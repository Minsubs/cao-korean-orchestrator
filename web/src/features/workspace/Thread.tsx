import { useEffect, useState } from 'react'
import { ArrowDown, Loader2, WifiOff } from 'lucide-react'
import { AgentAvatar } from './AgentAvatar'
import { ProgressCard } from './ProgressCard'
import { formatElapsed } from './orchestrationProgress'
import { useStickToBottom } from './useStickToBottom'
import type { UiConnectionStatus } from './eventsClient'
import type { ChatEntry, DelegationCard, ThreadItem } from './types'

interface ThreadProps {
  sessionName: string | null
  loading: boolean
  threadItems: ThreadItem[]
  connectionStatus: UiConnectionStatus
  terminalStatuses: Record<string, string>
  /** Same card list the agent side panel reads — the progress card must not introduce a second state source. */
  cards: DelegationCard[]
  supervisorTerminalId: string | null
  /** ms epoch of the pending turn's send, or null when nothing is pending / the stored turn predates Phase 2. */
  pendingSince: number | null
  /** Chat entry id of the pending assistant placeholder the progress card replaces. */
  pendingMessageId: string | null
  onOpenTerminal: (id: string) => void
  onOpenOutput: (id: string) => void
  onOpenLogs: () => void
  onRequestStop: (id: string, agentName: string | null) => void
  onMessageTarget: (id: string) => void
  onRequestStatusCheck: (id: string, agentName: string | null) => Promise<void>
  /** Re-sends a prompt whose original send failed (Phase 3 다시 보내기). */
  onRetry: (prompt: string) => void
}

export function ChatBubble({ entry, onRetry }: { entry: ChatEntry; onRetry?: (prompt: string) => void }) {
  const retryPrompt = entry.retryPrompt
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
        {entry.progress && (
          <div className="mb-1 text-[10px] font-semibold text-[var(--success)]">
            ✓ 완료 · 워커 {entry.progress.workerCount} · 소요 {formatElapsed(entry.progress.durationMs)}
          </div>
        )}
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
        {retryPrompt && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(retryPrompt)}
            className="mt-1.5 block text-[10px] font-semibold text-[var(--danger)] hover:underline"
          >
            다시 보내기
          </button>
        )}
      </div>
    </div>
  )
}


export function Thread(props: ThreadProps) {
  const {
    sessionName,
    loading,
    threadItems,
    connectionStatus,
    terminalStatuses,
    cards,
    supervisorTerminalId,
    pendingSince,
    pendingMessageId,
    onOpenTerminal,
    onRetry,
  } = props

  // Follow new content only while the user is at the bottom. The signature is
  // what "new content" means here: one more item, the pending placeholder
  // appearing or clearing, or the newest message's text growing as the reply is
  // cleaned and re-rendered. It deliberately excludes `now` — the 1s clock tick
  // must not scroll anything.
  const lastItem = threadItems[threadItems.length - 1]
  const lastLength =
    lastItem?.kind === 'chat'
      ? lastItem.entry.content.length
      : lastItem?.kind === 'system'
        ? lastItem.text.length
        : 0
  const scroll = useStickToBottom<HTMLDivElement>(
    `${threadItems.length}|${lastItem?.id ?? ''}|${lastLength}|${pendingMessageId ?? ''}`,
    sessionName,
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Phase 5: `connecting` means the client is already retrying (eventsClient
          backs off 1s→30s on its own), so it must not read as a dead stream —
          and the user must not be told to refresh. Only a true `disconnected`
          gets the warning treatment. */}
      {connectionStatus === 'connecting' ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--info-bg)] px-4 py-1.5 text-[11px] text-[var(--info)]">
          <Loader2 size={12} className="animate-spin" />
          이벤트 스트림에 재연결 중이에요 — 기존 폴링 데이터로 계속 동작해요
        </div>
      ) : connectionStatus === 'disconnected' ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--warning-bg)] px-4 py-1.5 text-[11px] text-[var(--warning)]">
          <WifiOff size={12} />
          이벤트 스트림을 사용할 수 없어요 — 기존 폴링 데이터로 계속 동작해요
        </div>
      ) : null}

      <div ref={scroll.ref} className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex max-w-[780px] flex-col gap-3.5">
          {!sessionName ? (
            <p className="mt-16 text-center text-xs text-[var(--text-3)]">왼쪽에서 세션을 선택하거나 새 세션을 시작하세요.</p>
          ) : loading && threadItems.length === 0 ? (
            <p className="mt-16 text-center text-xs text-[var(--text-3)]">불러오는 중…</p>
          ) : threadItems.length === 0 ? (
            <p className="mt-16 text-center text-xs text-[var(--text-3)]">이벤트 없음 — 아직 이 세션에서 관측된 활동이 없어요.</p>
          ) : (
            threadItems.map(item => {
              if (item.kind === 'chat') {
                // The pending assistant placeholder becomes the live progress
                // card; without a recorded start time we keep the plain
                // WAITING text rather than invent an elapsed value.
                if (pendingSince !== null && pendingMessageId === item.entry.id) {
                  return (
                    <ProgressCard
                      key={item.id}
                      pendingSince={pendingSince}
                      supervisorTerminalId={supervisorTerminalId}
                      cards={cards}
                      terminalStatuses={terminalStatuses}
                      onOpenWorker={onOpenTerminal}
                    />
                  )
                }
                return <ChatBubble key={item.id} entry={item.entry} onRetry={onRetry} />
              }
              if (item.kind === 'system') {
                return (
                  <div key={item.id} className="self-center text-[11px] text-[var(--text-3)]">
                    {item.text}
                  </div>
                )
              }
              // Delegation cards and agent-to-agent messages are not thread
              // items any more — they live in the work queue (agent panel), so
              // the conversation stays readable with a team of three.
              return null
            })
          )}
        </div>
      </div>

      {/* Only while scrolled up: following is automatic at the bottom, so the
          button would be a no-op there. Placed over the thread rather than in the
          header so it sits next to the content it jumps to. */}
      {!scroll.atBottom && threadItems.length > 0 && (
        <button
          type="button"
          onClick={() => scroll.scrollToBottom('smooth')}
          aria-label="맨 아래로"
          title="맨 아래로"
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-2)] shadow-lg transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
        >
          <ArrowDown size={12} />
          맨 아래로
        </button>
      )}
    </div>
  )
}
