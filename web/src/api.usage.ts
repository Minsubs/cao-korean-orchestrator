// api.usage.ts — AI 계정 사용량(Usage) API client.
//
// Kept separate from api.ts/api.ui.ts/api.tooling.ts by ownership (this
// feature's spec: "신규만 ... web/src/api.usage.ts") — the parallel-built
// `/usage/accounts` backend contract lives entirely in this file so this
// feature never has to touch another owner's API surface.
//
// Availability stance, same as every other api.*.ts client in this codebase:
// the endpoint can 404 (router not mounted yet — true today, the backend is
// being built in parallel) or fail on the network independently. Callers
// (useUsageAccounts.ts) must treat that as an honest error state — never
// fall back to fabricated/sample data.
const BASE = '' // Vite proxy handles routing to backend, same as every other api.*.ts

export interface ApiUsageError extends Error {
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
      const err: ApiUsageError = new Error(`${res.status} ${res.statusText}`)
      err.status = res.status
      err.detail = detail
      throw err
    }
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

/** One usage bucket (today/week) — raw token counts, never pre-aggregated client-side beyond display formatting. */
export interface UsageBucket {
  input: number
  output: number
  cache_read: number
  cache_creation: number
  total: number
}

/** One rate-limit window (primary/secondary) — `used_percent` is the server's exact measured value; the client never recomputes it. */
export interface UsageRateLimitWindow {
  used_percent: number
  window_minutes: number
  resets_at: number
}

export interface UsageRateLimits {
  plan: string | null
  primary: UsageRateLimitWindow | null
  secondary: UsageRateLimitWindow | null
  captured_at: string
}

export interface UsageAccount {
  /** 'claude_code' | 'codex' | ... — an open-ended provider slug, never hardcode an exhaustive union against it. */
  provider: string
  present: boolean
  source: string
  today: UsageBucket | null
  week: UsageBucket | null
  by_model_today: { model: string; total: number }[]
  /** `null` = this provider has no rate-limit concept surfaced (or the Claude opt-in hasn't been engaged) — render nothing, never a fake gauge. */
  rate_limits: UsageRateLimits | null
  last_activity: string | null
  /** Honest disclaimer / failure explanation (e.g. expired opt-in token) — always render as-is, never suppressed. */
  note: string
}

export interface UsageAccountsResponse {
  accounts: UsageAccount[]
  scanned_at: string
}

export interface GetUsageAccountsOptions {
  /**
   * Spec delta (사용자 확정): Claude 한도 실측은 opt-in — true일 때만
   * `?claude_limits=true`를 붙여 백엔드가 저장된 Claude 로그인 토큰으로
   * Anthropic 사용량 API를 조회하게 한다. 기본(false/미지정)은 기존 계약과
   * 동일한 `GET /usage/accounts`.
   */
  claudeLimits?: boolean
}

export const apiUsage = {
  getAccounts: (opts: GetUsageAccountsOptions = {}): Promise<UsageAccountsResponse> =>
    fetchJSON<UsageAccountsResponse>(`/usage/accounts${opts.claudeLimits ? '?claude_limits=true' : ''}`),
}
