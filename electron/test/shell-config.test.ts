import { describe, it, expect } from 'vitest'
import {
  distroFor,
  isSelectable,
  parseShellMode,
  posixShellOptions,
  shellBinaryFor,
  type ShellOption,
} from '../src/shell-config'

/** A realistic /etc/shells, comments and all. */
const ETC_SHELLS = `# List of acceptable shells
/bin/sh
/bin/bash
/bin/zsh
/opt/homebrew/bin/fish
`

describe('posixShellOptions', () => {
  it('lists what /etc/shells declares', () => {
    const options = posixShellOptions(ETC_SHELLS, () => true)
    expect(options.map(o => o.label)).toEqual(['sh', 'bash', 'zsh', 'fish'])
  })

  it('skips comments and blank lines', () => {
    const options = posixShellOptions('# just a comment\n\n/bin/zsh\n', () => true)
    expect(options).toHaveLength(1)
  })

  it('marks an uninstalled entry unavailable instead of hiding it', () => {
    // /etc/shells can name a shell that was later removed. Showing it disabled
    // with a reason beats silently omitting something the user expects.
    const options = posixShellOptions(ETC_SHELLS, path => path !== '/opt/homebrew/bin/fish')
    const fish = options.find(o => o.label === 'fish')

    expect(fish).toMatchObject({ available: false })
    expect(fish?.unavailableReason).toBeTruthy()
  })

  it("includes the user's current shell even when /etc/shells has not caught up", () => {
    // A brew-installed shell frequently is not in /etc/shells yet.
    const options = posixShellOptions(ETC_SHELLS, () => true, '/opt/homebrew/bin/nu')
    expect(options[0]).toMatchObject({ mode: 'posix:/opt/homebrew/bin/nu', available: true })
  })

  it('does not list the current shell twice', () => {
    const options = posixShellOptions(ETC_SHELLS, () => true, '/bin/zsh')
    expect(options.filter(o => o.mode === 'posix:/bin/zsh')).toHaveLength(1)
  })
})

describe('parseShellMode', () => {
  it.each([
    ['auto', { kind: 'auto' }],
    ['powershell', { kind: 'powershell' }],
    ['posix:/bin/zsh', { kind: 'posix', value: '/bin/zsh' }],
    ['wsl:Ubuntu', { kind: 'wsl', value: 'Ubuntu' }],
  ])('parses %s', (mode, expected) => {
    expect(parseShellMode(mode)).toEqual(expected)
  })

  it('accepts the legacy mac: prefix so an older config keeps working', () => {
    expect(parseShellMode('mac:/bin/zsh')).toEqual({ kind: 'posix', value: '/bin/zsh' })
  })

  it('keeps a Windows path intact despite its own colon', () => {
    expect(parseShellMode('posix:C:/msys64/usr/bin/bash')).toEqual({
      kind: 'posix',
      value: 'C:/msys64/usr/bin/bash',
    })
  })

  it.each([[''], ['nonsense'], [':/bin/zsh'], ['posix:'], [null], [42]])('rejects %j', value => {
    expect(parseShellMode(value)).toBeNull()
  })
})

describe('isSelectable', () => {
  const shells: ShellOption[] = [
    { mode: 'posix:/bin/zsh', label: 'zsh', available: true },
    { mode: 'posix:/bin/fish', label: 'fish', available: false },
  ]
  const distros = [
    { name: 'Ubuntu', usable: true },
    { name: 'docker-desktop', usable: false },
  ]

  it('accepts auto', () => {
    expect(isSelectable('auto', { shells, distros })).toBe(true)
  })

  it('accepts an installed shell', () => {
    expect(isSelectable('posix:/bin/zsh', { shells, distros })).toBe(true)
  })

  it('rejects a shell that is listed but missing', () => {
    // A stored choice goes stale when the shell is uninstalled; better to fall
    // back to auto loudly than to launch something else quietly.
    expect(isSelectable('posix:/bin/fish', { shells, distros })).toBe(false)
  })

  it('rejects a distro that cannot host the server', () => {
    expect(isSelectable('wsl:docker-desktop', { shells, distros })).toBe(false)
  })

  it('rejects a distro that no longer exists', () => {
    expect(isSelectable('wsl:Debian', { shells, distros })).toBe(false)
  })
})

describe('mode → spawn inputs', () => {
  it('gives the server spawn a shell binary for posix modes', () => {
    expect(shellBinaryFor('posix:/bin/zsh')).toBe('/bin/zsh')
  })

  it.each([['auto'], ['wsl:Ubuntu'], ['powershell']])('has no shell binary for %s', mode => {
    // auto means "platform default"; wsl/powershell pick a host, not a binary.
    expect(shellBinaryFor(mode)).toBeUndefined()
  })

  it('extracts the distro for wsl modes only', () => {
    expect(distroFor('wsl:Ubuntu')).toBe('Ubuntu')
    expect(distroFor('posix:/bin/zsh')).toBeUndefined()
  })
})
