import { useState, useEffect, useRef, useMemo } from 'react'
import { useStore } from '../store'
import { api, TerminalMeta } from '../api'
import { Bot, Zap, Package, Monitor, Terminal as TermIcon, Trash2, Mail, FileText, LogOut, Send, ChevronRight, ChevronDown, Users, Filter, ArrowDownUp, MessageCircle, Loader2 } from 'lucide-react'
import { TerminalView } from './TerminalView'
import { ConfirmModal } from './ConfirmModal'
import { InboxPanel } from './InboxPanel'
import { StatusBadge, STATUS_CONFIG } from './StatusBadge'
import { OutputViewer } from './OutputViewer'
import { SessionChatPanel } from './SessionChatPanel'

const STATUS_ORDER = ['PROCESSING', 'IDLE', 'WAITING_USER_ANSWER', 'ERROR', 'COMPLETED', 'UNKNOWN']

function fmtRel(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (diff < 60) return '방금'
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 24) return rm ? `${h}시간 ${rm}분 전` : `${h}시간 전`
  const days = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${days}일 ${rh}시간 전` : `${days}일 전`
}

function fmtAbs(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STATUS_LABELS: Record<string, string> = {
  PROCESSING: '작업 중',
  IDLE: '대기',
  WAITING_USER_ANSWER: '입력 대기',
  ERROR: '오류',
  COMPLETED: '완료',
  UNKNOWN: '알 수 없음',
}

const STATUS_META: Record<string, { label: string; dot: string; text: string; pulse?: boolean }> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, { label: STATUS_LABELS[k] || v.label, dot: v.dotClass, text: v.textClass, pulse: v.pulse }])
)
STATUS_META['UNKNOWN'] = { label: STATUS_LABELS.UNKNOWN, dot: 'bg-[var(--text-3)]', text: 'text-[var(--text-3)]' }

const STATUS_ACTIVE_BG: Record<string, string> = {
  PROCESSING: 'bg-[var(--info-bg)] border-[var(--info)] text-[var(--info)]',
  IDLE: 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent-text)]',
  WAITING_USER_ANSWER: 'bg-[var(--warning-bg)] border-[var(--warning)] text-[var(--warning)]',
  ERROR: 'bg-[var(--danger-bg)] border-[var(--danger)] text-[var(--danger)]',
  // --neutral rather than --accent: status.generated.ts calls COMPLETED an accent
  // status, but this map already spends accent on IDLE, and two accent-coloured
  // chips side by side are indistinguishable. Neutral also reads correctly for a
  // finished, no-longer-running agent. (The IDLE/COMPLETED split here diverges
  // from the generated canon — left as-is; changing it moves a colour's meaning,
  // which is a separate decision from removing hardcoded palette values.)
  COMPLETED: 'bg-[var(--neutral-bg)] border-[var(--neutral)] text-[var(--neutral)]',
  UNKNOWN: 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-2)]',
}

const agentTypeLabel = (value: string) => value === 'default' ? '기본값' : value

function StatusSummary({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {STATUS_ORDER.filter(s => counts[s] > 0).map(s => {
        const meta = STATUS_META[s]
        return (
          <span key={s} className="flex items-center gap-1 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${meta.pulse ? 'animate-pulse' : ''}`} />
            <span className={meta.text}>{counts[s]}</span>
            <span className="text-[var(--text-3)]">{meta.label}</span>
          </span>
        )
      })}
    </div>
  )
}

interface SessionWithTerminals {
  name: string
  status: string
  terminals: TerminalMeta[]
}

export function DashboardHome({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { sessions, terminalStatuses, setTerminalStatus, clearTerminalStatuses, showSnackbar, deleteSession } = useStore()
  const [profileCount, setProfileCount] = useState(0)
  const [sessionData, setSessionData] = useState<SessionWithTerminals[]>([])
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  const [liveTerminal, setLiveTerminal] = useState<{ id: string; provider?: string; agentProfile?: string | null } | null>(null)
  const [pendingClose, setPendingClose] = useState<TerminalMeta | null>(null)
  const [closingTerminal, setClosingTerminal] = useState<string | null>(null)
  const [inboxTerminalId, setInboxTerminalId] = useState<string | null>(null)
  const [outputTerminalId, setOutputTerminalId] = useState<string | null>(null)
  const [pendingExit, setPendingExit] = useState<TerminalMeta | null>(null)
  const [exitingTerminal, setExitingTerminal] = useState<string | null>(null)
  const [sendInputOpen, setSendInputOpen] = useState<Record<string, boolean>>({})
  const [sendInputValues, setSendInputValues] = useState<Record<string, string>>({})
  const [sendingInput, setSendingInput] = useState<string | null>(null)
  const [agentTypeFilter, setAgentTypeFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [pendingDeleteSession, setPendingDeleteSession] = useState<string | null>(null)
  const [deletingSession, setDeletingSession] = useState(false)
  const [sessionChat, setSessionChat] = useState<{ sessionName: string; terminalId: string } | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)
  const seenSessionsRef = useRef<Set<string>>(new Set())

  const totalTerminals = sessionData.reduce((sum, s) => sum + s.terminals.length, 0)

  const allAgentTypes = useMemo(() => {
    const types = new Set<string>()
    sessionData.forEach(s => s.terminals.forEach(t => { types.add(t.agent_profile || 'default') }))
    return [...types].sort()
  }, [sessionData])

  const filteredSessions = useMemo(() => {
    const filtered = sessionData.filter(s =>
      s.terminals.length === 0 || s.terminals.some(t => {
        const matchAgent = !agentTypeFilter || (t.agent_profile || 'default') === agentTypeFilter
        const matchStatus = !statusFilter || (terminalStatuses[t.id] || 'UNKNOWN') === statusFilter
        return matchAgent && matchStatus
      })
    )
    return filtered.sort((a, b) => {
      const latestA = Math.max(...a.terminals.map(t => t.last_active ? new Date(t.last_active).getTime() : 0))
      const latestB = Math.max(...b.terminals.map(t => t.last_active ? new Date(t.last_active).getTime() : 0))
      return sortOrder === 'desc' ? latestB - latestA : latestA - latestB
    })
  }, [sessionData, agentTypeFilter, statusFilter, sortOrder, terminalStatuses])

  const getStatusCounts = (terminals: TerminalMeta[]) => {
    const counts: Record<string, number> = {}
    terminals.forEach(t => {
      const s = terminalStatuses[t.id] || 'UNKNOWN'
      counts[s] = (counts[s] || 0) + 1
    })
    return counts
  }

  // Fetch session details with terminals
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const sessionDetails = await Promise.all(
          sessions.map(async s => {
            try {
              const detail = await api.getSession(s.name)
              return { name: s.name, status: s.status, terminals: detail.terminals || [] }
            } catch {
              return { name: s.name, status: s.status, terminals: [] }
            }
          })
        )
        setSessionData(sessionDetails)
        // Auto-expand only newly seen sessions
        const newNames = sessionDetails.map(s => s.name).filter(n => !seenSessionsRef.current.has(n))
        newNames.forEach(n => seenSessionsRef.current.add(n))
        if (newNames.length > 0) {
          setExpandedSessions(prev => {
            const next = new Set(prev)
            newNames.forEach(n => next.add(n))
            return next
          })
        }
      } catch {}
    }
    fetchAll()
    const interval = setInterval(fetchAll, 5000)
    return () => clearInterval(interval)
  }, [sessions.map(s => s.id).join(',')])

  // Poll statuses
  useEffect(() => {
    const allIds = sessionData.flatMap(s => s.terminals.map(t => t.id))
    if (!allIds.length) return
    clearTerminalStatuses(allIds)
    const fetch = () => {
      allIds.forEach(id => {
        api.getTerminalStatus(id)
          .then(status => { if (status) setTerminalStatus(id, status) })
          .catch(() => {})
      })
    }
    fetch()
    const interval = setInterval(fetch, 3000)
    return () => clearInterval(interval)
  }, [sessionData.flatMap(s => s.terminals.map(t => t.id)).join(',')])

  useEffect(() => {
    api.listProfiles().then(p => setProfileCount(p.length)).catch(() => {})
  }, [])

  const handleDeleteTerminal = async () => {
    if (!pendingClose) return
    setClosingTerminal(pendingClose.id)
    try {
      await api.deleteTerminal(pendingClose.id)
      if (liveTerminal?.id === pendingClose.id) setLiveTerminal(null)
      showSnackbar({ type: 'success', message: `터미널 ${pendingClose.id}을(를) 닫았습니다` })
    } catch {
      showSnackbar({ type: 'error', message: '터미널을 닫지 못했습니다' })
    }
    setClosingTerminal(null)
    setPendingClose(null)
  }

  const handleExitTerminal = async () => {
    if (!pendingExit) return
    setExitingTerminal(pendingExit.id)
    try {
      await api.exitTerminal(pendingExit.id)
      showSnackbar({ type: 'success', message: '정상 종료 명령을 보냈습니다' })
    } catch {
      showSnackbar({ type: 'error', message: '종료 명령을 보내지 못했습니다' })
    }
    setExitingTerminal(null)
    setPendingExit(null)
  }

  const handleDeleteSession = async () => {
    if (!pendingDeleteSession) return
    setDeletingSession(true)
    try {
      await deleteSession(pendingDeleteSession)
    } catch {}
    setDeletingSession(false)
    setPendingDeleteSession(null)
  }

  const handleSendInput = async (terminalId: string) => {
    const message = (sendInputValues[terminalId] || '').trim()
    if (!message) return
    setSendingInput(terminalId)
    try {
      await api.sendInput(terminalId, message)
      setSendInputValues(prev => ({ ...prev, [terminalId]: '' }))
      showSnackbar({ type: 'success', message: '메시지를 보냈습니다' })
    } catch {
      showSnackbar({ type: 'error', message: '메시지를 보내지 못했습니다' })
    }
    setSendingInput(null)
  }

  const toggleSession = (name: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const openSessionChat = async (sessionName: string) => {
    setOpeningChat(sessionName)
    try {
      const detail = await api.getSession(sessionName)
      const orchestrator = detail.terminals[0]
      if (!orchestrator) throw new Error('오케스트레이터 터미널을 찾을 수 없습니다')
      setSessionChat({ sessionName, terminalId: orchestrator.id })
    } catch (error: any) {
      showSnackbar({ type: 'error', message: error?.message || '오케스트레이터 채팅을 열지 못했습니다' })
    } finally {
      setOpeningChat(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface)] rounded-xl p-5 border border-[var(--border-soft)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center">
              <Users size={20} className="text-[var(--accent-text)]" />
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--text)]">{sessions.length}</div>
              <div className="text-xs text-[var(--text-3)] uppercase tracking-wide">세션</div>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface)] rounded-xl p-5 border border-[var(--border-soft)]">
          <div className="flex items-center gap-3">
            {/* Decorative stat tile — the pastel token pairs exist for exactly this
                and carry a light-mode value, unlike the cyan-900/cyan-400 it replaces. */}
            <div className="w-10 h-10 rounded-lg bg-[var(--p-sky)] flex items-center justify-center">
              <TermIcon size={20} className="text-[var(--p-sky-ink)]" />
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--text)]">{totalTerminals}</div>
              <div className="text-xs text-[var(--text-3)] uppercase tracking-wide">실행 중인 에이전트</div>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface)] rounded-xl p-5 border border-[var(--border-soft)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--info-bg)] flex items-center justify-center">
              <Package size={20} className="text-[var(--info)]" />
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--text)]">{profileCount}</div>
              <div className="text-xs text-[var(--text-3)] uppercase tracking-wide">프로필</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 flex-wrap">
        <button onClick={() => onNavigate('agents')} className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--on-accent)] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Bot size={16} /> 에이전트 실행
        </button>
        <button onClick={() => onNavigate('flows')} className="flex items-center gap-2 bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] text-[var(--text)] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Zap size={16} /> 자동화 관리
        </button>
      </div>

      {/* Header with sort toggle */}
      <div className="mb-1">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wide">활성 세션</h3>
            <p className="text-xs text-[var(--text-3)] mt-1">
              각 세션은 하나 이상의 AI 에이전트가 실행되고 협업하는 작업 공간입니다.
            </p>
          </div>
          <button onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')} className="flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] px-3 py-1.5 rounded-lg transition-colors">
            <ArrowDownUp size={12} />
            {sortOrder === 'desc' ? '최신순' : '오래된순'}
          </button>
        </div>
      </div>

      {/* Agent type filter */}
      {allAgentTypes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={12} className="text-[var(--text-3)]" />
          <button onClick={() => setAgentTypeFilter(null)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${!agentTypeFilter ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>전체</button>
          {allAgentTypes.map(t => (
            <button key={t} onClick={() => setAgentTypeFilter(agentTypeFilter === t ? null : t)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${agentTypeFilter === t ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>{agentTypeLabel(t)}</button>
          ))}
        </div>
      )}

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap -mt-3">
        <Filter size={12} className="text-[var(--text-3)]" />
        <button onClick={() => setStatusFilter(null)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${!statusFilter ? 'bg-[var(--surface-3)] border-[var(--border)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>모든 상태</button>
        {STATUS_ORDER.map(s => {
          const meta = STATUS_META[s]
          return (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${statusFilter === s ? STATUS_ACTIVE_BG[s] : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </button>
          )
        })}
      </div>

      {/* Sessions */}
      {filteredSessions.length === 0 ? (
        <div className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl p-8 text-center">
          <Bot size={32} className="mx-auto text-[var(--text-3)] mb-3" />
          {sessionData.length === 0 ? (
            <>
              <p className="text-[var(--text-3)] text-sm">활성 세션이 없습니다.</p>
              <p className="text-[var(--text-3)] text-xs mt-1"><span className="text-[var(--accent-text)] cursor-pointer" onClick={() => onNavigate('agents')}>에이전트 탭</span>에서 첫 에이전트를 실행하세요.</p>
            </>
          ) : (
            <p className="text-[var(--text-3)] text-sm">현재 필터와 일치하는 세션이 없습니다.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSessions.map(session => {
            const visibleTerminals = session.terminals.filter(t => {
              const matchAgent = !agentTypeFilter || t.agent_profile === agentTypeFilter
              const matchStatus = !statusFilter || (terminalStatuses[t.id] || 'UNKNOWN') === statusFilter
              return matchAgent && matchStatus
            })
            const statusCounts = getStatusCounts(session.terminals)
            const sortedTerminals = [...visibleTerminals].sort((a, b) => {
              const ta = a.last_active ? new Date(a.last_active).getTime() : 0
              const tb = b.last_active ? new Date(b.last_active).getTime() : 0
              return sortOrder === 'desc' ? tb - ta : ta - tb
            })
            const grouped: Record<string, TerminalMeta[]> = {}
            sortedTerminals.forEach(t => {
              const key = t.agent_profile || 'default'
              ;(grouped[key] ??= []).push(t)
            })
            const typeSummary = Object.entries(
              session.terminals.reduce<Record<string, number>>((acc, t) => {
                const k = t.agent_profile || 'default'
                acc[k] = (acc[k] || 0) + 1
                return acc
              }, {})
            ).sort((a, b) => b[1] - a[1])
            const sessionStart = session.terminals.reduce<string | null>((earliest, t) => {
              if (!t.created_at) return earliest
              if (!earliest) return t.created_at
              return new Date(t.created_at) < new Date(earliest) ? t.created_at : earliest
            }, null)
            const sessionLastActive = session.terminals.reduce<string | null>((latest, t) => {
              if (!t.last_active) return latest
              if (!latest) return t.last_active
              return new Date(t.last_active) > new Date(latest) ? t.last_active : latest
            }, null)

            return (
              <div key={session.name} className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl overflow-hidden relative">
                {/* Orchestrator chat — available without expanding the session */}
                <button
                  onClick={(e) => { e.stopPropagation(); void openSessionChat(session.name) }}
                  disabled={openingChat === session.name}
                  className="absolute top-3 right-11 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-[var(--accent-text)] hover:text-[var(--on-accent)] bg-[var(--accent-soft)] hover:bg-[var(--accent)] disabled:opacity-40 border border-[var(--accent)] rounded-lg transition-colors z-10"
                  title={`${session.name} 오케스트레이터에게 프롬프트 보내기`}
                  aria-label={`${session.name} 오케스트레이터 채팅`}
                >
                  {openingChat === session.name ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={12} />}
                  채팅
                </button>

                {/* Delete session button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDeleteSession(session.name) }}
                  className="absolute top-3 right-3 p-1.5 text-[var(--text-3)] hover:text-[var(--danger)] bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] rounded-lg transition-colors z-10"
                  title="세션 삭제"
                >
                  <Trash2 size={12} />
                </button>

                {/* Session header */}
                <button onClick={() => toggleSession(session.name)} className="w-full text-left p-4 pr-36 hover:bg-[var(--surface-2)] transition-colors">
                  <div className="flex items-center gap-3">
                    {expandedSessions.has(session.name) ? <ChevronDown size={14} className="text-[var(--text-3)]" /> : <ChevronRight size={14} className="text-[var(--text-3)]" />}
                    <Users size={14} className="text-[var(--accent-text)]" />
                    <span className="text-sm font-mono text-[var(--text)]">{session.name}</span>
                    <span className="text-xs text-[var(--text-3)]">에이전트 {session.terminals.length}개</span>
                  </div>
                  <div className="ml-8 mt-1.5 flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {typeSummary.map(([type, count]) => (
                        <span key={type} className="text-[10px] bg-[var(--surface-3)] text-[var(--text-3)] px-1.5 py-0.5 rounded">{agentTypeLabel(type)}{count > 1 ? ` ×${count}` : ''}</span>
                      ))}
                    </div>
                    <StatusSummary counts={statusCounts} />
                    <div className="flex items-center gap-3 text-[10px] text-[var(--text-3)]">
                      {sessionStart && <span title={fmtAbs(sessionStart) || ''}>시작 {fmtRel(sessionStart)}</span>}
                      {sessionLastActive && <span title={fmtAbs(sessionLastActive) || ''}>활동 {fmtRel(sessionLastActive)}</span>}
                    </div>
                  </div>
                </button>

                {/* Terminals grouped by agent type */}
                {expandedSessions.has(session.name) && (
                  <div className="border-t border-[var(--border-soft)] px-4 pb-4 space-y-3 pt-3">
                    {Object.entries(grouped).map(([agentType, terminals]) => (
                      <div key={agentType}>
                        <div className="flex items-center gap-2 mb-2">
                          <Bot size={11} className="text-[var(--text-3)]" />
                          <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">{agentTypeLabel(agentType)}</span>
                          <span className="text-[10px] text-[var(--text-3)]">({terminals.length})</span>
                        </div>
                        <div className="space-y-1.5">
                          {terminals.map(t => {
                            const relCreated = fmtRel(t.created_at)
                            const relActive = fmtRel(t.last_active)
                            const showActive = relActive && relActive !== relCreated
                            return (
                              <div key={t.id} className="bg-[var(--surface)] border border-[var(--border-soft)] rounded-lg px-3 py-2 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <TermIcon size={12} className="text-[var(--text-3)] shrink-0" />
                                    <span className="text-xs font-medium text-[var(--text-2)] truncate">{t.agent_profile || '기본값'}</span>
                                    <span className="text-[10px] font-mono text-[var(--text-3)]">{t.id.slice(0, 8)}</span>
                                    <StatusBadge status={terminalStatuses[t.id] || null} />
                                    <span className="text-[10px] text-[var(--text-3)]">{t.provider}</span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={() => setInboxTerminalId(t.id)} className="p-1 text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] rounded transition-colors" title="받은편지함"><Mail size={12} /></button>
                                    <button onClick={() => setOutputTerminalId(t.id)} className="p-1 text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] rounded transition-colors" title="출력"><FileText size={12} /></button>
                                    <button onClick={() => setLiveTerminal({ id: t.id, provider: t.provider, agentProfile: t.agent_profile })} className="flex items-center gap-1 px-2 py-1 bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--on-accent)] text-[10px] font-medium rounded transition-colors"><Monitor size={12} />터미널</button>
                                    <button onClick={() => setPendingExit(t)} disabled={exitingTerminal === t.id} className="p-1 text-[var(--text-3)] hover:text-[var(--warning)] bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] rounded transition-colors" title="정상 종료"><LogOut size={12} /></button>
                                    <button onClick={() => setPendingClose(t)} disabled={closingTerminal === t.id} className="p-1 text-[var(--text-3)] hover:text-[var(--danger)] bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] rounded transition-colors" title="닫기"><Trash2 size={12} /></button>
                                  </div>
                                </div>
                                {/* Timestamps */}
                                <div className="flex items-center gap-3 text-[10px] text-[var(--text-3)]">
                                  {relCreated && <span title={fmtAbs(t.created_at) || ''}>{relCreated}</span>}
                                  {showActive && <span title={fmtAbs(t.last_active) || ''}>↻ {relActive}</span>}
                                </div>
                                {/* Quick Send */}
                                {!sendInputOpen[t.id] ? (
                                  <button onClick={() => setSendInputOpen(prev => ({ ...prev, [t.id]: true }))} className="text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">에이전트에게 메시지...</button>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <input type="text" value={sendInputValues[t.id] || ''} onChange={e => setSendInputValues(prev => ({ ...prev, [t.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') handleSendInput(t.id) }} placeholder="메시지를 입력하세요..." className="flex-1 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-[11px] font-mono rounded px-2 py-1 focus:border-[var(--accent)] focus:outline-none" autoFocus />
                                    <button onClick={() => handleSendInput(t.id)} disabled={sendingInput === t.id || !(sendInputValues[t.id] || '').trim()} className="flex items-center gap-1 px-2 py-1 bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 text-[var(--on-accent)] text-[10px] font-medium rounded transition-colors"><Send size={10} /></button>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {inboxTerminalId && <InboxPanel terminalId={inboxTerminalId} onClose={() => setInboxTerminalId(null)} />}
      {liveTerminal && (
        <TerminalView terminalId={liveTerminal.id} provider={liveTerminal.provider} agentProfile={liveTerminal.agentProfile} onClose={() => setLiveTerminal(null)} />
      )}
      {outputTerminalId && <OutputViewer terminalId={outputTerminalId} onClose={() => setOutputTerminalId(null)} />}
      {sessionChat && (
        <SessionChatPanel
          sessionName={sessionChat.sessionName}
          terminalId={sessionChat.terminalId}
          onClose={() => setSessionChat(null)}
        />
      )}
      <ConfirmModal
        open={!!pendingClose}
        title="터미널 닫기"
        message="tmux 창을 닫고 에이전트 프로세스를 종료합니다."
        details={pendingClose ? [
          { label: '터미널', value: `${pendingClose.agent_profile || '기본값'} (${pendingClose.id})` },
          { label: '세션', value: pendingClose.tmux_session },
        ] : []}
        confirmLabel="터미널 닫기"
        variant="danger"
        loading={!!closingTerminal}
        onConfirm={handleDeleteTerminal}
        onCancel={() => setPendingClose(null)}
      />
      <ConfirmModal
        open={!!pendingExit}
        title="정상 종료"
        message="제공자별 종료 명령(예: /exit)을 보냅니다."
        details={pendingExit ? [
          { label: '터미널', value: `${pendingExit.agent_profile || '기본값'} (${pendingExit.id})` },
          { label: '제공자', value: pendingExit.provider },
        ] : []}
        confirmLabel="종료 명령 보내기"
        variant="warning"
        loading={!!exitingTerminal}
        onConfirm={handleExitTerminal}
        onCancel={() => setPendingExit(null)}
      />
      <ConfirmModal
        open={!!pendingDeleteSession}
        title="세션 삭제"
        message="이 세션의 모든 에이전트를 종료하고 세션을 삭제합니다."
        details={pendingDeleteSession ? [
          { label: '세션', value: pendingDeleteSession },
        ] : []}
        confirmLabel="세션 삭제"
        variant="danger"
        loading={deletingSession}
        onConfirm={handleDeleteSession}
        onCancel={() => setPendingDeleteSession(null)}
      />
    </div>
  )
}
