/**
 * The real side effects behind {@link ServerManagerDeps}.
 *
 * Kept apart from server-manager.ts so the decision logic there can be tested
 * without a network, a process table or a filesystem — and so this file stays
 * small enough to read as "obviously just plumbing".
 */

import { execFileSync, spawn as nodeSpawn } from 'node:child_process'
import { accessSync, constants, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import type { HealthResult, Platform, ProcessHandle, ServerManagerDeps } from './server-manager'
import type { InventoryDeps } from './shell-inventory'
import { decodeWslOutput, parseWslList, type WslDistro } from './wsl'

/** The `service` value cao-server's /health reports. */
const SERVICE_NAME = 'cli-agent-orchestrator'

/**
 * Probe /health and decide whether the responder is actually our server.
 *
 * Any failure is a negative answer rather than an exception: this runs inside
 * a port scan where "nothing there" is the normal case, not an error.
 */
export async function checkHealth(host: string, port: number, timeoutMs: number): Promise<HealthResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://${host}:${port}/health`, { signal: controller.signal })
    if (!response.ok) return { reachable: true, isCao: false }
    const body = (await response.json()) as { service?: unknown }
    return { reachable: true, isCao: body?.service === SERVICE_NAME }
  } catch {
    // Connection refused, DNS, timeout — all mean "not a server we can use".
    return { reachable: false, isCao: false }
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve an executable on PATH without shelling out. */
export function which(binary: string): string | null {
  const path = process.env.PATH ?? ''
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, binary)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not here; keep looking.
    }
  }
  return null
}

/**
 * Where a spawned server's output goes.
 *
 * Without this the boot screen can say "the server did not answer" and there is
 * nothing to look at — the child's stderr died with our pipe. The tray's
 * "로그 열기" opens this file.
 */
let logPath: string | null = null

export function setLogPath(path: string): void {
  logPath = path
}

export function getLogPath(): string | null {
  return logPath
}

/**
 * Spawn the server and keep hold of its output.
 *
 * The two platforms need opposite things here, and the first real Windows run
 * showed why:
 *
 * - POSIX: `detached: true` puts the child in its own process group, so
 *   signalling `-pid` after the grace period takes the whole tree — a login
 *   shell wrapping cao-server means the process we signal is not the one
 *   serving HTTP.
 * - Windows: `detached: true` gives the child its own console and our stdio
 *   pipes come back empty — the log file stayed 0 bytes while the server was
 *   plainly running. There are no process groups to signal either, so the
 *   trade has no upside: attach normally, hide the console window, and kill the
 *   tree with taskkill.
 */
export function spawn(command: string, args: string[]): ProcessHandle {
  const onWindows = process.platform === 'win32'
  const child = nodeSpawn(command, args, {
    detached: !onWindows,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (logPath) {
    // Append: a restart should not erase the log that explains why the previous
    // start failed.
    const log = createWriteStream(logPath, { flags: 'a' })
    child.stdout?.pipe(log)
    child.stderr?.pipe(log)
  }

  const exited = new Promise<void>(resolve => {
    child.once('exit', () => resolve())
    child.once('error', () => resolve())
  })

  return {
    pid: child.pid,
    kill(signal) {
      if (child.pid === undefined) return false
      try {
        if (onWindows) {
          // `process.kill(-pid)` is POSIX-only; on Windows it throws and the
          // server would simply keep running (and keep the port) after quit.
          // /T takes the wsl.exe tree with it, which is where the server lives.
          execFileSync('taskkill', ['/pid', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], {
            stdio: 'ignore',
          })
          return true
        }
        // Negative pid signals the group, which is why we spawned detached.
        process.kill(-child.pid, signal)
        return true
      } catch {
        return false
      }
    },
    exited,
  }
}

/**
 * Ask the distro whether it has `cao-server`.
 *
 * Windows-only, and the only lookup that means anything there: the server is
 * installed inside WSL, so the Windows PATH cannot answer. Runs through a login
 * shell for the same reason the spawn does — `~/.local/bin` and uv's shims are
 * on the PATH only after the rc files run.
 */
export function whichInWsl(distro?: string): string | null {
  if (process.platform !== 'win32') return null
  const distroArgs = distro ? ['-d', distro] : []
  try {
    const out = execFileSync('wsl.exe', [...distroArgs, '--', 'bash', '-lc', 'command -v cao-server'], {
      encoding: 'utf8',
      timeout: 10000,
    })
    const path = out.trim()
    return path.length > 0 ? path : null
  } catch {
    // Non-zero exit means "not found"; a missing wsl.exe means there is nothing
    // to find either.
    return null
  }
}

/**
 * Run a `wsl.exe …` plan and collect its output.
 *
 * Async and output-capturing because the caller shows the tail on screen when
 * an install fails — a bare exit code tells the user nothing they can act on.
 */
export function runCapturing(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise(resolve => {
    const child = nodeSpawn(command, args, { windowsHide: true })
    let output = ''
    child.stdout?.on('data', chunk => {
      output += String(chunk)
    })
    child.stderr?.on('data', chunk => {
      output += String(chunk)
    })
    child.once('error', error => resolve({ code: null, output: output + String(error) }))
    child.once('close', code => resolve({ code, output }))
  })
}

export function currentPlatform(): Platform {
  const platform = process.platform
  if (platform === 'darwin' || platform === 'win32') return platform
  return 'linux'
}

/**
 * Ask Windows which WSL distros exist.
 *
 * Runs with `encoding: 'buffer'` on purpose: wsl.exe writes UTF-16LE, and
 * letting Node decode it as UTF-8 is exactly the bug `decodeWslOutput` exists
 * to prevent. A missing wsl.exe (no WSL installed) is an empty list, not an
 * error — the settings UI then simply has no distros to offer.
 */
export function listDistros(): WslDistro[] {
  if (process.platform !== 'win32') return []
  try {
    const raw = execFileSync('wsl.exe', ['-l', '-v'], { encoding: 'buffer', timeout: 5000 })
    return parseWslList(decodeWslOutput(raw))
  } catch {
    return []
  }
}

export function createInventoryDeps(): InventoryDeps {
  return {
    platform: process.platform,
    readEtcShells: () => {
      try {
        return readFileSync('/etc/shells', 'utf8')
      } catch {
        return ''
      }
    },
    fileExists: existsSync,
    ...(process.env.SHELL ? { currentShell: process.env.SHELL } : {}),
    listDistros,
    windowsBinaryExists: binary => which(binary) !== null,
  }
}

export function createRuntimeDeps(): ServerManagerDeps {
  return {
    platform: currentPlatform(),
    checkHealth,
    spawn,
    which,
    whichInWsl,
    fileExists: existsSync,
    homeDir: homedir(),
    delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }
}
