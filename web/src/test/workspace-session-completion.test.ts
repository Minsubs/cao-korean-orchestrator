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

describe('aggregateSessionStatus', () => {
  it('reports processing instead of completed while a delegated worker is active', () => {
    expect(aggregateSessionStatus([{ status: 'completed' }, { status: 'processing' }])).toBe('processing')
  })

  it('reports completed only after the whole session completes', () => {
    expect(aggregateSessionStatus([{ status: 'completed' }, { status: 'completed' }])).toBe('completed')
  })
})
