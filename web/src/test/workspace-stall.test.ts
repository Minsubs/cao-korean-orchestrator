import { describe, expect, it } from 'vitest'
import { computeStall, stallMinutes } from '../features/workspace/stall'
import { STALL_MS } from '../features/workspace/constants'

const NOW = Date.parse('2026-07-17T12:00:00Z')

function card(overrides: Partial<Parameters<typeof computeStall>[0]> = {}) {
  return {
    status: 'processing',
    lastActivityAt: null as number | null,
    lastOutputAt: null as string | null,
    firstSeenAt: NOW - 10 * 60 * 1000,
    killed: false,
    ...overrides,
  }
}

describe('computeStall (spec §7)', () => {
  it('is never stalled when status is not processing, no matter how old the last signal is', () => {
    const result = computeStall(card({ status: 'idle', lastActivityAt: NOW - 60 * 60 * 1000 }), NOW)
    expect(result.stalled).toBe(false)
  })

  it('is never stalled once the terminal has been killed', () => {
    const result = computeStall(card({ killed: true, lastActivityAt: NOW - 60 * 60 * 1000 }), NOW)
    expect(result.stalled).toBe(false)
  })

  it('is not stalled just under the threshold', () => {
    const result = computeStall(card({ lastActivityAt: NOW - (STALL_MS - 1000) }), NOW)
    expect(result.stalled).toBe(false)
  })

  it('is stalled just over the threshold', () => {
    const result = computeStall(card({ lastActivityAt: NOW - (STALL_MS + 1000) }), NOW)
    expect(result.stalled).toBe(true)
    expect(result.elapsedMs).toBeGreaterThan(STALL_MS)
  })

  it('combines the activity event and last_output_at signals, taking whichever is more recent', () => {
    const result = computeStall(
      card({
        lastActivityAt: NOW - (STALL_MS + 60000), // stale activity event
        lastOutputAt: new Date(NOW - 60000).toISOString(), // but output was seen 1 minute ago
      }),
      NOW,
    )
    expect(result.stalled).toBe(false)
  })

  it('falls back to firstSeenAt when no activity signal has ever arrived (never guesses a stall from nothing)', () => {
    const neverStalled = computeStall(card({ firstSeenAt: NOW - (STALL_MS - 1000) }), NOW)
    expect(neverStalled.stalled).toBe(false)

    const stalledSinceStart = computeStall(card({ firstSeenAt: NOW - (STALL_MS + 1000) }), NOW)
    expect(stalledSinceStart.stalled).toBe(true)
  })
})

describe('stallMinutes', () => {
  it('floors to whole minutes and never reports less than 1', () => {
    expect(stallMinutes(30000)).toBe(1)
    expect(stallMinutes(STALL_MS)).toBe(5)
    expect(stallMinutes(STALL_MS + 59000)).toBe(5)
    expect(stallMinutes(STALL_MS + 60000)).toBe(6)
  })
})
