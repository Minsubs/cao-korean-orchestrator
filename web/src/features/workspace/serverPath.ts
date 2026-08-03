/**
 * Normalising Windows paths that reach the server.
 *
 * The server runs inside WSL and only understands POSIX paths. The desktop
 * shell's folder dialog is a Windows dialog, so before the shell learned to
 * convert its results (electron/src/wsl-paths.ts) it handed back UNC paths like
 * `\\wsl.localhost\Ubuntu\home\me\project`. Starting a session with one fails:
 *
 *     Failed to create session: Working directory does not exist:
 *     \\wsl.localhost\ubuntu\home\me\project
 *
 * The shell-side fix only applies at pick time and only to a shell new enough
 * to have it. **Paths already stored in localStorage keep the old form**, and a
 * user on an older app build keeps producing them, so the web layer normalises
 * defensively wherever a path is saved or submitted.
 *
 * Only the UNC form is handled here — it is a pure string rewrite. A drive path
 * (`C:\src`) needs `wslpath` and therefore the shell; those pass through
 * untouched so the server's own error is what the user sees, rather than a
 * guess from us.
 */

const UNC_WSL = /^\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+\\?(.*)$/

/**
 * Convert `\\wsl.localhost\<distro>\a\b` to `/a/b`; leave anything else alone.
 *
 * The segment after the distro name is already the POSIX path, so no lookup is
 * needed to translate it.
 */
export function normalizeServerPath(path: string): string {
  const match = UNC_WSL.exec(path.trim())
  if (!match) return path
  const rest = (match[1] ?? '').replace(/\\/g, '/')
  return '/' + rest.replace(/^\/+/, '')
}

/** Whether a path still needs the shell to translate it (drive paths). */
export function needsShellTranslation(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path.trim())
}
