import { describe, expect, it } from 'vitest'
import { isTeamWorking, sessionStatusMap } from '../features/workspace/agentGrouping'
import type { DelegationCard } from '../features/workspace/types'

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
    firstSeenAt: 0,
    hasSignal: true,
    ...over,
  }
}

describe('sessionStatusMap', () => {
  it('lets an auto-cleaned worker read as completed instead of its stale PROCESSING', () => {
    const map = sessionStatusMap({
      supervisorId: 'sup',
      cards: [card({ terminalId: 'w1', killed: true, status: 'completed' })],
      // The global store still remembers the last live status of a terminal
      // that no longer exists — Workspace never prunes it.
      terminalStatuses: { w1: 'PROCESSING', sup: 'COMPLETED' },
    })
    expect(map.w1).toBe('COMPLETED')
  })

  it('reports a killed card with no recorded status as completed', () => {
    const map = sessionStatusMap({
      supervisorId: null,
      cards: [card({ terminalId: 'w1', killed: true })],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(map.w1).toBe('COMPLETED')
  })

  it('excludes terminals that do not belong to this session', () => {
    const map = sessionStatusMap({
      supervisorId: 'sup',
      cards: [card({ terminalId: 'w1' })],
      terminalStatuses: { w1: 'PROCESSING', sup: 'COMPLETED', someoneElse: 'PROCESSING' },
    })
    expect(Object.keys(map).sort()).toEqual(['sup', 'w1'])
  })

  it('keeps the live status for a worker that is genuinely running', () => {
    const map = sessionStatusMap({
      supervisorId: 'sup',
      cards: [card({ terminalId: 'w1' })],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(map.w1).toBe('PROCESSING')
  })

  it('falls back to the card status when the store knows nothing', () => {
    const map = sessionStatusMap({
      supervisorId: null,
      cards: [card({ terminalId: 'w1', status: 'processing' })],
      terminalStatuses: {},
    })
    expect(map.w1).toBe('PROCESSING')
  })

  it('omits a worker with no status from either source rather than guessing', () => {
    const map = sessionStatusMap({ supervisorId: null, cards: [card({ terminalId: 'w1' })], terminalStatuses: {} })
    expect('w1' in map).toBe(false)
  })
})

describe('isTeamWorking over a session-scoped map', () => {
  it('stops reporting work once every worker of this session has ended', () => {
    const stale = { w1: 'PROCESSING', w2: 'PROCESSING' }
    expect(isTeamWorking(stale)).toBe(true)

    const scoped = sessionStatusMap({
      supervisorId: 'sup',
      cards: [
        card({ terminalId: 'w1', killed: true, status: 'completed' }),
        card({ terminalId: 'w2', killed: true, status: 'completed' }),
      ],
      terminalStatuses: { ...stale, sup: 'COMPLETED' },
    })
    expect(isTeamWorking(scoped)).toBe(false)
  })

  it('still reports work while a worker of this session is running', () => {
    const scoped = sessionStatusMap({
      supervisorId: 'sup',
      cards: [card({ terminalId: 'w1' })],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(isTeamWorking(scoped)).toBe(true)
  })

  it('is not tripped by another session leaving a PROCESSING entry behind', () => {
    const scoped = sessionStatusMap({
      supervisorId: 'sup',
      cards: [card({ terminalId: 'w1', killed: true, status: 'completed' })],
      terminalStatuses: { w1: 'PROCESSING', otherSessionTerminal: 'PROCESSING', sup: 'COMPLETED' },
    })
    expect(isTeamWorking(scoped)).toBe(false)
  })
})
