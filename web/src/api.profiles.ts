// New client functions for Phase 5c (Agent Profiles screen). Kept in its own
// module — api.ts's existing flows/profiles functions are imported as-is
// (read-only reuse); this file only adds the two endpoints api.ts does not
// have yet: profile install and the (Phase 5a, in-flight) model catalog.
import type { ApiError, AgentProfileInfo, Terminal } from './api'

const BASE = '' // Vite proxy handles routing to backend, same convention as api.ts

async function fetchJSON<T>(url: string, opts?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 10000)
  try {
    const res = await fetch(`${BASE}${url}`, { ...opts, signal: controller.signal })
    if (!res.ok) {
      let detail: string | undefined
      try {
        const body = await res.json()
        if (body && typeof body.detail === 'string') detail = body.detail
      } catch {
        /* non-JSON error body */
      }
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

// ── Agent profile install (POST /agents/profiles/install) ──────────────────
// Mirrors backend api/main.py InstallAgentProfileRequest and
// services/install_service.py InstallResult exactly (field names + optionality).
export interface InstallAgentProfileRequest {
  source: string
  provider?: string
  env_vars?: Record<string, string>
}

export interface InstallAgentProfileResult {
  success: boolean
  message: string
  agent_name?: string
  context_file?: string
  agent_file?: string
  unresolved_vars?: string[]
  source_kind?: 'url' | 'file' | 'name'
  provider?: string
}

/**
 * Calls the real install endpoint. NOTE: confirmed by reading
 * services/install_service.py (install_agent) that `source` only accepts an
 * https:// URL or a bare profile name already resolvable via
 * `_read_agent_profile_source()` (an existing agent-dirs/local-store/built-in
 * entry) — raw file content is deliberately never accepted over HTTP ("Local
 * .md file paths are deliberately NOT accepted here"). A profile generated
 * client-side (Agent 추가 모달) therefore CANNOT be installed through this
 * call — there is nothing on disk yet for `source` to resolve to. The modal
 * does not invoke this function for that flow; it degrades honestly to a
 * markdown download + `cao install` command instead (see profileTemplate.ts).
 * This client fn is still provided for API-contract completeness and for any
 * future flow that installs an *existing* named/URL profile.
 */
export function installAgentProfile(body: InstallAgentProfileRequest): Promise<InstallAgentProfileResult> {
  return fetchJSON<InstallAgentProfileResult>('/agents/profiles/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 30000,
  })
}

// ── Model catalog (GET /tooling/models) ─────────────────────────────────────
// Phase 5a builds this endpoint in parallel; it may 404 or be unreachable
// while that lands. Callers MUST catch and degrade — never fabricate a model
// list. Contract per docs/ui-refactor-plan.md + phase5c-spec.md:
//   [{provider, source: 'probe'|'known', models: [{name}], probed_at}]
export interface ModelCatalogModel {
  name: string
}

export interface ModelCatalogEntry {
  provider: string
  source: 'probe' | 'known'
  models: ModelCatalogModel[]
  probed_at: string | null
}

export function fetchModelCatalog(): Promise<ModelCatalogEntry[]> {
  return fetchJSON<ModelCatalogEntry[]>('/tooling/models', { timeoutMs: 15000 })
}

// ── Agent profile content install (POST /agents/profiles) ──────────────────
// Integration-phase additive endpoint: accepts the full .md text a
// client-side composer (Agent 추가 모달) produced, so no file has to exist on
// the server beforehand. Mirrors InstallAgentProfileContentRequest.
export interface InstallAgentProfileContentRequest {
  name: string
  content: string
  provider?: string
  overwrite?: boolean
}

export function installAgentProfileContent(
  body: InstallAgentProfileContentRequest,
): Promise<InstallAgentProfileResult> {
  return fetchJSON<InstallAgentProfileResult>('/agents/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 30000,
  })
}

// ── GET /agents/profiles nullable provider/model contract (5.5-A, landed) ──
// api.ts's AgentProfileInfo intentionally stays unchanged (forbidden file) —
// this augments it structurally so both the profile card (feedback #6) and
// session-creation call sites (feedback #1) can read the two new fields. Both
// are `null`, never omitted, when the profile's frontmatter doesn't declare
// them — render/branch on that explicitly, never fabricate a value.
export interface AgentProfileInfoWithModel extends AgentProfileInfo {
  provider: string | null
  model: string | null
  ui_role?: string | null
  specialty?: string | null
}

// ── Session/terminal creation with an *optional* provider (feedback #1) ────
// api.ts's `createSession`/`addTerminalToSession` both take `provider` as a
// required string and always embed it in the query string — there is no way
// to omit it through those functions, and api.ts is a forbidden file for this
// change. The confirmed bug (NewTaskModal.tsx defaulting an unresolved
// provider to the literal string 'claude_code') was exactly that forced
// fallback; the backend's own profile-parsing already resolves an omitted
// `provider` from the profile's own frontmatter correctly, so callers must
// never invent one. These two functions are the additive, correct alternative
// for any session/terminal-creation call site that now has a real
// `profile.provider` (possibly null) to work with — pass it straight through,
// `undefined`/`null` means "omit the query param entirely", not "send empty".
export function createSessionWithOptionalProvider(
  provider: string | null | undefined,
  agentProfile: string,
  sessionName?: string,
  workingDirectory?: string,
): Promise<Terminal> {
  const query = [
    provider ? `provider=${encodeURIComponent(provider)}` : '',
    `agent_profile=${encodeURIComponent(agentProfile)}`,
    sessionName ? `session_name=${encodeURIComponent(sessionName)}` : '',
    workingDirectory ? `working_directory=${encodeURIComponent(workingDirectory)}` : '',
  ]
    .filter(Boolean)
    .join('&')
  return fetchJSON<Terminal>(`/sessions?${query}`, { method: 'POST', timeoutMs: 90000 })
}

export function addTerminalToSessionWithOptionalProvider(
  sessionName: string,
  provider: string | null | undefined,
  agentProfile: string,
  workingDirectory?: string,
): Promise<Terminal> {
  const query = [
    provider ? `provider=${encodeURIComponent(provider)}` : '',
    `agent_profile=${encodeURIComponent(agentProfile)}`,
    workingDirectory ? `working_directory=${encodeURIComponent(workingDirectory)}` : '',
  ]
    .filter(Boolean)
    .join('&')
  return fetchJSON<Terminal>(`/sessions/${encodeURIComponent(sessionName)}/terminals?${query}`, {
    method: 'POST',
    timeoutMs: 90000,
  })
}

// ── Agent profile full detail (GET /agents/profiles/{name}) ────────────────
// Backing call for the "프로필 수정" edit modal (feedback #2). This route is
// C's in-flight "신규 라우터" work — its exact shape wasn't available while
// this was written, so the fields below are a best-effort guess at the
// obvious ones (mirrors the profile .md's own frontmatter: name/description/
// provider/model + the system-prompt body). Every consumer MUST treat a
// missing/differently-named field as absent (never throw on an unexpected
// shape) and degrade to the "can't prefill this field" messaging the edit
// modal already shows for frontmatter it can't round-trip — see
// EditProfileModal.tsx. Whoever integrates this against the real endpoint
// should diff this shape against it first.
/**
 * Response of `GET /agents/profiles/{name}` — the server's parsed AgentProfile
 * `model_dump(exclude_none=True)`. Beyond the named fields it can carry any
 * frontmatter key (mcpServers, allowedTools, role, permissionMode, ...); the
 * edit modal must round-trip those untouched, hence the index signature.
 * Note: there is no `source` here (that's a list-endpoint field), and the
 * prompt body is `system_prompt` (`prompt` is a separate passthrough field).
 */
export interface AgentProfileFullDetail {
  name: string
  description: string
  provider?: string | null
  model?: string | null
  /** System-prompt body (everything after the frontmatter fence). */
  system_prompt?: string
  [key: string]: unknown
}

export function getAgentProfileDetail(name: string): Promise<AgentProfileFullDetail> {
  return fetchJSON<AgentProfileFullDetail>(`/agents/profiles/${encodeURIComponent(name)}`, { timeoutMs: 15000 })
}

export const apiProfiles = {
  installAgentProfile,
  installAgentProfileContent,
  fetchModelCatalog,
  createSessionWithOptionalProvider,
  addTerminalToSessionWithOptionalProvider,
  getAgentProfileDetail,
}
