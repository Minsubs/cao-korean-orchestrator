import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Clock, FileText, Loader2, Mail, MessageSquare, Plus, Square, Terminal as TermIcon, Trash2 } from 'lucide-react'
import type { TerminalMeta } from '../../api'
import type { UsageAccount } from '../../api.usage'
import { StatusBadge } from '../../components/StatusBadge'
import { AgentAvatar } from './AgentAvatar'
import { AddAgentModal } from './AddAgentModal'
import { ContextGaugeChip } from './ContextGaugeChip'
import { displaySessionName } from './displayName'
import type { DelegationCard } from './types'
import type { TeamRosterProfile } from './teamRoster'
import { profileLabel, profileDetail } from '../profiles/profilePresentation'
import { roleBadgeFor } from './roleLabel'
import { InlineUsageBar } from '../usage/InlineUsageBar'
import { useUsageAccounts } from '../usage/useUsageAccounts'
import { isTeamWorking, sessionStatusMap } from './agentGrouping'
import { instructionSummary, stripInstructionPlumbing } from './instructionSummary'
import { workerStateFor, type WorkerState } from './orchestrationProgress'
import { RoleBoard, type AgentVizItem } from './RoleBoard'
import { DelegationHierarchy } from './DelegationHierarchy'

interface AgentSidePanelProps {
  collapsed: boolean
  sessionName: string | null
  terminals: TerminalMeta[]
  cards: DelegationCard[]
  teamRoster?: TeamRosterProfile[]
  terminalStatuses: Record<string, string>
  /** Session's own (supervisor terminal's) working directory — prefills the [+] modal's directory field. */
  sessionWorkingDirectory: string | null
  /**
   * terminalId → how many results that agent has reported back
   * (buildAgentReportCounts). The thread no longer shows agent-to-agent
   * messages, so this is where "did it actually report" is answered.
   */
  reportCounts?: Record<string, number>
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

const QUEUE_STATE_LABEL: Record<WorkerState, string> = {
  waiting: '시작 대기',
  working: '실행 중',
  blocked: '입력 대기',
  done: '완료',
  error: '오류',
}

function QueueStateIcon({ state }: { state: WorkerState }) {
  if (state === 'blocked') return <Clock size={15} className="mt-0.5 shrink-0 text-[var(--warning)]" />
  if (state === 'error') return <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--danger)]" />
  if (state === 'done') return <Check size={15} className="mt-0.5 shrink-0 text-[var(--text-3)]" />
  if (state === 'waiting') return <Clock size={15} className="mt-0.5 shrink-0 text-[var(--text-3)]" />
  return <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-[var(--info)]" />
}

/** One delegated task in the work queue.
 *
 * Carries what the thread's delegation card used to: the instruction (summarised,
 * expandable — a truncated 배정 line loses the part that says what the agent was
 * actually told), the state, and whether the agent has reported back. */
function QueueRow({
  card,
  state,
  reportCount,
}: {
  card: DelegationCard
  state: WorkerState
  reportCount: number
}) {
  const [showFull, setShowFull] = useState(false)
  const summary = instructionSummary(card.instruction)
  const fullText = stripInstructionPlumbing(card.instruction)
  const title = summary.text || profileLabel(card.agentName ?? '') || card.terminalId.slice(0, 8)
  return (
    <div
      data-testid={`queue-row-${card.terminalId}`}
      data-state={state}
      className={`flex items-start gap-2.5 rounded-xl border px-2.5 py-2 ${
        state === 'done' ? 'border-[var(--border-soft)] opacity-70' : 'border-[var(--border)]'
      }`}
    >
      <QueueStateIcon state={state} />
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-semibold text-[var(--text)] ${showFull ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
          {showFull ? fullText : title}
        </div>
        <div className="text-[10.5px] text-[var(--text-3)]">
          {card.agentName ? profileLabel(card.agentName) : card.terminalId.slice(0, 8)} · {QUEUE_STATE_LABEL[state]}
          {reportCount > 0 ? ` · 보고 ${reportCount}건` : state === 'done' ? ' · 보고 없음' : ''}
        </div>
        {summary.truncated && (
          <button
            type="button"
            onClick={() => setShowFull(v => !v)}
            className="mt-1 text-[10.5px] font-semibold text-[var(--text-3)] hover:text-[var(--text)]"
          >
            {showFull ? '요약 보기' : '전체 보기'}
          </button>
        )}
      </div>
    </div>
  )
}

function resolveStatus(id: string, fallback: string | null, terminalStatuses: Record<string, string>): string | null {
  return terminalStatuses[id] || (fallback ? fallback.toUpperCase() : null)
}

function fmtAbs(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Maps a terminal/card identity to the summary-viz shape (RoleBoard/DelegationHierarchy).
 * Neither TerminalMeta nor DelegationCard carry a live `model` field, so the
 * model badge falls back to the profile's known detail string (e.g. "Codex · Sol"). */
function toVizItem(name: string | null, provider: string | null, terminalId: string): AgentVizItem {
  return {
    name: name ?? terminalId.slice(0, 8),
    provider,
    model: name ? profileDetail({ name, source: 'built-in', provider }) : null,
    terminalId,
  }
}

type VizMode = 'auto' | 'board' | 'hier'

export function AgentSidePanel({
  collapsed,
  sessionName,
  terminals,
  cards,
  teamRoster = [],
  terminalStatuses,
  sessionWorkingDirectory,
  gauges = {},
  reportCounts = {},
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
  // Phase 4-C Task 4: agents 탭 summary viz — RoleBoard (idle) auto-switches to
  // DelegationHierarchy while any worker is PROCESSING/WAITING_USER_ANSWER
  // (isTeamWorking), overridable via the 보드/계층 toggle below.
  const [vizMode, setVizMode] = useState<VizMode>('auto')
  // Loaded once here (not per AgentCard) so every card in this panel shares
  // the same fetch — see InlineUsageBar.tsx / useUsageAccounts.ts. No
  // Claude-limits opt-in from this context (that stays UsageButton's own
  // per-popover state); a claude_code card simply shows "사용량 데이터 없음"
  // until the user opts in from the usage popover elsewhere.
  const { accounts } = useUsageAccounts(!collapsed, false)

  if (collapsed) return null

  const supervisor = terminals[0]
  const activeProfileNames = new Set(cards.map(card => card.agentName).filter((name): name is string => Boolean(name)))
  const waitingRoster = teamRoster.filter(profile => !activeProfileNames.has(profile.name))
  const agentCount = (supervisor ? 1 : 0) + cards.length + waitingRoster.length
  // Session-scoped and card-aware: the raw store keeps a deleted worker's last
  // PROCESSING forever and carries other sessions' terminals too, which would
  // over-report both the work queue and the board→hierarchy switch.
  const scopedStatuses = sessionStatusMap({
    supervisorId: supervisor?.id ?? null,
    cards,
    terminalStatuses,
  })
  // "In flight" must mean the same thing here as on the in-chat progress card,
  // so both read it through workerStateFor. The old filter only counted
  // PROCESSING/WAITING_USER_ANSWER literals, which dropped a worker that exists
  // but has not reported a status yet — it was alive and working, and the queue
  // showed 0.
  // 작업 큐는 "이번 세션에 배정된 작업 목록"이다 — 지금 살아 있는 워커 목록이 아니다.
  //
  // It used to list only in-flight workers, and looked permanently broken: the
  // orchestrator calls delete_terminal on each worker as soon as its callback
  // lands, so a card is `killed` (→ done) within seconds of finishing. On a run
  // that delegated eight tasks the queue read 0 the entire time, because at no
  // single instant was more than one worker alive.
  //
  // So the queue now keeps every delegated task and carries its state per row.
  // Active work sorts to the top — that is what someone opening the tab mid-run
  // is looking for — and finished work stays below as the turn's record.
  const QUEUE_ORDER: Record<WorkerState, number> = { blocked: 0, working: 1, waiting: 2, error: 3, done: 4 }
  const queueItems = cards
    .map(card => ({ card, state: workerStateFor(card, scopedStatuses) }))
    .sort((a, b) => {
      const byState = QUEUE_ORDER[a.state] - QUEUE_ORDER[b.state]
      if (byState !== 0) return byState
      return (a.card.firstSeenAt ?? 0) - (b.card.firstSeenAt ?? 0)
    })
  const queueActiveCount = queueItems.filter(item => item.state === 'working' || item.state === 'blocked' || item.state === 'waiting').length
  const startedAt = terminals.reduce<string | null>((earliest, t) => {
    if (!t.created_at) return earliest
    if (!earliest) return t.created_at
    return new Date(t.created_at) < new Date(earliest) ? t.created_at : earliest
  }, null)
  const providers = [...new Set(terminals.map(t => t.provider).filter(Boolean))]

  const vizOrchestrator = supervisor ? toVizItem(supervisor.agent_profile, supervisor.provider, supervisor.id) : null
  const vizWorkers = cards.map(card => toVizItem(card.agentName, card.provider, card.terminalId))
  const vizAll = vizOrchestrator ? [vizOrchestrator, ...vizWorkers] : vizWorkers
  // Auto used to require a worker to be actively PROCESSING before switching to
  // the hierarchy, so a session whose workers had already finished fell back to
  // the flat board — which shows who exists but not who delegated to whom. That
  // is precisely the "어떻게 흘러가는지 모르겠다" case. Show the hierarchy whenever
  // this session has delegated at all; the board is for a session with no
  // workers yet, where a tree of one node would say nothing. isTeamWorking still
  // drives the live highlighting inside the hierarchy.
  const hasDelegated = vizWorkers.length > 0
  const vizView = vizMode === 'auto' ? (hasDelegated ? 'hier' : 'board') : vizMode

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
              {t === 'agents' ? `에이전트 ${agentCount}` : t === 'queue' ? `작업 큐 ${queueItems.length}` : '세션 정보'}
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
            {vizAll.length > 0 && (
              <div className="mb-1">
                <div className="mb-1.5 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setVizMode('board')}
                    aria-pressed={vizView === 'board'}
                    className={`h-6 rounded-full px-2.5 text-[10.5px] font-bold ${
                      vizView === 'board' ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'bg-[var(--surface-2)] text-[var(--text-3)]'
                    }`}
                  >
                    보드
                  </button>
                  <button
                    type="button"
                    onClick={() => setVizMode('hier')}
                    aria-pressed={vizView === 'hier'}
                    className={`h-6 rounded-full px-2.5 text-[10.5px] font-bold ${
                      vizView === 'hier' ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'bg-[var(--surface-2)] text-[var(--text-3)]'
                    }`}
                  >
                    계층
                  </button>
                </div>
                <div data-testid="agent-viz" data-view={vizView}>
                  {vizView === 'hier' && vizOrchestrator ? (
                    <DelegationHierarchy orchestrator={vizOrchestrator} agents={vizWorkers} statuses={scopedStatuses} />
                  ) : (
                    <RoleBoard agents={vizAll} statuses={scopedStatuses} />
                  )}
                </div>
              </div>
            )}
            {supervisor && (
              <AgentCard
                terminalId={supervisor.id}
                agentName={supervisor.agent_profile}
                provider={supervisor.provider}
                status={resolveStatus(supervisor.id, null, terminalStatuses)}
                percentLeft={gauges[supervisor.id] ?? null}
                accounts={accounts}
                roleLabel="오케스트레이터"
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
                status={card.killed ? (card.status ?? 'completed') : resolveStatus(card.terminalId, card.status, terminalStatuses)}
                percentLeft={gauges[card.terminalId] ?? null}
                accounts={accounts}
                roleLabel={null}
                subLine={instructionSummary(card.instruction).text || null}
                callerAgentName={card.callerAgentName}
                location={card.location}
                onMessage={() => onMessageTarget(card.terminalId)}
                onTerminal={() => onOpenTerminal(card.terminalId)}
                onOutput={() => onOpenOutput(card.terminalId)}
                onInbox={() => onOpenInbox(card.terminalId)}
                onStop={() => onRequestStop(card.terminalId, card.agentName)}
                onDelete={() => onRequestDelete(card.terminalId, card.agentName)}
                actionsEnabled={!card.killed}
              />
            ))}
            {waitingRoster.map(profile => (
              <TeamRosterCard key={profile.name} profile={profile} />
            ))}
          </div>
        ) : tab === 'queue' ? (
          queueItems.length === 0 ? (
            <p className="px-1 py-3 text-[11px] text-[var(--text-3)]">아직 배정된 작업이 없어요. 오케스트레이터가 역할에 작업을 나누면 여기에 쌓여요.</p>
          ) : (
            <div className="space-y-2">
              <p className="px-1 text-[10.5px] text-[var(--text-3)]" data-testid="queue-summary">
                진행 중 {queueActiveCount} · 전체 {queueItems.length}
              </p>
              {queueItems.map(({ card, state }) => (
                <QueueRow
                  key={card.terminalId}
                  card={card}
                  state={state}
                  reportCount={reportCounts[card.terminalId] ?? 0}
                />
              ))}
            </div>
          )
        ) : (
          <div className="space-y-0.5 text-xs">
            <InfoRow k="세션" v={displaySessionName(sessionName)} />
            <InfoRow k="터미널" v={`${terminals.length}개`} />
            <InfoRow k="실행 AI" v={providers.join(', ') || '—'} />
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

function TeamRosterCard({ profile }: { profile: TeamRosterProfile }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] p-2.5">
      <div className="flex items-center gap-2">
        <AgentAvatar name={profile.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-bold text-[var(--text)]">{profileLabel(profile.name)}</div>
          <div className="truncate text-[10.5px] text-[var(--text-3)]">{profile.provider ?? '프로필 자동 결정'} · 호출 대기</div>
        </div>
        <StatusBadge status="idle" />
      </div>
      <p className="mt-1.5 text-[10.5px] text-[var(--text-3)]">선택한 팀원 · 오케스트레이터가 위임하면 진행 카드로 전환돼요.</p>
    </div>
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
  accounts,
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
  actionsEnabled = true,
}: {
  terminalId: string
  agentName: string | null
  provider: string | null
  status: string | null
  percentLeft?: number | null
  /** Phase D: this AI's inline usage bar — accounts are loaded once by the parent AgentSidePanel, never per-card. */
  accounts: UsageAccount[]
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
  actionsEnabled?: boolean
}) {
  // The supervisor's profile label already reads 오케스트레이터, so the role badge
  // would print the same word twice; roleBadgeFor drops it in that case and keeps
  // it for a custom orchestrator profile whose name differs.
  const displayedName = agentName ? profileLabel(agentName) : terminalId.slice(0, 8)
  const badge = roleBadgeFor(displayedName, roleLabel)
  return (
    <div className="rounded-2xl border border-[var(--border)] p-2.5">
      <div className="flex items-center gap-2">
        <AgentAvatar name={agentName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-bold text-[var(--text)]">
            {displayedName}
            {badge && <span className="ml-1.5 rounded bg-[var(--surface-3)] px-1 py-0.5 text-[9.5px] font-bold text-[var(--text-2)]">{badge}</span>}
          </div>
          <div className="truncate text-[10.5px] text-[var(--text-3)]">
            {provider} · {terminalId.slice(0, 8)}
          </div>
        </div>
        <ContextGaugeChip percentLeft={percentLeft} />
        {status && <StatusBadge status={status} />}
      </div>
      {provider && (
        <div className="mt-1.5">
          <InlineUsageBar provider={provider} accounts={accounts} />
        </div>
      )}
      {(subLine || callerAgentName || location) && (
        <div className="mt-1.5 space-y-0.5 text-[11px] text-[var(--text-2)]">
          {subLine && <div className="truncate">현재: {subLine}</div>}
          {callerAgentName && <div>상위: {callerAgentName}</div>}
          {location && <div className="truncate font-mono text-[10.5px] text-[var(--text-3)]">{location}</div>}
        </div>
      )}
      {actionsEnabled ? (
        <div className="mt-2 flex gap-1">
          <IconButton title="메시지 보내기" onClick={onMessage}><MessageSquare size={13} /></IconButton>
          <IconButton title="터미널 열기" onClick={onTerminal}><TermIcon size={13} /></IconButton>
          <IconButton title="Output 열기" onClick={onOutput}><FileText size={13} /></IconButton>
          <IconButton title="받은편지함" onClick={onInbox}><Mail size={13} /></IconButton>
          <IconButton title="중지" onClick={onStop} warn><Square size={13} /></IconButton>
          <IconButton title="삭제" onClick={onDelete} warn><Trash2 size={13} /></IconButton>
        </div>
      ) : (
        <p className="mt-2 text-[10.5px] text-[var(--text-3)]">완료 후 자동 정리된 작업 기록</p>
      )}
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
