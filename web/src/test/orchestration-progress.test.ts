import { describe, expect, it } from 'vitest'
import {
  computeOrchestrationProgress,
  formatElapsed,
  summarizeOrchestration,
  workerStateFor,
} from '../features/workspace/orchestrationProgress'
import type { DelegationCard } from '../features/workspace/types'

const T0 = 1_700_000_000_000

function card(over: Partial<DelegationCard> & { terminalId: string }): DelegationCard {
  return {
    sessionId: null,
    agentName: null,
    provider: null,
    callerId: null,
    callerAgentName: null,
    status: null,
    prevStatus: null,
    location: null,
    locationLoaded: false,
    instruction: null,
    instructionType: null,
    instructionFromId: null,
    killed: false,
    lastActivityAt: null,
    lastOutputAt: null,
    firstSeenAt: T0 + 1000,
    hasSignal: true,
    ...over,
  }
}

describe('formatElapsed', () => {
  it('renders sub-minute durations in seconds', () => {
    expect(formatElapsed(0)).toBe('0초')
    expect(formatElapsed(12_400)).toBe('12초')
  })

  it('renders minutes with seconds, dropping a zero seconds remainder', () => {
    expect(formatElapsed(125_000)).toBe('2분 5초')
    expect(formatElapsed(180_000)).toBe('3분')
  })

  it('renders hours with minutes', () => {
    expect(formatElapsed(3_600_000)).toBe('1시간')
    expect(formatElapsed(3_780_000)).toBe('1시간 3분')
  })

  it('never renders a negative or non-finite duration', () => {
    expect(formatElapsed(-5000)).toBe('0초')
    expect(formatElapsed(Number.NaN)).toBe('0초')
  })
})

describe('workerStateFor', () => {
  it('reports a killed card as done regardless of live status', () => {
    expect(workerStateFor(card({ terminalId: 'w1', killed: true }), { w1: 'PROCESSING' })).toBe('done')
  })

  it('reports error before working', () => {
    expect(workerStateFor(card({ terminalId: 'w1' }), { w1: 'ERROR' })).toBe('error')
  })

  it('treats PROCESSING and WAITING_USER_ANSWER as working', () => {
    expect(workerStateFor(card({ terminalId: 'w1' }), { w1: 'PROCESSING' })).toBe('working')
    expect(workerStateFor(card({ terminalId: 'w1' }), { w1: 'WAITING_USER_ANSWER' })).toBe('working')
  })

  it('falls back to the card status when no live status is known', () => {
    expect(workerStateFor(card({ terminalId: 'w1', status: 'completed' }), {})).toBe('done')
    expect(workerStateFor(card({ terminalId: 'w1' }), {})).toBe('waiting')
  })
})

describe('computeOrchestrationProgress', () => {
  const base = { supervisorTerminalId: 'sup', terminalStatuses: {}, now: T0 + 5000 }

  it('returns null when no turn is pending', () => {
    expect(computeOrchestrationProgress({ ...base, pendingSince: null, cards: [] })).toBeNull()
  })

  it('reports dispatching while no worker of this turn exists yet', () => {
    const progress = computeOrchestrationProgress({ ...base, pendingSince: T0, cards: [] })
    expect(progress).not.toBeNull()
    expect(progress!.stage).toBe('dispatching')
    expect(progress!.totalCount).toBe(0)
    expect(progress!.waitingForLabel).toBeNull()
    expect(progress!.elapsedMs).toBe(5000)
  })

  it('excludes the supervisor and workers left over from an earlier turn', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [
        card({ terminalId: 'sup', firstSeenAt: T0 - 60_000 }),
        card({ terminalId: 'old', firstSeenAt: T0 - 60_000 }),
        card({ terminalId: 'w1', agentName: 'codex_qa_terra' }),
      ],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(progress!.workers.map(w => w.terminalId)).toEqual(['w1'])
  })

  it('reports working and names the worker it is waiting on, via the display label', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', agentName: 'codex_qa_terra', provider: 'codex' })],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(progress!.stage).toBe('working')
    expect(progress!.workers[0].roleLabel).not.toBe('codex_qa_terra')
    expect(progress!.waitingForLabel).toBe(progress!.workers[0].roleLabel)
    expect(progress!.doneCount).toBe(0)
    expect(progress!.totalCount).toBe(1)
  })

  it('reports callback once every worker has ended but the reply has not landed', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [
        card({ terminalId: 'w1', agentName: 'codex_qa_terra', firstSeenAt: T0 + 1000 }),
        card({ terminalId: 'w2', agentName: 'claude_scout_haiku', firstSeenAt: T0 + 2000, killed: true }),
      ],
      terminalStatuses: { w1: 'COMPLETED' },
    })
    expect(progress!.stage).toBe('callback')
    expect(progress!.doneCount).toBe(2)
    // the most recently finished worker is the one whose callback is awaited
    expect(progress!.waitingForLabel).toBe(progress!.workers[1].roleLabel)
  })

  it('flags a stall from the shared stall calculation', () => {
    const progress = computeOrchestrationProgress({
      supervisorTerminalId: 'sup',
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', status: 'processing', firstSeenAt: T0 })],
      terminalStatuses: { w1: 'PROCESSING' },
      now: T0 + 6 * 60 * 1000,
    })
    expect(progress!.stalled).toBe(true)
    expect(progress!.workers[0].stalled).toBe(true)
  })

  it('tolerates a create event timestamped slightly before the local send', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', firstSeenAt: T0 - 1500 })],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(progress!.workers.map(w => w.terminalId)).toEqual(['w1'])
  })
})

describe('summarizeOrchestration', () => {
  it('returns undefined when nothing was pending', () => {
    expect(summarizeOrchestration(null)).toBeUndefined()
  })

  it('returns undefined when the turn delegated to nobody', () => {
    const progress = computeOrchestrationProgress({
      supervisorTerminalId: 'sup',
      pendingSince: T0,
      cards: [],
      terminalStatuses: {},
      now: T0 + 5000,
    })
    expect(summarizeOrchestration(progress)).toBeUndefined()
  })

  it('freezes worker count, duration and labels', () => {
    const progress = computeOrchestrationProgress({
      supervisorTerminalId: 'sup',
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', agentName: 'codex_qa_terra' })],
      terminalStatuses: { w1: 'COMPLETED' },
      now: T0 + 125_000,
    })
    const summary = summarizeOrchestration(progress)
    expect(summary).toEqual({
      workerCount: 1,
      durationMs: 125_000,
      workerLabels: [progress!.workers[0].roleLabel],
    })
  })
})
