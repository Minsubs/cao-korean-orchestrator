import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import type { AgentProfileInfoWithModel } from '../api.profiles'
import { toolingApi } from '../api.tooling'
import {
  ENV_SNAPSHOT_SCHEMA,
  InvalidSnapshotError,
  buildEnvSnapshot,
  deleteSnapshot,
  loadSavedSnapshots,
  parseSnapshotJson,
  saveSnapshot,
  serializeSnapshot,
  snapshotFilename,
  type EnvSnapshot,
} from '../features/tooling/envProfile'

function legacySnapshot(overrides: Partial<EnvSnapshot> = {}): EnvSnapshot {
  return {
    schema: ENV_SNAPSHOT_SCHEMA,
    captured_at: '2026-07-18T00:00:00.000Z',
    label: 'office mac',
    environment: { os: 'macOS' },
    extensions_summary: [],
    agent_profiles: [],
    inventory_counts: {},
    ...overrides,
  }
}

describe('environment profile snapshot helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(toolingApi, 'getEnvironment').mockResolvedValue({
      os: 'macOS', os_version: '26.5', arch: 'arm64', shell: '/bin/zsh', is_wsl: false,
      server_version: '2.3.0', python_version: '3.11.15', checked_at: null,
    })
    vi.spyOn(toolingApi, 'listProviders').mockResolvedValue([
      { name: 'codex', display_name: 'Codex CLI', binary: 'codex', installed: true, path: '/secret/bin/codex', version: '0.144.5', version_error: null, checked_at: 'now' },
      { name: 'claude_code', display_name: 'Claude Code', binary: 'claude', installed: true, path: '/secret/bin/claude', version: null, version_error: 'unknown', checked_at: 'now' },
      { name: 'missing', display_name: 'Missing', binary: 'missing', installed: false, path: null, version: null, version_error: null, checked_at: null },
    ])
    vi.spyOn(toolingApi, 'listExtensions').mockResolvedValue([])
    const profiles: AgentProfileInfoWithModel[] = [
      { name: 'reviewer', description: 'Review', source: 'built-in', provider: 'codex', model: 'gpt-5' },
    ]
    vi.spyOn(api, 'listProfiles').mockResolvedValue(profiles)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ clis: [{ cli: 'codex', counts: { total: 2, skill: 2 } }] }), { status: 200 })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('assembles five sources while retaining only safe installed CLI version fields', async () => {
    const { snapshot, failedSections } = await buildEnvSnapshot(' work mac ')

    expect(failedSections).toEqual([])
    expect(snapshot.label).toBe('work mac')
    expect(snapshot.cli_versions).toEqual([
      { name: 'codex', display_name: 'Codex CLI', version: '0.144.5' },
      { name: 'claude_code', display_name: 'Claude Code', version: null },
    ])
    expect(snapshot.cli_versions?.[0]).not.toHaveProperty('path')
    expect(snapshot.agent_profiles).toEqual([{ name: 'reviewer', provider: 'codex', model: 'gpt-5' }])
    expect(snapshot.inventory_counts).toEqual({ codex: { total: 2, skill: 2 } })
    expect(toolingApi.listProviders).toHaveBeenCalledOnce()
  })

  it('reports provider failure separately and omits unknown CLI data', async () => {
    vi.mocked(toolingApi.listProviders).mockRejectedValueOnce(new Error('offline'))

    const { snapshot, failedSections } = await buildEnvSnapshot('partial')

    expect(failedSections).toEqual(['providers'])
    expect(snapshot).not.toHaveProperty('cli_versions')
    expect(snapshot.environment).toMatchObject({ os: 'macOS' })
  })

  it('loads legacy v1 snapshots and persists save/delete operations', () => {
    const snapshot = legacySnapshot()
    expect(saveSnapshot(snapshot)).toEqual([snapshot])
    expect(loadSavedSnapshots()).toEqual([snapshot])
    expect(deleteSnapshot(snapshot.captured_at)).toEqual([])
    expect(loadSavedSnapshots()).toEqual([])
  })

  it('round-trips legacy and additive snapshots while rejecting malformed JSON', () => {
    const snapshot = legacySnapshot({ cli_versions: [{ name: 'codex', display_name: 'Codex CLI', version: '0.144.5' }] })
    expect(parseSnapshotJson(serializeSnapshot(snapshot))).toEqual(snapshot)
    expect(parseSnapshotJson(serializeSnapshot(legacySnapshot()))).toEqual(legacySnapshot())
    expect(() => parseSnapshotJson('{bad')).toThrowError(InvalidSnapshotError)
    expect(() => parseSnapshotJson('{}')).toThrow(`${ENV_SNAPSHOT_SCHEMA} 형식이 아니에요`)
  })

  it('creates a stable sanitized export filename', () => {
    expect(snapshotFilename(' 회사 Mac / 2026 ')).toBe('cao-env-회사_Mac_2026.json')
  })
})
