// Per-session Workbench "context" (selected terminal + tab) memory
// (feedback #14) — kept separate from Workbench.tsx's own open/tall/tab
// *layout* prefs (STORAGE_KEYS.workbench, a single global key): that one is
// "how the dock looks", this one is "which terminal was I looking at, for
// this specific session" so switching sessions and back restores it instead
// of leaving the dock pointed at a terminal from whatever session you were
// on before (or nothing at all).
export type WbTab = 'term' | 'output' | 'inbox' | 'logs'

export interface WorkbenchContext {
  terminalId: string
  tab: WbTab
}

const VALID_TABS: WbTab[] = ['term', 'output', 'inbox', 'logs']

function storageKey(sessionName: string): string {
  return `cao:workbench:v1:${sessionName}`
}

export function loadWorkbenchContext(sessionName: string): WorkbenchContext | null {
  try {
    const raw = window.localStorage.getItem(storageKey(sessionName))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.terminalId !== 'string' || !parsed.terminalId) return null
    const tab: WbTab = VALID_TABS.includes(parsed.tab) ? parsed.tab : 'term'
    return { terminalId: parsed.terminalId, tab }
  } catch {
    return null
  }
}

export function saveWorkbenchContext(sessionName: string, ctx: WorkbenchContext): void {
  try {
    window.localStorage.setItem(storageKey(sessionName), JSON.stringify(ctx))
  } catch {
    // Best-effort — the dock still works for the session even if storage is full/disabled.
  }
}
