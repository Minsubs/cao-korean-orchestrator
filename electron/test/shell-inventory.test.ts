import { describe, it, expect, vi } from 'vitest'
import { buildInventory, type InventoryDeps } from '../src/shell-inventory'
import { readShellMode, writeShellMode, type StoreDeps } from '../src/shell-store'
import { parseWslList } from '../src/wsl'

const WSL_OUTPUT = [
  '  NAME                   STATE           VERSION',
  '* Ubuntu                 Running         2',
  '  docker-desktop         Running         2',
].join('\r\n')

function posixDeps(overrides: Partial<InventoryDeps> = {}): InventoryDeps {
  return {
    platform: 'darwin',
    readEtcShells: () => '/bin/sh\n/bin/zsh\n',
    fileExists: () => true,
    currentShell: '/bin/zsh',
    listDistros: () => [],
    windowsBinaryExists: () => false,
    ...overrides,
  }
}

function windowsDeps(overrides: Partial<InventoryDeps> = {}): InventoryDeps {
  return {
    platform: 'win32',
    readEtcShells: () => '',
    fileExists: () => false,
    listDistros: () => parseWslList(WSL_OUTPUT),
    windowsBinaryExists: () => true,
    ...overrides,
  }
}

describe('buildInventory — macOS/Linux', () => {
  it('always offers 자동 first', () => {
    expect(buildInventory(posixDeps(), 'auto').options[0]).toMatchObject({ mode: 'auto', available: true })
  })

  it('spells out what 자동 currently resolves to', () => {
    // Otherwise "자동" is a black box to someone debugging a PATH problem.
    expect(buildInventory(posixDeps(), 'auto').autoResolvesTo).toBe('/bin/zsh')
  })

  it('offers the installed shells', () => {
    const modes = buildInventory(posixDeps(), 'auto').options.map(o => o.mode)
    expect(modes).toContain('posix:/bin/zsh')
  })

  it('keeps a stored mode that still resolves', () => {
    const inventory = buildInventory(posixDeps(), 'posix:/bin/zsh')
    expect(inventory).toMatchObject({ mode: 'posix:/bin/zsh', fellBackToAuto: false })
  })

  it('falls back to auto and says so when the shell is gone', () => {
    // Silently switching shells would leave the settings screen showing a
    // choice that is not in effect.
    const deps = posixDeps({ fileExists: path => path !== '/bin/fish', readEtcShells: () => '/bin/fish\n' })
    const inventory = buildInventory(deps, 'posix:/bin/fish')

    expect(inventory).toMatchObject({ mode: 'auto', fellBackToAuto: true })
  })

  it('does not claim a fallback when nothing was chosen', () => {
    expect(buildInventory(posixDeps(), 'auto').fellBackToAuto).toBe(false)
  })
})

describe('buildInventory — Windows', () => {
  it('offers distros and marks the unusable one with its reason', () => {
    const options = buildInventory(windowsDeps(), 'auto').options
    const docker = options.find(o => o.mode === 'wsl:docker-desktop')

    expect(options.find(o => o.mode === 'wsl:Ubuntu')).toMatchObject({ available: true })
    expect(docker).toMatchObject({ available: false })
    expect(docker?.unavailableReason).toBeTruthy()
  })

  it('attaches the tmux caveat to PowerShell instead of pretending it hosts agents', () => {
    const powershell = buildInventory(windowsDeps(), 'auto').options.find(o => o.mode === 'powershell')
    expect(powershell).toMatchObject({ available: true })
    expect(powershell?.caveat).toContain('WSL')
  })

  it('disables PowerShell when neither flavour is installed', () => {
    const deps = windowsDeps({ windowsBinaryExists: () => false })
    expect(buildInventory(deps, 'auto').options.find(o => o.mode === 'powershell')).toMatchObject({
      available: false,
    })
  })

  it('resolves 자동 to the default distro', () => {
    expect(buildInventory(windowsDeps(), 'auto').autoResolvesTo).toBe('WSL · Ubuntu')
  })

  it('rejects a stored distro that has since been removed', () => {
    const deps = windowsDeps({ listDistros: () => [] })
    expect(buildInventory(deps, 'wsl:Ubuntu')).toMatchObject({ mode: 'auto', fellBackToAuto: true })
  })

  it('offers no shell paths on Windows', () => {
    const modes = buildInventory(windowsDeps(), 'auto').options.map(o => o.mode)
    expect(modes.some(mode => mode.startsWith('posix:'))).toBe(false)
  })
})

describe('shell store', () => {
  function store(initial: string | Error): StoreDeps & { written: string[] } {
    const written: string[] = []
    return {
      path: '/tmp/shell-settings.json',
      readFile: () => {
        if (initial instanceof Error) throw initial
        return initial
      },
      writeFile: (_path, contents) => {
        written.push(contents)
      },
      written,
    }
  }

  it('reads a stored mode', () => {
    expect(readShellMode(store('{"shellMode":"posix:/bin/zsh"}'))).toBe('posix:/bin/zsh')
  })

  it.each([
    ['a missing file', new Error('ENOENT')],
    ['invalid JSON', '{not json'],
    ['a mode of the wrong type', '{"shellMode":42}'],
    ['a mode this build cannot parse', '{"shellMode":"quantum:/bin/zsh"}'],
    ['an empty object', '{}'],
  ])('falls back to auto on %s', (_label, initial) => {
    // A hand-edited or corrupt settings file must not stop the app booting.
    expect(readShellMode(store(initial as string | Error))).toBe('auto')
  })

  it('writes a valid mode', () => {
    const deps = store('{}')
    expect(writeShellMode(deps, 'posix:/bin/zsh')).toEqual({ ok: true })
    expect(JSON.parse(deps.written[0]!)).toEqual({ shellMode: 'posix:/bin/zsh' })
  })

  it('refuses to store something it could never read back', () => {
    const deps = store('{}')
    expect(writeShellMode(deps, 'nonsense').ok).toBe(false)
    expect(deps.written).toHaveLength(0)
  })

  it('reports a write failure instead of throwing at the caller', () => {
    const deps: StoreDeps = {
      path: '/nope/shell-settings.json',
      readFile: () => '{}',
      writeFile: vi.fn(() => {
        throw new Error('EACCES: permission denied')
      }),
    }
    expect(writeShellMode(deps, 'auto')).toMatchObject({ ok: false, error: expect.stringContaining('EACCES') })
  })
})
