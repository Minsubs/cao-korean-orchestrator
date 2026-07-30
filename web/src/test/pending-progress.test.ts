import { describe, expect, it } from 'vitest'
import {
  isTurnQuiet,
  PENDING_INACTIVITY_MS,
  progressFingerprint,
  type ProgressInputs,
} from '../features/workspace/pendingProgress'

// The chat abandoned a pending turn after a flat 180s — it cleared pendingReply,
// which stopped polling for good. A real multi-agent run (one worker alone ran
// 9m50s) therefore never showed the answer or the completion summary. Progress is
// now judged by movement, not by a stopwatch.

const base: ProgressInputs = {
  output: 'orchestrator output so far',
  generations: { sup: 3, w1: 1 },
  latestInboxId: 7,
  statuses: { sup: 'PROCESSING', w1: 'PROCESSING' },
}

describe('progressFingerprint', () => {
  it('is stable when nothing moved', () => {
    expect(progressFingerprint(base)).toBe(progressFingerprint({ ...base }))
  })

  it('changes when the orchestrator output grows', () => {
    expect(progressFingerprint({ ...base, output: `${base.output} more` })).not.toBe(progressFingerprint(base))
  })

  it('changes when any generation advances', () => {
    expect(progressFingerprint({ ...base, generations: { sup: 4, w1: 1 } })).not.toBe(progressFingerprint(base))
  })

  it('changes when a new inbox message arrives', () => {
    expect(progressFingerprint({ ...base, latestInboxId: 8 })).not.toBe(progressFingerprint(base))
  })

  it('changes when a worker changes state — a long worker run is still progress', () => {
    expect(progressFingerprint({ ...base, statuses: { sup: 'PROCESSING', w1: 'COMPLETED' } })).not.toBe(
      progressFingerprint(base),
    )
  })

  it('changes when a worker appears mid-turn', () => {
    expect(progressFingerprint({ ...base, statuses: { ...base.statuses, w2: 'PROCESSING' } })).not.toBe(
      progressFingerprint(base),
    )
  })

  it('does not depend on key insertion order', () => {
    const a = progressFingerprint({ ...base, generations: { sup: 3, w1: 1 }, statuses: { sup: 'PROCESSING', w1: 'PROCESSING' } })
    const b = progressFingerprint({ ...base, generations: { w1: 1, sup: 3 }, statuses: { w1: 'PROCESSING', sup: 'PROCESSING' } })
    expect(a).toBe(b)
  })
})

describe('isTurnQuiet', () => {
  it('stays patient well past the old 180s deadline while work is recent', () => {
    const now = 10_000_000
    expect(isTurnQuiet(now - 181_000, now)).toBe(false)
    // The run that exposed this: a single worker at 9m50s.
    expect(isTurnQuiet(now - 590_000 + PENDING_INACTIVITY_MS, now)).toBe(false)
  })

  it('reports quiet only once nothing has moved for the inactivity window', () => {
    const now = 10_000_000
    expect(isTurnQuiet(now - (PENDING_INACTIVITY_MS - 1), now)).toBe(false)
    expect(isTurnQuiet(now - PENDING_INACTIVITY_MS, now)).toBe(true)
  })

  it('gives a turn the full window from its last movement, not from its start', () => {
    const start = 1_000_000
    const movedAt = start + 600_000 // 10 minutes in, still working
    expect(isTurnQuiet(movedAt, movedAt + 1_000)).toBe(false)
  })
})
