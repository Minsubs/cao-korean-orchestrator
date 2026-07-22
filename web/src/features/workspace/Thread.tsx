import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, Eye, FileText, MessageSquare, Square, Terminal as TermIcon, WifiOff } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'
import { AgentAvatar } from './AgentAvatar'
import { computeStall, stallMinutes } from './stall'
import { useNowTick } from './useNowTick'
import type { UiConnectionStatus } from './eventsClient'
import type { ChatEntry, DelegationCard, ThreadItem } from './types'
import { profileLabel } from '../profiles/profilePresentation'

interface ThreadProps {
  sessionName: string | null
  loading: boolean
  threadItems: ThreadItem[]
  connectionStatus: UiConnectionStatus
  terminalStatuses: Record<string, string>
  onOpenTerminal: (id: string) => void
  onOpenOutput: (id: string) => void
  onOpenLogs: () => void
  onRequestStop: (id: string, agentName: string | null) => void
  onMessageTarget: (id: string) => void
  onRequestStatusCheck: (id: string, agentName: string | null) => Promise<void>
}

function resolveStatus(card: DelegationCard, terminalStatuses: Record<string, string>): string | null {
  if (card.killed) return (card.status ?? 'completed').toUpperCase()
  return terminalStatuses[card.terminalId] || (card.status ? card.status.toUpperCase() : null)
}

const INSTRUCTION_TYPE_LABEL: Record<string, string> = { assign: '배정', handoff: '핸드오프' }

export function ChatBubble({ entry }: { entry: ChatEntry }) {
  const isUser = entry.role === 'user'
  const isSystem = entry.role === 'system'
  const [showRaw, setShowRaw] = useState(false)
  const hasRaw = entry.role === 'assistant' && !!entry.raw && entry.raw.trim() !== entry.content.trim()
  return (
    <div className={`flex max-w-[86%] gap-2.5 ${isUser ? 'ml-auto flex-row-reverse' : ''}`}>
      {!isUser && <AgentAvatar name={isSystem ? 'system' : 'supervisor'} size="sm" />}
      <div
        className={`rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'rounded-br-md bg-[var(--accent)] text-[var(--on-accent)]'
            : isSystem
              ? 'rounded-bl-md border border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]'
              : 'rounded-bl-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'
        }`}
      >
        {entry.targetId && <div className="mb-1 text-[10px] font-semibold opacity-70">→ {entry.targetId.slice(0, 8)}</div>}
        {showRaw ? entry.raw : entry.content}
        {hasRaw && (
          <button
            type="button"
            onClick={() => setShowRaw(v => !v)}
            className="mt-1.5 block text-[10px] font-semibold text-[var(--text-3)] hover:text-[var(--text)]"
          >
            {showRaw ? '정리본 보기' : '원문 보기'}
          </button>
        )}
      </div>
    </div>
  )
}

function DelegationCardBlock({
  card,
  now,
  terminalStatuses,
  onOpenTerminal,
  onOpenOutput,
  onOpenLogs,
  onRequestStop,
  onMessageTarget,
  onRequestStatusCheck,
}: {
  card: DelegationCard
  now: number
  terminalStatuses: Record<string, string>
  onOpenTerminal: (id: string) => void
  onOpenOutput: (id: string) => void
  onOpenLogs: () => void
  onRequestStop: (id: string, agentName: string | null) => void
  onMessageTarget: (id: string) => void
  onRequestStatusCheck: (id: string, agentName: string | null) => Promise<void>
}) {
  const [checkRequested, setCheckRequested] = useState(false)
  const status = resolveStatus(card, terminalStatuses)
  const stall = computeStall({ ...card, status: status?.toLowerCase() ?? card.status }, now)
  const isError = (status ?? '').toUpperCase() === 'ERROR'

  // Episode ended — re-arm the "request a status check" action for next time.
  useEffect(() => {
    if (!stall.stalled) setCheckRequested(false)
  }, [stall.stalled])

  return (
    <div className={`ml-10 max-w-[calc(86%-40px)] rounded-2xl border bg-[var(--surface)] p-3 shadow-sm ${isError ? 'border-[var(--danger)]' : 'border-[var(--border)]'}`}>
      <div className="flex items-center gap-2.5">
        <AgentAvatar name={card.agentName} title={card.agentName ?? undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-[var(--text)]">
            {card.agentName ? profileLabel(card.agentName) : card.terminalId.slice(0, 8)}
            {card.location && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--p-lilac)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--p-lilac-ink)]">
                {card.location}
              </span>
            )}
            {card.killed && <span className="rounded-md bg-[var(--neutral-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--neutral)]">종료됨</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-3)]">
            {card.provider && <span>{card.provider}</span>}
            <span className="font-mono">{card.terminalId.slice(0, 8)}</span>
            {card.callerAgentName && <span>상위: {card.callerAgentName}</span>}
          </div>
        </div>
        {status && <StatusBadge status={status} />}
      </div>

      {card.instruction && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-2)]">
          <span className="font-semibold text-[var(--text-3)]">{INSTRUCTION_TYPE_LABEL[card.instructionType ?? ''] ?? '지시'}: </span>
          {card.instruction}
        </p>
      )}

      {isError && (
        <button
          type="button"
          onClick={onOpenLogs}
          className="mt-2 flex items-center gap-1.5 rounded-lg bg-[var(--danger-bg)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--danger)]"
        >
          <AlertTriangle size={12} />
          오류 상태예요 — 로그 보기
          <ChevronRight size={12} />
        </button>
      )}

      {stall.stalled && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--warning-bg)] px-2.5 py-1.5 text-[11.5px] text-[var(--warning)]">
          <AlertTriangle size={13} />
          <b>출력이 {stallMinutes(stall.elapsedMs)}분째 없어요</b>
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => onOpenTerminal(card.terminalId)} className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-2)]">
              터미널 확인
            </button>
            <button
              type="button"
              disabled={checkRequested}
              onClick={() => {
                setCheckRequested(true)
                void onRequestStatusCheck(card.terminalId, card.agentName)
              }}
              className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-text)] disabled:opacity-50"
            >
              {checkRequested ? '요청함' : '상태 확인 요청'}
            </button>
          </span>
        </div>
      )}

      {!card.killed && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onMessageTarget(card.terminalId)} className="flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--accent-text)]">
            <MessageSquare size={12} />
            추가 지시
          </button>
          <button type="button" onClick={() => onOpenTerminal(card.terminalId)} className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--text-2)]">
            <TermIcon size={12} />
            터미널
          </button>
          <button type="button" onClick={() => onOpenOutput(card.terminalId)} className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--text-2)]">
            <FileText size={12} />
            Output
          </button>
          <button
            type="button"
            onClick={() => void onRequestStatusCheck(card.terminalId, card.agentName)}
            className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--text-2)]"
          >
            <Eye size={12} />
            상태 확인
          </button>
          <button
            type="button"
            onClick={() => onRequestStop(card.terminalId, card.agentName)}
            className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--text-2)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
          >
            <Square size={12} />
            중지
          </button>
        </div>
      )}
    </div>
  )
}

export function Thread(props: ThreadProps) {
  const { sessionName, loading, threadItems, connectionStatus, terminalStatuses } = props
  const now = useNowTick()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {connectionStatus !== 'connected' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--warning-bg)] px-4 py-1.5 text-[11px] text-[var(--warning)]">
          <WifiOff size={12} />
          이벤트 스트림을 사용할 수 없어요 — 기존 폴링 데이터로 계속 동작해요
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex max-w-[780px] flex-col gap-3.5">
          {!sessionName ? (
            <p className="mt-16 text-center text-xs text-[var(--text-3)]">왼쪽에서 세션을 선택하거나 새 세션을 시작하세요.</p>
          ) : loading && threadItems.length === 0 ? (
            <p className="mt-16 text-center text-xs text-[var(--text-3)]">불러오는 중...</p>
          ) : threadItems.length === 0 ? (
            <p className="mt-16 text-center text-xs text-[var(--text-3)]">이벤트 없음 — 아직 이 세션에서 관측된 활동이 없어요.</p>
          ) : (
            threadItems.map(item => {
              if (item.kind === 'chat') return <ChatBubble key={item.id} entry={item.entry} />
              if (item.kind === 'system') {
                return (
                  <div key={item.id} className="self-center text-[11px] text-[var(--text-3)]">
                    {item.text}
                  </div>
                )
              }
              if (item.kind === 'card') {
                return (
                  <DelegationCardBlock
                    key={item.id}
                    card={item.card}
                    now={now}
                    terminalStatuses={terminalStatuses}
                    onOpenTerminal={props.onOpenTerminal}
                    onOpenOutput={props.onOpenOutput}
                    onOpenLogs={props.onOpenLogs}
                    onRequestStop={props.onRequestStop}
                    onMessageTarget={props.onMessageTarget}
                    onRequestStatusCheck={props.onRequestStatusCheck}
                  />
                )
              }
              return (
                <details key={item.id} className="self-center w-full max-w-[640px]">
                  <summary className="cursor-pointer rounded-full px-2 py-1 text-center text-[11.5px] text-[var(--text-3)] hover:bg-[var(--surface-2)]">
                    에이전트 간 내부 메시지 {item.messages.length}건 · 펼치기
                  </summary>
                  <div className="mt-1.5 space-y-1.5">
                    {item.messages.map(msg => (
                      <div key={msg.id} className="rounded-xl bg-[var(--surface-2)] px-2.5 py-2 text-xs">
                        <div className="font-semibold text-[var(--text-2)]">
                          {msg.sender.slice(0, 8)} → {msg.receiver.slice(0, 8)}
                        </div>
                        <div className="text-[var(--text-2)]">{msg.message}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
