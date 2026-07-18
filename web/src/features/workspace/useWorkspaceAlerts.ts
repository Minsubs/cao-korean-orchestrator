import { useEffect, useRef } from 'react'
import { emitWorkspaceAlert } from '../../components/NotificationCenter'
import { profileLabel } from '../profiles/profilePresentation'
import { computeStall } from './stall'
import { displaySessionName } from './displayName'
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
        const resolvedStatus = (
          card.killed
            ? card.status || terminalStatuses[card.terminalId] || ''
            : terminalStatuses[card.terminalId] || card.status || ''
        ).toLowerCase()
        const rawAgentName = card.agentName || card.terminalId.slice(0, 8)
        const label = profileLabel(rawAgentName)
        const sessionLabel = displaySessionName(sessionName || card.sessionId || '현재 세션')

        const stall = computeStall({ ...card, status: resolvedStatus }, now)
        const wasStalled = stalledRef.current.has(card.terminalId)
        if (stall.stalled && !wasStalled) {
          stalledRef.current.add(card.terminalId)
          emitWorkspaceAlert(
            'stall',
            `${sessionLabel} · ${label} 정체 감지`,
            `${label}이(가) 작업 중인데 출력 활동이 멈췄어요.`,
            card.terminalId,
            sessionName ?? undefined,
            rawAgentName,
          )
        } else if (!stall.stalled && wasStalled) {
          stalledRef.current.delete(card.terminalId)
        }

        const previous = lastStatusRef.current[card.terminalId]
        lastStatusRef.current[card.terminalId] = resolvedStatus
        if (resolvedStatus === 'waiting_user_answer' && previous !== undefined && previous !== resolvedStatus) {
          emitWorkspaceAlert('waiting_input', `${sessionLabel} · ${label} 입력 필요`, `${label}이(가) 입력을 기다리고 있어요.`, card.terminalId, sessionName ?? undefined, rawAgentName)
        }
        if (previous === 'processing' && ['completed', 'idle'].includes(resolvedStatus)) {
          emitWorkspaceAlert('completed', `${sessionLabel} · ${label} 작업 완료`, `${label}의 작업이 끝났습니다.`, card.terminalId, sessionName ?? undefined, rawAgentName)
        }
        if (previous === 'processing' && resolvedStatus === 'error') {
          emitWorkspaceAlert('error', `${sessionLabel} · ${label} 작업 오류`, `${label}의 상태를 확인해 주세요.`, card.terminalId, sessionName ?? undefined, rawAgentName)
        }
      }
    }

    check()
    const interval = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [cards, terminalStatuses, sessionName])
}
