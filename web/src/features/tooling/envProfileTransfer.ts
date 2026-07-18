import { ENV_SNAPSHOT_SCHEMA, type EnvSnapshot } from './envProfileSnapshot'
import { isValidSnapshotShape } from './envProfileStorage'

export function snapshotFilename(label: string): string {
  const safe = label
    .trim()
    .replace(/[^A-Za-z0-9가-힣_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return `cao-env-${safe || 'snapshot'}.json`
}

export function serializeSnapshot(snapshot: EnvSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

export function downloadSnapshot(snapshot: EnvSnapshot): void {
  const blob = new Blob([serializeSnapshot(snapshot)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = snapshotFilename(snapshot.label)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export class InvalidSnapshotError extends Error {}

export function parseSnapshotJson(raw: string): EnvSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new InvalidSnapshotError(`${ENV_SNAPSHOT_SCHEMA} 형식이 아니에요`)
  }
  if (!isValidSnapshotShape(parsed)) {
    throw new InvalidSnapshotError(`${ENV_SNAPSHOT_SCHEMA} 형식이 아니에요`)
  }
  return parsed
}
