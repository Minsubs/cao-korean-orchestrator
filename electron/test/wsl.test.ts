import { describe, it, expect } from 'vitest'
import { chooseDistro, decodeWslOutput, detectPowerShell, parseWslList } from '../src/wsl'

/**
 * Captured from a real Windows 11 host (`wsl.exe -l -v`), including the CRLF
 * line endings and the column padding. The default distro carries the `*`.
 */
const REAL_OUTPUT = [
  '  NAME                   STATE           VERSION',
  '* Ubuntu                 Running         2',
  '  docker-desktop         Running         2',
  '',
].join('\r\n')

describe('decodeWslOutput', () => {
  it('reads wsl.exe output as UTF-16LE', () => {
    // Read as UTF-8 this looks like " U b u n t u" and every distro name fails
    // to match. Verified against real bytes: 20 00 20 00 4E 00 …
    const raw = Buffer.from(REAL_OUTPUT, 'utf16le')
    expect(decodeWslOutput(raw)).toBe(REAL_OUTPUT)
  })

  it('strips a BOM when the Windows build emits one', () => {
    const raw = Buffer.from('﻿' + REAL_OUTPUT, 'utf16le')
    expect(decodeWslOutput(raw).startsWith('  NAME')).toBe(true)
  })

  it('does not mangle a distro name with a hyphen', () => {
    const raw = Buffer.from(REAL_OUTPUT, 'utf16le')
    expect(decodeWslOutput(raw)).toContain('docker-desktop')
  })
})

describe('parseWslList', () => {
  it('reads the real output', () => {
    const distros = parseWslList(REAL_OUTPUT)

    expect(distros.map(d => d.name)).toEqual(['Ubuntu', 'docker-desktop'])
    expect(distros[0]).toMatchObject({ name: 'Ubuntu', state: 'Running', version: 2, isDefault: true, usable: true })
  })

  it('marks Docker Desktop distros unusable rather than offering them', () => {
    // They exist and are Running, so a naive list would present them as valid
    // choices; hosting the server there is not a thing anyone wants.
    const docker = parseWslList(REAL_OUTPUT).find(d => d.name === 'docker-desktop')
    expect(docker).toMatchObject({ usable: false })
    expect(docker?.unusableReason).toContain('Docker Desktop')
  })

  it('rejects WSL1, whose localhost forwarding differs', () => {
    const output = ['  NAME     STATE     VERSION', '* Legacy   Running   1'].join('\r\n')
    const [distro] = parseWslList(output)

    expect(distro).toMatchObject({ version: 1, usable: false })
    expect(distro?.unusableReason).toContain('WSL1')
  })

  it('treats the first line as the header regardless of language', () => {
    // Windows localizes the header; matching the word "NAME" would turn a
    // Korean header row into a distro called 이름.
    const localized = ['  이름         상태        버전', '* Ubuntu       Running     2'].join('\r\n')
    const distros = parseWslList(localized)

    expect(distros.map(d => d.name)).toEqual(['Ubuntu'])
  })

  it('survives a distro with no distro installed at all', () => {
    expect(parseWslList('Windows Subsystem for Linux has no installed distributions.')).toEqual([])
  })

  it('flags an unparseable version instead of assuming WSL2', () => {
    const output = ['  NAME     STATE     VERSION', '* Odd      Running   ?'].join('\r\n')
    expect(parseWslList(output)[0]).toMatchObject({ version: 0, usable: false })
  })
})

describe('chooseDistro', () => {
  const distros = parseWslList(REAL_OUTPUT)

  it('honours an explicit choice', () => {
    const extra = [...distros, { name: 'Alpine', state: 'Stopped', version: 2, isDefault: false, usable: true }]
    expect(chooseDistro(extra, 'Alpine')?.name).toBe('Alpine')
  })

  it('ignores a choice that is not usable', () => {
    // A stale setting pointing at docker-desktop must not silently win.
    expect(chooseDistro(distros, 'docker-desktop')?.name).toBe('Ubuntu')
  })

  it('falls back to the WSL default', () => {
    expect(chooseDistro(distros)?.name).toBe('Ubuntu')
  })

  it('returns null when nothing is usable, rather than a wsl.exe error later', () => {
    const onlyDocker = distros.filter(d => d.name === 'docker-desktop')
    expect(chooseDistro(onlyDocker)).toBeNull()
  })
})

describe('detectPowerShell', () => {
  it('prefers PowerShell 7 when installed', () => {
    expect(detectPowerShell(binary => binary === 'pwsh.exe')).toMatchObject({ binary: 'pwsh.exe' })
  })

  it('falls back to Windows PowerShell, which every Windows box has', () => {
    expect(detectPowerShell(binary => binary === 'powershell.exe')).toMatchObject({
      binary: 'powershell.exe',
    })
  })

  it('reports absence instead of guessing', () => {
    expect(detectPowerShell(() => false)).toBeNull()
  })
})
