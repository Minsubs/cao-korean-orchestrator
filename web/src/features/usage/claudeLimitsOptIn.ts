// Persisted opt-in flag for Claude 한도 실측 조회 (spec delta, 사용자 확정).
// Off by default — the backend only calls the Anthropic usage API (using the
// saved Claude login token) when this is explicitly turned on from the
// account card's toggle. Same localStorage-flag-with-safe-fallback shape as
// NotificationCenter.tsx's ENABLED_KEY (private mode / storage-disabled
// browsers silently fall back to the default instead of throwing).
const CLAUDE_LIMITS_OPTIN_KEY = 'cao:usage:claude-limits-optin:v1'

export function loadClaudeLimitsOptIn(): boolean {
  try {
    return window.localStorage.getItem(CLAUDE_LIMITS_OPTIN_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Fired after the flag changes so other subtrees can re-read it.
 *
 * The toggle lives in 설정 › AI 계정 사용량 while the header bars
 * (HeaderUsageBars) fetch with the same flag — two separate React trees, so
 * neither sees the other's state. The `storage` event only fires for *other*
 * tabs, which is why this same-document event exists alongside it.
 */
export const CLAUDE_LIMITS_OPTIN_EVENT = 'cao:usage:claude-limits-optin'

export function saveClaudeLimitsOptIn(value: boolean): void {
  try {
    window.localStorage.setItem(CLAUDE_LIMITS_OPTIN_KEY, value ? 'true' : 'false')
  } catch {
    // Persisting is best-effort; the session still gets the toggle's effect.
  }
  // Dispatched even when persisting failed — listeners re-read through
  // loadClaudeLimitsOptIn(), so a storage-disabled browser simply keeps the
  // default instead of going out of sync with the component that toggled.
  try {
    window.dispatchEvent(new Event(CLAUDE_LIMITS_OPTIN_EVENT))
  } catch {
    // Event constructor unavailable (non-DOM env) — nothing to notify.
  }
}
