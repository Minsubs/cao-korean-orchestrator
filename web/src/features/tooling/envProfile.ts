// 환경 프로필 탭 (Phase 6c) — 스냅샷 조립 + 로컬 저장 + 내보내기/가져오기.
//
// 신규 백엔드 없음: 이미 존재하는 네 개의 실 API를 병렬로 호출해 하나의
// 스냅샷으로 조립한다(phase6c-tabs-front-spec.md §B).
//   - GET /tooling/environment   (api.tooling.ts — toolingApi.getEnvironment)
//   - GET /tooling/extensions    (api.tooling.ts — toolingApi.listExtensions)
//   - GET /agents/profiles       (api.ts — api.listProfiles, read-only import)
//   - GET /env/inventory?cli=all (env_router.py — 이 파일 전용 소형 fetch, 아래)
//
// 스냅샷은 브라우저 localStorage에만 저장된다(다른 머신과 비교하려면 내보낸
// JSON 파일을 가져와야 한다) — 절대 파일 내용/토큰을 담지 않는다(이름·버전·
// 개수만). 이 파일은 순수 로직 + fetch만 담당하고 렌더링은 EnvProfilesPane이,
// diff 계산은 envProfileDiff.ts가 담당한다(단위테스트 용이성을 위한 분리).
import { api } from '../../api'
import type { AgentProfileInfoWithModel } from '../../api.profiles'
import { toolingApi } from '../../api.tooling'

export const ENV_SNAPSHOT_SCHEMA = 'cao-env-profile/v1' as const

export interface EnvExtensionSummaryItem {
  kind: string
  name: string
  scope?: string
}

export interface EnvAgentProfileSummary {
  name: string
  provider: string | null
  model: string | null
}

/**
 * `environment` is an intentional passthrough of `/tooling/environment`'s raw
 * body (`unknown`, per the spec schema) — this module never assumes a shape
 * beyond what it directly reads (see `environmentSummaryChips` below);
 * envProfileDiff.ts does its own defensive field-by-field reading too.
 */
export interface EnvSnapshot {
  schema: typeof ENV_SNAPSHOT_SCHEMA
  captured_at: string
  label: string
  environment: unknown
  extensions_summary: EnvExtensionSummaryItem[]
  agent_profiles: EnvAgentProfileSummary[]
  inventory_counts: Record<string, Record<string, number>>
}

export type EnvSnapshotSection = 'environment' | 'extensions' | 'agent_profiles' | 'inventory'

export const ENV_SNAPSHOT_SECTIONS: EnvSnapshotSection[] = ['environment', 'extensions', 'agent_profiles', 'inventory']

/** Human-facing endpoint label for the "X 조회 실패 — 이 항목 제외" honest-partial-failure message. */
export const ENV_SNAPSHOT_SECTION_LABEL: Record<EnvSnapshotSection, string> = {
  environment: '/tooling/environment',
  extensions: '/tooling/extensions',
  agent_profiles: '/agents/profiles',
  inventory: '/env/inventory',
}

export function defaultSnapshotLabel(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

// ── /env/inventory (env_router.py, Phase 6b — already landed & mounted) ────
// No client wrapper exists for this router anywhere yet. Kept local to this
// module (not api.tooling.ts, which is documented as talking to the
// tooling_router backend specifically) rather than touching any of the
// forbidden api*.ts files for this phase.
interface EnvInventoryCliEntry {
  cli: string
  present: boolean
  items: unknown[]
  counts: Record<string, number>
  note: string | null
}

interface EnvInventoryAllResponse {
  clis: EnvInventoryCliEntry[]
}

async function fetchInventoryAll(): Promise<EnvInventoryAllResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch('/env/inventory?cli=all', { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`)
    }
    return (await res.json()) as EnvInventoryAllResponse
  } finally {
    clearTimeout(timeout)
  }
}

export interface BuildSnapshotOutcome {
  snapshot: EnvSnapshot
  /** Endpoints that failed independently — the snapshot still assembles from whatever succeeded (see ENV_SNAPSHOT_SECTION_LABEL for display). */
  failedSections: EnvSnapshotSection[]
}

/**
 * Parallel-fetches all four source endpoints and assembles one EnvSnapshot.
 * Each endpoint is isolated (Promise.allSettled) — a single failing section
 * degrades to an empty/absent value and is reported in `failedSections`
 * rather than failing the whole snapshot (spec: "부분 fetch 실패 시 해당
 * 섹션 결측 정직 표기"). Callers decide what "all four failed" means for
 * their own UI (EnvProfilesPane declines to save a fully-empty snapshot).
 */
export async function buildEnvSnapshot(label: string): Promise<BuildSnapshotOutcome> {
  const [envRes, extRes, profRes, invRes] = await Promise.allSettled([
    toolingApi.getEnvironment(),
    toolingApi.listExtensions(),
    api.listProfiles(),
    fetchInventoryAll(),
  ])

  const failedSections: EnvSnapshotSection[] = []

  let environment: unknown = null
  if (envRes.status === 'fulfilled') {
    environment = envRes.value
  } else {
    failedSections.push('environment')
  }

  let extensions_summary: EnvExtensionSummaryItem[] = []
  if (extRes.status === 'fulfilled') {
    extensions_summary = extRes.value.map(e => ({
      kind: e.kind,
      name: e.name,
      ...(e.scope ? { scope: e.scope } : {}),
    }))
  } else {
    failedSections.push('extensions')
  }

  let agent_profiles: EnvAgentProfileSummary[] = []
  if (profRes.status === 'fulfilled') {
    // api.ts's declared AgentProfileInfo return type intentionally doesn't
    // carry provider/model (forbidden file for this phase) — the real
    // response does (landed 5.5-A contract, see api.profiles.ts's own
    // AgentProfileInfoWithModel + comment). Same read-only-augment approach
    // that file already established.
    const profiles = profRes.value as AgentProfileInfoWithModel[]
    agent_profiles = profiles.map(p => ({
      name: p.name,
      provider: p.provider ?? null,
      model: p.model ?? null,
    }))
  } else {
    failedSections.push('agent_profiles')
  }

  let inventory_counts: Record<string, Record<string, number>> = {}
  if (invRes.status === 'fulfilled') {
    inventory_counts = Object.fromEntries(invRes.value.clis.map(c => [c.cli, c.counts]))
  } else {
    failedSections.push('inventory')
  }

  const snapshot: EnvSnapshot = {
    schema: ENV_SNAPSHOT_SCHEMA,
    captured_at: new Date().toISOString(),
    label: label.trim() || defaultSnapshotLabel(),
    environment,
    extensions_summary,
    agent_profiles,
    inventory_counts,
  }

  return { snapshot, failedSections }
}

// ── localStorage — "이 브라우저에만 저장돼요" ───────────────────────────────
const STORAGE_KEY = 'cao:env-profiles:v1'

function isValidSnapshotShape(value: unknown): value is EnvSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.schema === ENV_SNAPSHOT_SCHEMA &&
    typeof v.captured_at === 'string' &&
    typeof v.label === 'string' &&
    Array.isArray(v.extensions_summary) &&
    Array.isArray(v.agent_profiles) &&
    typeof v.inventory_counts === 'object' &&
    v.inventory_counts !== null
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
    // Best-effort only (storage quota exceeded/disabled) — the in-memory
    // list still reflects the change for the rest of this session.
  }
}

export function saveSnapshot(snapshot: EnvSnapshot): EnvSnapshot[] {
  const next = [...loadSavedSnapshots(), snapshot]
  persistSnapshots(next)
  return next
}

export function deleteSnapshot(capturedAt: string): EnvSnapshot[] {
  const next = loadSavedSnapshots().filter(s => s.captured_at !== capturedAt)
  persistSnapshots(next)
  return next
}

// ── 내보내기 (JSON 파일 다운로드) ────────────────────────────────────────────
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

/** DOM-touching (Blob + anchor click) — not unit tested directly; snapshotFilename()/serializeSnapshot() above carry the tested logic (same split AddAgentModal.tsx uses for its markdown download). */
export function downloadSnapshot(snapshot: EnvSnapshot): void {
  const blob = new Blob([serializeSnapshot(snapshot)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = snapshotFilename(snapshot.label)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── 가져오기 (파일 선택 또는 붙여넣기) ───────────────────────────────────────
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

/** Best-effort {os, server_version} read off the passthrough `environment` blob, for the saved-list card's summary chips. */
export function environmentSummaryChips(environment: unknown): { os: string | null; serverVersion: string | null } {
  if (!environment || typeof environment !== 'object') return { os: null, serverVersion: null }
  const env = environment as Record<string, unknown>
  const os = typeof env.os === 'string' ? env.os : null
  const serverVersion = typeof env.server_version === 'string' ? env.server_version : null
  return { os, serverVersion }
}
