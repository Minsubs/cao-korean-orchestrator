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

/** One selectable shell/distro, with the reason when it is not selectable. */
export interface ShellChoice {
  mode: string
  label: string
  available: boolean
  unavailableReason?: string
  /** Something the user must know before choosing (e.g. PowerShell's limits). */
  caveat?: string
}

export interface ShellSettings {
  /** Effective mode after validation against what is installed. */
  mode: string
  /** True when the stored mode no longer resolves and `auto` took over. */
  fellBackToAuto: boolean
  choices: ShellChoice[]
  /** What `auto` resolves to right now, so it is not a black box. */
  autoResolvesTo: string | null
  /** A change applies when the server restarts, not immediately. */
  restartRequired: boolean
}

/** IPC channel names, kept in one place so preload and main agree. */
export const CHANNELS = {
  pickDirectory: 'cao:pick-directory',
  openExternal: 'cao:open-external',
  appInfo: 'cao:app-info',
  restartServer: 'cao:restart-server',
  shellConfigGet: 'cao:shell-config-get',
  shellConfigSet: 'cao:shell-config-set',
  installServer: 'cao:install-server',
} as const

export interface CaoNative {
  /** Native folder dialog. Resolves to null when the user cancels. */
  pickDirectory(initialPath?: string): Promise<string | null>
  /** Open an https URL in the real browser. Non-https is ignored. */
  openExternal(url: string): void
  appInfo(): Promise<AppInfo>
  /** Only meaningful for a server we spawned; a no-op otherwise. */
  restartServer(): Promise<void>
  shellConfig: {
    get(): Promise<ShellSettings>
    /** Rejected modes come back as `{ok:false, error}` rather than throwing. */
    set(mode: string): Promise<{ ok: boolean; error?: string }>
  }
  /**
   * Install cao-server into WSL from a checkout the user picks.
   *
   * Offered by the diagnostics screen when the server is missing — the shell
   * ships the window, not the server, so a fresh install has nothing to show
   * until this runs. `cancelled` means the folder dialog was dismissed.
   */
  installServer(): Promise<{ ok: boolean; message: string; cancelled?: boolean }>
}
