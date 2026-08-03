/**
 * What shells and WSL distros this machine actually has (docs/electron-plan.md §4).
 *
 * Assembles the choices the settings UI shows. Detection results only — an
 * option that is not really there is either absent or disabled with a reason,
 * never silently offered.
 */

import {
  POWERSHELL_CAVEAT,
  posixShellOptions,
  type ShellMode,
  type ShellOption,
  isSelectable,
} from './shell-config'
import { chooseDistro, detectPowerShell, type WslDistro } from './wsl'

export interface InventoryDeps {
  platform: NodeJS.Platform
  /** `/etc/shells` contents, or '' when it cannot be read. */
  readEtcShells(): string
  fileExists(path: string): boolean
  /** The user's `$SHELL`, when the process has one. */
  currentShell?: string
  /** Parsed `wsl.exe -l -v`; empty on non-Windows or when WSL is absent. */
  listDistros(): WslDistro[]
  /** Whether a Windows binary resolves. */
  windowsBinaryExists(binary: string): boolean
}

export interface ShellInventory {
  /** Currently effective mode after validation. */
  mode: ShellMode
  /** True when the stored mode was dropped because it no longer works. */
  fellBackToAuto: boolean
  options: ShellOption[]
  distros: WslDistro[]
  /** What `auto` resolves to right now, for display next to that option. */
  autoResolvesTo: string | null
}

/**
 * Build the option list for the current platform.
 *
 * macOS/Linux get shells; Windows gets distros plus PowerShell (carrying the
 * caveat that agent terminals still run in WSL, because the terminal backend is
 * tmux). A stored mode that no longer resolves is reported as a fallback rather
 * than quietly replaced — the UI has to be able to tell the user why their
 * choice changed.
 */
export function buildInventory(deps: InventoryDeps, storedMode: ShellMode): ShellInventory {
  const isWindows = deps.platform === 'win32'
  const distros = isWindows ? deps.listDistros() : []

  const options: ShellOption[] = [{ mode: 'auto', label: '자동', available: true }]

  if (isWindows) {
    for (const distro of distros) {
      options.push({
        mode: `wsl:${distro.name}`,
        label: `WSL · ${distro.name}`,
        available: distro.usable,
        ...(distro.unusableReason ? { unavailableReason: distro.unusableReason } : {}),
      })
    }
    const powershell = detectPowerShell(deps.windowsBinaryExists)
    options.push(
      powershell
        ? { mode: 'powershell', label: powershell.label, available: true, caveat: POWERSHELL_CAVEAT }
        : { mode: 'powershell', label: 'PowerShell', available: false, unavailableReason: '설치되어 있지 않아요' }
    )
  } else {
    options.push(...posixShellOptions(deps.readEtcShells(), deps.fileExists, deps.currentShell))
  }

  const valid = isSelectable(storedMode, { shells: options, distros })
  return {
    mode: valid ? storedMode : 'auto',
    fellBackToAuto: !valid && storedMode !== 'auto',
    options,
    distros,
    autoResolvesTo: resolveAuto(deps, distros),
  }
}

/**
 * What `auto` means on this machine right now.
 *
 * Shown next to the option so "자동" is not a black box — a user debugging a
 * PATH problem needs to know which shell that actually is.
 */
function resolveAuto(deps: InventoryDeps, distros: WslDistro[]): string | null {
  if (deps.platform === 'win32') {
    const distro = chooseDistro(distros)
    return distro ? `WSL · ${distro.name}` : null
  }
  return deps.currentShell ?? null
}
