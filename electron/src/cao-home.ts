/**
 * Keeping the server's home directory off a Windows mount.
 *
 * The server creates FIFOs under its home (`~/.aws/cli-agent-orchestrator` by
 * default). On a Windows filesystem seen through WSL — 9p for `/mnt/c`, drvfs
 * on older builds — `os.mkfifo` fails with `[Errno 95] Operation not
 * supported`, and **the failure only shows up when the user starts a task**:
 * the server boots, `/health` answers, the UI loads, and then session creation
 * returns 500. Measured exactly that way on a machine where `~/.aws` is a
 * symlink to `/mnt/c/Users/<name>/.aws`.
 *
 * So the shell checks where that home actually lives and, when it is on a
 * Windows mount, points the server at an ext4 path inside the distro instead.
 * When the default is already fine, nothing is overridden — moving a working
 * user's data would be worse than leaving it.
 */

/** Filesystems that cannot host the server's FIFOs. */
const WINDOWS_MOUNT_TYPES = new Set(['9p', 'v9fs', 'drvfs', 'cifs', 'smb2', 'ntfs'])

export interface CaoHomeProbe {
  /** `$HOME` inside the distro. */
  home: string
  /** `stat -f -c %T` of the CAO home's nearest existing ancestor. */
  fsType: string
}

/**
 * Ask the distro where `$HOME` is and what filesystem the CAO home sits on.
 *
 * Two constraints shape this one-liner, both measured through `wsl.exe`:
 *
 * - **No variable assignments.** `p=$HOME/.aws; echo [$p]` prints `[]` — the
 *   assignment is swallowed somewhere in the interop path, so the first version
 *   of this probe looped on an empty variable and reported nothing at all.
 * - **No double quotes**, which Node's Windows command-line quoting mangles on
 *   the way to wsl.exe (see install-server.ts).
 *
 * The fallback chain replaces a walk-up loop: the CAO home may not exist yet on
 * a first run, and `~/.aws` itself may be the symlink onto the Windows mount —
 * so statting `$HOME` alone would answer for the wrong filesystem.
 */
export function buildCaoHomeProbePlan(distro?: string): { command: string; args: string[] } {
  const distroArgs = distro ? ['-d', distro] : []
  const script =
    'echo HOME=$HOME; echo FS=$(' +
    'stat -f -c %T $HOME/.aws/cli-agent-orchestrator 2>/dev/null || ' +
    'stat -f -c %T $HOME/.aws 2>/dev/null || ' +
    'stat -f -c %T $HOME)'
  return { command: 'wsl.exe', args: [...distroArgs, '--', 'bash', '-lc', script] }
}

export function parseCaoHomeProbe(output: string): CaoHomeProbe | null {
  const home = /^HOME=(.+)$/m.exec(output)?.[1]?.trim()
  const fsType = /^FS=(.+)$/m.exec(output)?.[1]?.trim()
  if (!home || !fsType) return null
  return { home, fsType }
}

/** Whether the default home would land on a filesystem without FIFO support. */
export function needsSafeCaoHome(fsType: string): boolean {
  return WINDOWS_MOUNT_TYPES.has(fsType.toLowerCase())
}

/**
 * Where to put the home instead.
 *
 * `~/.local/share` is inside the distro's own filesystem, so it supports FIFOs,
 * and it is the conventional place for this kind of state.
 */
export function safeCaoHome(home: string): string {
  return `${home.replace(/\/+$/, '')}/.local/share/cao-home`
}
