/**
 * Persistence for the shell choice.
 *
 * A plain JSON file rather than a store dependency: one string, read at boot
 * and written when the user changes it. Everything about reading is defensive —
 * a corrupt or hand-edited file must not stop the app from starting, because
 * the failure would look like "the app is broken", not "one setting is odd".
 */

import { parseShellMode, type ShellMode } from './shell-config'

export interface StoreDeps {
  readFile(path: string): string
  writeFile(path: string, contents: string): void
  path: string
}

interface StoredSettings {
  shellMode?: unknown
}

/**
 * Read the stored mode, or `auto`.
 *
 * Anything unexpected — missing file, invalid JSON, a mode string this build
 * does not understand — resolves to `auto`. Note this is a *syntactic* check
 * only: whether the mode still resolves to something installed is decided later
 * against live detection (`buildInventory`), because a shell can vanish long
 * after it was written here.
 */
export function readShellMode(deps: StoreDeps): ShellMode {
  let raw: string
  try {
    raw = deps.readFile(deps.path)
  } catch {
    return 'auto'
  }

  let parsed: StoredSettings
  try {
    parsed = JSON.parse(raw) as StoredSettings
  } catch {
    return 'auto'
  }

  if (typeof parsed?.shellMode !== 'string') return 'auto'
  return parseShellMode(parsed.shellMode) ? parsed.shellMode : 'auto'
}

/**
 * Persist a mode.
 *
 * Rejects a mode this build cannot parse instead of writing it: a settings file
 * that stores garbage produces a fallback on every subsequent boot, with
 * nothing to explain it.
 */
export function writeShellMode(deps: StoreDeps, mode: ShellMode): { ok: boolean; error?: string } {
  if (!parseShellMode(mode)) return { ok: false, error: `알 수 없는 셸 설정: ${mode}` }
  try {
    deps.writeFile(deps.path, JSON.stringify({ shellMode: mode }, null, 2) + '\n')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '설정을 저장하지 못했어요' }
  }
}
