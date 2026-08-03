/**
 * Argument validation for the native bridge.
 *
 * The renderer loads a localhost page we serve, but "we serve it" is not the
 * same as "we wrote every string that reaches these handlers" — chat content,
 * agent output and catalog entries all flow through that page. So main treats
 * every bridge argument as untrusted and validates here rather than at the call
 * site, where a future caller could forget.
 */

/**
 * Whether a URL may be handed to the OS browser.
 *
 * https only, deliberately. `file:` would open local content, and the various
 * script-ish schemes (`javascript:`, `data:`) are how "open this link" turns
 * into "run this code". http is excluded too: everything we legitimately link
 * to is https, so allowing plaintext buys nothing.
 */
export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'https:'
}

/**
 * Whether an initial-path hint from the renderer is usable.
 *
 * Only a shape check: the dialog is the user's own file browser, so the real
 * authority is the person clicking. A non-string or empty hint just means "no
 * preference" and the dialog opens wherever the OS would.
 */
export function normalizeInitialPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
