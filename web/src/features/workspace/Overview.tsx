import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Plus, Sparkles, WifiOff } from 'lucide-react'
import type { Session } from '../../api'
import { useStore } from '../../store'
import { StatusBadge } from '../../components/StatusBadge'
import { AgentAvatar } from './AgentAvatar'
import { statusDotColor } from './statusColor'
import { displaySessionName } from './displayName'
import { isSessionCompleted } from './sessionCompletion'
import { emptyProjectsData, loadProjectsData, matchWorkingDirectoryToProject, type ProjectMatch } from './projects'
import { useSessionLocations } from './useSessionLocations'
import { useFleetSummaries, type FleetTerminal, type FleetSummariesState } from './useFleetSummaries'
import type { ProjectsData } from './types'

const ATTENTION_STATUSES = new Set(['waiting_user_answer', 'error'])
const WORST_STATUS_PRIORITY = ['error', 'waiting_user_answer', 'processing', 'completed', 'idle']

interface AttentionItem {
  sessionId: string
  sessionName: string
  terminalId: string
  agentProfile: string | null
  status: 'waiting_user_answer' | 'error'
}

function pathTail(path: string | null | undefined): string | null {
  if (!path) return null
  const trimmed = path.replace(/[/\\]+$/, '')
  if (!trimmed) return null
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || trimmed
}

/** Worst-of among a session's own terminals only (never the whole-app terminal map) — feeds the grid card's status dot. */
function worstStatus(terminals: FleetTerminal[]): string | null {
  const seen = new Set(terminals.map(t => (t.status || '').toLowerCase()).filter(Boolean))
  for (const status of WORST_STATUS_PRIORITY) {
    if (seen.has(status)) return status
  }
  return null
}

interface OverviewProps {
  onSelectSession: (sessionId: string) => void
  onNewTask: () => void
  /**
   * Pre-fetched summaries (feedback #16) — Workspace.tsx lifts one
   * `useFleetSummaries` call and hands it to both this component and the
   * Sidebar, so the two views share a single poll instead of doubling the
   * request rate. Falls back to its own internal polling when omitted, so
   * this component stays mountable standalone (existing tests render it with
   * no parent-supplied summaries at all).
   */
  summariesOverride?: FleetSummariesState
}

/**
 * Fleet overview — renders where the Thread used to show a bare "select a
 * session" placeholder whenever no session is selected (Phase 2c spec §1).
 * Every count/card here is built from the REST fleet poll above; this screen
 * never guesses at "stalled" — that judgment only ever happens inside a
 * session's own Thread once the event stream is live (spec: "정체 판정은
 * 여기서 하지 않는다").
 */
export function Overview({ onSelectSession, onNewTask, summariesOverride }: OverviewProps) {
  const sessions = useStore(s => s.sessions)
  // Rules-of-hooks safe: always called, just with an empty session list (a
  // no-op — see useFleetSummaries' own early return) whenever a parent has
  // already supplied summaries, so only one of the two ever actually polls.
  const ownFleet = useFleetSummaries(summariesOverride ? [] : sessions)
  const { summaries, loading, allFailed } = summariesOverride ?? ownFleet
  const locations = useSessionLocations(sessions)
  const [projectsData] = useState<ProjectsData>(() => (typeof window === 'undefined' ? emptyProjectsData() : loadProjectsData()))

  const matches = useMemo(() => {
    const out: Record<string, ProjectMatch> = {}
    sessions.forEach(s => {
      out[s.id] = matchWorkingDirectoryToProject(locations[s.name] ?? locations[s.id], projectsData)
    })
    return out
  }, [sessions, locations, projectsData])

  const counts = useMemo(() => {
    let processing = 0
    let waiting = 0
    let error = 0
    Object.values(summaries).forEach(summary => {
      summary.terminals.forEach(t => {
        const s = (t.status || '').toLowerCase()
        if (s === 'processing') processing += 1
        else if (s === 'waiting_user_answer') waiting += 1
        else if (s === 'error') error += 1
      })
    })
    return { sessions: sessions.length, processing, waiting, error }
  }, [summaries, sessions.length])

  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = []
    sessions.forEach(s => {
      const summary = summaries[s.id]
      if (!summary) return
      summary.terminals.forEach(t => {
        const status = (t.status || '').toLowerCase()
        if (ATTENTION_STATUSES.has(status)) {
          items.push({
            sessionId: s.id,
            sessionName: s.name,
            terminalId: t.id,
            agentProfile: t.agentProfile,
            status: status as 'waiting_user_answer' | 'error',
          })
        }
      })
    })
    // Error first, then waiting-for-input — both already filtered to just these two.
    return items.sort((a, b) => (a.status === b.status ? 0 : a.status === 'error' ? -1 : 1))
  }, [sessions, summaries])

  const sections = useMemo(() => {
    const byGroup = new Map<string, Session[]>()
    const independent: Session[] = []
    sessions.forEach(s => {
      const groupId = matches[s.id]?.groupId
      if (groupId) {
        const list = byGroup.get(groupId) ?? []
        list.push(s)
        byGroup.set(groupId, list)
      } else {
        independent.push(s)
      }
    })
    const out: { key: string; label: string; sessions: Session[] }[] = []
    projectsData.groups.forEach(group => {
      const list = byGroup.get(group.id)
      if (list && list.length > 0) out.push({ key: group.id, label: group.name, sessions: list })
    })
    if (independent.length > 0) out.push({ key: '__independent__', label: '독립 세션', sessions: independent })
    return out
  }, [sessions, matches, projectsData])

  const hasAnyData = Object.keys(summaries).length > 0
  const initialLoading = loading && sessions.length > 0 && !hasAnyData

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[960px] space-y-6">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-8 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-2)]">
              <Sparkles size={20} />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text)]">아직 실행 중인 세션이 없어요</h2>
            <p className="max-w-sm text-xs leading-relaxed text-[var(--text-3)]">
              새 작업을 시작하면 Supervisor가 필요한 워커 에이전트를 만들어 나가요.
            </p>
            <button
              type="button"
              onClick={onNewTask}
              className="mt-1 flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 text-xs font-bold text-[var(--on-accent)]"
            >
              <Plus size={13} />새 작업 시작
            </button>
          </div>
        ) : initialLoading ? (
          <p className="mt-16 text-center text-xs text-[var(--text-3)]">불러오는 중...</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SummaryChip label="세션" value={counts.sessions} />
              <SummaryChip label="작업 중" value={counts.processing} tone="info" />
              <SummaryChip label="입력 대기" value={counts.waiting} tone="warning" />
              <SummaryChip label="오류" value={counts.error} tone="danger" />
              <button
                type="button"
                onClick={onNewTask}
                className="ml-auto flex h-7 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-xs font-bold text-[var(--on-accent)]"
              >
                <Plus size={13} />새 작업
              </button>
            </div>

            {allFailed && (
              <div className="flex items-center gap-2 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-[11.5px] text-[var(--warning)]">
                <WifiOff size={13} />
                세션 상태를 불러오지 못했어요 — 서버 연결을 확인해 주세요.
              </div>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                <AlertTriangle size={12} />
                주의가 필요해요
              </h3>
              {attentionItems.length === 0 ? (
                <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-xs text-[var(--text-3)]">지금은 조용해요 ✨</p>
              ) : (
                <div className="space-y-1.5">
                  {attentionItems.map(item => (
                    <button
                      key={item.terminalId}
                      type="button"
                      onClick={() => onSelectSession(item.sessionId)}
                      aria-label={`${displaySessionName(item.sessionName)} 세션 선택 — 주의 필요`}
                      className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:bg-[var(--surface-2)]"
                    >
                      <AgentAvatar name={item.agentProfile} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-[var(--text)]">{item.agentProfile ?? item.terminalId.slice(0, 8)}</span>
                        <span className="block truncate text-[10.5px] text-[var(--text-3)]">{displaySessionName(item.sessionName)}</span>
                      </span>
                      <StatusBadge status={item.status} />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">세션</h3>
              <div className="space-y-4">
                {sections.map(section => (
                  <div key={section.key}>
                    <div className="mb-1.5 text-[10.5px] font-semibold text-[var(--text-3)]">{section.label}</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {section.sessions.map(s => {
                        const summary = summaries[s.id]
                        const tail = pathTail(locations[s.name] ?? locations[s.id])
                        const completed = summary ? isSessionCompleted(summary.terminals) : false
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => onSelectSession(s.id)}
                            aria-label={`${displaySessionName(s.name)} 세션 선택`}
                            className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left hover:bg-[var(--surface-2)]"
                          >
                            <span className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ background: statusDotColor(summary ? worstStatus(summary.terminals) : null) }}
                              />
                              <span className="truncate text-xs font-semibold text-[var(--text)]">{displaySessionName(s.name)}</span>
                              {completed && (
                                <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--success-bg)] px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--success)]">
                                  <Check size={10} />
                                  완료
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-3)]">
                              <span>터미널 {summary ? summary.terminals.length : '—'}개</span>
                              {tail && <span className="truncate font-mono">{tail}</span>}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone?: 'info' | 'warning' | 'danger' }) {
  const toneClass =
    tone === 'info'
      ? 'bg-[var(--info-bg)] text-[var(--info)]'
      : tone === 'warning'
        ? 'bg-[var(--warning-bg)] text-[var(--warning)]'
        : tone === 'danger'
          ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
          : 'bg-[var(--surface-2)] text-[var(--text-2)]'
  return (
    <span aria-label={`${label} ${value}`} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${toneClass}`}>
      {value}
      <span className="font-normal opacity-80">{label}</span>
    </span>
  )
}
