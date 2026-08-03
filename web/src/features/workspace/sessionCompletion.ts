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
  id?: string
  status?: string | null
  caller_id?: string | null
  input_generation?: number
  ready_generation?: number
  /** Explicit kill flag for callers with one (DelegationCard) — a plain REST terminal-status string never carries "killed" as a status value (see models/terminal.py TerminalStatus), only this separate flag. */
  killed?: boolean
}

export interface CallbackMessageInput {
  id: number
  sender_id: string
  status: string
}

const BLOCKING_STATUSES = new Set(['processing', 'waiting_user_answer'])
const SETTLED_STATUSES = new Set(['completed', 'idle'])
const REPLY_OUTCOMES = new Set(['completed', 'idle', 'waiting_user_answer', 'error'])
// Outcomes that mean "the agent produced something", as opposed to `idle`,
// which only means the terminal is quiet. Used by the relaxed acceptance path
// below, where a state this weak must never stand in for an answer.
const RESPONSE_OUTCOMES = new Set(['completed', 'waiting_user_answer', 'error'])

export interface ReplyReadyOptions {
  /**
   * Accept the target's turn even when StatusMonitor never recorded a ready
   * generation for it.
   *
   * Measured (matrix case CL-to-AG, 2026-08-03): a turn that both starts and
   * ends while the terminal is already latched on a ready status can never
   * record one. The monitor only advances ready_generation on a
   * PROCESSING -> ready edge, and a fast turn — a supervisor answering a worker
   * callback with one line — can finish without a single PROCESSING frame ever
   * being sampled. The terminal log proved the answer arrived (final marker in
   * the FIFO bytes) while the status stream stayed silent, so
   * ready_generation stayed one behind input_generation forever and the reply
   * was never shown.
   *
   * The monitor is right to report only what it observed, so the missing proof
   * is supplied here instead: the caller passes true only once the output text
   * has settled (identical on two consecutive polls) and differs from the
   * pre-prompt baseline. That is a content proof of a new response, which is
   * strictly stronger than a sampled spinner frame.
   */
  allowUnobservedTargetTurn?: boolean
}

export type AggregateSessionStatus = 'unknown' | 'processing' | 'waiting_user_answer' | 'error' | 'completed' | 'idle'

export function snapshotInputGenerations(items: CompletionStatusInput[]): Record<string, number> {
  return Object.fromEntries(
    items
      .filter((item): item is CompletionStatusInput & { id: string } => !!item.id)
      .map(item => [item.id, item.input_generation ?? 0]),
  )
}

function relevantStatuses(items: CompletionStatusInput[]): string[] {
  return items
    .filter(item => !item.killed)
    .map(item => (item.status || '').toLowerCase())
}

export function isSessionCompleted(items: CompletionStatusInput[]): boolean {
  const normalized = relevantStatuses(items)
  if (normalized.length === 0) return false
  if (normalized.some(status => BLOCKING_STATUSES.has(status))) return false

  const allSettled = normalized.every(status => SETTLED_STATUSES.has(status))
  const hasCompleted = normalized.some(status => status === 'completed')
  return allSettled && hasCompleted
}

function branchForTarget(items: CompletionStatusInput[], targetId: string): CompletionStatusInput[] {
  const branchIds = new Set([targetId])
  let changed = true
  while (changed) {
    changed = false
    for (const item of items) {
      if (item.id && item.caller_id && branchIds.has(item.caller_id) && !branchIds.has(item.id)) {
        branchIds.add(item.id)
        changed = true
      }
    }
  }
  return items.filter(item => item.id && branchIds.has(item.id))
}

/**
 * Prove that the target completed its prompt cycle and, when this turn spawned
 * workers, completed another processing cycle for their inbox callbacks. Turn
 * generations are semantic StatusMonitor transitions, not output/redraw times.
 */
export function isOrchestrationReplyReady(
  items: CompletionStatusInput[],
  targetId: string,
  baselineGenerations: Record<string, number>,
  callbacks: CallbackMessageInput[],
  baselineInboxMessageId: number,
  options: ReplyReadyOptions = {},
): boolean {
  const branch = branchForTarget(items.filter(item => !item.killed), targetId)
  const target = branch.find(item => item.id === targetId)
  if (!target || !REPLY_OUTCOMES.has((target.status || '').toLowerCase())) return false

  const branchDescendants = branch.filter(item => item.id && item.id !== targetId)
  if (branchDescendants.some(item => (
    item.id
    && baselineGenerations[item.id] === undefined
    && (item.input_generation ?? 0) <= 0
  ))) return false
  const descendants = branchDescendants.filter(item => {
    if (!item.id || item.id === targetId) return false
    const baseline = baselineGenerations[item.id] ?? 0
    return (item.input_generation ?? 0) > baseline
  })
  if (descendants.some(item => (
    !REPLY_OUTCOMES.has((item.status || '').toLowerCase())
    || (item.ready_generation ?? 0) !== (item.input_generation ?? 0)
  ))) return false
  const directChildren = descendants.filter(item => item.caller_id === targetId)
  const callbackSenders = new Set(
    callbacks
      .filter(message => message.id > baselineInboxMessageId && message.status === 'delivered')
      .map(message => message.sender_id),
  )
  if (directChildren.some(item => !item.id || !callbackSenders.has(item.id))) return false
  const baselineTarget = baselineGenerations[targetId] ?? 0
  const requiredGeneration = baselineTarget + 1 + directChildren.length
  const inputGeneration = target.input_generation ?? 0
  const readyGeneration = target.ready_generation ?? 0
  if (inputGeneration < requiredGeneration) return false
  if (readyGeneration === inputGeneration) return true
  // No observed ready generation for this turn. Accept only when the caller has
  // its own proof (settled, changed output) and the target is in a state that
  // carries a response — see ReplyReadyOptions.
  if (!options.allowUnobservedTargetTurn) return false
  return RESPONSE_OUTCOMES.has((target.status || '').toLowerCase())
}

/**
 * A reply is accepted only when the same ready orchestration snapshot brackets
 * the output read. This prevents an interim pane capture from being paired with
 * newer session generations/callbacks by concurrent HTTP requests.
 */
export function orchestrationReplyFingerprint(
  items: CompletionStatusInput[],
  targetId: string,
  baselineGenerations: Record<string, number>,
  callbacks: CallbackMessageInput[],
  baselineInboxMessageId: number,
  options: ReplyReadyOptions = {},
): string | null {
  if (!isOrchestrationReplyReady(items, targetId, baselineGenerations, callbacks, baselineInboxMessageId, options)) {
    return null
  }
  const terminals = items
    .filter(item => !item.killed)
    .map(item => ({
      id: item.id ?? '',
      callerId: item.caller_id ?? '',
      status: (item.status || '').toLowerCase(),
      inputGeneration: item.input_generation ?? 0,
      readyGeneration: item.ready_generation ?? 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const deliveredCallbacks = callbacks
    .filter(message => message.id > baselineInboxMessageId && message.status === 'delivered')
    .map(message => ({ id: message.id, senderId: message.sender_id }))
    .sort((a, b) => a.id - b.id)
  return JSON.stringify({ terminals, deliveredCallbacks })
}

/** Collapse terminal-turn states into the state of the whole orchestration session. */
export function aggregateSessionStatus(items: CompletionStatusInput[]): AggregateSessionStatus {
  const normalized = relevantStatuses(items)
  if (normalized.length === 0 || normalized.some(status => status.length === 0)) return 'unknown'
  if (normalized.includes('waiting_user_answer')) return 'waiting_user_answer'
  if (normalized.includes('processing')) return 'processing'
  if (normalized.includes('error')) return 'error'
  if (isSessionCompleted(items)) return 'completed'
  if (normalized.every(status => status === 'idle')) return 'idle'
  return 'unknown'
}
