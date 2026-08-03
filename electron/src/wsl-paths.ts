/**
 * Translating between what the Windows folder dialog says and what the server
 * can use.
 *
 * The dialog is a Windows dialog: it returns `\\wsl.localhost\Ubuntu\home\me\p`
 * for a folder inside the distro and `C:\src\p` for one on a Windows drive. The
 * server runs *inside* WSL and only understands POSIX paths, so handing its API
 * a dialog result verbatim produces
 *
 *     Failed to create session: Working directory does not exist:
 *     \\wsl.localhost\ubuntu\home\me\p
 *
 * — reported from live use, and the reason this module exists.
 */

/** `\\wsl.localhost\<distro>\rest` / `\\wsl$\<distro>\rest`, parsed. */
export interface UncWslPath {
  distro: string
  path: string
}

/**
 * Parse a UNC path that points into a distro.
 *
 * `wslpath` cannot do this — handed a UNC path it treats it as a drive path and
 * returns nonsense (measured: `/mnt/c/wsl.localhostUbuntuhomemerepo`). The
 * segment after the distro name is already the POSIX path, so no external
 * command is needed.
 */
export function parseUncWslPath(windowsPath: string): UncWslPath | null {
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\?(.*)$/.exec(windowsPath)
  if (!match) return null
  const distro = match[1] ?? ''
  if (!distro) return null
  const rest = (match[2] ?? '').replace(/\\/g, '/')
  return { distro, path: '/' + rest.replace(/^\/+/, '') }
}

/** Whether a string is already a POSIX path the server can use as-is. */
export function isPosixPath(value: string): boolean {
  return value.startsWith('/')
}

/** Whether a string is a Windows drive path (`C:\…`), which needs `wslpath`. */
export function isDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value)
}

/**
 * Render a POSIX path as the UNC path Windows dialogs understand.
 *
 * Used for the dialog's starting folder: passing `/home/me/p` to a Windows
 * dialog opens nothing useful, so the caller converts first.
 */
export function toUncPath(posixPath: string, distro: string): string {
  const trimmed = posixPath.replace(/^\/+/, '').replace(/\//g, '\\')
  return `\\\\wsl.localhost\\${distro}\\${trimmed}`
}

/** The `wslpath -u` call for a drive path. */
export function buildDrivePathPlan(windowsPath: string, distro?: string): { command: string; args: string[] } {
  const distroArgs = distro ? ['-d', distro] : []
  return { command: 'wsl.exe', args: [...distroArgs, '--', 'wslpath', '-u', windowsPath] }
}
