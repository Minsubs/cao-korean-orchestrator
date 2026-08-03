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
 * Spawn the server detached from our stdio.
 *
 * `detached: true` puts the child in its own process group so a SIGKILL after
 * the grace period takes the whole tree with it — a login shell wrapping
 * cao-server means the thing we signal is not the thing serving HTTP.
 */
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

export function spawn(command: string, args: string[]): ProcessHandle {
  const child = nodeSpawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })

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
    fileExists: existsSync,
    homeDir: homedir(),
    delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }
}
