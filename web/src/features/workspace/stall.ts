// Stall detection (spec §7): a card is "stalled" once it has been PROCESSING
// with no observed activity for STALL_MS. Never guessed from silence alone —
// baseline falls back to firstSeenAt only, and NOT-processing cards are
// never flagged, regardless of how old their last signal is.
import { STALL_MS } from './constants'
import type { DelegationCard } from './types'

export interface StallInfo {
  stalled: boolean
  /** ms since the last known activity signal (or since first seen, if none ever arrived). */
  elapsedMs: number
}

export function computeStall(
  card: Pick<DelegationCard, 'status' | 'lastActivityAt' | 'lastOutputAt' | 'firstSeenAt' | 'killed'>,
  now: number,
): StallInfo {
  const status = (card.status ?? '').toLowerCase()
  if (card.killed || status !== 'processing') return { stalled: false, elapsedMs: 0 }

  const lastOutputMs = card.lastOutputAt ? Date.parse(card.lastOutputAt) : null
  const lastActivity = Math.max(card.lastActivityAt ?? 0, lastOutputMs ?? 0) || card.firstSeenAt
  const elapsedMs = Math.max(0, now - lastActivity)
  return { stalled: elapsedMs > STALL_MS, elapsedMs }
}

export function stallMinutes(elapsedMs: number): number {
  return Math.max(1, Math.floor(elapsedMs / 60000))
}
