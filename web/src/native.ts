/**
 * Access to the desktop shell's native bridge, when there is one.
 *
 * The browser is still a first-class way to run this UI, so nothing here may
 * assume the bridge exists — every caller gets a capability check and a web
 * fallback. The types are duplicated from `electron/src/bridge-contract.ts`
 * rather than imported so the web build never depends on the desktop
 * workspace; the shapes are small and the duplication is the point.
 */

export type NativeServerMode = 'attached' | 'spawned'

export interface NativeAppInfo {
  platform: string
  version: string
  serverMode: NativeServerMode
  port: number
  distro?: string
}

export interface CaoNative {
  pickDirectory(initialPath?: string): Promise<string | null>
  openExternal(url: string): void
  appInfo(): Promise<NativeAppInfo>
  restartServer(): Promise<void>
}

declare global {
  interface Window {
    caoNative?: Partial<CaoNative>
  }
}

/**
 * The bridge, or null in a browser.
 *
 * Read through a function rather than captured at module load: tests stub the
 * global per case, and a module-level snapshot would freeze whichever value
 * happened to be there when the first import ran.
 */
export function getNative(): Partial<CaoNative> | null {
  if (typeof window === 'undefined') return null
  return window.caoNative ?? null
}

/**
 * Whether a specific capability is present.
 *
 * Per-method rather than "is this Electron", because an older shell may expose
 * a smaller contract than the one this build knows about. Feature detection
 * degrades; version detection breaks.
 */
export function hasNative<K extends keyof CaoNative>(method: K): boolean {
  return typeof getNative()?.[method] === 'function'
}

/**
 * Open a directory picker natively, or report that we cannot.
 *
 * Returns `{ supported: false }` so the caller can fall back to the in-app
 * server-side browser instead of showing an error — not being in the desktop
 * app is normal, not a failure.
 */
export async function pickDirectoryNative(
  initialPath?: string
): Promise<{ supported: false } | { supported: true; path: string | null }> {
  const native = getNative()
  if (typeof native?.pickDirectory !== 'function') return { supported: false }
  try {
    return { supported: true, path: await native.pickDirectory(initialPath) }
  } catch {
    // A bridge that throws is treated as absent: falling back to the web
    // picker keeps the user moving.
    return { supported: false }
  }
}

/**
 * Open an external link the best way available.
 *
 * In the desktop app a plain `target=_blank` would try to open a window inside
 * Electron, which main refuses; routing through the bridge hands it to the
 * real browser instead.
 */
export function openExternal(url: string): void {
  const native = getNative()
  if (typeof native?.openExternal === 'function') {
    native.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** App/server info for the header chip, or null outside the desktop app. */
export async function fetchAppInfo(): Promise<NativeAppInfo | null> {
  const native = getNative()
  if (typeof native?.appInfo !== 'function') return null
  try {
    return await native.appInfo()
  } catch {
    return null
  }
}
