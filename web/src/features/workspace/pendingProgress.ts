// 대기 중인 턴이 "아직 살아 있는지"를 진행 신호로 판정한다.
//
// The chat used to abandon a pending turn after a flat 180s: it cleared
// pendingReply, which permanently stopped polling, so a genuinely long
// multi-agent run (one observed run had a single worker at 9m50s) showed no
// answer and no completion summary — ever, even after the orchestrator replied.
//
// Any absolute deadline is the wrong shape: too short abandons healthy work, too
// long pins the UI on a turn that really is dead. So track *inactivity* instead —
// take a cheap fingerprint of everything that moves while work happens, and only
// call the turn quiet when nothing has moved for a while. Nothing is discarded on
// timeout; the caller keeps polling (slower) so a late answer still lands.

/** No observed movement for this long → report the turn as quiet (not dead). */
export const PENDING_INACTIVITY_MS = 300_000

/** Poll cadence before / after the turn goes quiet. */
export const PENDING_POLL_MS = 2_000
export const PENDING_QUIET_POLL_MS = 10_000

export interface ProgressInputs {
  /** Cleaned orchestrator output seen this round. */
  output: string
  /** input/ready generation per terminal in the session. */
  generations: Record<string, number>
  /** Highest inbox message id observed for the waiting terminal. */
  latestInboxId: number
  /** Live status per terminal — a worker changing state is progress too. */
  statuses: Record<string, string>
}

/**
 * Collapse everything that moves during a turn into one comparable string. Any
 * change at all counts as progress; the exact value is never shown to a user.
 */
export function progressFingerprint(inputs: ProgressInputs): string {
  const gens = Object.keys(inputs.generations)
    .sort()
    .map(id => `${id}:${inputs.generations[id]}`)
    .join(',')
  const statuses = Object.keys(inputs.statuses)
    .sort()
    .map(id => `${id}:${inputs.statuses[id]}`)
    .join(',')
  return `${inputs.output.length}|${gens}|${inputs.latestInboxId}|${statuses}`
}

/** True once nothing has moved for PENDING_INACTIVITY_MS. */
export function isTurnQuiet(lastProgressAt: number, now: number): boolean {
  return now - lastProgressAt >= PENDING_INACTIVITY_MS
}
