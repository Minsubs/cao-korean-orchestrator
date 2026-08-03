/**
 * Content-Security-Policy for the renderer.
 *
 * cao-server sends no CSP of its own — it was written to be opened in a
 * browser, where the user's own origin isolation does the work. Inside Electron
 * that gap is louder: the renderer shares a process family with a main process
 * that can spawn things, and Electron itself warns about it on every launch.
 *
 * The policy is injected by the shell rather than added to the server so the
 * browser deployment keeps working unchanged, and so the rules can be as tight
 * as the desktop case allows without arguing about someone's reverse proxy.
 */

/** Loopback origins the app is allowed to talk to (its own server). */
const LOCAL = "http://127.0.0.1:* http://localhost:*"
const LOCAL_WS = "ws://127.0.0.1:* ws://localhost:*"

/**
 * The policy, as a header value.
 *
 * Notes on the loose ends, none of which are accidental:
 * - `style-src` needs `'unsafe-inline'`: the terminal and graph views set
 *   element styles directly, and a nonce cannot cover style *attributes*.
 * - `img-src` needs `data:`/`blob:`: the favicon is a data URI and captures are
 *   blobs.
 * - `connect-src` needs the loopback origins explicitly because SSE and
 *   WebSocket connections to the server are what drive the whole UI.
 * - `script-src` stays `'self'` — no inline, no eval. That is the rule worth
 *   having, and the one Electron's warning is actually about.
 */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${LOCAL} ${LOCAL_WS}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/**
 * Merge the policy into a response's headers.
 *
 * Replaces any existing CSP rather than appending: two policies intersect, and
 * a server that later grows its own header would silently tighten ours into
 * something untested.
 */
export function withCspHeader(
  headers: Record<string, string | string[]>
): Record<string, string | string[]> {
  const merged: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-security-policy') continue
    merged[key] = value
  }
  merged['Content-Security-Policy'] = [contentSecurityPolicy()]
  return merged
}

/**
 * Whether this response should carry our policy.
 *
 * **Only the server's own http origin.** The header is a blunt instrument: it
 * also lands on `file://` responses, and our boot/diagnostics screen is a local
 * file whose inline script is what swaps in the current state. Injecting there
 * blocked that script, so a failed start sat forever on "서버를 확인하는 중이에요"
 * with the real diagnosis never rendering — the app looked hung when it had
 * actually finished and failed in under two seconds.
 *
 * The boot page ships its own restrictive meta CSP, so leaving it alone does
 * not leave it unprotected.
 */
export function shouldInjectCsp(url: string): boolean {
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)
}
