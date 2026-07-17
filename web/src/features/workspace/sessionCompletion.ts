// Pure "is this session done?" judgment (feedback #16), kept separate from
// any component so it stays independently unit-testable and so the two
// consumers (Sidebar session row, Overview session card) apply the exact
// same rule instead of two hand-rolled approximations.
//
// A session counts as complete once every terminal that still counts (killed
// ones are excluded — a torn-down worker shouldn't block the badge) has
// settled into completed/idle, at least one of them actually reached
// `completed` (idle-only, e.g. a supervisor that never ran anything, is not
// "done" — just quiet), and none are still processing or waiting on the user.
export interface CompletionStatusInput {
  status: string | null | undefined
  /** Explicit kill flag for callers with one (DelegationCard) — a plain REST terminal-status string never carries "killed" as a status value (see models/terminal.py TerminalStatus), only this separate flag. */
  killed?: boolean
}

const BLOCKING_STATUSES = new Set(['processing', 'waiting_user_answer'])
const SETTLED_STATUSES = new Set(['completed', 'idle'])

export function isSessionCompleted(items: CompletionStatusInput[]): boolean {
  const relevant = items.filter(item => !item.killed)
  if (relevant.length === 0) return false

  const normalized = relevant.map(item => (item.status || '').toLowerCase())
  if (normalized.some(status => BLOCKING_STATUSES.has(status))) return false

  const allSettled = normalized.every(status => SETTLED_STATUSES.has(status))
  const hasCompleted = normalized.some(status => status === 'completed')
  return allSettled && hasCompleted
}
