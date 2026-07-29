// Phase 2 · 채팅 인라인 라이브 진행카드의 순수 계산부.
//
// 상태원을 새로 만들지 않는다 — AgentSidePanel 이 읽는 것과 같은
// DelegationCard[] + terminalStatuses 만 읽고, "이번 턴"의 경계는
// pendingSince(사용자가 프롬프트를 보낸 로컬 시각) 하나로 정한다.
// 표시 전용이므로 여기서 어떤 워커 터미널도 읽지 않는다.
import { computeStall } from './stall'
import { profileLabel } from '../profiles/profilePresentation'
import type { DelegationCard } from './types'

/** 워커 create 이벤트의 서버 timestamp 가 로컬 전송 시각보다 살짝 앞설 수 있어 그만큼만 관대하게 본다. */
export const TURN_GRACE_MS = 2000

export type OrchestrationStage = 'dispatching' | 'working' | 'callback'
/** `blocked` = 사람의 승인을 기다리며 멈춘 상태. "일하는 중"과 구분해야 조치 버튼을 붙일 수 있다. */
export type WorkerState = 'waiting' | 'working' | 'blocked' | 'done' | 'error'

export interface WorkerProgress {
  terminalId: string
  /** 사용자용 역할명. 프로필 ID 를 그대로 노출하지 않는다. */
  roleLabel: string
  provider: string | null
  state: WorkerState
  stalled: boolean
  firstSeenAt: number
  /** 이 워커가 살아 있은 시간. 턴 경과와 달리 워커 생성 시점 기준이다. */
  elapsedMs: number
}

export interface OrchestrationProgress {
  stage: OrchestrationStage
  elapsedMs: number
  workers: WorkerProgress[]
  /** 지금 콜백을 기다리는 대상의 역할명. 아직 배정 전이면 null. */
  waitingForLabel: string | null
  doneCount: number
  totalCount: number
  stalled: boolean
  /** 사람의 승인을 기다리며 멈춘 워커 수. */
  blockedCount: number
  /** 오류로 끝난 워커 수. 종료된 워커이므로 doneCount 에도 포함된다. */
  errorCount: number
}

/** 응답 확정 시점에 굳혀 ChatEntry 에 붙는 스냅샷(로컬 저장 왕복 대상). */
export interface OrchestrationSummary {
  workerCount: number
  durationMs: number
  workerLabels: string[]
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0초'
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}초`

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60
    return seconds === 0 ? `${totalMinutes}분` : `${totalMinutes}분 ${seconds}초`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`
}

const ENDED_STATES = new Set<WorkerState>(['done', 'error'])

export function workerStateFor(card: DelegationCard, statuses: Record<string, string>): WorkerState {
  if (card.killed) return 'done'
  const status = (statuses[card.terminalId] || card.status || '').toUpperCase()
  if (status === 'ERROR') return 'error'
  if (status === 'WAITING_USER_ANSWER') return 'blocked'
  if (status === 'PROCESSING') return 'working'
  if (status === 'COMPLETED') return 'done'
  return 'waiting'
}

export function computeOrchestrationProgress(params: {
  pendingSince: number | null
  supervisorTerminalId: string | null
  cards: DelegationCard[]
  terminalStatuses: Record<string, string>
  now: number
}): OrchestrationProgress | null {
  const { pendingSince, supervisorTerminalId, cards, terminalStatuses, now } = params
  if (pendingSince === null) return null

  const workers: WorkerProgress[] = cards
    .filter(card => card.terminalId !== supervisorTerminalId)
    .filter(card => card.firstSeenAt >= pendingSince - TURN_GRACE_MS)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
    .map(card => {
      const state = workerStateFor(card, terminalStatuses)
      const liveStatus = terminalStatuses[card.terminalId]
      const stall = computeStall({ ...card, status: liveStatus ? liveStatus.toLowerCase() : card.status }, now)
      return {
        terminalId: card.terminalId,
        roleLabel: card.agentName ? profileLabel(card.agentName) : card.terminalId.slice(0, 8),
        provider: card.provider,
        state,
        stalled: stall.stalled,
        firstSeenAt: card.firstSeenAt,
        elapsedMs: Math.max(0, now - card.firstSeenAt),
      }
    })

  const active = workers.filter(worker => !ENDED_STATES.has(worker.state))
  const stage: OrchestrationStage =
    workers.length === 0 ? 'dispatching' : active.length > 0 ? 'working' : 'callback'

  let waitingForLabel: string | null = null
  if (stage === 'working') {
    waitingForLabel = (active.find(worker => worker.state === 'working') ?? active[0]).roleLabel
  } else if (stage === 'callback') {
    waitingForLabel = workers[workers.length - 1].roleLabel
  }

  return {
    stage,
    elapsedMs: Math.max(0, now - pendingSince),
    workers,
    waitingForLabel,
    doneCount: workers.filter(worker => ENDED_STATES.has(worker.state)).length,
    totalCount: workers.length,
    stalled: workers.some(worker => worker.stalled),
    blockedCount: workers.filter(worker => worker.state === 'blocked').length,
    errorCount: workers.filter(worker => worker.state === 'error').length,
  }
}

export function summarizeOrchestration(progress: OrchestrationProgress | null): OrchestrationSummary | undefined {
  if (!progress || progress.workers.length === 0) return undefined
  return {
    workerCount: progress.workers.length,
    durationMs: progress.elapsedMs,
    workerLabels: progress.workers.map(worker => worker.roleLabel),
  }
}
