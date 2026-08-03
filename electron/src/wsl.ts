/**
 * WSL discovery for the Windows path (docs/electron-plan.md §4).
 *
 * On Windows the server does not run on Windows: it runs inside a WSL distro
 * and is reached over WSL2's localhost forwarding. So "which distro" is a real
 * setting the user has to be able to see and change, and the choices offered
 * must be distros that actually exist — no invented options.
 *
 * The parsing here exists because `wsl.exe -l -v` is not ordinary text output.
 */

/**
 * Decode `wsl.exe` output.
 *
 * **wsl.exe writes UTF-16LE**, not UTF-8. Read as UTF-8 it looks like every
 * character is followed by a NUL — `" U b u n t u"` — and a naive line split
 * yields distro names nobody can match against. Verified against a real
 * Windows 11 host: the first bytes of `-l -v` are `20 00 20 00 4E 00 …`.
 *
 * A BOM may or may not be present depending on the Windows build, so it is
 * stripped rather than relied on.
 */
export function decodeWslOutput(raw: Buffer): string {
  return raw.toString('utf16le').replace(/^﻿/, '')
}

export interface WslDistro {
  name: string
  /** `Running` / `Stopped` as reported; shown, never interpreted. */
  state: string
  /** WSL version. 1 cannot be used — see `usable`. */
  version: number
  /** The distro `wsl.exe` uses when none is named. */
  isDefault: boolean
  /** Whether we can host the server there, and why not when we cannot. */
  usable: boolean
  unusableReason?: string
}

/** Names `wsl -l -v` lists that are not user distros. */
const SYSTEM_DISTROS = new Set(['docker-desktop', 'docker-desktop-data'])

/**
 * Parse `wsl.exe -l -v` into distros.
 *
 * The layout is column-aligned with a `*` marking the default, and the header
 * row is localized on non-English Windows — so the header is identified by
 * position (first line) rather than by matching the word "NAME", which would
 * silently treat a Korean header as a distro named `이름`.
 */
export function parseWslList(output: string): WslDistro[] {
  const lines = output.split(/\r?\n/).filter(line => line.trim().length > 0)
  // Drop the header: its wording depends on the Windows display language.
  const rows = lines.slice(1)

  const distros: WslDistro[] = []
  for (const row of rows) {
    const isDefault = row.trimStart().startsWith('*')
    const columns = row.replace(/^\s*\*?\s*/, '').split(/\s{2,}/)
    const name = columns[0]?.trim()
    if (!name) continue

    const state = columns[1]?.trim() ?? 'Unknown'
    const version = Number.parseInt(columns[2]?.trim() ?? '', 10)

    distros.push({
      name,
      state,
      version: Number.isNaN(version) ? 0 : version,
      isDefault,
      ...usability(name, Number.isNaN(version) ? 0 : version),
    })
  }
  return distros
}

function usability(name: string, version: number): Pick<WslDistro, 'usable' | 'unusableReason'> {
  if (SYSTEM_DISTROS.has(name)) {
    return { usable: false, unusableReason: 'Docker Desktop 이 관리하는 시스템 배포판이에요' }
  }
  if (version === 1) {
    // WSL1 does not forward localhost the way WSL2 does, so the window could
    // not reach a server started inside it.
    return { usable: false, unusableReason: 'WSL1 은 localhost 포워딩이 달라 사용할 수 없어요' }
  }
  if (version === 0) {
    return { usable: false, unusableReason: '버전을 확인하지 못했어요' }
  }
  return { usable: true }
}

/**
 * Pick the distro to host the server.
 *
 * Prefers the user's explicit choice, then WSL's own default, then the first
 * usable one. Returns null when nothing is usable — the diagnostics screen
 * says so instead of the app failing later with a confusing wsl.exe error.
 */
export function chooseDistro(distros: WslDistro[], preferred?: string): WslDistro | null {
  const usable = distros.filter(distro => distro.usable)
  if (preferred) {
    const match = usable.find(distro => distro.name === preferred)
    if (match) return match
  }
  return usable.find(distro => distro.isDefault) ?? usable[0] ?? null
}

export interface PowerShellFlavor {
  /** Executable name as invoked. */
  binary: 'pwsh.exe' | 'powershell.exe'
  label: string
}

/**
 * Which PowerShell is available, newest first.
 *
 * PowerShell 7 (`pwsh.exe`) and Windows PowerShell 5.1 (`powershell.exe`) are
 * different products that coexist; 5.1 is present on every Windows box, so it
 * is the fallback rather than the preference.
 */
export function detectPowerShell(exists: (binary: string) => boolean): PowerShellFlavor | null {
  if (exists('pwsh.exe')) return { binary: 'pwsh.exe', label: 'PowerShell 7' }
  if (exists('powershell.exe')) return { binary: 'powershell.exe', label: 'Windows PowerShell 5.1' }
  return null
}
