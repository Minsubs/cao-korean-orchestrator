import { describe, it, expect } from 'vitest'
import { computeEnvDiff } from '../features/tooling/envProfileDiff'
import { ENV_SNAPSHOT_SCHEMA, type EnvSnapshot } from '../features/tooling/envProfile'

// Pure-function tests for the diff engine (no React, no fetch) — see
// phase6c-tabs-front-spec.md §테스트: "비교 diff 계산(버전 드리프트+프로필
// 누락 — 순수함수로 분리해 단위테스트: envProfileDiff.ts)".

function makeSnapshot(overrides: Partial<EnvSnapshot> = {}): EnvSnapshot {
  return {
    schema: ENV_SNAPSHOT_SCHEMA,
    captured_at: '2026-07-01T00:00:00.000Z',
    label: 'base',
    environment: {
      os: 'macOS',
      os_version: '15.5',
      arch: 'arm64',
      shell: '/bin/zsh',
      is_wsl: false,
      server_version: 'v2.3.0',
      python_version: '3.11.4',
      checked_at: '2026-07-01T00:00:00.000Z',
    },
    extensions_summary: [],
    agent_profiles: [],
    inventory_counts: {},
    ...overrides,
  }
}

describe('computeEnvDiff', () => {
  it('reports no diff for two structurally identical snapshots (hasDiff=false, every list empty)', () => {
    const a = makeSnapshot()
    const b = makeSnapshot({ captured_at: '2026-07-17T09:00:00.000Z', label: 'live' })
    const diff = computeEnvDiff(a, b)
    expect(diff.hasDiff).toBe(false)
    expect(diff.environmentFieldDiffs).toEqual([])
    expect(diff.cliPresenceDiffs).toEqual([])
    expect(diff.inventoryCountDiffs).toEqual([])
    expect(diff.onlyInSnapshot.agentProfiles).toEqual([])
    expect(diff.onlyInLive.agentProfiles).toEqual([])
    expect(diff.onlyInSnapshot.extensions).toEqual([])
    expect(diff.onlyInLive.extensions).toEqual([])
  })

  it('flags a server_version drift ("CLI 버전 드리프트") with both values, leaving unrelated fields alone', () => {
    const snapshot = makeSnapshot({ environment: { ...makeSnapshot().environment as object, server_version: 'v2.3.0' } })
    const live = makeSnapshot({ environment: { ...makeSnapshot().environment as object, server_version: 'v2.4.0' } })
    const diff = computeEnvDiff(snapshot, live)
    expect(diff.hasDiff).toBe(true)
    expect(diff.environmentFieldDiffs).toEqual([{ field: 'server_version', snapshotValue: 'v2.3.0', liveValue: 'v2.4.0' }])
  })

  it('formats boolean/null environment fields honestly (예/아니오, null stays null) and ignores checked_at entirely', () => {
    const snapshot = makeSnapshot({
      environment: { os: 'macOS', is_wsl: false, server_version: null, checked_at: '2026-07-01T00:00:00.000Z' },
    })
    const live = makeSnapshot({
      environment: { os: 'macOS', is_wsl: true, server_version: null, checked_at: '2099-01-01T00:00:00.000Z' },
    })
    const diff = computeEnvDiff(snapshot, live)
    // is_wsl differs (false -> true); server_version is null on both sides
    // (no diff); checked_at always differs between two captures but must
    // never show up as a field diff.
    expect(diff.environmentFieldDiffs).toEqual([{ field: 'is_wsl', snapshotValue: '아니오', liveValue: '예' }])
  })

  it('flags a CLI present only in the snapshot as "onlyIn: snapshot" (미설치 now) without duplicating it into inventoryCountDiffs', () => {
    const snapshot = makeSnapshot({ inventory_counts: { claude_code: { total: 5, skill: 3, instruction: 2 } } })
    const live = makeSnapshot({ inventory_counts: {} })
    const diff = computeEnvDiff(snapshot, live)
    expect(diff.cliPresenceDiffs).toEqual([{ cli: 'claude_code', onlyIn: 'snapshot' }])
    expect(diff.inventoryCountDiffs).toEqual([])
  })

  it('flags a CLI present only live as "onlyIn: live" (newly installed since the snapshot)', () => {
    const snapshot = makeSnapshot({ inventory_counts: {} })
    const live = makeSnapshot({ inventory_counts: { codex: { total: 2, instruction: 1, prompt: 1 } } })
    const diff = computeEnvDiff(snapshot, live)
    expect(diff.cliPresenceDiffs).toEqual([{ cli: 'codex', onlyIn: 'live' }])
    expect(diff.inventoryCountDiffs).toEqual([])
  })

  it('reports per-kind inventory count drift for a CLI present on both sides, and skips kinds that match', () => {
    const snapshot = makeSnapshot({ inventory_counts: { claude_code: { total: 5, skill: 3, instruction: 2 } } })
    const live = makeSnapshot({ inventory_counts: { claude_code: { total: 6, skill: 4, instruction: 2 } } })
    const diff = computeEnvDiff(snapshot, live)
    expect(diff.cliPresenceDiffs).toEqual([])
    expect(diff.inventoryCountDiffs).toEqual(
      expect.arrayContaining([
        { cli: 'claude_code', kind: 'total', snapshotCount: 5, liveCount: 6 },
        { cli: 'claude_code', kind: 'skill', snapshotCount: 3, liveCount: 4 },
      ]),
    )
    // instruction matches on both sides (2 === 2) — not reported.
    expect(diff.inventoryCountDiffs.some(d => d.kind === 'instruction')).toBe(false)
  })

  it('flags agent profiles missing on one side, by name, carrying provider as `detail`', () => {
    const snapshot = makeSnapshot({
      agent_profiles: [
        { name: 'data_analyst', provider: 'claude_code', model: 'sonnet' },
        { name: 'shared_profile', provider: 'codex', model: null },
      ],
    })
    const live = makeSnapshot({ agent_profiles: [{ name: 'shared_profile', provider: 'codex', model: null }] })
    const diff = computeEnvDiff(snapshot, live)
    expect(diff.onlyInSnapshot.agentProfiles).toEqual([{ name: 'data_analyst', detail: 'claude_code' }])
    expect(diff.onlyInLive.agentProfiles).toEqual([])
    expect(diff.hasDiff).toBe(true)
  })

  it('flags extensions missing on one side, by name, carrying kind as `detail`', () => {
    const snapshot = makeSnapshot({ extensions_summary: [{ kind: 'skill', name: 'docx', scope: 'user' }] })
    const live = makeSnapshot({
      extensions_summary: [
        { kind: 'skill', name: 'docx', scope: 'user' },
        { kind: 'plugin', name: 'frontend-design', scope: 'user' },
      ],
    })
    const diff = computeEnvDiff(snapshot, live)
    expect(diff.onlyInSnapshot.extensions).toEqual([])
    expect(diff.onlyInLive.extensions).toEqual([{ name: 'frontend-design', detail: 'plugin' }])
    expect(diff.hasDiff).toBe(true)
  })
})
