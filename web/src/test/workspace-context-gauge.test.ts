import { describe, expect, it } from 'vitest'
import {
  gaugeBucket,
  gaugeClassName,
  INITIAL_LOW_CONTEXT_STATE,
  LOW_CONTEXT_REARM_THRESHOLD,
  LOW_CONTEXT_THRESHOLD,
  nextLowContextState,
} from '../features/workspace/contextGauge'

describe('gaugeBucket / gaugeClassName (Phase 2d spec §2d — color buckets)', () => {
  it('is "safe" at and above 50', () => {
    expect(gaugeBucket(50)).toBe('safe')
    expect(gaugeBucket(100)).toBe('safe')
    expect(gaugeClassName(50)).toContain('--success')
  })

  it('is "caution" from 20 up to (not including) 50', () => {
    expect(gaugeBucket(20)).toBe('caution')
    expect(gaugeBucket(49)).toBe('caution')
    expect(gaugeClassName(35)).toContain('--warning')
  })

  it('is "warning" below 20', () => {
    expect(gaugeBucket(19)).toBe('warning')
    expect(gaugeBucket(0)).toBe('warning')
    expect(gaugeClassName(5)).toContain('--danger')
  })

  it('never hardcodes a color — every bucket resolves through an existing CSS var token', () => {
    for (const value of [0, 19, 20, 49, 50, 100]) {
      expect(gaugeClassName(value)).toMatch(/var\(--(success|warning|danger)(-bg)?\)/)
    }
  })
})

describe('nextLowContextState (spec §2d — low-context notification debounce)', () => {
  it('never notifies while percentLeft is null ("no gauge yet"), and never changes armed state', () => {
    const { state, notify } = nextLowContextState(INITIAL_LOW_CONTEXT_STATE, null)
    expect(notify).toBe(false)
    expect(state).toEqual(INITIAL_LOW_CONTEXT_STATE)
  })

  it('does not notify while comfortably above the threshold', () => {
    const { state, notify } = nextLowContextState(INITIAL_LOW_CONTEXT_STATE, 80)
    expect(notify).toBe(false)
    expect(state.armed).toBe(true)
  })

  it('notifies exactly once on the downward crossing below the threshold', () => {
    let state = INITIAL_LOW_CONTEXT_STATE
    const first = nextLowContextState(state, LOW_CONTEXT_THRESHOLD - 1)
    expect(first.notify).toBe(true)
    expect(first.state.armed).toBe(false)
    state = first.state

    // Still below the threshold on the next poll — debounced, no repeat notification.
    const second = nextLowContextState(state, LOW_CONTEXT_THRESHOLD - 5)
    expect(second.notify).toBe(false)
    expect(second.state.armed).toBe(false)
  })

  it('does not notify at exactly the threshold (boundary is exclusive on the low side)', () => {
    const { notify } = nextLowContextState(INITIAL_LOW_CONTEXT_STATE, LOW_CONTEXT_THRESHOLD)
    expect(notify).toBe(false)
  })

  it('re-arms only once recovered to the rearm threshold, not merely above the low threshold', () => {
    const afterFire = nextLowContextState(INITIAL_LOW_CONTEXT_STATE, 10).state
    expect(afterFire.armed).toBe(false)

    // In the 15–24 dead zone: still not armed, no notification, no state change.
    const deadZone = nextLowContextState(afterFire, LOW_CONTEXT_REARM_THRESHOLD - 1)
    expect(deadZone.notify).toBe(false)
    expect(deadZone.state.armed).toBe(false)

    // Recovered to the rearm threshold — armed again, but this transition itself never notifies.
    const rearmed = nextLowContextState(deadZone.state, LOW_CONTEXT_REARM_THRESHOLD)
    expect(rearmed.notify).toBe(false)
    expect(rearmed.state.armed).toBe(true)

    // A fresh dip below the threshold now fires again.
    const secondCrossing = nextLowContextState(rearmed.state, 12)
    expect(secondCrossing.notify).toBe(true)
  })

  it('fires on the very first observation if a terminal is already below the threshold when first seen', () => {
    // No prior poll exists yet — INITIAL_LOW_CONTEXT_STATE is armed by design,
    // so opening a session on an already-critical terminal still warns once.
    const { notify } = nextLowContextState(INITIAL_LOW_CONTEXT_STATE, 3)
    expect(notify).toBe(true)
  })
})
