/**
 * Which shell the server (and therefore the agent terminals) runs in.
 *
 * docs/electron-plan.md §4. The rule the whole file follows: **every option
 * offered must actually work**. A picker listing shells that are not installed,
 * or a distro that cannot host the server, is worse than no picker — the user
 * makes a choice, nothing happens, and there is nothing on screen explaining
 * why.
 */

/**
 * `auto` — let the platform decide.
 * `mac:<path>` / `posix:<path>` — a specific shell binary.
 * `wsl:<distro>` — a WSL distro on Windows.
 * `powershell` — Windows-side helper shell only (see the caveat below).
 */
export type ShellMode = string

export interface ShellOption {
  mode: ShellMode
  label: string
  /** False when the option exists but cannot be selected. */
  available: boolean
  /** Why it cannot be selected — shown next to the disabled option. */
  unavailableReason?: string
  /** Extra context the user needs before choosing. */
  caveat?: string
}

/**
 * PowerShell cannot host agent terminals in v1.
 *
 * The terminal backend is tmux, which PowerShell does not run. Offering
 * PowerShell without saying this would let a user pick it and then wonder why
 * their agents are still Linux shells.
 */
export const POWERSHELL_CAVEAT = '에이전트 터미널은 WSL 에서 실행됩니다 (tmux 기반)'

/**
 * Shells offered on macOS/Linux, drawn from `/etc/shells`.
 *
 * `/etc/shells` is the system's own list of login shells, so it never invents
 * an entry — but it can list one that has since been uninstalled, hence the
 * separate existence check.
 */
export function posixShellOptions(
  etcShellsContent: string,
  exists: (path: string) => boolean,
  currentShell?: string
): ShellOption[] {
  const listed = etcShellsContent
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))

  // The user's current $SHELL belongs in the list even when /etc/shells has
  // not caught up (a brew-installed fish, typically).
  const candidates = [...new Set([...(currentShell ? [currentShell] : []), ...listed])]

  return candidates.map(path => {
    const available = exists(path)
    return {
      mode: `posix:${path}`,
      label: path.split('/').pop() ?? path,
      available,
      ...(available ? {} : { unavailableReason: '설치되어 있지 않아요' }),
    }
  })
}

/** The parsed form of a mode string, or null when it is not one we know. */
export interface ParsedShellMode {
  kind: 'auto' | 'posix' | 'wsl' | 'powershell'
  value?: string
}

export function parseShellMode(mode: unknown): ParsedShellMode | null {
  if (typeof mode !== 'string' || mode.length === 0) return null
  if (mode === 'auto') return { kind: 'auto' }
  if (mode === 'powershell') return { kind: 'powershell' }

  const separator = mode.indexOf(':')
  if (separator <= 0) return null
  const kind = mode.slice(0, separator)
  const value = mode.slice(separator + 1)
  if (value.length === 0) return null

  // `mac:` is accepted as an alias so a config written by an earlier build
  // keeps working.
  if (kind === 'posix' || kind === 'mac') return { kind: 'posix', value }
  if (kind === 'wsl') return { kind: 'wsl', value }
  return null
}

/**
 * Validate a mode against what is actually present.
 *
 * A stored choice can go stale — the shell gets uninstalled, the distro gets
 * removed. Rather than launching something else silently, an invalid mode is
 * rejected here so the caller can fall back to `auto` *and say so*.
 */
export function isSelectable(
  mode: ShellMode,
  { shells, distros }: { shells: ShellOption[]; distros: { name: string; usable: boolean }[] }
): boolean {
  const parsed = parseShellMode(mode)
  if (!parsed) return false
  if (parsed.kind === 'auto' || parsed.kind === 'powershell') return true
  if (parsed.kind === 'posix') {
    return shells.some(shell => shell.mode === `posix:${parsed.value}` && shell.available)
  }
  return distros.some(distro => distro.name === parsed.value && distro.usable)
}

/**
 * The shell binary a mode resolves to, for the server spawn command.
 *
 * `auto`, `wsl:` and `powershell` return undefined: the first two mean "let the
 * platform default apply", and PowerShell does not host the server process
 * itself — the distro choice does.
 */
export function shellBinaryFor(mode: ShellMode): string | undefined {
  const parsed = parseShellMode(mode)
  return parsed?.kind === 'posix' ? parsed.value : undefined
}

/** The WSL distro a mode names, if any. */
export function distroFor(mode: ShellMode): string | undefined {
  const parsed = parseShellMode(mode)
  return parsed?.kind === 'wsl' ? parsed.value : undefined
}
