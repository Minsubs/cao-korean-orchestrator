// 환경 프로필 비교(diff) — 순수 함수만, I/O 없음, React 없음.
//
// 별도 파일로 분리한 이유는 phase6c-tabs-front-spec.md §테스트가 명시적으로
// 요구하기 때문("비교 diff 계산...순수함수로 분리해 단위테스트:
// envProfileDiff.ts") — snapshot 두 개(저장/가져온 것과, 비교 시점에 새로
// 만든 "현재" 스냅샷)를 받아 차이만 계산한다. 두 스냅샷 모두 envProfile.ts의
// buildEnvSnapshot()이 만든 동일한 EnvSnapshot 모양이라 대칭적으로 비교할
// 수 있다.
import type { EnvSnapshot } from './envProfile'

export interface EnvFieldDiff {
  field: string
  snapshotValue: string | null
  liveValue: string | null
}

export interface NamedDiffEntry {
  name: string
  /** Extra context for display — provider for an agent profile, kind for an extension. */
  detail?: string
}

export interface CliPresenceDiff {
  cli: string
  onlyIn: 'snapshot' | 'live'
}

export interface InventoryCountDiff {
  cli: string
  kind: string
  snapshotCount: number
  liveCount: number
}

export interface EnvProfileDiffResult {
  /** "CLI 버전 드리프트" — see field list + rationale below. */
  environmentFieldDiffs: EnvFieldDiff[]
  /** A whole CLI's inventory present on only one side (inferred from a zero vs. non-zero total — see below). */
  cliPresenceDiffs: CliPresenceDiff[]
  onlyInSnapshot: { agentProfiles: NamedDiffEntry[]; extensions: NamedDiffEntry[] }
  onlyInLive: { agentProfiles: NamedDiffEntry[]; extensions: NamedDiffEntry[] }
  /** Per-kind count mismatches for a CLI present on *both* sides (a CLI only-on-one-side is reported via cliPresenceDiffs instead, not duplicated here). */
  inventoryCountDiffs: InventoryCountDiff[]
  hasDiff: boolean
}

// The spec's 4-endpoint snapshot schema carries a single passthrough
// `environment` object — there is no per-CLI-binary version array in scope
// (that lives in /tooling/providers, which this schema deliberately doesn't
// fetch). "CLI 버전 드리프트" is therefore read off this object's own
// version-shaped fields, generalized to every comparable field: the feature's
// actual use case (회사 Windows/WSL ↔ 개인 mac) cares about OS/shell drift
// just as much as a version string, and `server_version` (CAO's own version)
// is the one literal "버전" field this schema captures.
// `checked_at` is excluded on purpose — it's a scan timestamp, not
// environment state, so it would "differ" on every comparison and never be a
// meaningful drift signal.
const ENVIRONMENT_DIFF_FIELDS = ['os', 'os_version', 'arch', 'shell', 'is_wsl', 'server_version', 'python_version'] as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function formatFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? '예' : '아니오'
  return String(value)
}

function namesOf(entries: { name: string }[]): Set<string> {
  return new Set(entries.map(e => e.name))
}

function onlyInFirst<T extends { name: string }>(first: T[], secondNames: Set<string>, detailOf: (e: T) => string | undefined): NamedDiffEntry[] {
  return first.filter(e => !secondNames.has(e.name)).map(e => ({ name: e.name, detail: detailOf(e) }))
}

/**
 * Pure diff between a saved/imported snapshot and a freshly-rebuilt "live"
 * snapshot. No I/O — callers (EnvProfilesPane) are responsible for building
 * `live` via buildEnvSnapshot() at the moment of comparison ("비교 시점에
 * 재fetch").
 */
export function computeEnvDiff(snapshot: EnvSnapshot, live: EnvSnapshot): EnvProfileDiffResult {
  const snapEnv = asRecord(snapshot.environment)
  const liveEnv = asRecord(live.environment)
  const environmentFieldDiffs: EnvFieldDiff[] = []
  for (const field of ENVIRONMENT_DIFF_FIELDS) {
    const snapshotValue = formatFieldValue(snapEnv[field])
    const liveValue = formatFieldValue(liveEnv[field])
    if (snapshotValue !== liveValue) {
      environmentFieldDiffs.push({ field, snapshotValue, liveValue })
    }
  }

  // CLI presence, inferred from inventory totals — the schema carries no
  // explicit "present" flag (see envProfile.ts's EnvSnapshot.inventory_counts
  // doc comment), so an absent/empty inventory for a CLI stands in for "not
  // present on this machine".
  const clis = new Set([...Object.keys(snapshot.inventory_counts), ...Object.keys(live.inventory_counts)])
  const cliPresenceDiffs: CliPresenceDiff[] = []
  const inventoryCountDiffs: InventoryCountDiff[] = []
  for (const cli of clis) {
    const snapCounts = snapshot.inventory_counts[cli] ?? {}
    const liveCounts = live.inventory_counts[cli] ?? {}
    const snapTotal = snapCounts.total ?? 0
    const liveTotal = liveCounts.total ?? 0

    if (snapTotal === 0 && liveTotal === 0) continue
    if (snapTotal > 0 && liveTotal === 0) {
      cliPresenceDiffs.push({ cli, onlyIn: 'snapshot' })
      continue
    }
    if (liveTotal > 0 && snapTotal === 0) {
      cliPresenceDiffs.push({ cli, onlyIn: 'live' })
      continue
    }
    // Present on both sides — compare per-kind counts (including "total").
    const kinds = new Set([...Object.keys(snapCounts), ...Object.keys(liveCounts)])
    for (const kind of kinds) {
      const snapshotCount = snapCounts[kind] ?? 0
      const liveCount = liveCounts[kind] ?? 0
      if (snapshotCount !== liveCount) {
        inventoryCountDiffs.push({ cli, kind, snapshotCount, liveCount })
      }
    }
  }

  const snapProfileNames = namesOf(snapshot.agent_profiles)
  const liveProfileNames = namesOf(live.agent_profiles)
  const onlyInSnapshotProfiles = onlyInFirst(snapshot.agent_profiles, liveProfileNames, p => p.provider ?? undefined)
  const onlyInLiveProfiles = onlyInFirst(live.agent_profiles, snapProfileNames, p => p.provider ?? undefined)

  const snapExtNames = namesOf(snapshot.extensions_summary)
  const liveExtNames = namesOf(live.extensions_summary)
  const onlyInSnapshotExt = onlyInFirst(snapshot.extensions_summary, liveExtNames, e => e.kind)
  const onlyInLiveExt = onlyInFirst(live.extensions_summary, snapExtNames, e => e.kind)

  const hasDiff =
    environmentFieldDiffs.length > 0 ||
    cliPresenceDiffs.length > 0 ||
    inventoryCountDiffs.length > 0 ||
    onlyInSnapshotProfiles.length > 0 ||
    onlyInLiveProfiles.length > 0 ||
    onlyInSnapshotExt.length > 0 ||
    onlyInLiveExt.length > 0

  return {
    environmentFieldDiffs,
    cliPresenceDiffs,
    onlyInSnapshot: { agentProfiles: onlyInSnapshotProfiles, extensions: onlyInSnapshotExt },
    onlyInLive: { agentProfiles: onlyInLiveProfiles, extensions: onlyInLiveExt },
    inventoryCountDiffs,
    hasDiff,
  }
}
