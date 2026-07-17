import { useCallback, useEffect, useRef, useState } from 'react'
import {
  toolingApi,
  type ApiError,
  type ToolingAdapter,
  type ToolingExecutionPlan,
  type ToolingOperation,
  type ToolingOperationStatus,
  type ToolingPlanRequest,
} from '../../api.tooling'
import { IN_PROGRESS_STATUSES } from './shared'

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error' | 'executing'

export interface PreviewState {
  status: PreviewStatus
  request: ToolingPlanRequest | null
  plan: ToolingExecutionPlan | null
  /** Set on a plan fetch failure (status='error') or an execute failure (status stays 'ready'). */
  error: string | null
}

const IDLE_PREVIEW: PreviewState = { status: 'idle', request: null, plan: null, error: null }

function describeError(err: unknown, fallback: string): string {
  const apiErr = err as ApiError
  return apiErr?.detail || apiErr?.message || fallback
}

/**
 * Owns every piece of Phase 4b write-path state that has to survive a tab
 * switch inside ToolingView: adapters, the Operation Queue + its 2s
 * conditional poll, and the Preview-modal plan/execute flow (shared by both
 * the Updates tab's Skill 관리 controls and the Installed tab's detail
 * buttons — see ui-refactor-plan/phase4b spec "설치됨 탭 상세 연결").
 *
 * Deliberately lives above both panes (in ToolingView) rather than inside
 * UpdatesPane: the "업데이트 탭 라벨에 스피너/배지" requirement needs
 * operation-in-progress state even while a *different* sub-tab is active.
 *
 * Availability stance matches api.tooling.ts: adapters/operations endpoints
 * can independently 404 (Phase 4a landing in parallel). A failure here
 * degrades only the write-path controls (disabled + honest reason) — it
 * never crashes the read-only Overview/Installed/Diagnostics tabs, and the
 * poll simply stops rather than retry-storming a dead endpoint.
 */
export function useToolingOperations(onOperationFinished: () => void) {
  const [adapters, setAdapters] = useState<ToolingAdapter[]>([])
  const [adaptersLoading, setAdaptersLoading] = useState(true)
  const [adaptersError, setAdaptersError] = useState(false)

  const [operations, setOperations] = useState<ToolingOperation[]>([])
  const [operationsError, setOperationsError] = useState(false)

  const [preview, setPreview] = useState<PreviewState>(IDLE_PREVIEW)

  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [logLoading, setLogLoading] = useState<Record<string, boolean>>({})
  const [logError, setLogError] = useState<Record<string, boolean>>({})

  const mountedRef = useRef(true)
  const prevStatusRef = useRef<Map<string, ToolingOperationStatus>>(new Map())
  const lastKnownOpsRef = useRef<ToolingOperation[]>([])
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onOperationFinishedRef = useRef(onOperationFinished)
  onOperationFinishedRef.current = onOperationFinished

  useEffect(
    () => () => {
      mountedRef.current = false
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    },
    [],
  )

  const loadAdapters = useCallback(async () => {
    setAdaptersLoading(true)
    try {
      const list = await toolingApi.listAdapters()
      if (!mountedRef.current) return
      setAdapters(list)
      setAdaptersError(false)
    } catch {
      if (!mountedRef.current) return
      setAdapters([])
      setAdaptersError(true)
    } finally {
      if (mountedRef.current) setAdaptersLoading(false)
    }
  }, [])

  const refreshOperations = useCallback(async (): Promise<ToolingOperation[]> => {
    try {
      const ops = await toolingApi.listOperations()
      const prevMap = prevStatusRef.current
      // "완료 후 재검증": a transition out of an in-progress status into any
      // terminal one (succeeded/failed/cancelled/partially_succeeded) means
      // the extension/diagnostics snapshot the rest of the screen is holding
      // may now be stale.
      const justFinished = ops.some(o => {
        const prev = prevMap.get(o.id)
        return prev !== undefined && IN_PROGRESS_STATUSES.has(prev) && !IN_PROGRESS_STATUSES.has(o.status)
      })
      prevStatusRef.current = new Map(ops.map(o => [o.id, o.status]))
      lastKnownOpsRef.current = ops
      if (mountedRef.current) {
        setOperations(ops)
        setOperationsError(false)
        if (justFinished) onOperationFinishedRef.current()
      }
      return ops
    } catch {
      if (mountedRef.current) setOperationsError(true)
      // Keep polling on the last known state rather than assuming everything
      // finished just because one poll tick failed on the network.
      return lastKnownOpsRef.current
    }
  }, [])

  const scheduleNextPoll = useCallback(
    (ops: ToolingOperation[]) => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
      if (!mountedRef.current) return
      if (!ops.some(o => IN_PROGRESS_STATUSES.has(o.status))) return
      pollTimerRef.current = setTimeout(async () => {
        pollTimerRef.current = null
        const next = await refreshOperations()
        scheduleNextPoll(next)
      }, 2000)
    },
    [refreshOperations],
  )

  useEffect(() => {
    loadAdapters()
    refreshOperations().then(ops => scheduleNextPoll(ops))
    // Mount-once: loadAdapters/refreshOperations/scheduleNextPoll are stable
    // (useCallback with fixed deps) and re-running this per-render would
    // fight the poll's own reschedule-on-tick loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Manual "새로고침" — re-detects adapters (e.g. `skills` just got installed) and re-lists operations. Real re-fetch only, never a fabricated "N updates available" check. */
  const refreshAll = useCallback(() => {
    loadAdapters()
    refreshOperations().then(ops => scheduleNextPoll(ops))
  }, [loadAdapters, refreshOperations, scheduleNextPoll])

  const hasInProgress = operations.some(o => IN_PROGRESS_STATUSES.has(o.status))
  const inProgressCount = operations.filter(o => IN_PROGRESS_STATUSES.has(o.status)).length

  const requestAction = useCallback((request: ToolingPlanRequest) => {
    setPreview({ status: 'loading', request, plan: null, error: null })
    toolingApi.plan(request).then(
      plan => setPreview({ status: 'ready', request, plan, error: null }),
      err => setPreview({ status: 'error', request, plan: null, error: describeError(err, 'Preview를 불러오지 못했어요') }),
    )
  }, [])

  const closePreview = useCallback(() => setPreview(IDLE_PREVIEW), [])

  /** Returns true on a successful execute so the caller can route the user to the Operation Queue. */
  const confirmExecute = useCallback(async (): Promise<boolean> => {
    if (!preview.request) return false
    setPreview(p => ({ ...p, status: 'executing', error: null }))
    try {
      await toolingApi.execute(preview.request)
      setPreview(IDLE_PREVIEW)
      const ops = await refreshOperations()
      scheduleNextPoll(ops)
      return true
    } catch (err) {
      setPreview(p => ({ ...p, status: 'ready', error: describeError(err, '실행에 실패했어요') }))
      return false
    }
  }, [preview.request, refreshOperations, scheduleNextPoll])

  const cancelOperation = useCallback(
    async (id: string) => {
      try {
        await toolingApi.cancelOperation(id)
      } finally {
        const ops = await refreshOperations()
        scheduleNextPoll(ops)
      }
    },
    [refreshOperations, scheduleNextPoll],
  )

  /** Re-plans the same request a failed operation used, opening Preview again ("다시 시도"). */
  const retryOperation = useCallback(
    (op: ToolingOperation) => {
      requestAction({
        action: op.action,
        provider: op.provider,
        target: op.target ?? undefined,
        scope: op.scope ?? undefined,
      })
    },
    [requestAction],
  )

  const toggleLog = useCallback(async (id: string, open: boolean) => {
    if (!open) return
    setLogLoading(prev => ({ ...prev, [id]: true }))
    setLogError(prev => ({ ...prev, [id]: false }))
    try {
      const detail = await toolingApi.getOperation(id)
      setLogs(prev => ({ ...prev, [id]: detail.log }))
    } catch {
      setLogError(prev => ({ ...prev, [id]: true }))
    } finally {
      setLogLoading(prev => ({ ...prev, [id]: false }))
    }
  }, [])

  return {
    adapters,
    adaptersLoading,
    adaptersError,
    operations,
    operationsError,
    hasInProgress,
    inProgressCount,
    refreshAll,
    preview,
    requestAction,
    closePreview,
    confirmExecute,
    cancelOperation,
    retryOperation,
    logs,
    logLoading,
    logError,
    toggleLog,
  }
}
