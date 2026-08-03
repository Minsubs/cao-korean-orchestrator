/**
 * The `window.caoNative` contract (docs/electron-plan.md §3).
 *
 * Shared by the preload that implements it and the main process that serves
 * it, so the two cannot drift. The web side keeps its own copy of these types
 * (`web/src/native.ts`) rather than importing across workspaces — the browser
 * build must not depend on the desktop one, since the browser is still a
 * first-class way to run this UI.
 *
 * Everything here is deliberately small. The renderer gets no filesystem and no
 * shell: file work still goes through cao-server's API exactly as it does in a
 * browser. These five exist only for things a web page genuinely cannot do.
 */

export type ServerMode = 'attached' | 'spawned'

export interface AppInfo {
  platform: NodeJS.Platform
  version: string
  serverMode: ServerMode
  port: number
  /** Windows only: the WSL distro hosting the server. */
  distro?: string
}

/** IPC channel names, kept in one place so preload and main agree. */
export const CHANNELS = {
  pickDirectory: 'cao:pick-directory',
  openExternal: 'cao:open-external',
  appInfo: 'cao:app-info',
  restartServer: 'cao:restart-server',
} as const

export interface CaoNative {
  /** Native folder dialog. Resolves to null when the user cancels. */
  pickDirectory(initialPath?: string): Promise<string | null>
  /** Open an https URL in the real browser. Non-https is ignored. */
  openExternal(url: string): void
  appInfo(): Promise<AppInfo>
  /** Only meaningful for a server we spawned; a no-op otherwise. */
  restartServer(): Promise<void>
}
