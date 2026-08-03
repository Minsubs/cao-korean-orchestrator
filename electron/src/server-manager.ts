/**
 * Lifecycle of the cao-server process behind the desktop window.
 *
 * Design notes that are load-bearing (docs/electron-plan.md §1):
 *
 * - **Attach beats spawn.** If a CAO server already answers on the port we
 *   would use, we connect to it and never start a second one. Two servers on
 *   one tmux tree means two pipe-pane monitors on the same panes, which
 *   silently corrupts terminal output capture.
 * - **We only stop what we started.** A server we attached to belongs to
 *   whoever launched it — a developer's terminal, usually.
 * - **A busy port is not automatically our server.** `/health` has to answer
 *   with our service name; anything else means the port belongs to someone
 *   else and we move to the next one.
 *
 * Everything here takes its side effects as injected dependencies so the
 * decisions can be tested without a real server, a real port or a real
 * process.
 */

export type Platform = 'darwin' | 'win32' | 'linux'

/** How the running server came to be. */
export type ServerMode = 'attached' | 'spawned'

export interface HealthResult {
  /** The port answered at all. */
  reachable: boolean
  /** It answered *and* identified itself as cao-server. */
  isCao: boolean
}

/** Minimal handle over a spawned child; real impl wraps child_process. */
export interface ProcessHandle {
  pid: number | undefined
  /** Send a signal. Returns false when the process is already gone. */
  kill(signal: 'SIGTERM' | 'SIGKILL'): boolean
  /** Resolves when the process has exited. */
  exited: Promise<void>
}

export interface ServerManagerDeps {
  platform: Platform
  /** Probe `http://<host>:<port>/health`. Must not throw. */
  checkHealth(host: string, port: number, timeoutMs: number): Promise<HealthResult>
  spawn(command: string, args: string[]): ProcessHandle
  /** Resolve an executable on PATH, or null. */
  which(binary: string): string | null
  /**
   * Resolve `cao-server` *inside* WSL, or null.
   *
   * Windows only. The Windows PATH says nothing about what is installed in the
   * distro, so this is the only lookup that means anything there.
   */
  whichInWsl(distro?: string): string | null
  /** Existence check for the extra install locations we look in. */
  fileExists(path: string): boolean
  homeDir: string
  /** Wall-clock sleep, injected so shutdown timing is testable. */
  delay(ms: number): Promise<void>
}

export interface ServerConfig {
  host: string
  /** First port to try; subsequent attempts walk upward. */
  basePort: number
  /** How many ports to try in total, including the base. */
  portAttempts: number
  /** `auto` lets the platform decide; otherwise an explicit choice (§4). */
  shell?: string
  /** Windows only: which WSL distro hosts the server. */
  distro?: string
  /** Extra environment for the server process, e.g. CAO_DEFAULT_SHELL. */
  serverEnv?: Record<string, string>
}

export const DEFAULT_CONFIG: ServerConfig = {
  host: '127.0.0.1',
  basePort: 9889,
  portAttempts: 8,
}

/** Health probe budget. Long enough for a loaded WSL, short enough to scan. */
export const HEALTH_TIMEOUT_MS = 1500

/** How long a spawned server gets to exit on SIGTERM before SIGKILL. */
export const SHUTDOWN_GRACE_MS = 5000

/**
 * Where a `cao-server` install might live, beyond PATH.
 *
 * A GUI-launched app does not inherit the login shell's PATH, so the binary
 * that works in the user's terminal is frequently invisible to us. These are
 * the locations uv and pip actually use.
 */
export function installCandidates(homeDir: string): string[] {
  return [
    `${homeDir}/.local/bin/cao-server`,
    `${homeDir}/.local/share/uv/tools/cli-agent-orchestrator/bin/cao-server`,
    `${homeDir}/.cargo/bin/cao-server`,
    '/opt/homebrew/bin/cao-server',
    '/usr/local/bin/cao-server',
  ]
}

/**
 * Locate the server executable.
 *
 * Returns the bare name `cao-server` when found on PATH — the login shell we
 * launch through will resolve it the same way the user's terminal does — and an
 * absolute path when we had to fall back to a known install location.
 */
export function resolveServerBinary(deps: ServerManagerDeps, distro?: string): string | null {
  // On Windows the server does not live on Windows. Looking for `cao-server` on
  // the Windows PATH — or under `C:\Users\<name>/.local/bin` — can only ever
  // fail, and it failed loudly the first time the app ran there: the
  // diagnostics screen said "not found" while a perfectly good cao-server sat
  // inside the distro. Ask WSL instead, and return the bare name so the login
  // shell we launch through resolves it the same way the user's terminal does.
  if (deps.platform === 'win32') {
    return deps.whichInWsl(distro) ? 'cao-server' : null
  }

  if (deps.which('cao-server')) return 'cao-server'
  for (const candidate of installCandidates(deps.homeDir)) {
    if (deps.fileExists(candidate)) return candidate
  }
  return null
}

/** Single-quote for a POSIX shell (`-lc '<command>'`). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * The `cao-server …` command line, before any shell wrapping.
 *
 * Host and port are always explicit: the server's own defaults come from its
 * config file, so leaving them off would silently ignore the port we picked.
 */
export function serverCommandLine(binary: string, config: ServerConfig): string {
  const parts = [binary, '--host', config.host, '--port', String(config.basePort)]
  const env = config.serverEnv ?? {}
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`)
  return [...assignments, ...parts.map(shellQuote)].join(' ')
}

export interface SpawnPlan {
  command: string
  args: string[]
}

/**
 * Build the argv that starts the server on this platform.
 *
 * We always go through a **login shell** rather than exec'ing the binary
 * directly: that is what applies the user's rc files, and therefore the PATH
 * entries uv/nvm/pyenv add. Without it a GUI launch fails to find tooling that
 * plainly works in the user's terminal.
 *
 * On Windows the server does not run on Windows at all — it runs inside WSL,
 * reachable over WSL2's localhost forwarding (§1).
 */
export function buildSpawnPlan(
  binary: string,
  config: ServerConfig,
  platform: Platform
): SpawnPlan {
  const commandLine = serverCommandLine(binary, config)
  const shell = config.shell && config.shell !== 'auto' ? config.shell : defaultShellFor(platform)

  if (platform === 'win32') {
    const distroArgs = config.distro ? ['-d', config.distro] : []
    return { command: 'wsl.exe', args: [...distroArgs, '--', shell, '-lc', commandLine] }
  }
  return { command: shell, args: ['-lc', commandLine] }
}

/** The shell used when the user has not chosen one. */
export function defaultShellFor(platform: Platform): string {
  if (platform === 'darwin') return '/bin/zsh'
  if (platform === 'win32') return 'bash'
  return '/bin/bash'
}

export interface PortScanResult {
  /** A port to use. */
  port: number
  /** True when a CAO server is already listening there. */
  occupiedByCao: boolean
}

/**
 * Find the port to use.
 *
 * The first CAO server we meet wins — that is the attach case. A port held by
 * something that is not us is skipped rather than reported as busy-but-ours,
 * because attaching to a stranger's HTTP server would be worse than moving on.
 * When every candidate is taken by something else we return null; the caller
 * surfaces that on the diagnostics screen instead of guessing.
 */
export async function scanForPort(
  deps: ServerManagerDeps,
  config: ServerConfig
): Promise<PortScanResult | null> {
  let firstFree: number | null = null

  for (let offset = 0; offset < config.portAttempts; offset++) {
    const port = config.basePort + offset
    const health = await deps.checkHealth(config.host, port, HEALTH_TIMEOUT_MS)

    if (health.isCao) return { port, occupiedByCao: true }
    if (!health.reachable && firstFree === null) firstFree = port
  }

  return firstFree === null ? null : { port: firstFree, occupiedByCao: false }
}

export interface StartResult {
  mode: ServerMode
  port: number
  /** Present only for `spawned`; nothing else may be stopped by us. */
  handle?: ProcessHandle
}

export class ServerStartError extends Error {
  constructor(
    message: string,
    /** Machine-readable so the diagnostics screen can offer the right fix. */
    readonly reason: 'no-free-port' | 'binary-not-found'
  ) {
    super(message)
    this.name = 'ServerStartError'
  }
}

/**
 * Attach to a running CAO server, or start one.
 *
 * Note the ordering: the scan runs first and an existing server short-circuits
 * everything, including the binary lookup. A user whose PATH we cannot read
 * still gets a working app as long as they started the server themselves.
 */
export async function startServer(
  deps: ServerManagerDeps,
  config: ServerConfig = DEFAULT_CONFIG
): Promise<StartResult> {
  const scan = await scanForPort(deps, config)
  if (scan === null) {
    throw new ServerStartError(
      `No usable port in ${config.basePort}–${config.basePort + config.portAttempts - 1}`,
      'no-free-port'
    )
  }
  if (scan.occupiedByCao) {
    return { mode: 'attached', port: scan.port }
  }

  const binary = resolveServerBinary(deps, config.distro)
  if (binary === null) {
    throw new ServerStartError(
      deps.platform === 'win32'
        ? `cao-server was not found inside WSL${config.distro ? ` (${config.distro})` : ''}`
        : 'cao-server was not found on PATH or in the usual install locations',
      'binary-not-found'
    )
  }

  const plan = buildSpawnPlan(binary, { ...config, basePort: scan.port }, deps.platform)
  const handle = deps.spawn(plan.command, plan.args)
  return { mode: 'spawned', port: scan.port, handle }
}

/**
 * Wait for a freshly spawned server to answer.
 *
 * Polls rather than sleeping a fixed amount: cold starts vary from under a
 * second to tens of seconds on WSL, and the boot screen shows real progress
 * rather than a fake bar.
 */
export async function waitForHealthy(
  deps: ServerManagerDeps,
  host: string,
  port: number,
  { attempts, intervalMs }: { attempts: number; intervalMs: number }
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const health = await deps.checkHealth(host, port, HEALTH_TIMEOUT_MS)
    if (health.isCao) return true
    if (i < attempts - 1) await deps.delay(intervalMs)
  }
  return false
}

/**
 * Stop the server, but only if we started it.
 *
 * SIGTERM first so the server runs its shutdown hooks (tmux bookkeeping, DB
 * writes); SIGKILL only after the grace period, because a wedged server left
 * running would hold the port against the next launch.
 */
export async function stopServer(deps: ServerManagerDeps, result: StartResult): Promise<void> {
  if (result.mode !== 'spawned' || !result.handle) return

  const handle = result.handle
  handle.kill('SIGTERM')

  let exited = false
  await Promise.race([
    handle.exited.then(() => {
      exited = true
    }),
    deps.delay(SHUTDOWN_GRACE_MS),
  ])

  if (!exited) handle.kill('SIGKILL')
}
