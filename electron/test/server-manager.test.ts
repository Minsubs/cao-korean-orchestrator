import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_CONFIG,
  ServerStartError,
  buildSpawnPlan,
  defaultShellFor,
  installCandidates,
  resolveServerBinary,
  scanForPort,
  serverCommandLine,
  shellQuote,
  startServer,
  stopServer,
  waitForHealthy,
  type HealthResult,
  type Platform,
  type ProcessHandle,
  type ServerManagerDeps,
} from '../src/server-manager'

/** A health map keyed by port; anything unlisted is a closed port. */
function depsWith({
  health = {},
  platform = 'linux',
  onPath = true,
  existing = [],
  spawn = vi.fn<ServerManagerDeps['spawn']>(() => handleStub()),
}: {
  health?: Record<number, HealthResult>
  platform?: Platform
  onPath?: boolean
  existing?: string[]
  spawn?: ServerManagerDeps['spawn']
} = {}): ServerManagerDeps {
  return {
    platform,
    checkHealth: async (_host, port) => health[port] ?? { reachable: false, isCao: false },
    spawn,
    which: () => (onPath ? '/usr/bin/cao-server' : null),
    fileExists: path => existing.includes(path),
    homeDir: '/home/dev',
    delay: async () => {},
  }
}

function handleStub(exited: Promise<void> = Promise.resolve()): ProcessHandle {
  return { pid: 4242, kill: vi.fn(() => true), exited }
}

const CAO = { reachable: true, isCao: true }
const STRANGER = { reachable: true, isCao: false }

describe('shellQuote', () => {
  it('wraps in single quotes', () => {
    expect(shellQuote('/bin/zsh')).toBe(`'/bin/zsh'`)
  })

  it('survives a path containing a single quote', () => {
    // Naive quoting here would end the quoted string early and let the rest of
    // the path be interpreted by the shell.
    expect(shellQuote("/home/o'brien/bin/cao-server")).toBe(`'/home/o'\\''brien/bin/cao-server'`)
  })
})

describe('serverCommandLine', () => {
  it('always passes host and port explicitly', () => {
    // The server's own defaults come from its config file, so omitting these
    // would quietly ignore the port we just picked.
    expect(serverCommandLine('cao-server', { ...DEFAULT_CONFIG, basePort: 9891 })).toBe(
      `'cao-server' '--host' '127.0.0.1' '--port' '9891'`
    )
  })

  it('prefixes environment assignments', () => {
    const line = serverCommandLine('cao-server', {
      ...DEFAULT_CONFIG,
      serverEnv: { CAO_DEFAULT_SHELL: '/bin/zsh' },
    })
    expect(line.startsWith(`CAO_DEFAULT_SHELL='/bin/zsh' `)).toBe(true)
  })
})

describe('buildSpawnPlan', () => {
  it('runs through a login shell on macOS', () => {
    // -lc is what applies the user's rc files, and therefore the PATH entries
    // uv/nvm/pyenv write there.
    const plan = buildSpawnPlan('cao-server', DEFAULT_CONFIG, 'darwin')
    expect(plan.command).toBe('/bin/zsh')
    expect(plan.args[0]).toBe('-lc')
  })

  it('honours an explicit shell choice over the platform default', () => {
    const plan = buildSpawnPlan('cao-server', { ...DEFAULT_CONFIG, shell: '/bin/fish' }, 'darwin')
    expect(plan.command).toBe('/bin/fish')
  })

  it('treats "auto" as no choice at all', () => {
    const plan = buildSpawnPlan('cao-server', { ...DEFAULT_CONFIG, shell: 'auto' }, 'darwin')
    expect(plan.command).toBe(defaultShellFor('darwin'))
  })

  it('goes through wsl.exe on Windows, with the chosen distro', () => {
    // The server never runs on Windows itself — it runs in WSL and is reached
    // over WSL2 localhost forwarding.
    const plan = buildSpawnPlan('cao-server', { ...DEFAULT_CONFIG, distro: 'Ubuntu' }, 'win32')
    expect(plan.command).toBe('wsl.exe')
    expect(plan.args.slice(0, 3)).toEqual(['-d', 'Ubuntu', '--'])
    expect(plan.args).toContain('-lc')
  })

  it('omits the distro flag when none is chosen so WSL uses its default', () => {
    const plan = buildSpawnPlan('cao-server', DEFAULT_CONFIG, 'win32')
    expect(plan.args.slice(0, 1)).toEqual(['--'])
  })
})

describe('resolveServerBinary', () => {
  it('prefers PATH and keeps the bare name so the login shell resolves it', () => {
    expect(resolveServerBinary(depsWith())).toBe('cao-server')
  })

  it('falls back to known install locations when PATH does not have it', () => {
    // The GUI-launched case: our PATH is not the user's PATH.
    const candidate = installCandidates('/home/dev')[0]!
    expect(resolveServerBinary(depsWith({ onPath: false, existing: [candidate] }))).toBe(candidate)
  })

  it('returns null rather than guessing when nothing is found', () => {
    expect(resolveServerBinary(depsWith({ onPath: false }))).toBeNull()
  })
})

describe('scanForPort', () => {
  it('reports the base port as free when nothing answers', async () => {
    expect(await scanForPort(depsWith(), DEFAULT_CONFIG)).toEqual({ port: 9889, occupiedByCao: false })
  })

  it('finds an already-running CAO server', async () => {
    expect(await scanForPort(depsWith({ health: { 9889: CAO } }), DEFAULT_CONFIG)).toEqual({
      port: 9889,
      occupiedByCao: true,
    })
  })

  it('skips a port held by something that is not us', async () => {
    // Attaching to a stranger's HTTP server would be worse than moving on.
    expect(await scanForPort(depsWith({ health: { 9889: STRANGER } }), DEFAULT_CONFIG)).toEqual({
      port: 9890,
      occupiedByCao: false,
    })
  })

  it('prefers an existing CAO server over an earlier free port', async () => {
    // Otherwise we would start a second server while one is already running —
    // two pipe-pane monitors on the same tmux panes.
    const deps = depsWith({ health: { 9891: CAO } })
    expect(await scanForPort(deps, DEFAULT_CONFIG)).toEqual({ port: 9891, occupiedByCao: true })
  })

  it('returns null when every candidate belongs to someone else', async () => {
    const health = Object.fromEntries([9889, 9890, 9891].map(p => [p, STRANGER]))
    expect(await scanForPort(depsWith({ health }), { ...DEFAULT_CONFIG, portAttempts: 3 })).toBeNull()
  })
})

describe('startServer', () => {
  it('attaches without spawning when a server is already up', async () => {
    const spawn = vi.fn<ServerManagerDeps['spawn']>(() => handleStub())
    const result = await startServer(depsWith({ health: { 9889: CAO }, spawn }), DEFAULT_CONFIG)

    expect(result.mode).toBe('attached')
    expect(result.handle).toBeUndefined()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('attaches even when the binary is nowhere to be found', async () => {
    // A user whose PATH we cannot read still gets a working app if they
    // started the server themselves.
    const deps = depsWith({ health: { 9889: CAO }, onPath: false })
    await expect(startServer(deps, DEFAULT_CONFIG)).resolves.toMatchObject({ mode: 'attached' })
  })

  it('spawns on the port the scan chose, not blindly on the base port', async () => {
    const spawn = vi.fn<ServerManagerDeps['spawn']>(() => handleStub())
    const deps = depsWith({ health: { 9889: STRANGER }, spawn })

    const result = await startServer(deps, DEFAULT_CONFIG)

    expect(result).toMatchObject({ mode: 'spawned', port: 9890 })
    expect(spawn.mock.calls[0]![1].join(' ')).toContain(`'--port' '9890'`)
  })

  it('fails with a typed reason when the binary is missing', async () => {
    const deps = depsWith({ onPath: false })
    await expect(startServer(deps, DEFAULT_CONFIG)).rejects.toMatchObject({
      name: 'ServerStartError',
      reason: 'binary-not-found',
    })
  })

  it('fails with a typed reason when no port is usable', async () => {
    const health = Object.fromEntries([9889, 9890].map(p => [p, STRANGER]))
    const deps = depsWith({ health })
    const error = await startServer(deps, { ...DEFAULT_CONFIG, portAttempts: 2 }).catch(e => e)

    expect(error).toBeInstanceOf(ServerStartError)
    expect(error.reason).toBe('no-free-port')
  })
})

describe('waitForHealthy', () => {
  it('returns as soon as the server answers', async () => {
    const checkHealth = vi
      .fn<ServerManagerDeps['checkHealth']>()
      .mockResolvedValueOnce({ reachable: false, isCao: false })
      .mockResolvedValueOnce(CAO)
    const deps = { ...depsWith(), checkHealth }

    await expect(waitForHealthy(deps, '127.0.0.1', 9889, { attempts: 10, intervalMs: 1 })).resolves.toBe(true)
    expect(checkHealth).toHaveBeenCalledTimes(2)
  })

  it('gives up after the attempt budget instead of hanging the boot screen', async () => {
    const deps = depsWith()
    await expect(waitForHealthy(deps, '127.0.0.1', 9889, { attempts: 3, intervalMs: 1 })).resolves.toBe(false)
  })

  it('does not sleep after the final attempt', async () => {
    const delay = vi.fn(async () => {})
    const deps = { ...depsWith(), delay }

    await waitForHealthy(deps, '127.0.0.1', 9889, { attempts: 3, intervalMs: 1 })

    expect(delay).toHaveBeenCalledTimes(2)
  })
})

describe('stopServer', () => {
  it('never touches a server we merely attached to', async () => {
    const handle = handleStub()
    await stopServer(depsWith(), { mode: 'attached', port: 9889 })
    expect(handle.kill).not.toHaveBeenCalled()
  })

  it('asks a spawned server to exit before forcing it', async () => {
    const handle = handleStub()
    await stopServer(depsWith(), { mode: 'spawned', port: 9889, handle })

    expect(handle.kill).toHaveBeenCalledWith('SIGTERM')
    expect(handle.kill).not.toHaveBeenCalledWith('SIGKILL')
  })

  it('kills a server that ignores SIGTERM so it cannot hold the port', async () => {
    const handle = handleStub(new Promise<void>(() => {}))
    await stopServer(depsWith(), { mode: 'spawned', port: 9889, handle })

    expect(handle.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
