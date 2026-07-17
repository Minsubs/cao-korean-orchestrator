import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, BellOff, CheckCircle2, X, XCircle } from 'lucide-react'
import { api, Session } from '../api'
import { useStore } from '../store'

const ENABLED_KEY = 'cao:notifications:enabled'
const ALERTS_KEY = 'cao:notifications:history:v1'

type AlertKind = 'completed' | 'approval' | 'error'

interface AgentAlert {
  kind: AlertKind
  title: string
  body: string
}

interface StoredAlert extends AgentAlert {
  id: string
  terminalId: string
  createdAt: string
  read: boolean
}

function normalizeStatus(status: string | null): string {
  return (status || 'unknown').toLowerCase()
}

/** Return an alert only for actionable status transitions. */
export function alertForStatusTransition(
  sessionName: string,
  previousStatus: string | undefined,
  currentStatus: string | null,
): AgentAlert | null {
  const previous = previousStatus ? normalizeStatus(previousStatus) : undefined
  const current = normalizeStatus(currentStatus)

  if (current === 'waiting_user_answer' && previous !== current) {
    return {
      kind: 'approval',
      title: '승인 또는 응답이 필요합니다',
      body: `${sessionName} 오케스트레이터가 사용자의 입력을 기다리고 있습니다.`,
    }
  }

  if (previous === 'processing' && ['completed', 'idle'].includes(current)) {
    return {
      kind: 'completed',
      title: '작업이 완료되었습니다',
      body: `${sessionName} 오케스트레이터의 작업이 끝났습니다.`,
    }
  }

  if (previous === 'processing' && current === 'error') {
    return {
      kind: 'error',
      title: '작업 중 오류가 발생했습니다',
      body: `${sessionName} 오케스트레이터 상태를 확인해 주세요.`,
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
      && ['completed', 'approval', 'error'].includes(alert?.kind)
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
  if (kind === 'completed') return <CheckCircle2 size={16} className="text-emerald-400" />
  if (kind === 'approval') return <AlertTriangle size={16} className="text-amber-400" />
  return <XCircle size={16} className="text-red-400" />
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

  const emitAlert = (alert: AgentAlert, terminalId: string) => {
    const storedAlert: StoredAlert = {
      ...alert,
      id: `${terminalId}-${alert.kind}-${Date.now()}`,
      terminalId,
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

        void api.getTerminalStatus(orchestrator.id)
          .then(currentStatus => {
            if (cancelled) return
            const previousStatus = statuses.current[orchestrator.id]
            const normalized = normalizeStatus(currentStatus)
            statuses.current[orchestrator.id] = normalized

            // A currently waiting approval is actionable even on the first read.
            // Completion/error alerts require a real transition to avoid noise on load.
            const alert = alertForStatusTransition(sessions[index].name, previousStatus, currentStatus)
            if (alert && (previousStatus !== undefined || alert.kind === 'approval')) {
              emitAlert(alert, orchestrator.id)
            }
          })
          .catch(() => {})
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
            ? 'border-emerald-700/60 bg-emerald-950/50 text-emerald-300'
            : 'border-gray-700 bg-gray-800/60 text-gray-300 hover:text-white hover:border-gray-600'
        }`}
        title="작업 완료와 승인 요청 알림 내역"
        aria-label={open ? '알림 센터 닫기' : '알림 센터 열기'}
        aria-expanded={open}
      >
        <Bell size={15} />
        <span>알림</span>
        {unreadCount > 0 && (
          <span className="min-w-4 h-4 px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {enabled && unreadCount === 0 && <span className="w-2 h-2 rounded-full bg-emerald-400" title="시스템 알림 켜짐" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="알림 센터"
          className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700/70 rounded-xl shadow-2xl overflow-hidden z-[90]"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/60">
            <div>
              <h2 className="text-sm font-semibold text-white">알림 센터</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">완료, 승인 요청, 오류 내역을 보관합니다.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800"
              aria-label="알림 센터 닫기"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-950/50 border-b border-gray-800">
            <div className="flex items-center gap-2 min-w-0">
              {enabled ? <Bell size={14} className="text-emerald-400 shrink-0" /> : <BellOff size={14} className={blocked ? 'text-red-400 shrink-0' : 'text-gray-500 shrink-0'} />}
              <div className="min-w-0">
                <p className="text-xs text-gray-300">시스템 알림 {enabled ? '켜짐' : blocked ? '차단됨' : '꺼짐'}</p>
                <p className="text-[10px] text-gray-600 truncate">앱 내 알림 내역은 항상 저장됩니다.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void toggleNotifications()}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                enabled
                  ? 'border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800'
                  : blocked
                    ? 'border-red-900/60 text-red-400 hover:bg-red-950/30'
                    : 'border-emerald-800/60 text-emerald-400 hover:bg-emerald-950/40'
              }`}
            >
              {enabled ? '시스템 알림 끄기' : blocked ? '권한 확인' : '시스템 알림 켜기'}
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <Bell size={24} className="text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-gray-400">아직 알림이 없습니다.</p>
                <p className="text-[11px] text-gray-600 mt-1">작업이 완료되거나 승인이 필요하면 여기에 표시됩니다.</p>
              </div>
            ) : alerts.map(alert => (
              <div key={alert.id} className="flex gap-3 px-4 py-3 border-b border-gray-800/70 last:border-b-0 bg-gray-900">
                <div className="mt-0.5 shrink-0">{alertIcon(alert.kind)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-200">{alert.title}</p>
                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{alert.body}</p>
                  <p className="text-[10px] text-gray-600 mt-1.5">
                    {new Date(alert.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
