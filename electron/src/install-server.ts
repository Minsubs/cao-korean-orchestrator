/**
 * Installing cao-server into WSL from the diagnostics screen.
 *
 * The desktop shell ships the window, not the server — the server is a Python
 * app that has to run inside WSL, and the UI the window displays is served *by*
 * it. So a fresh install with no server is not a broken app, it is an app with
 * nothing to show yet. Rather than leaving the user with a paragraph telling
 * them to go install something, the diagnostics screen can do it.
 *
 * Two things this deliberately does not do:
 *
 * - **Not `uv tool install cli-agent-orchestrator`.** That name on PyPI is
 *   upstream CAO, not this fork; installing it would produce a server that runs
 *   but is missing everything this repository adds. The install always comes
 *   from a checkout the user points at.
 * - **No guessing where the checkout is.** A wrong guess installs the wrong
 *   thing silently. The user picks the folder, and the folder is verified to be
 *   this project before anything runs.
 */

/** Marker files that identify a usable checkout. */
export const CHECKOUT_MARKERS = ['pyproject.toml', 'src/cli_agent_orchestrator'] as const

export type CheckoutVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing-marker' | 'wrong-project' }

/**
 * Decide whether a folder is a checkout of this project.
 *
 * Checks the package name too: any Python project has a pyproject.toml, and
 * installing a random one would fail late and confusingly.
 */
export function verifyCheckout(
  exists: (relativePath: string) => boolean,
  pyprojectContents: string | null
): CheckoutVerdict {
  for (const marker of CHECKOUT_MARKERS) {
    if (!exists(marker)) return { ok: false, reason: 'missing-marker' }
  }
  if (!pyprojectContents || !/^name\s*=\s*"cli-agent-orchestrator"/m.test(pyprojectContents)) {
    return { ok: false, reason: 'wrong-project' }
  }
  return { ok: true }
}

/**
 * The command that installs the checkout into the distro.
 *
 * `uv tool install .` puts `cao-server` in `~/.local/bin`, which the login shell
 * we launch through already has on PATH — the same lookup `whichInWsl` performs,
 * so a successful install is immediately visible to the normal start path.
 *
 * Runs through a login shell because `uv` itself is usually installed the same
 * way and is not on a non-interactive PATH.
 */
export interface InstallInputs {
  wslCheckoutPath: string
  uvPath: string
  /** Needed only when the web bundle has to be built first. */
  npmPath?: string
  /**
   * True when `src/cli_agent_orchestrator/web_ui/` is absent from the checkout.
   *
   * That directory is gitignored, so a fresh clone has no UI — and a server
   * installed from it starts fine and then answers `{"detail":"Not Found"}` at
   * `/`, which reads as a broken app rather than a missing build step. Measured
   * exactly that way before this existed.
   */
  needsWebBuild: boolean
  distro?: string
}

export function buildInstallPlan(inputs: InstallInputs): { command: string; args: string[] } {
  const { wslCheckoutPath, uvPath, npmPath, needsWebBuild, distro } = inputs
  const distroArgs = distro ? ['-d', distro] : []
  const steps = [`cd ${shellQuote(wslCheckoutPath)}`]

  if (needsWebBuild && npmPath) {
    // A fixed PATH, fully quoted, with npm's own directory first.
    //
    // Not `…:$PATH`: unquoted, that expands to the interop PATH, whose Windows
    // entries contain spaces and parentheses — `/mnt/c/Program Files (x86)/…` —
    // and bash then dies on the `(`. Quoting it would need double quotes, which
    // Node's Windows command-line quoting mangles on the way to wsl.exe. A
    // build needs nothing beyond node and the base system anyway, and dropping
    // the interop entries keeps Windows tools out of it.
    const npmDir = npmPath.replace(/\/[^/]+$/, '')
    steps.push(
      `export PATH=${shellQuote(`${npmDir}:/usr/local/bin:/usr/bin:/bin`)}`,
      'cd web',
      `${shellQuote(npmPath)} ci`,
      `${shellQuote(npmPath)} run build`,
      'cd ..'
    )
  }

  // --reinstall, always. Without it uv sees the same version already installed
  // and does nothing — so a freshly built web bundle never reaches the
  // installed package, and the app keeps answering {"detail":"Not Found"} after
  // an install that reported success. Measured exactly that way.
  steps.push(`${shellQuote(uvPath)} tool install --reinstall .`)
  return { command: 'wsl.exe', args: [...distroArgs, '--', 'bash', '-lc', steps.join(' && ')] }
}

/**
 * Where `uv` might be, beyond what the login shell reports.
 *
 * A login shell started by `wsl.exe` from Windows is **not** the environment
 * the user sees in their terminal: it inherits nothing, and any PATH entry
 * added from an interactive rc (linuxbrew's shellenv in `.zshrc`, typically) is
 * absent. Measured here — `command -v uv` succeeds inside WSL and fails through
 * `wsl.exe -- bash -lc`, which is what made the first install attempt die on
 * "uv: 명령어를 찾을 수 없음" on a machine that plainly has uv.
 */
export const UV_CANDIDATES = [
  '$HOME/.local/bin/uv',
  '$HOME/.cargo/bin/uv',
  '/home/linuxbrew/.linuxbrew/bin/uv',
  '/usr/local/bin/uv',
  '/usr/bin/uv',
] as const

/**
 * Ask the distro where uv is: PATH first, then the known install locations.
 *
 * **No double quotes in the script.** Passing `wsl.exe` an argument containing
 * them through Node's Windows command-line quoting mangles it — measured: the
 * quoted form returned exit 1 and empty output on a machine where the unquoted
 * one printed the path. The candidate paths contain no spaces, so `ls` over a
 * bare list is both safe and immune to that.
 */
export function buildBinaryLookupPlan(
  binary: string,
  candidates: readonly string[],
  distro?: string
): { command: string; args: string[] } {
  const distroArgs = distro ? ['-d', distro] : []
  // Not `command -v … || ls …`: on WSL the Windows PATH is on the Linux PATH,
  // so `command -v npm` succeeds with /mnt/c/Program Files/nodejs/npm and the
  // fallback never runs — measured, with the real npm sitting unused in nvm.
  // Emit both and let the caller discard interop hits.
  // sort -Vr so a machine with several nvm versions gets the newest, not the
  // lexicographically first (v22 was winning over v24 here).
  const script = `{ command -v ${binary}; ls -1 ${candidates.join(' ')} 2>/dev/null | sort -Vr; } | head -5`
  return { command: 'wsl.exe', args: [...distroArgs, '--', 'bash', '-lc', script] }
}

/** Where npm might be inside the distro, for the web build step. */
export const NPM_CANDIDATES = [
  '$HOME/.local/bin/npm',
  '/home/linuxbrew/.linuxbrew/bin/npm',
  '/usr/local/bin/npm',
  '/usr/bin/npm',
  '$HOME/.nvm/versions/node/*/bin/npm',
] as const

export function buildUvLookupPlan(distro?: string): { command: string; args: string[] } {
  return buildBinaryLookupPlan('uv', UV_CANDIDATES, distro)
}

export function buildNpmLookupPlan(distro?: string): { command: string; args: string[] } {
  return buildBinaryLookupPlan('npm', NPM_CANDIDATES, distro)
}

/**
 * First usable line of a lookup, or null.
 *
 * **A `/mnt/` hit does not count.** WSL puts the Windows PATH on the Linux
 * PATH, so `command -v npm` inside the distro cheerfully answers
 * `/mnt/c/Program Files/nodejs/npm` — the *Windows* npm, reached through
 * interop. Building a Linux artifact with it is a trap; measured on this
 * machine, that shell had no Linux `node` at all while Windows `npm` resolved
 * fine, so taking the first line would have run the build with a toolchain that
 * cannot work.
 */
export function parseBinaryPath(output: string): string | null {
  const first = output
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('/mnt/'))
  return first ?? null
}

/** Single-quote for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * A folder inside the distro, as the dialog reports it.
 *
 * `\\wsl.localhost\Ubuntu\home\me\repo` and the older `\\wsl$\Ubuntu\…` are
 * views *into* a distro, so the path after the distro name is already the
 * POSIX path — and the distro named there is the one that actually holds the
 * files, which matters when the user has more than one.
 */
export interface UncCheckout {
  distro: string
  path: string
}

/**
 * Parse a `\\wsl.localhost\<distro>\…` / `\\wsl$\<distro>\…` path, or null.
 *
 * **`wslpath` cannot do this.** Handed a UNC path it treats it as a drive path
 * and returns nonsense — measured: `\\wsl.localhost\Ubuntu\home\me\repo`
 * came back as `/mnt/c/wsl.localhostUbuntuhomemerepo`, and the install then
 * failed on a directory that never existed. Only drive paths (`C:\src`) go to
 * wslpath.
 */
export function parseUncWslPath(windowsPath: string): UncCheckout | null {
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\?(.*)$/.exec(windowsPath)
  if (!match) return null
  const distro = match[1] ?? ''
  const rest = (match[2] ?? '').replace(/\\/g, '/')
  if (!distro) return null
  return { distro, path: '/' + rest.replace(/^\/+/, '') }
}

/**
 * The `wslpath` call for a real Windows drive path (`C:\src\repo`).
 *
 * Only reached when {@link parseUncWslPath} says the path is not inside a
 * distro.
 */
export function buildWslPathPlan(windowsPath: string, distro?: string): { command: string; args: string[] } {
  const distroArgs = distro ? ['-d', distro] : []
  return { command: 'wsl.exe', args: [...distroArgs, '--', 'wslpath', '-u', windowsPath] }
}

export interface InstallResult {
  ok: boolean
  /** Shown verbatim on the diagnostics screen when the install fails. */
  message: string
}

/**
 * Turn a finished install into something the screen can say.
 *
 * The tail of the output rather than the whole log: the useful part of a uv
 * failure is at the end, and the screen is not a terminal.
 */
export function summarizeInstall(exitCode: number | null, output: string): InstallResult {
  if (exitCode === 0) return { ok: true, message: '설치했어요. 서버를 시작합니다…' }
  const tail = output.trim().split('\n').slice(-4).join('\n').trim()
  return {
    ok: false,
    message: tail.length > 0 ? tail : `설치에 실패했어요 (exit ${exitCode ?? '?'}).`,
  }
}
