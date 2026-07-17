import { useEffect, useRef } from 'react'
import { emitWorkspaceAlert } from '../../components/NotificationCenter'
import { computeStall } from './stall'
import type { DelegationCard } from './types'

const CHECK_INTERVAL_MS = 15000

/**
 * Centralized, edge-triggered NotificationCenter wiring for the two Phase 2b
 * alert kinds (spec §7). Cards render in both the Thread and the Agent side
 * panel simultaneously, so this must live once per session (not per card
 * component) or the same episode would double-alert.
 *
 * `sessionName` (feedback #17) is threaded straight through to
 * `emitWorkspaceAlert` so the notification center can offer a "jump to this
 * session" action — Workspace.tsx is the only caller and always knows which
 * session these cards belong to, so this is simpler and more reliable than
 * trying to recover it from `DelegationCard.sessionId` (not reliably
 * populated on every card — see threadReducer.ts).
 */
export function useWorkspaceAlerts(cards: DelegationCard[], terminalStatuses: Record<string, string>, sessionName: string | null): void {
  const stalledRef = useRef<Set<string>>(new Set())
  const lastStatusRef = useRef<Record<string, string>>({})

  useEffect(() => {
    const check = () => {
      const now = Date.now()
      for (const card of cards) {
        const resolvedStatus = (terminalStatuses[card.terminalId] || card.status || '').toLowerCase()

        const stall = computeStall({ ...card, status: resolvedStatus }, now)
        const wasStalled = stalledRef.current.has(card.terminalId)
        if (stall.stalled && !wasStalled) {
          stalledRef.current.add(card.terminalId)
          const label = card.agentName || card.terminalId.slice(0, 8)
          emitWorkspaceAlert(
            'stall',
            `정체 감지 — ${label} 출력 없음`,
            `${label}이(가) 작업 중인데 출력 활동이 멈췄어요.`,
            card.terminalId,
            sessionName ?? undefined,
          )
        } else if (!stall.stalled && wasStalled) {
          stalledRef.current.delete(card.terminalId)
        }

        const previous = lastStatusRef.current[card.terminalId]
        lastStatusRef.current[card.terminalId] = resolvedStatus
        if (resolvedStatus === 'waiting_user_answer' && previous !== undefined && previous !== resolvedStatus) {
          const label = card.agentName || card.terminalId.slice(0, 8)
          emitWorkspaceAlert('waiting_input', '입력 대기 — 확인 필요', `${label}이(가) 입력을 기다리고 있어요.`, card.terminalId, sessionName ?? undefined)
        }
      }
    }

    check()
    const interval = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [cards, terminalStatuses, sessionName])
}
