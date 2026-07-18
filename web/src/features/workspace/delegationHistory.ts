import { STORAGE_KEYS } from './constants'
import type { DelegationCard } from './types'

function key(sessionName: string): string {
  return `${STORAGE_KEYS.delegationHistory}${sessionName}`
}

export function loadDelegationHistory(sessionName: string): Record<string, DelegationCard> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key(sessionName)) || '[]')
    if (!Array.isArray(parsed)) return {}
    const cards: Record<string, DelegationCard> = {}
    parsed.slice(-100).forEach(item => {
      if (!item || typeof item.terminalId !== 'string' || typeof item.firstSeenAt !== 'number') return
      cards[item.terminalId] = {
        terminalId: item.terminalId,
        sessionId: typeof item.sessionId === 'string' ? item.sessionId : null,
        agentName: typeof item.agentName === 'string' ? item.agentName : null,
        provider: typeof item.provider === 'string' ? item.provider : null,
        callerId: typeof item.callerId === 'string' ? item.callerId : null,
        callerAgentName: typeof item.callerAgentName === 'string' ? item.callerAgentName : null,
        status: typeof item.status === 'string' ? item.status : null,
        prevStatus: typeof item.prevStatus === 'string' ? item.prevStatus : null,
        location: typeof item.location === 'string' ? item.location : null,
        locationLoaded: Boolean(item.locationLoaded),
        instruction: typeof item.instruction === 'string' ? item.instruction : null,
        instructionType: typeof item.instructionType === 'string' ? item.instructionType : null,
        instructionFromId: typeof item.instructionFromId === 'string' ? item.instructionFromId : null,
        killed: Boolean(item.killed),
        lastActivityAt: typeof item.lastActivityAt === 'number' ? item.lastActivityAt : null,
        lastOutputAt: typeof item.lastOutputAt === 'string' ? item.lastOutputAt : null,
        firstSeenAt: item.firstSeenAt,
        hasSignal: true,
      }
    })
    return cards
  } catch {
    return {}
  }
}

export function saveDelegationHistory(sessionName: string, cards: DelegationCard[]): void {
  try {
    window.localStorage.setItem(
      key(sessionName),
      JSON.stringify([...cards].sort((a, b) => a.firstSeenAt - b.firstSeenAt).slice(-100)),
    )
  } catch {
    // Event history remains live even when persistence is unavailable.
  }
}
