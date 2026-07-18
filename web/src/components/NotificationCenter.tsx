import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, BellOff, CheckCircle2, Clock, X, XCircle } from 'lucide-react'
import { api, Session } from '../api'
import { useStore } from '../store'
import { displaySessionName } from '../features/workspace/displayName'
import { profileLabel } from '../features/profiles/profilePresentation'

const ENABLED_KEY = 'cao:notifications:enabled'
const ALERTS_KEY = 'cao:notifications:history:v1'

// 'waiting_input'/'stall' are the Phase 2b Orchestration Workspace additions
// (spec §7): a per-terminal "needs your attention" ping (any terminal, not
// just the session's orchestrator) and a stall-detected ping. Both fold into
// this same store/localStorage schema — additive only, existing 'completed'
// | 'approval' | 'error' alerts and their stored shape are unchanged.
type AlertKind = 'completed' | 'approval' | 'error' | 'waiting_input' | 'stall'
const KNOWN_ALERT_KINDS: AlertKind[] = ['completed', 'approval', 'error', 'waiting_input', 'stall']

interface AgentAlert {
  kind: AlertKind
  title: string
  body: string
}

interface StoredAlert extends AgentAlert {
  id: string
  terminalId: string
  /**
   * Session this alert is about (feedback #17) — lets the notification
   * center offer a "jump to this session" click. Optional so the existing
   * localStorage schema (and any alert already stored before this field
   * existed) stays valid: an alert with no `sessionName` just renders
   * non-clickable with an explanatory title instead of guessing.
   */
  sessionName?: string
  /** Exact profile/agent that produced the alert; absent in older v1 history. */
  agentName?: string
  createdAt: string
  read: boolean
}

/** One listener per mounted NotificationCenter (normally exactly one, in AppShell's top bar). */
type WorkspaceAlertListener = (alert: AgentAlert, terminalId: string, sessionName?: string, agentName?: string) => void
const workspaceAlertListeners = new Set<WorkspaceAlertListener>()

/**
 * Entry point for the Orchestration Workspace feature (features/workspace/**)
 * to raise a 'waiting_input' or 'stall' alert without importing React state
 * from this component. Safe to call even if no NotificationCenter is mounted
 * (the alert is simply dropped — same as any notification with nobody home).
 * `sessionName` is optional (trailing param) so every existing call site —
 * including this module's own tests — keeps compiling unchanged; omitting it
 * just means that alert won't be clickable (see `sessionName` docstring above).
 */
export function emitWorkspaceAlert(kind: AlertKind, title: string, body: string, terminalId: string, sessionName?: string, agentName?: string): void {
  workspaceAlertListeners.forEach(listener => listener({ kind, title, body }, terminalId, sessionName, agentName))
}

function normalizeStatus(status: string | null | undefined): string {
  return (status || 'unknown').toLowerCase()
}

/** Return an alert only for actionable status transitions. */
export function alertForStatusTransition(
  sessionName: string,
  agentName: string,
  previousStatus: string | undefined,
  currentStatus: string | null,
): AgentAlert | null {
  const previous = previousStatus ? normalizeStatus(previousStatus) : undefined
  const current = normalizeStatus(currentStatus)
  const agentLabel = profileLabel(agentName)
  const context = `${displaySessionName(sessionName)} · ${agentLabel}`

  if (current === 'waiting_user_answer' && previous !== current) {
    return {
      kind: 'approval',
      title: `${context} 입력 필요`,
      body: `${agentLabel}가 사용자의 승인 또는 응답을 기다리고 있습니다.`,
    }
  }

  if (previous === 'processing' && ['completed', 'idle'].includes(current)) {
    return {
      kind: 'completed',
      title: `${context} 작업 완료`,
      body: `${agentLabel}의 작업이 끝났습니다.`,
    }
  }

  if (previous === 'processing' && current === 'error') {
    return {
      kind: 'error',
      title: `${context} 작업 오류`,
      body: `${agentLabel}의 상태를 확인해 주세요.`,
    }
  }

  return null
}

function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function initialEnabled(): boolean {
  if (!notificationsSupported()) return false
  return window.localStorage.getItem(ENABLED_KEY) === 'true' && Notification.permission === 'granted'
}

function loadStoredAlerts(): StoredAlert[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ALERTS_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((alert: any) => (
      typeof alert?.id === 'string'
      && KNOWN_ALERT_KINDS.includes(alert?.kind)
      && typeof alert?.title === 'string'
      && typeof alert?.body === 'string'
      && typeof alert?.terminalId === 'string'
      && typeof alert?.createdAt === 'string'
      && typeof alert?.read === 'boolean'
    )).slice(0, 30)
  } catch {
    return []
  }
}

function alertIcon(kind: AlertKind) {
  if (kind === 'completed') return <CheckCircle2 size={16} className="text-[var(--success)]" />
  if (kind === 'approval' || kind === 'waiting_input') return <AlertTriangle size={16} className="text-[var(--warning)]" />
  if (kind === 'stall') return <Clock size={16} className="text-[var(--warning)]" />
  return <XCircle size={16} className="text-[var(--danger)]" />
}

export function NotificationCenter({ sessions }: { sessions: Session[] }) {
  const { showSnackbar } = useStore()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<StoredAlert[]>(loadStoredAlerts)
  const [permission, setPermission] = useState<NotificationPermission>(() => (
    notificationsSupported() ? Notification.permission : 'denied'
  ))
  const statuses = useRef<Record<string, string>>({})

  const emitAlert = (alert: AgentAlert, terminalId: string, sessionName?: string, agentName?: string) => {
    const storedAlert: StoredAlert = {
      ...alert,
      id: `${terminalId}-${alert.kind}-${Date.now()}`,
      terminalId,
      sessionName,
      agentName,
      createdAt: new Date().toISOString(),
      read: false,
    }
    setAlerts(current => [storedAlert, ...current].slice(0, 30))
    showSnackbar({
      type: alert.kind === 'error' ? 'error' : alert.kind === 'completed' ? 'success' : 'info',
      message: `${alert.title} · ${alert.body}`,
    })

    if (!enabled || !notificationsSupported() || Notification.permission !== 'granted') return
    const notification = new Notification(alert.title, {
      body: alert.body,
      tag: `cao-${terminalId}-${alert.kind}`,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }

  // `emitAlert` closes over `enabled`/`showSnackbar` and is redefined every
  // render — keep a ref so the module-level listener set (which subscribes
  // once) always calls the latest version, never a stale closure.
  const emitAlertRef = useRef(emitAlert)
  emitAlertRef.current = emitAlert

  useEffect(() => {
    const listener: WorkspaceAlertListener = (alert, terminalId, sessionName, agentName) => emitAlertRef.current(alert, terminalId, sessionName, agentName)
    workspaceAlertListeners.add(listener)
    return () => {
      workspaceAlertListeners.delete(listener)
    }
  }, [])

  // Feedback #17: click an alert to jump straight to its session. Workspace.tsx
  // already listens for this exact event (Command Palette "select session"
  // seam) and switches its own selected session — but that listener only
  // exists inside the Workspace *view*; if the user is on a different rail
  // item (Profiles/Tooling/...) when they click, nothing visibly happens
  // until they switch back. AppShell.tsx (view-switching) is out of this
  // change's ownership — flagged in the handoff report, not fixed here.
  const goToSession = (sessionName: string) => {
    window.dispatchEvent(new CustomEvent('cao:select-session', { detail: sessionName }))
    setOpen(false)
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts))
    } catch {
      // The live notification center remains usable when storage is unavailable.
    }
  }, [alerts])

  useEffect(() => {
    if (!open) return
    setAlerts(current => current.some(alert => !alert.read)
      ? current.map(alert => ({ ...alert, read: true }))
      : current)
  }, [open])

  useEffect(() => {
    if (sessions.length === 0) return

    let cancelled = false

    const poll = async () => {
      const details = await Promise.allSettled(sessions.map(session => api.getSession(session.id)))
      if (cancelled) return

      details.forEach((result, index) => {
        if (result.status !== 'fulfilled') return
        const orchestrator = result.value.terminals[0]
        if (!orchestrator) return
        const currentStatus = normalizeStatus(orchestrator.status)
        const previousStatus = statuses.current[orchestrator.id]
        statuses.current[orchestrator.id] = currentStatus
        const agentName = orchestrator.agent_profile || '오케스트레이터'

        // A currently waiting approval is actionable even on the first read.
        // Completion/error alerts require a real aggregate transition to avoid noise on load.
        const alert = alertForStatusTransition(sessions[index].name, agentName, previousStatus, currentStatus)
        if (alert && (previousStatus !== undefined || alert.kind === 'approval')) {
          emitAlert(alert, orchestrator.id, sessions[index].name, agentName)
        }
      })
    }

    void poll()
    const interval = window.setInterval(poll, 3000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [enabled, sessions.map(session => session.id).join(',')])

  const toggleNotifications = async () => {
    if (enabled) {
      window.localStorage.setItem(ENABLED_KEY, 'false')
      setEnabled(false)
      showSnackbar({ type: 'info', message: '작업 알림을 껐습니다.' })
      return
    }

    if (!notificationsSupported()) {
      showSnackbar({ type: 'error', message: '이 브라우저는 시스템 알림을 지원하지 않습니다.' })
      return
    }

    let nextPermission = Notification.permission
    if (nextPermission === 'default') nextPermission = await Notification.requestPermission()
    setPermission(nextPermission)

    if (nextPermission !== 'granted') {
      showSnackbar({ type: 'error', message: '브라우저 설정에서 이 사이트의 알림 권한을 허용해 주세요.' })
      return
    }

    window.localStorage.setItem(ENABLED_KEY, 'true')
    setEnabled(true)
    showSnackbar({ type: 'success', message: '작업 완료 및 승인 요청 알림을 켰습니다.' })
  }

  const blocked = permission === 'denied'
  const unreadCount = alerts.filter(alert => !alert.read).length

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
          open
            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
            : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--text)]'
        }`}
        title="작업 완료와 승인 요청 알림 내역"
        aria-label={open ? '알림 센터 닫기' : '알림 센터 열기'}
        aria-expanded={open}
      >
        <Bell size={15} />
        <span>알림</span>
        {unreadCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-[var(--on-accent)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {enabled && unreadCount === 0 && <span className="h-2 w-2 rounded-full bg-[var(--success)]" title="시스템 알림 켜짐" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="알림 센터"
          className="absolute right-0 top-full z-[90] mt-2 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">알림 센터</h2>
              <p className="mt-0.5 text-[11px] text-[var(--text-3)]">완료, 승인 요청, 오류 내역을 보관합니다.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              aria-label="알림 센터 닫기"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[var(--surface-2)] px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              {enabled ? <Bell size={14} className="shrink-0 text-[var(--success)]" /> : <BellOff size={14} className={blocked ? 'shrink-0 text-[var(--danger)]' : 'shrink-0 text-[var(--text-3)]'} />}
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-2)]">시스템 알림 {enabled ? '켜짐' : blocked ? '차단됨' : '꺼짐'}</p>
                <p className="truncate text-[10px] text-[var(--text-3)]">앱 내 알림 내역은 항상 저장됩니다.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void toggleNotifications()}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                enabled
                  ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
                  : blocked
                    ? 'border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)] hover:brightness-95'
                    : 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)] hover:brightness-95'
              }`}
            >
              {enabled ? '시스템 알림 끄기' : blocked ? '권한 확인' : '시스템 알림 켜기'}
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <Bell size={24} className="mx-auto mb-2 text-[var(--text-3)]" />
                <p className="text-sm text-[var(--text-2)]">아직 알림이 없습니다.</p>
                <p className="mt-1 text-[11px] text-[var(--text-3)]">작업이 완료되거나 승인이 필요하면 여기에 표시됩니다.</p>
              </div>
            ) : alerts.map(alert => {
              const clickable = !!alert.sessionName
              const agentName = alert.agentName || (['completed', 'approval', 'error'].includes(alert.kind) ? '오케스트레이터' : undefined)
              const context = [
                alert.sessionName ? displaySessionName(alert.sessionName) : null,
                agentName ? profileLabel(agentName) : null,
              ].filter(Boolean).join(' · ')
              const displayTitle = context && alert.title.startsWith(`${context} `)
                ? alert.title.slice(context.length + 1)
                : alert.title
              return (
                <div
                  key={alert.id}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => goToSession(alert.sessionName!) : undefined}
                  onKeyDown={
                    clickable
                      ? e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            goToSession(alert.sessionName!)
                          }
                        }
                      : undefined
                  }
                  title={clickable ? `${displaySessionName(alert.sessionName!)} 세션으로 이동` : '이 알림은 세션 정보가 없어 이동할 수 없어요'}
                  aria-label={clickable ? `${displaySessionName(alert.sessionName!)} 세션으로 이동 — ${alert.title}` : undefined}
                  className={`flex gap-3 border-b border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 last:border-b-0 ${
                    clickable ? 'cursor-pointer hover:bg-[var(--surface-2)]' : 'cursor-default'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{alertIcon(alert.kind)}</div>
                  <div className="min-w-0 flex-1">
                    {context && <p className="mb-1 text-[10px] font-medium text-[var(--accent-text)]">{context}</p>}
                    <p className="text-xs font-medium text-[var(--text)]">{displayTitle}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-2)]">{alert.body}</p>
                    <p className="mt-1.5 text-[10px] text-[var(--text-3)]">
                      {new Date(alert.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {!clickable && ' · 세션 이동 불가'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
