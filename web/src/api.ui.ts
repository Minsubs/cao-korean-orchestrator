// Additive API surface for the Phase 2b Orchestration Workspace.
//
// Kept separate from api.ts by design (spec ownership: "추가 API는 전부
// api.ui.ts에") so the existing, stable REST surface never has to change
// shape for this feature. Endpoints here are the Phase 2a backend contract
// (`/ui/events*`, `/fs/list`) plus one additive-field read of the existing
// `/terminals/{id}` response (`caller_id` / `last_output_at`, both already
// present on the server's Terminal model — see
// src/cli_agent_orchestrator/models/terminal.py, read-only reference).
//
// `/ui/events`/`/fs/list` were still landing in parallel when this client was
// written; if a route is ever missing on an older server, the call fails the
// same honest way any unimplemented route does (404/network error rejects
// the promise) — callers must treat that as "unavailable", never synthesize
// data to paper over it.
import type { TerminalMeta } from './api'
import type { UiEvent } from './features/workspace/types'

const BASE = ''

export interface ApiUiError extends Error {
  status?: number
  detail?: string
}

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
        // non-JSON error body — detail stays undefined
      }
      const err: ApiUiError = new Error(`${res.status} ${res.statusText}`)
      err.status = res.status
      err.detail = detail
      throw err
    }
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

export interface UiEventHistoryParams {
  limit?: number
  sinceId?: number
  types?: string[]
}

export interface FsEntry {
  name: string
  is_dir: boolean
  markers: string[]
}

export interface FsListResponse {
  path: string
  entries: FsEntry[]
}

/** Additive fields the Terminal model already carries (models/terminal.py) that api.ts's slimmer `Terminal` doesn't type. */
export interface TerminalDetail {
  id: string
  name: string
  provider: string
  session_name: string
  agent_profile: string | null
  caller_id: string | null
  status: string | null
  last_active: string | null
  last_output_at: string | null
}

/**
 * Phase 2d (`GET /ui/terminals/{id}/context`, api/ui_features_router.py
 * `get_terminal_context`) — remaining-context gauge, DISPLAY ONLY.
 * `percent_left` is the remaining percentage (higher = more headroom); `null`
 * means no gauge is available right now (no footer scraped yet, or the
 * terminal's provider has none, e.g. Codex today) and callers must render
 * nothing rather than treating it as 0%. Never drives any orchestration
 * decision (no auto-/compact, ever) — see contextGauge.ts/useContextGauges.ts.
 */
export interface TerminalContextResponse {
  terminal_id: string
  percent_left: number | null
  source: string
  checked_at: string
}

/**
 * Phase 2e (`GET /ui/slash-commands`, api/ui_features_router.py
 * `get_slash_commands`) — one enumerated command/skill entry. The same
 * `name` can legitimately appear more than once with different `scope`s
 * (e.g. a user-level and a project-level command sharing a name) — list all
 * of them, distinguished by their scope badge, never de-duplicate by name.
 */
export interface SlashCommandInfo {
  name: string
  scope: 'builtin' | 'user' | 'project'
  kind: 'command' | 'skill'
  description: string | null
  interactive: boolean
}

export interface SlashCommandsResponse {
  provider: string
  cwd: string | null
  commands: SlashCommandInfo[]
}

/** Providers the backend enumerator knows how to scan (else 400 — spec: "그 외 provider는 ... 자동완성 기능 자체를 숨김"). */
export type SlashCommandProvider = 'claude_code' | 'codex'

const SLASH_CACHE_TTL_MS = 30000

/**
 * Client-side cache for `getSlashCommands`, keyed by `provider::cwd` (spec
 * §2e: "클라 캐시 30s ... 타이핑마다 fetch 금지"). Caches the in-flight/settled
 * *promise* itself (not just the resolved value) so concurrent callers within
 * the window share one request, and a rejected promise is evicted immediately
 * (see the `.catch` below) instead of poisoning the cache for the full 30s.
 * This sits in front of the server's own independent 30s TTL cache
 * (api/ui_features_router.py `_SLASH_CACHE`) — the two are unrelated caches
 * at different layers, not one shared mechanism.
 */
const slashCommandsCache = new Map<string, { expiresAt: number; promise: Promise<SlashCommandsResponse> }>()

/**
 * `GET /sessions/{name}` (api.ts's `getSession`) enriches each terminal dict
 * with a live `status` before returning it (session_service.py `get_session`
 * — status_monitor is the source of truth, derived fresh on every call rather
 * than a persisted column) that api.ts's slimmer `TerminalMeta` doesn't type.
 * Same additive-field widening as `TerminalDetail` above, just for the
 * session-list response instead of `/terminals/{id}`. Used by the fleet
 * Overview's per-session status poll (features/workspace/Overview.tsx) to
 * read `.status` off `api.getSession(name).terminals` without touching
 * api.ts's shape for every other existing caller.
 */
export interface TerminalMetaWithStatus extends TerminalMeta {
  status: string | null
}

export const apiUi = {
  /** SSE endpoint URL — constructed by eventsClient.ts's `new EventSource(...)`, not fetched here. */
  uiEventsStreamUrl: '/ui/events',

  getUiEventsHistory: async (params: UiEventHistoryParams = {}) => {
    const query = [
      params.limit ? `limit=${params.limit}` : '',
      params.sinceId !== undefined ? `since_id=${params.sinceId}` : '',
      // Server takes one comma-separated `types` string, not a repeated param
      // (api/main.py `ui_events_history`: `types.split(",")`).
      params.types && params.types.length > 0 ? `types=${params.types.map(encodeURIComponent).join(',')}` : '',
    ]
      .filter(Boolean)
      .join('&')
    // Server wraps the array: `{"events": [...]}` (api/main.py `ui_events_history`).
    const body = await fetchJSON<{ events: UiEvent[] }>(`/ui/events/history${query ? `?${query}` : ''}`)
    return body.events
  },

  listFsEntries: (path?: string) =>
    fetchJSON<FsListResponse>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),

  getTerminalDetail: (id: string) => fetchJSON<TerminalDetail>(`/terminals/${id}`),

  /** Phase 2d: the remaining-context gauge for one terminal. 404s the same honest way as any unknown terminal — caller treats a rejected promise as "no gauge", never synthesizes a value. */
  getTerminalContext: (terminalId: string) => fetchJSON<TerminalContextResponse>(`/ui/terminals/${terminalId}/context`),

  /**
   * Phase 2e: enumerated slash commands for `provider` (+ optional `cwd` for
   * the project-scope scan). 30s client cache per (provider, cwd) — see
   * `slashCommandsCache` above. `provider` outside the supported set 400s;
   * callers must gate on `SlashCommandProvider` *before* calling this so that
   * never happens in practice (spec: unsupported provider hides the feature
   * entirely rather than surfacing an error toast).
   */
  getSlashCommands: (provider: SlashCommandProvider, cwd?: string | null): Promise<SlashCommandsResponse> => {
    const key = `${provider}::${cwd ?? ''}`
    const now = Date.now()
    const cached = slashCommandsCache.get(key)
    if (cached && cached.expiresAt > now) return cached.promise

    const query = `provider=${encodeURIComponent(provider)}${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ''}`
    const promise = fetchJSON<SlashCommandsResponse>(`/ui/slash-commands?${query}`)
    slashCommandsCache.set(key, { expiresAt: now + SLASH_CACHE_TTL_MS, promise })
    promise.catch(() => {
      // A failed request must not "poison" the cache for the full 30s window —
      // evict it immediately so the next call gets a fresh attempt instead of
      // replaying the same rejection.
      if (slashCommandsCache.get(key)?.promise === promise) slashCommandsCache.delete(key)
    })
    return promise
  },
}
