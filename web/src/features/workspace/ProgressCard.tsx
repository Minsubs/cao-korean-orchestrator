// Phase 2 · 채팅 인라인 라이브 진행카드.
//
// 표시 전용이다. 새 API 를 호출하지 않고, AgentSidePanel 과 같은
// cards/terminalStatuses 만 읽어 그린다. 1초 tick 은 경과시간 표시를 위한
// 로컬 리렌더일 뿐 어떤 네트워크 요청도 유발하지 않는다
// (과거 "환각 폴링" 회귀 금지 — 워커 터미널을 여기서 읽지 않는다).
import { AlertTriangle } from 'lucide-react'
import { AgentAvatar } from './AgentAvatar'
import { useNowTick } from './useNowTick'
import { computeOrchestrationProgress, formatElapsed } from './orchestrationProgress'
import { providerLabel } from '../profiles/roleData'
import type { OrchestrationStage, WorkerState } from './orchestrationProgress'
import type { DelegationCard } from './types'

const STAGE_LABEL: Record<OrchestrationStage, string> = {
  dispatching: '작업 배정 중',
  working: '워커 작업 중',
  callback: '콜백 대기 중',
}

const STATE_LABEL: Record<WorkerState, string> = {
  waiting: '대기',
  working: '작업 중',
  done: '완료',
  error: '오류',
}

const STATE_CLASS: Record<WorkerState, string> = {
  waiting: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)]',
  working: 'border-[var(--info)] bg-[var(--info-bg)] text-[var(--info)]',
  done: 'border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]',
  error: 'border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]',
}

export function ProgressCard({
  pendingSince,
  supervisorTerminalId,
  cards,
  terminalStatuses,
}: {
  pendingSince: number
  supervisorTerminalId: string | null
  cards: DelegationCard[]
  terminalStatuses: Record<string, string>
}) {
  const now = useNowTick(1000)
  const progress = computeOrchestrationProgress({ pendingSince, supervisorTerminalId, cards, terminalStatuses, now })
  if (!progress) return null

  return (
    <div
      data-testid="progress-card"
      data-stage={progress.stage}
      className="ml-10 max-w-[calc(86%-40px)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden />
        <span className="text-[12px] font-semibold text-[var(--text)]">{STAGE_LABEL[progress.stage]}</span>
        <span className="text-[11px] text-[var(--text-3)]">{formatElapsed(progress.elapsedMs)}</span>
        {progress.totalCount > 0 && (
          <span className="ml-auto text-[11px] text-[var(--text-3)]">
            {progress.doneCount}/{progress.totalCount} 완료
          </span>
        )}
      </div>

      {progress.workers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {progress.workers.map(worker => (
            <li key={worker.terminalId} className="flex items-center gap-2">
              <AgentAvatar name={worker.roleLabel} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text)]">{worker.roleLabel}</span>
              {worker.provider && (
                <span className="text-[10px] text-[var(--text-3)]">{providerLabel(worker.provider)}</span>
              )}
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATE_CLASS[worker.state]}`}
              >
                {STATE_LABEL[worker.state]}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-[var(--text-3)]">
        {progress.waitingForLabel ? `${progress.waitingForLabel}의 콜백 대기 중` : '워커를 배정하는 중이에요'}
      </p>

      {progress.stalled && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--warning)]">
          <AlertTriangle size={12} aria-hidden />
          한동안 응답이 없어요
        </p>
      )}
    </div>
  )
}
