import { useEffect, useMemo, useRef, useState } from 'react'
import { Blocks, Plus, Sidebar as SidebarIcon, Users, Wifi, WifiOff } from 'lucide-react'
import { api } from '../../api'
import { useStore } from '../../store'
import { ConfirmModal } from '../../components/ConfirmModal'
import { Sidebar } from './Sidebar'
import { NewTaskModal } from './NewTaskModal'
import { Thread } from './Thread'
import { Composer, type ComposerTarget } from './Composer'
import { AgentSidePanel } from './AgentSidePanel'
import { Overview } from './Overview'
import { Workbench } from './Workbench'
import type { UiConnectionStatus } from './eventsClient'
import { useWorkspaceSession } from './useWorkspaceSession'
import { useWorkspaceAlerts } from './useWorkspaceAlerts'
import { useContextGauges } from './useContextGauges'
import { useFleetSummaries } from './useFleetSummaries'
import { loadProjectsData } from './projects'
import { displaySessionName } from './displayName'
import { loadWorkbenchContext, saveWorkbenchContext } from './workbenchContext'
import { PENDING_SELECT_KEY } from './constants'
import type { ProjectsData, UiEvent } from './types'

const SIDEBAR_KEY = 'cao:workspace:sidebar-collapsed'
const RPANEL_KEY = 'cao:workspace:rpanel-collapsed'

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v === 'true'
  } catch {
    return fallback
  }
}

function saveBool(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // Layout preference persistence is best-effort.
  }
}

type WbTab = 'term' | 'output' | 'inbox' | 'logs'

interface PendingAction {
  id: string
  name: string | null
}

interface WorkspaceProps {
  /** Shared `/ui/events` ring, owned by AppShell (above the rail's view switch) so it survives menu navigation — see useUiEventStream.ts. */
  events: UiEvent[]
  status: UiConnectionStatus
  /** Also owned by AppShell for the same reason: a plain local state here would reset to null every time this component remounts on rail navigation. */
  selectedSessionId: string | null
  setSelectedSessionId: (id: string | null) => void
}

/** Top-level Orchestration Workspace (spec Phase 2b): project/group sidebar + Thread + Composer + Agent panel + Workbench, receiving the one shared `/ui/events` stream (and the selected session) as props from AppShell. */
export function Workspace({ events, status: streamStatus, selectedSessionId, setSelectedSessionId }: WorkspaceProps) {
  const sessions = useStore(s => s.sessions)
  const fetchSessions = useStore(s => s.fetchSessions)
  const showSnackbar = useStore(s => s.showSnackbar)
  const showOverlay = useStore(s => s.showOverlay)
  const hideOverlay = useStore(s => s.hideOverlay)
  const fleet = useFleetSummaries(sessions)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadBool(SIDEBAR_KEY, false))
  const [rpanelCollapsed, setRpanelCollapsed] = useState(() => loadBool(RPANEL_KEY, false))

  const [newTaskState, setNewTaskState] = useState<{ projects: ProjectsData; prefill?: { targetPath?: string; targetLabel?: string } } | null>(null)

  // Command Palette / NotificationCenter seam (AppShell dispatches; Workspace
  // owns the state): 'cao:open-new-task' opens the New Task modal,
  // 'cao:select-session' jumps straight into a session's thread. When the
  // event fires while another view is mounted, AppShell stashes the session
  // name (PENDING_SELECT_KEY) and switches views — consume it here on mount so
  // the selection isn't lost to the unmount gap.
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_SELECT_KEY)
    if (pending) {
      sessionStorage.removeItem(PENDING_SELECT_KEY)
      setSelectedSessionId(pending)
    }
    const openNewTask = () => setNewTaskState({ projects: loadProjectsData() })
    const selectSession = (e: Event) => {
      const name = (e as CustomEvent<string>).detail
      if (name) setSelectedSessionId(name)
    }
    window.addEventListener('cao:open-new-task', openNewTask)
    window.addEventListener('cao:select-session', selectSession)
    return () => {
      window.removeEventListener('cao:open-new-task', openNewTask)
      window.removeEventListener('cao:select-session', selectSession)
    }
  }, [])
  const [workbenchRequest, setWorkbenchRequest] = useState<{ terminalId: string; tab: WbTab; nonce: number }>({ terminalId: '', tab: 'term', nonce: 0 })

  const [pendingStop, setPendingStop] = useState<PendingAction | null>(null)
  const [stopping, setStopping] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingAction | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingEndSession, setPendingEndSession] = useState(false)
  const [endingSession, setEndingSession] = useState(false)

  // Default to the first known session; drop the selection if it disappears.
  useEffect(() => {
    if (selectedSessionId && sessions.some(s => s.id === selectedSessionId)) return
    setSelectedSessionId(sessions[0]?.id ?? null)
  }, [sessions, selectedSessionId])

  const workspaceSession = useWorkspaceSession(selectedSessionId, events)
  useWorkspaceAlerts(workspaceSession.cards, workspaceSession.terminalStatuses, selectedSessionId)

  // Phase 2d (spec §2d): one gauge-poll owner per session, shared by the
  // Workbench header and every AgentSidePanel row (see useContextGauges.ts).
  const gaugeTerminals = useMemo(
    () => workspaceSession.terminals.map(t => ({ id: t.id, provider: t.provider, label: t.agent_profile })),
    [workspaceSession.terminals],
  )
  const gauges = useContextGauges(gaugeTerminals, workspaceSession.terminalStatuses, selectedSessionId)

  const openInWorkbench = (terminalId: string, tab: WbTab) => {
    setWorkbenchRequest(current => ({ terminalId, tab, nonce: current.nonce + 1 }))
    if (selectedSessionId) saveWorkbenchContext(selectedSessionId, { terminalId, tab })
  }

  // Feedback #14: remember which terminal/tab the Workbench was pointed at
  // per session, and restore it (or default to the session's own supervisor
  // terminal) exactly once per session switch — guarded by a ref (not state)
  // so this doesn't fight a later manual terminal switch within the same
  // session every time the 4s terminal-list poll produces a new array
  // reference. Intentionally only updates `.terminalId`/`.tab`, never
  // `.nonce` — that field is reserved for explicit "open the dock" requests
  // (Thread/AgentSidePanel buttons), so a session switch quietly re-points
  // the context (the Terminal tab reconnects via Workbench's own
  // `key={contextTerminalId}` if it's already open) without popping a
  // collapsed dock open on its own.
  const restoredWorkbenchSessionRef = useRef<string | null>(null)
  const workbenchSessionRef = useRef<string | null>(null)
  useEffect(() => {
    // `useWorkspaceSession` starts its new-session poll in an effect too, so
    // this effect can briefly observe the previous session's terminal list (or
    // an empty initial list) while `loading` is still false. Clear the stale
    // context immediately, but do not mark restoration complete until a
    // terminal that actually belongs to the selected session is available.
    if (workbenchSessionRef.current !== selectedSessionId) {
      workbenchSessionRef.current = selectedSessionId
      restoredWorkbenchSessionRef.current = null
      setWorkbenchRequest(current => ({ ...current, terminalId: '' }))
    }
    if (!selectedSessionId || workspaceSession.loading) return
    if (restoredWorkbenchSessionRef.current === selectedSessionId) return

    const sessionTerminals = workspaceSession.terminals.filter(t => t.tmux_session === selectedSessionId)
    const stored = loadWorkbenchContext(selectedSessionId)
    const storedStillPresent = !!stored && sessionTerminals.some(t => t.id === stored.terminalId)
    const resolvedId = storedStillPresent ? stored!.terminalId : sessionTerminals[0]?.id
    if (!resolvedId) return
    restoredWorkbenchSessionRef.current = selectedSessionId
    setWorkbenchRequest(current => ({
      ...current,
      terminalId: resolvedId,
      tab: storedStillPresent ? stored!.tab : current.tab,
    }))
  }, [selectedSessionId, workspaceSession.loading, workspaceSession.terminals, workspaceSession.supervisorTerminalId])

  const composerTargets: ComposerTarget[] = useMemo(
    () =>
      workspaceSession.terminals.map((t, index) => ({
        id: t.id,
        label: index === 0 ? `${t.agent_profile ?? '오케스트레이터'} · 오케스트레이터` : t.agent_profile ?? t.id.slice(0, 8),
        provider: t.provider,
      })),
    [workspaceSession.terminals],
  )
  const composerTarget = composerTargets.find(t => t.id === workspaceSession.composerTargetId) ?? null

  const activeSession = sessions.find(s => s.id === selectedSessionId) ?? null

  const wbContext = workspaceSession.terminals.find(t => t.id === workbenchRequest.terminalId)
  const wbCard = workspaceSession.cards.find(c => c.terminalId === workbenchRequest.terminalId)
  // Session's own (supervisor terminal's) working directory — shared by the
  // AgentSidePanel's [+] modal prefill and (Phase 2e) the Composer's
  // slash-command project-scope scan.
  const sessionWorkingDirectory = workspaceSession.locations[workspaceSession.supervisorTerminalId ?? ''] ?? null

  const handleConfirmStop = async () => {
    if (!pendingStop) return
    setStopping(true)
    try {
      await api.exitTerminal(pendingStop.id)
      showSnackbar({ type: 'success', message: `${pendingStop.name ?? pendingStop.id}에 정상 종료 명령을 보냈어요` })
    } catch {
      showSnackbar({ type: 'error', message: '종료 명령을 보내지 못했어요' })
    }
    setStopping(false)
    setPendingStop(null)
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deleteTerminal(pendingDelete.id)
      showSnackbar({ type: 'success', message: '터미널을 삭제했어요' })
    } catch {
      showSnackbar({ type: 'error', message: '터미널을 삭제하지 못했어요' })
    }
    setDeleting(false)
    setPendingDelete(null)
  }

  // Feedback #3: this used to route through the store's `deleteSession`
  // action, the one confirm-flow in this file NOT calling its api.ts
  // function directly (handleConfirmStop/handleConfirmDelete both do) — that
  // extra hop also depended on the store's own (never-synced-by-Workspace)
  // `activeSession` field to decide whether to clear anything, so the
  // "clear selection" half of the contract only ever happened *indirectly*,
  // via the effect above reacting to the next `fetchSessions()` tick. Made
  // self-contained + deterministic to match its siblings: call the DELETE
  // endpoint directly, surface the server's own `detail` on failure, and
  // clear the selection immediately on success instead of waiting on a
  // side-effect chain.
  const handleConfirmEndSession = async () => {
    if (!selectedSessionId) return
    setEndingSession(true)
    showOverlay('세션을 정리하고 있어요')
    try {
      await api.deleteSession(selectedSessionId)
      showSnackbar({ type: 'success', message: `${displaySessionName(selectedSessionId)} 세션을 종료했어요` })
      setSelectedSessionId(null)
      await fetchSessions()
    } catch (error: unknown) {
      const err = error as { detail?: string; message?: string }
      showSnackbar({ type: 'error', message: err?.detail || err?.message || '세션을 종료하지 못했어요' })
    } finally {
      setEndingSession(false)
      setPendingEndSession(false)
      hideOverlay()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <button
          type="button"
          onClick={() => {
            const next = !sidebarCollapsed
            setSidebarCollapsed(next)
            saveBool(SIDEBAR_KEY, next)
          }}
          title="사이드바 열기/접기"
          aria-label="사이드바 열기/접기"
          className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        >
          <SidebarIcon size={15} />
        </button>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-[var(--text)]">
          <Blocks size={13} className="shrink-0 text-[var(--text-3)]" />
          {activeSession ? displaySessionName(activeSession.name) : '세션을 선택하세요'}
        </span>
        <span
          className={`ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold ${
            streamStatus === 'connected' ? 'bg-[var(--success-bg)] text-[var(--success)]' : 'bg-[var(--warning-bg)] text-[var(--warning)]'
          }`}
        >
          {streamStatus === 'connected' ? <Wifi size={11} /> : <WifiOff size={11} />}
          {streamStatus === 'connected' ? '이벤트 연결됨' : streamStatus === 'connecting' ? '이벤트 연결 중' : '이벤트 끊김'}
        </span>
        <button
          type="button"
          onClick={() => setNewTaskState({ projects: loadProjectsData() })}
          className="flex h-7 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-xs font-bold text-[var(--on-accent)]"
        >
          <Plus size={13} />새 작업
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !rpanelCollapsed
            setRpanelCollapsed(next)
            saveBool(RPANEL_KEY, next)
          }}
          title="에이전트 패널 열기/접기"
          aria-label="에이전트 패널 열기/접기"
          className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        >
          <Users size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => {
            setSidebarCollapsed(true)
            saveBool(SIDEBAR_KEY, true)
          }}
          activeSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
          onNewTask={prefill => setNewTaskState({ projects: loadProjectsData(), prefill })}
          sessionSummaries={fleet.summaries}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {selectedSessionId ? (
            <>
              <Thread
                sessionName={selectedSessionId}
                loading={workspaceSession.loading}
                threadItems={workspaceSession.threadItems}
                connectionStatus={streamStatus}
                terminalStatuses={workspaceSession.terminalStatuses}
                onOpenTerminal={id => openInWorkbench(id, 'term')}
                onOpenOutput={id => openInWorkbench(id, 'output')}
                onOpenLogs={() => openInWorkbench(workspaceSession.supervisorTerminalId ?? '', 'logs')}
                onRequestStop={(id, name) => setPendingStop({ id, name })}
                onMessageTarget={id => workspaceSession.setComposerTarget(id)}
                onRequestStatusCheck={workspaceSession.requestStatusCheck}
              />
              <Composer
                sessionName={selectedSessionId}
                target={composerTarget}
                targets={composerTargets}
                onChangeTarget={workspaceSession.setComposerTarget}
                onSend={workspaceSession.sendMessage}
                sending={workspaceSession.sending}
                streamDisconnected={streamStatus !== 'connected'}
                slashProvider={composerTarget?.provider ?? null}
                slashCwd={sessionWorkingDirectory}
              />
            </>
          ) : (
            // Phase 2c spec §1: no session selected = the fleet overview, not a bare placeholder.
            <Overview
              onSelectSession={setSelectedSessionId}
              onNewTask={() => setNewTaskState({ projects: loadProjectsData() })}
              summariesOverride={fleet}
            />
          )}
        </div>

        <AgentSidePanel
          collapsed={rpanelCollapsed}
          sessionName={selectedSessionId}
          terminals={workspaceSession.terminals}
          cards={workspaceSession.cards}
          teamRoster={workspaceSession.teamRoster}
          terminalStatuses={workspaceSession.terminalStatuses}
          sessionWorkingDirectory={sessionWorkingDirectory}
          gauges={gauges}
          onMessageTarget={id => workspaceSession.setComposerTarget(id)}
          onOpenTerminal={id => openInWorkbench(id, 'term')}
          onOpenOutput={id => openInWorkbench(id, 'output')}
          onOpenInbox={id => openInWorkbench(id, 'inbox')}
          onRequestStop={(id, name) => setPendingStop({ id, name })}
          onRequestDelete={(id, name) => setPendingDelete({ id, name })}
          onRequestEndSession={() => setPendingEndSession(true)}
          onAgentAdded={() => {
            void workspaceSession.refreshTerminals()
          }}
        />
      </div>

      <Workbench
        events={events}
        contextTerminalId={workbenchRequest.terminalId || null}
        contextLabel={wbContext?.agent_profile ?? wbCard?.agentName ?? null}
        contextProvider={wbContext?.provider ?? wbCard?.provider ?? null}
        contextPercentLeft={workbenchRequest.terminalId ? gauges[workbenchRequest.terminalId] ?? null : null}
        requestedTab={workbenchRequest.terminalId ? workbenchRequest.tab : null}
        requestNonce={workbenchRequest.nonce}
      />

      {newTaskState && (
        <NewTaskModal
          projects={newTaskState.projects}
          defaultTarget={newTaskState.prefill}
          onClose={() => setNewTaskState(null)}
          onCreated={sessionId => setSelectedSessionId(sessionId)}
        />
      )}

      <ConfirmModal
        open={!!pendingStop}
        title="에이전트 중지"
        message="제공자별 정상 종료 명령을 보냅니다."
        details={pendingStop ? [{ label: '터미널', value: `${pendingStop.name ?? '기본값'} (${pendingStop.id})` }] : []}
        confirmLabel="중지"
        variant="warning"
        loading={stopping}
        onConfirm={handleConfirmStop}
        onCancel={() => setPendingStop(null)}
      />

      <ConfirmModal
        open={!!pendingDelete}
        title="터미널 삭제"
        message="tmux 창을 닫고 에이전트 프로세스를 종료합니다. 되돌릴 수 없어요."
        details={pendingDelete ? [{ label: '터미널', value: `${pendingDelete.name ?? '기본값'} (${pendingDelete.id})` }] : []}
        confirmLabel="삭제"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmModal
        open={pendingEndSession}
        title="세션 종료"
        message="이 세션의 모든 에이전트를 종료하고 세션을 삭제합니다."
        details={activeSession ? [{ label: '세션', value: displaySessionName(activeSession.name) }] : []}
        confirmLabel="세션 종료"
        variant="danger"
        loading={endingSession}
        onConfirm={handleConfirmEndSession}
        onCancel={() => setPendingEndSession(false)}
      />
    </div>
  )
}
