import { describe, expect, it } from 'vitest'
import {
  aggregateSessionStatus,
  isSessionCompleted,
  isOrchestrationReplyReady,
} from '../features/workspace/sessionCompletion'

describe('isSessionCompleted (feedback #16)', () => {
  it('is false for an empty terminal list — no signal is not "done"', () => {
    expect(isSessionCompleted([])).toBe(false)
  })

  it('is true when every terminal is completed', () => {
    expect(isSessionCompleted([{ status: 'completed' }, { status: 'completed' }])).toBe(true)
  })

  it('is true when settled terminals are a mix of completed/idle, as long as at least one completed', () => {
    expect(isSessionCompleted([{ status: 'completed' }, { status: 'idle' }])).toBe(true)
  })

  it('is false when every terminal is idle — quiet is not the same as done', () => {
    expect(isSessionCompleted([{ status: 'idle' }, { status: 'idle' }])).toBe(false)
  })

  it('is false while any terminal is still processing', () => {
    expect(isSessionCompleted([{ status: 'completed' }, { status: 'processing' }])).toBe(false)
  })

  it('is false while any terminal is waiting on the user', () => {
    expect(isSessionCompleted([{ status: 'completed' }, { status: 'waiting_user_answer' }])).toBe(false)
  })

  it('excludes killed terminals from the judgment entirely', () => {
    // A torn-down worker sitting at a stale 'processing' snapshot must not block the badge.
    expect(isSessionCompleted([{ status: 'completed' }, { status: 'processing', killed: true }])).toBe(true)
  })

  it('is false when every terminal is killed — nothing left to judge', () => {
    expect(isSessionCompleted([{ status: 'completed', killed: true }])).toBe(false)
  })

  it('is case-insensitive and treats a null/undefined status as unsettled', () => {
    expect(isSessionCompleted([{ status: 'COMPLETED' }])).toBe(true)
    expect(isSessionCompleted([{ status: null }])).toBe(false)
    expect(isSessionCompleted([{ status: undefined }])).toBe(false)
  })
})

describe('isOrchestrationReplyReady', () => {
  it('keeps a reply pending while any delegated worker is processing', () => {
    expect(isOrchestrationReplyReady([
      { id: 'supervisor', status: 'completed', input_generation: 4, ready_generation: 4 },
      { id: 'worker', caller_id: 'supervisor', status: 'processing', input_generation: 8, ready_generation: 7 },
    ], 'supervisor', { supervisor: 3, worker: 7 }, [], 14)).toBe(false)
  })

  it('requires the supervisor to complete a callback-triggered processing cycle', () => {
    const interim = [
      { id: 'supervisor', status: 'completed', input_generation: 4, ready_generation: 4 },
      { id: 'worker', caller_id: 'supervisor', status: 'error', input_generation: 8, ready_generation: 8 },
    ]
    const baseline = { supervisor: 3, worker: 7 }
    expect(isOrchestrationReplyReady(interim, 'supervisor', baseline, [], 14)).toBe(false)
    expect(isOrchestrationReplyReady([
      { ...interim[0], input_generation: 5, ready_generation: 5 },
      interim[1],
    ], 'supervisor', baseline, [
      { id: 15, sender_id: 'worker', status: 'delivered' },
    ], 14)).toBe(true)
  })

  it('does not mistake an unrelated second input cycle for a worker callback', () => {
    expect(isOrchestrationReplyReady([
      { id: 'supervisor', status: 'completed', input_generation: 5, ready_generation: 5 },
      { id: 'worker', caller_id: 'supervisor', status: 'completed', input_generation: 8, ready_generation: 8 },
    ], 'supervisor', { supervisor: 3, worker: 7 }, [], 14)).toBe(false)
  })

  it('accepts an idle delegated worker only with semantic ready-generation proof', () => {
    expect(isOrchestrationReplyReady([
      { id: 'supervisor', status: 'completed', input_generation: 5, ready_generation: 5 },
      { id: 'worker', caller_id: 'supervisor', status: 'idle', input_generation: 8, ready_generation: 8 },
    ], 'supervisor', { supervisor: 3, worker: 7 }, [
      { id: 15, sender_id: 'worker', status: 'delivered' },
    ], 14)).toBe(true)
    expect(isOrchestrationReplyReady([
      { id: 'supervisor', status: 'completed', input_generation: 5, ready_generation: 5 },
      { id: 'worker', caller_id: 'supervisor', status: 'idle', input_generation: 8, ready_generation: 7 },
    ], 'supervisor', { supervisor: 3, worker: 7 }, [
      { id: 15, sender_id: 'worker', status: 'delivered' },
    ], 14)).toBe(false)
  })

  it('does not accept a newly discovered idle worker with zero generations', () => {
    expect(isOrchestrationReplyReady([
      { id: 'supervisor', status: 'completed', input_generation: 2, ready_generation: 2 },
      { id: 'new-worker', caller_id: 'supervisor', status: 'idle', input_generation: 0, ready_generation: 0 },
    ], 'supervisor', { supervisor: 0 }, [
      { id: 15, sender_id: 'new-worker', status: 'delivered' },
    ], 14)).toBe(false)
    expect(isOrchestrationReplyReady([
      { id: 'supervisor', status: 'completed', input_generation: 2, ready_generation: 2 },
      { id: 'new-worker', caller_id: 'supervisor', status: 'idle', input_generation: 1, ready_generation: 1 },
    ], 'supervisor', { supervisor: 0 }, [
      { id: 15, sender_id: 'new-worker', status: 'delivered' },
    ], 14)).toBe(true)
  })

  it('ignores independent orchestration roots in the same session', () => {
    expect(isOrchestrationReplyReady([
      { id: 'supervisor', status: 'completed', input_generation: 5, ready_generation: 5 },
      { id: 'worker', caller_id: 'supervisor', status: 'completed', input_generation: 8, ready_generation: 8 },
      { id: 'other-root', status: 'processing', input_generation: 12, ready_generation: 11 },
    ], 'supervisor', { supervisor: 3, worker: 7, 'other-root': 11 }, [
      { id: 15, sender_id: 'worker', status: 'delivered' },
    ], 14)).toBe(true)
  })

  it('ignores an old completed worker that was not assigned during this turn', () => {
    expect(isOrchestrationReplyReady([
      { id: 'supervisor', status: 'completed', input_generation: 4, ready_generation: 4 },
      { id: 'old-worker', caller_id: 'supervisor', status: 'completed', input_generation: 7, ready_generation: 7 },
    ], 'supervisor', { supervisor: 3, 'old-worker': 7 }, [], 14)).toBe(true)
  })
})

describe('isOrchestrationReplyReady — turns the monitor never observed', () => {
  // Live shape from matrix case CL-to-AG (2026-08-03): the claude supervisor
  // answered its worker's callback, the answer is in the FIFO bytes, and the
  // status stream recorded nothing at all for that turn — so input_generation
  // sat one ahead of ready_generation for good and the reply was never shown.
  const stalled = [
    { id: 'supervisor', status: 'completed', input_generation: 3, ready_generation: 2 },
    { id: 'worker', caller_id: 'supervisor', status: 'completed', input_generation: 2, ready_generation: 2 },
  ]
  const baseline = { supervisor: 1, worker: 0 }
  const callbacks = [{ id: 76, sender_id: 'worker', status: 'delivered' }]

  it('stays pending by default — a missing ready generation is still missing', () => {
    expect(isOrchestrationReplyReady(stalled, 'supervisor', baseline, callbacks, 70)).toBe(false)
  })

  it('accepts the reply once the caller proves the output settled', () => {
    expect(isOrchestrationReplyReady(stalled, 'supervisor', baseline, callbacks, 70, {
      allowUnobservedTargetTurn: true,
    })).toBe(true)
  })

  it('refuses an idle target even with settled output — quiet is not an answer', () => {
    const idleTarget = [{ ...stalled[0], status: 'idle' }, stalled[1]]
    expect(isOrchestrationReplyReady(idleTarget, 'supervisor', baseline, callbacks, 70, {
      allowUnobservedTargetTurn: true,
    })).toBe(false)
  })

  it('still requires the callback-triggered input cycle to have happened', () => {
    // input_generation 2 = prompt only; the callback never reached the
    // supervisor, so no amount of output proof makes this a finished turn.
    const tooEarly = [{ ...stalled[0], input_generation: 2, ready_generation: 1 }, stalled[1]]
    expect(isOrchestrationReplyReady(tooEarly, 'supervisor', baseline, callbacks, 70, {
      allowUnobservedTargetTurn: true,
    })).toBe(false)
  })

  it('does not relax the rule for delegated workers', () => {
    // A worker's own turn is proven by its callback; letting a lagging worker
    // through here would accept a reply while the worker is mid-answer.
    const laggingWorker = [
      { id: 'supervisor', status: 'completed', input_generation: 3, ready_generation: 3 },
      { id: 'worker', caller_id: 'supervisor', status: 'completed', input_generation: 2, ready_generation: 1 },
    ]
    expect(isOrchestrationReplyReady(laggingWorker, 'supervisor', baseline, callbacks, 70, {
      allowUnobservedTargetTurn: true,
    })).toBe(false)
  })

  it('keeps rejecting a target that is still processing', () => {
    const busy = [{ ...stalled[0], status: 'processing' }, stalled[1]]
    expect(isOrchestrationReplyReady(busy, 'supervisor', baseline, callbacks, 70, {
      allowUnobservedTargetTurn: true,
    })).toBe(false)
  })
})

describe('aggregateSessionStatus', () => {
  it('reports processing instead of completed while a delegated worker is active', () => {
    expect(aggregateSessionStatus([{ status: 'completed' }, { status: 'processing' }])).toBe('processing')
  })

  it('reports completed only after the whole session completes', () => {
    expect(aggregateSessionStatus([{ status: 'completed' }, { status: 'completed' }])).toBe('completed')
  })
})
