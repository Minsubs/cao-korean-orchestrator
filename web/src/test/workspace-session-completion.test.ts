import { describe, expect, it } from 'vitest'
import { isSessionCompleted } from '../features/workspace/sessionCompletion'

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
