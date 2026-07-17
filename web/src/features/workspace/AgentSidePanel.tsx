import { useState, type ReactNode } from 'react'
import { Clock, FileText, Loader2, Mail, MessageSquare, Plus, Square, Terminal as TermIcon, Trash2 } from 'lucide-react'
import type { TerminalMeta } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import { AgentAvatar } from './AgentAvatar'
import { AddAgentModal } from './AddAgentModal'
import { ContextGaugeChip } from './ContextGaugeChip'
import { displaySessionName } from './displayName'
import type { DelegationCard } from './types'

interface AgentSidePanelProps {
  collapsed: boolean
  sessionName: string | null
  terminals: TerminalMeta[]
  cards: DelegationCard[]
  terminalStatuses: Record<string, string>
  /** Session's own (supervisor terminal's) working directory — prefills the [+] modal's directory field. */
  sessionWorkingDirectory: string | null
  /** Phase 2d (spec §2d): terminalId → remaining-context percentage (from useContextGauges in Workspace.tsx). A missing entry renders no gauge at all — never a placeholder. */
  gauges?: Record<string, number | null>
  onMessageTarget: (id: string) => void
  onOpenTerminal: (id: string) => void
  onOpenOutput: (id: string) => void
  onOpenInbox: (id: string) => void
  onRequestStop: (id: string, agentName: string | null) => void
  onRequestDelete: (id: string, agentName: string | null) => void
  onRequestEndSession: () => void
  /** A worker terminal was manually added via the [+] modal (spec Phase 2c §2) — refresh the card list. */
  onAgentAdded: () => void
}

type Tab = 'agents' | 'queue' | 'session'

function resolveStatus(id: string, fallback: string | null, terminalStatuses: Record<string, string>): string | null {
  return terminalStatuses[id] || (fallback ? fallback.toUpperCase() : null)
}

function fmtAbs(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function AgentSidePanel({
  collapsed,
  sessionName,
  terminals,
  cards,
  terminalStatuses,
  sessionWorkingDirectory,
  gauges = {},
  onMessageTarget,
  onOpenTerminal,
  onOpenOutput,
  onOpenInbox,
  onRequestStop,
  onRequestDelete,
  onRequestEndSession,
  onAgentAdded,
}: AgentSidePanelProps) {
  const [tab, setTab] = useState<Tab>('agents')
  const [addAgentOpen, setAddAgentOpen] = useState(false)

  if (collapsed) return null

  const supervisor = terminals[0]
  const queueCards = cards.filter(c => {
    const s = (resolveStatus(c.terminalId, c.status, terminalStatuses) || '').toUpperCase()
    return s === 'PROCESSING' || s === 'WAITING_USER_ANSWER'
  })
  const startedAt = terminals.reduce<string | null>((earliest, t) => {
    if (!t.created_at) return earliest
    if (!earliest) return t.created_at
    return new Date(t.created_at) < new Date(earliest) ? t.created_at : earliest
  }, null)
  const providers = [...new Set(terminals.map(t => t.provider).filter(Boolean))]

  return (
    <aside className="flex w-[296px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]" aria-label="에이전트와 작업">
      <div className="flex items-center gap-1 p-2">
        <div role="tablist" aria-label="에이전트 패널" className="flex flex-1 gap-1">
          {(['agents', 'queue', 'session'] as Tab[]).map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-7 flex-1 rounded-full text-[11.5px] font-bold ${
                tab === t ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'bg-[var(--surface-2)] text-[var(--text-3)]'
              }`}
            >
              {t === 'agents' ? `에이전트 ${terminals.length}` : t === 'queue' ? `작업 큐 ${queueCards.length}` : '세션 정보'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAddAgentOpen(true)}
          disabled={!sessionName}
          title="에이전트 추가"
          aria-label="에이전트 추가"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)] disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {!sessionName ? (
          <p className="px-1 py-3 text-[11px] text-[var(--text-3)]">세션을 선택하면 에이전트 목록이 표시돼요.</p>
        ) : tab === 'agents' ? (
          <div className="space-y-2">
            {supervisor && (
              <AgentCard
                terminalId={supervisor.id}
                agentName={supervisor.agent_profile}
                provider={supervisor.provider}
                status={resolveStatus(supervisor.id, null, terminalStatuses)}
                percentLeft={gauges[supervisor.id] ?? null}
                roleLabel="Supervisor"
                subLine={null}
                callerAgentName={null}
                location={null}
                onMessage={() => onMessageTarget(supervisor.id)}
                onTerminal={() => onOpenTerminal(supervisor.id)}
                onOutput={() => onOpenOutput(supervisor.id)}
                onInbox={() => onOpenInbox(supervisor.id)}
                onStop={() => onRequestStop(supervisor.id, supervisor.agent_profile)}
                onDelete={() => onRequestDelete(supervisor.id, supervisor.agent_profile)}
              />
            )}
            {cards.map(card => (
              <AgentCard
                key={card.terminalId}
                terminalId={card.terminalId}
                agentName={card.agentName}
                provider={card.provider}
                status={resolveStatus(card.terminalId, card.status, terminalStatuses)}
                percentLeft={gauges[card.terminalId] ?? null}
                roleLabel={null}
                subLine={card.instruction}
                callerAgentName={card.callerAgentName}
                location={card.location}
                onMessage={() => onMessageTarget(card.terminalId)}
                onTerminal={() => onOpenTerminal(card.terminalId)}
                onOutput={() => onOpenOutput(card.terminalId)}
                onInbox={() => onOpenInbox(card.terminalId)}
                onStop={() => onRequestStop(card.terminalId, card.agentName)}
                onDelete={() => onRequestDelete(card.terminalId, card.agentName)}
              />
            ))}
          </div>
        ) : tab === 'queue' ? (
          queueCards.length === 0 ? (
            <p className="px-1 py-3 text-[11px] text-[var(--text-3)]">진행 중이거나 응답을 기다리는 작업이 없어요.</p>
          ) : (
            <div className="space-y-2">
              {queueCards.map(card => {
                const status = resolveStatus(card.terminalId, card.status, terminalStatuses)
                const waiting = status === 'WAITING_USER_ANSWER'
                return (
                  <div key={card.terminalId} className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] px-2.5 py-2">
                    {waiting ? <Clock size={15} className="mt-0.5 text-[var(--warning)]" /> : <Loader2 size={15} className="mt-0.5 animate-spin text-[var(--info)]" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-[var(--text)]">{card.instruction || card.agentName || card.terminalId.slice(0, 8)}</div>
                      <div className="text-[10.5px] text-[var(--text-3)]">{card.agentName ?? card.terminalId.slice(0, 8)} · {waiting ? '입력 대기' : '실행 중'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <div className="space-y-0.5 text-xs">
            <InfoRow k="세션" v={displaySessionName(sessionName)} />
            <InfoRow k="터미널" v={`${terminals.length}개`} />
            <InfoRow k="Provider" v={providers.join(', ') || '—'} />
            <InfoRow k="시작" v={fmtAbs(startedAt) ?? '확인할 수 없음'} />
            <InfoRow k="Git branch" v="확인할 수 없음" muted />
            <button
              type="button"
              onClick={onRequestEndSession}
              className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-[var(--danger)] text-xs font-semibold text-[var(--danger)]"
            >
              <Square size={13} />
              세션 종료
            </button>
          </div>
        )}
      </div>

      {addAgentOpen && sessionName && (
        <AddAgentModal
          sessionName={sessionName}
          defaultWorkingDirectory={sessionWorkingDirectory}
          onClose={() => setAddAgentOpen(false)}
          onAdded={onAgentAdded}
        />
      )}
    </aside>
  )
}

function InfoRow({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-dashed border-[var(--border-soft)] py-1.5">
      <span className="text-[var(--text-3)]">{k}</span>
      <span className={`min-w-0 truncate text-right ${muted ? 'text-[var(--text-3)]' : 'text-[var(--text)]'}`}>{v}</span>
    </div>
  )
}

function AgentCard({
  terminalId,
  agentName,
  provider,
  status,
  percentLeft,
  roleLabel,
  subLine,
  callerAgentName,
  location,
  onMessage,
  onTerminal,
  onOutput,
  onInbox,
  onStop,
  onDelete,
}: {
  terminalId: string
  agentName: string | null
  provider: string | null
  status: string | null
  percentLeft?: number | null
  roleLabel: string | null
  subLine: string | null
  callerAgentName: string | null
  location: string | null
  onMessage: () => void
  onTerminal: () => void
  onOutput: () => void
  onInbox: () => void
  onStop: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] p-2.5">
      <div className="flex items-center gap-2">
        <AgentAvatar name={agentName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-bold text-[var(--text)]">
            {agentName ?? terminalId.slice(0, 8)}
            {roleLabel && <span className="ml-1.5 rounded bg-[var(--surface-3)] px-1 py-0.5 text-[9.5px] font-bold text-[var(--text-2)]">{roleLabel}</span>}
          </div>
          <div className="truncate text-[10.5px] text-[var(--text-3)]">
            {provider} · {terminalId.slice(0, 8)}
          </div>
        </div>
        <ContextGaugeChip percentLeft={percentLeft} />
        {status && <StatusBadge status={status} />}
      </div>
      {(subLine || callerAgentName || location) && (
        <div className="mt-1.5 space-y-0.5 text-[11px] text-[var(--text-2)]">
          {subLine && <div className="truncate">현재: {subLine}</div>}
          {callerAgentName && <div>상위: {callerAgentName}</div>}
          {location && <div className="truncate font-mono text-[10.5px] text-[var(--text-3)]">{location}</div>}
        </div>
      )}
      <div className="mt-2 flex gap-1">
        <IconButton title="메시지 보내기" onClick={onMessage}><MessageSquare size={13} /></IconButton>
        <IconButton title="터미널 열기" onClick={onTerminal}><TermIcon size={13} /></IconButton>
        <IconButton title="Output 열기" onClick={onOutput}><FileText size={13} /></IconButton>
        <IconButton title="받은편지함" onClick={onInbox}><Mail size={13} /></IconButton>
        <IconButton title="중지" onClick={onStop} warn><Square size={13} /></IconButton>
        <IconButton title="삭제" onClick={onDelete} warn><Trash2 size={13} /></IconButton>
      </div>
    </div>
  )
}

function IconButton({ title, onClick, warn, children }: { title: string; onClick: () => void; warn?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-2)] ${
        warn ? 'hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]' : 'hover:bg-[var(--surface-3)]'
      }`}
    >
      {children}
    </button>
  )
}
