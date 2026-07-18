import { ENV_SNAPSHOT_SCHEMA, type EnvCliVersionSummary, type EnvSnapshot } from './envProfileSnapshot'

const STORAGE_KEY = 'cao:env-profiles:v1'

function isCliVersionSummary(value: unknown): value is EnvCliVersionSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.name === 'string' &&
    typeof item.display_name === 'string' &&
    (typeof item.version === 'string' || item.version === null)
  )
}

export function isValidSnapshotShape(value: unknown): value is EnvSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return (
    snapshot.schema === ENV_SNAPSHOT_SCHEMA &&
    typeof snapshot.captured_at === 'string' &&
    typeof snapshot.label === 'string' &&
    Array.isArray(snapshot.extensions_summary) &&
    Array.isArray(snapshot.agent_profiles) &&
    typeof snapshot.inventory_counts === 'object' &&
    snapshot.inventory_counts !== null &&
    (snapshot.cli_versions === undefined ||
      (Array.isArray(snapshot.cli_versions) && snapshot.cli_versions.every(isCliVersionSummary)))
  )
}

export function loadSavedSnapshots(): EnvSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidSnapshotShape)
  } catch {
    return []
  }
}

function persistSnapshots(snapshots: EnvSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots))
  } catch {
    // Best effort: keep the in-memory result usable when storage is disabled.
  }
}

export function saveSnapshot(snapshot: EnvSnapshot): EnvSnapshot[] {
  const next = [...loadSavedSnapshots(), snapshot]
  persistSnapshots(next)
  return next
}

export function deleteSnapshot(capturedAt: string): EnvSnapshot[] {
  const next = loadSavedSnapshots().filter(snapshot => snapshot.captured_at !== capturedAt)
  persistSnapshots(next)
  return next
}
