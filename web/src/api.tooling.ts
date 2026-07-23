// api.tooling.ts — Tooling & Extensions API client.
// Phase 3b: read-only environment/providers/extensions/diagnostics/scan.
// Phase 4b: write path — adapters/plan/execute/operations (Operation Queue).
//
// Talks to the tooling_router.py backend (services/tooling/, developed in
// parallel across phases). The contract below is fixed by
// docs/ui-refactor-plan.md §4 and the phase3a/phase4a specs — do not add
// fields the backend doesn't document.
//
// Availability stance: every endpoint here can 404 (router not mounted yet,
// or a Phase 4a endpoint not landed yet) or fail on the network
// independently. Callers MUST treat that as an honest error state (see
// features/tooling/ToolingView.tsx and useToolingOperations.ts) — never fall
// back to mock/sample data to paper over a dead backend.
const BASE = ''  // Vite proxy handles routing to backend, same as api.ts

export interface ApiError extends Error {
  status?: number
  detail?: string
}

// Default abort timeout for calls that don't pass `timeoutMs` explicitly. Most
// of this file's GETs are read-only probes that shell out to CLI binaries
// (providers/adapters/catalog) — on WSL those cold-start slowly (catalog can
// take ~20s+, and the first mount fires 8 of these concurrently, contending
// for the same subprocess pool). 10s was tight enough that a slow-but-healthy
// probe would self-abort into `net::ERR_ABORTED`, which ToolingView had no way
// to distinguish from a truly dead backend. 60s gives real WSL cold starts
// headroom without masking an actually-hung server (an abort still fires, it
// just isn't racing the probe itself). Explicit callers below (scan/execute)
// already carry their own — larger — timeoutMs and are untouched.
const DEFAULT_TIMEOUT_MS = 60000

async function fetchJSON<T>(url: string, opts?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${url}`, { ...opts, signal: controller.signal })
    if (!res.ok) {
      // Best-effort read of the JSON error body to expose the server's
      // `detail` without leaking a full response. A non-JSON body is fine —
      // detail just stays undefined.
      let detail: string | undefined
      try {
        const body = await res.json()
        if (body && typeof body.detail === 'string') detail = body.detail
      } catch { /* non-JSON error body */ }
      const err: ApiError = new Error(`${res.status} ${res.statusText}`)
      err.status = res.status
      err.detail = detail
      throw err
    }
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

export interface ToolingEnvironment {
  os: string | null
  os_version: string | null
  arch: string | null
  shell: string | null
  is_wsl: boolean | null
  server_version: string | null
  python_version: string | null
  checked_at: string | null
}

export interface ToolingProvider {
  name: string
  display_name: string
  binary: string
  installed: boolean
  path: string | null
  version: string | null
  version_error: string | null
  checked_at: string | null
}

// 'mcp' added in Phase 5b — 5a's claude_code/codex/antigravity adapters can
// report provider-native MCP servers (e.g. `claude mcp list`) through this
// same /tooling/extensions read path (see features/tooling/InstalledPane.tsx
// "설치됨 탭 확장"). Additive only: existing 'skill'|'plugin'|'profile'
// consumers are unaffected.
export type ExtensionKind = 'skill' | 'plugin' | 'profile' | 'mcp'
export type ExtensionScope = 'built-in' | 'user'

export interface ToolingExtension {
  id: string
  kind: ExtensionKind
  name: string
  description: string | null
  scope: ExtensionScope
  source_path: string | null
  provider: string | null
  enabled: boolean
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface ToolingDiagnostic {
  severity: DiagnosticSeverity
  code: string
  title: string
  cause: string | null
  impact: string | null
  recommendation: string | null
  provider?: string | null
  path?: string | null
}

export interface ToolingScanResult {
  scanned_at: string
}

// ── Phase 4b additions — write path (adapters/plan/execute/operations) ─────
// Same availability stance as above: any of these can 404 independently
// (Phase 4a backend developed in parallel) or fail on the network. Callers
// degrade the affected control/section honestly — never a full-screen crash
// for these alone, and never mock/sample data standing in for a real answer.

export type ToolingAction = 'install' | 'remove' | 'update' | 'update_all'

export interface ToolingAdapterDetected {
  installed: boolean
  path: string | null
  version: string | null
}

/** Keys mirror ExtensionAdapter.capabilities() on the backend (services/tooling/adapters/base.py). */
export type ToolingCapabilityKey =
  | 'canList'
  | 'canInstall'
  | 'canRemove'
  | 'canUpdate'
  | 'canUpdateAll'
  | 'requiresNewSession'
  | 'requiresRestart'

export interface ToolingCapabilities {
  canList: boolean
  canInstall: boolean
  canRemove: boolean
  canUpdate: boolean
  canUpdateAll: boolean
  requiresNewSession: boolean
  requiresRestart: boolean
  /** Present only for capabilities the adapter reports as unsupported. */
  reasons: Partial<Record<ToolingCapabilityKey, string>>
}

export interface ToolingAdapter {
  id: string
  display_name: string
  detected: ToolingAdapterDetected
  capabilities: ToolingCapabilities
}

export interface ToolingPlanRequest {
  action: ToolingAction
  provider: string
  target?: string
  scope?: string
  /** Phase 5b catalog installs that need extra input (e.g. filesystem MCP's {path}) — see needs_params on CatalogItem. */
  params?: Record<string, string>
}

export interface ToolingExecutionPlan {
  description: string
  argv: string[]
  cwd: string
  verify_description: string
  warnings: string[]
}

export interface ToolingExecuteResult {
  operation_id: string
}

export type ToolingOperationStatus =
  | 'queued'
  | 'running'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'partially_succeeded'

export interface ToolingOperation {
  id: string
  action: ToolingAction
  provider: string
  target: string | null
  scope: string | null
  status: ToolingOperationStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  error: string | null
  verified: boolean | null
}

/** `GET /tooling/operations/{id}` — the list view (`ToolingOperation`) plus the masked log. */
export interface ToolingOperationDetail extends ToolingOperation {
  log: string[]
}

export interface ToolingCancelResult {
  cancelled: boolean
}

// ── Phase 5b additions — 인기 확장 카탈로그 (탐색 탭) ────────────────────────
// Schema fixed by docs 스크래치패드 phase5a-spec.md §2 / phase5b-spec.md §백엔드
// 계약. Same availability stance as the rest of this file: /tooling/catalog
// can independently 404 (Phase 5a backend developed in parallel, "아직 발주
// 전" at the time this client was written) — DiscoverPane degrades only its
// own tab to an honest error+retry state, never mock/sample data.
//
// Note: `CatalogProviderSupport.method`/`.command` aren't spelled out
// character-for-character on the phase5b contract's one-line schema, but are
// required by that same spec's own "method가 manual이면 [명령 복사] 제공"
// bullet — treated here as part of the same per-provider `supported` object
// 5a is expected to populate. If 5a's real response omits them, the
// 명령 복사 button simply doesn't render (the disabled button + reason
// tooltip still do) rather than fabricating a command — see DiscoverPane.tsx.
//
// 'cli' added in Phase 6c: the landed backend (services/tooling/catalog.py)
// ships one kind='cli' bootstrap item ("generic-skills-cli") alongside
// mcp/plugin/skill — a prerequisite CLI shown via method='manual' regardless
// of whether it's currently detected. Additive only.
export type CatalogKind = 'mcp' | 'plugin' | 'skill' | 'cli'

// Shape verified against the landed Phase 5a backend (catalog.list_catalog):
// per-provider state lives entirely inside `supported[provider]` — there is no
// top-level install_status/needs_params.
export interface CatalogProviderSupport {
  /** Install mechanism ('cli' argv via plan/execute, or 'manual'). */
  method: string
  /** Runtime params the install needs (e.g. ['path'] for the filesystem MCP). */
  requires_params: string[]
  install_status: 'installed' | 'not_installed' | 'unknown'
  /** Whether the in-UI install path is available for this provider. */
  supported: boolean
  /** Why installation isn't available, when supported=false. */
  reason: string | null
  /** The exact command to show/copy for method='manual'. Never a secret (github MCP's token requirement surfaces as a plan `warnings` entry instead — see PreviewModal). */
  command?: string
}

export interface CatalogItem {
  id: string
  name: string
  description_ko: string
  kind: CatalogKind
  category: string
  providers: string[]
  homepage: string | null
  requires: string[]
  popular: boolean
  new_session_required: boolean
  warnings: string[]
  install: Record<string, { method: string; argv: string[] }>
  supported: Record<string, CatalogProviderSupport>
}

// ── Phase 6c additions — 소스 탭 (도구/확장이 어디서 오는지) ──────────────────
// Schema fixed by the phase6c-tabs-front-spec.md scratchpad (§A). Developed in
// parallel by a separate backend session — `/tooling/sources` can 404 or
// otherwise fail independently of every endpoint above while that lands.
// SourcesPane degrades only its own tab to an honest error+retry state (same
// availability stance as /tooling/catalog above), never mock/sample data.
export interface ToolingSourceDirectory {
  path: string
  /** Only meaningful for skill/agent-profile directories (store vs. user-added). Absent for other kinds. */
  scope?: 'store' | 'user'
  /** Present when the directory is scoped to one CLI provider (e.g. a provider's own skills dir). */
  cli?: string
  kind: string
  count: number
  exists: boolean
}

export interface ToolingCatalogSummary {
  count: number
  kinds: Record<string, number>
  origin: string
  note: string
}

export interface ToolingMarketplaceItem {
  name: string
  source?: string
}

export interface ToolingMarketplace {
  supported: boolean
  items: ToolingMarketplaceItem[] | null
  reason: string | null
  /** A copyable CLI command for managing this marketplace outside the UI (no in-app add/remove yet). */
  manage_hint?: string
}

export interface ToolingSources {
  directory_sources: ToolingSourceDirectory[]
  catalog: ToolingCatalogSummary
  marketplaces: Record<string, ToolingMarketplace>
}

function postJSON<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  return fetchJSON<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs,
  })
}

export const toolingApi = {
  getEnvironment: () => fetchJSON<ToolingEnvironment>('/tooling/environment'),
  listProviders: () => fetchJSON<ToolingProvider[]>('/tooling/providers'),
  listExtensions: () => fetchJSON<ToolingExtension[]>('/tooling/extensions'),
  listDiagnostics: () => fetchJSON<ToolingDiagnostic[]>('/tooling/diagnostics'),
  scan: () => fetchJSON<ToolingScanResult>('/tooling/scan', { method: 'POST', timeoutMs: 30000 }),

  listAdapters: () => fetchJSON<ToolingAdapter[]>('/tooling/adapters'),
  plan: (body: ToolingPlanRequest) => postJSON<ToolingExecutionPlan>('/tooling/plan', body),
  execute: (body: ToolingPlanRequest) => postJSON<ToolingExecuteResult>('/tooling/execute', body, 30000),
  listOperations: () => fetchJSON<ToolingOperation[]>('/tooling/operations'),
  getOperation: (id: string) => fetchJSON<ToolingOperationDetail>(`/tooling/operations/${encodeURIComponent(id)}`),
  cancelOperation: (id: string) => postJSON<ToolingCancelResult>(`/tooling/operations/${encodeURIComponent(id)}/cancel`, {}),

  listCatalog: () => fetchJSON<CatalogItem[]>('/tooling/catalog'),

  getSources: () => fetchJSON<ToolingSources>('/tooling/sources'),
}
