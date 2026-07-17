import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Clock, Loader2, Play, Plus, Trash2, X, Zap } from 'lucide-react'
import { api, type Flow } from '../../api'
import { useStore } from '../../store'
import { EmptyState } from '../../components/EmptyState'
import { AgentAvatar } from '../workspace/AgentAvatar'
import { humanizeCron } from './cron'
import { NewFlowModal } from './NewFlowModal'

const UNKNOWN = '확인할 수 없음'

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('ko-KR')
}

/**
 * 자동화 · Flows screen (Phase 5c, mockup v9 structure, real data only). No
 * run-history list: the Flow model (models/flow.py) has no success/failure
 * field and api.ts has no /flows/runs client — the spec explicitly says not
 * to build a history list against data that doesn't exist. last_run/next_run
 * are shown inline per row instead.
 */
export function FlowsView() {
  const showSnackbar = useStore(s => s.showSnackbar)

  const [flows, setFlows] = useState<Flow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingName, setTogglingName] = useState<string | null>(null)
  const [runningName, setRunningName] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Flow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .listFlows()
      .then(setFlows)
      .catch((e: unknown) => {
        const err = e as { detail?: string; message?: string }
        setError(err?.detail || err?.message || 'Flow 목록을 불러오지 못했어요')
        setFlows(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleToggle(f: Flow) {
    setTogglingName(f.name)
    try {
      if (f.enabled) await api.disableFlow(f.name)
      else await api.enableFlow(f.name)
      await load()
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      showSnackbar({ type: 'error', message: err?.detail || err?.message || `${f.name} 상태를 바꾸지 못했어요` })
    } finally {
      setTogglingName(null)
    }
  }

  async function handleRun(f: Flow) {
    setRunningName(f.name)
    try {
      const res = await api.runFlow(f.name)
      showSnackbar({
        type: res.executed ? 'success' : 'info',
        message: res.executed ? `${f.name} 실행을 시작했어요` : `${f.name}의 조건 스크립트가 실행 조건을 충족하지 않아 건너뛰었어요`,
      })
      await load()
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      showSnackbar({ type: 'error', message: err?.detail || err?.message || `${f.name} 실행에 실패했어요` })
    } finally {
      setRunningName(null)
    }
  }

  async function handleDeleteConfirm() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deleteFlow(pendingDelete.name)
      showSnackbar({ type: 'success', message: `"${pendingDelete.name}"을(를) 삭제했어요` })
      setPendingDelete(null)
      await load()
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      showSnackbar({ type: 'error', message: err?.detail || err?.message || '삭제하지 못했어요' })
    } finally {
      setDeleting(false)
    }
  }

  const stats = useMemo(() => {
    const list = flows ?? []
    const activeCount = list.filter(f => f.enabled).length
    const upcoming = list
      .filter(f => f.enabled && f.next_run)
      .map(f => ({ f, t: new Date(f.next_run as string).getTime() }))
      .filter(x => !Number.isNaN(x.t))
      .sort((a, b) => a.t - b.t)[0]
    return { total: list.length, activeCount, next: upcoming?.f ?? null }
  }, [flows])

  return (
    <div className="mx-auto max-w-4xl px-5 py-5">
      <div className="flex items-center gap-2.5">
        <h1 className="flex flex-1 items-center gap-2 text-lg font-bold text-[var(--text)]">
          <Zap size={18} className="text-[var(--accent-text)]" />
          자동 실행 · Flows
        </h1>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--on-accent)] shadow-sm hover:brightness-105"
        >
          <Plus size={13} />
          새 Flow
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-3)]">
        cron 스케줄로 에이전트 세션을 자동 실행해요 · <span className="font-mono">cao schedule</span>과 동일한 데이터 · cao-server가 켜져 있어야 스케줄이 동작해요
      </p>

      {!loading && !error && flows && flows.length > 0 && (
        <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-2">
          <StatTile
            icon={<Zap size={13} />}
            label="활성 Flow"
            value={
              <>
                {stats.activeCount}
                <span className="text-xs text-[var(--text-3)]">/{stats.total}</span>
              </>
            }
          />
          <StatTile
            icon={<Clock size={13} />}
            label={stats.next ? `다음 실행 · ${stats.next.name}` : '다음 실행'}
            value={<span className="text-sm">{stats.next ? formatDateTime(stats.next.next_run) : UNKNOWN}</span>}
          />
        </div>
      )}

      <div className="mt-5">
        {loading && !flows && !error ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-[var(--surface-2)]" />
            ))}
          </div>
        ) : error ? (
          <EmptyState icon={<AlertTriangle size={20} />} title="Flow를 불러오지 못했어요" description={error} />
        ) : !flows || flows.length === 0 ? (
          <EmptyState icon={<Zap size={20} />} title="등록된 Flow가 없어요" description="새 Flow 버튼으로 첫 자동 실행 스케줄을 만들어 보세요." />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {flows.map((f, i) => (
              <FlowRow
                key={f.name}
                flow={f}
                withBorder={i > 0}
                toggling={togglingName === f.name}
                running={runningName === f.name}
                onToggle={() => handleToggle(f)}
                onRun={() => handleRun(f)}
                onDeleteRequest={() => setPendingDelete(f)}
              />
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-2)]">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        조건 스크립트가 있는 Flow는 실행 전에 스크립트를 먼저 돌려요 — 조건이 충족되지 않으면 세션을 만들지 않고 건너뛰어요. 건너뜀은 실패가 아니에요.
      </p>

      {showNewModal && <NewFlowModal onClose={() => setShowNewModal(false)} onCreated={load} />}

      {pendingDelete && (
        <DeleteConfirm
          flow={pendingDelete}
          deleting={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  )
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
      <div className="text-xl font-bold tabular-nums text-[var(--text)]">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-[var(--text-3)]" title={label}>
        {icon}
        {label}
      </div>
    </div>
  )
}

function FlowRow({
  flow,
  withBorder,
  toggling,
  running,
  onToggle,
  onRun,
  onDeleteRequest,
}: {
  flow: Flow
  withBorder: boolean
  toggling: boolean
  running: boolean
  onToggle: () => void
  onRun: () => void
  onDeleteRequest: () => void
}) {
  const human = humanizeCron(flow.schedule)
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${withBorder ? 'border-t border-dashed border-[var(--border-soft)]' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={flow.enabled}
        aria-label={`${flow.name} ${flow.enabled ? '비활성화' : '활성화'}`}
        onClick={onToggle}
        disabled={toggling}
        title="활성/비활성"
        className="relative h-5 w-8 shrink-0 rounded-full transition-colors disabled:opacity-60"
        style={{ background: flow.enabled ? 'var(--accent)' : 'var(--neutral-bg)' }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-[var(--surface)] shadow-sm transition-all"
          style={{ left: flow.enabled ? 16 : 2 }}
        />
      </button>
      <AgentAvatar name={flow.agent_profile} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
          {flow.name}
          <span className="rounded-md bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] font-normal text-[var(--text-2)]">{flow.schedule}</span>
        </div>
        <div className="truncate text-[11px] text-[var(--text-3)]">
          {human} · {flow.agent_profile} · 마지막 실행: {formatDateTime(flow.last_run)}
        </div>
      </div>
      <span className="shrink-0 whitespace-nowrap text-right text-[10.5px] text-[var(--text-3)]">
        {flow.next_run ? `다음: ${formatDateTime(flow.next_run)}` : flow.enabled ? UNKNOWN : '비활성'}
      </span>
      <button
        type="button"
        onClick={onRun}
        disabled={running}
        title="지금 실행"
        aria-label={`${flow.name} 지금 실행`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-2)] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed"
      >
        {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
      </button>
      <button
        type="button"
        onClick={onDeleteRequest}
        title="삭제"
        aria-label={`${flow.name} 삭제`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-2)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function DeleteConfirm({
  flow,
  deleting,
  onCancel,
  onConfirm,
}: {
  flow: Flow
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[61] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Flow 삭제 확인">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-bg)] text-[var(--danger)]">
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--text)]">Flow를 삭제할까요?</h3>
            <p className="mt-1 text-xs text-[var(--text-2)]">
              <span className="font-mono">{flow.name}</span>이(가) 영구히 삭제돼요. 이 작업은 되돌릴 수 없어요.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-full p-1 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={14} />
          </button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={deleting} className="h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-2)]">
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--danger)] px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}
