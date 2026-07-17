import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Blocks, Download, Info, Plus, RefreshCw, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import type { ToolingAdapter, ToolingExtension, ToolingOperation, ToolingPlanRequest } from '../../api.tooling'
import {
  ACTION_LABELS,
  ActionButton,
  EmptyPane,
  GENERIC_SKILLS_ADAPTER_ID,
  InstallPill,
  OperationStatusPill,
  TARGET_HELP_TEXT,
  TARGET_PATTERN,
  UNKNOWN,
  formatDateTime,
  gateCapability,
} from './shared'

interface UpdatesPaneProps {
  adapters: ToolingAdapter[]
  adaptersLoading: boolean
  adaptersError: boolean
  extensions: ToolingExtension[]
  operations: ToolingOperation[]
  operationsError: boolean
  logs: Record<string, string[]>
  logLoading: Record<string, boolean>
  logError: Record<string, boolean>
  onToggleLog: (id: string, open: boolean) => void
  onRequestAction: (request: ToolingPlanRequest) => void
  onCancelOperation: (id: string) => void
  onRetryOperation: (op: ToolingOperation) => void
  onRefresh: () => void
  autoFocusQueue: boolean
  onQueueFocused: () => void
}

/**
 * 업데이트 탭 — Phase 4b spec §화면 1-3: 어댑터 카드 → Skill 관리(추가/업데이트/
 * 삭제/모두 업데이트, 전부 plan→Preview 모달 경유) → Operation Queue.
 *
 * Note on scope vs. the reference mockup: the mockup shows per-skill
 * "v1.4.0 → v1.5.1" version diffs and an "N개 업데이트 가능" count. The real
 * schema here (ToolingExtension/ToolingAdapter, phase3a+4a) has no per-skill
 * version or update-availability field — only the adapter's own installed
 * version. Fabricating a diff/count would violate "가짜 성공 상태 금지", so
 * this pane instead always offers 업데이트/모두 업데이트 as real actions
 * (the underlying `skills update` is a no-op when already current) rather
 * than pretending to know what needs updating.
 */
export function UpdatesPane({
  adapters,
  adaptersLoading,
  adaptersError,
  extensions,
  operations,
  operationsError,
  logs,
  logLoading,
  logError,
  onToggleLog,
  onRequestAction,
  onCancelOperation,
  onRetryOperation,
  onRefresh,
  autoFocusQueue,
  onQueueFocused,
}: UpdatesPaneProps) {
  const skillsAdapter = adapters.find(a => a.id === GENERIC_SKILLS_ADAPTER_ID)
  const adapterMissingReason = adaptersError
    ? '어댑터 정보를 불러오지 못했어요'
    : adaptersLoading
      ? '어댑터 정보를 확인하는 중…'
      : '감지된 어댑터가 없어요'

  const queueRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocusQueue && queueRef.current) {
      queueRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      queueRef.current.focus()
      onQueueFocused()
    }
  }, [autoFocusQueue, onQueueFocused])

  const skillExtensions = extensions.filter(e => e.kind === 'skill')
  const sortedOperations = [...operations].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <div className="space-y-5">
      {/* 1. 어댑터 카드 */}
      <div>
        <SectionTitle icon={<Blocks size={13} />}>어댑터</SectionTitle>
        {adaptersLoading ? (
          <div className="h-20 animate-pulse rounded-2xl bg-[var(--surface-2)]" />
        ) : adaptersError ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-xs text-[var(--danger)]">
            어댑터 정보를 불러오지 못했어요
          </div>
        ) : !skillsAdapter ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-xs text-[var(--text-3)]">
            감지된 어댑터가 없어요
          </div>
        ) : (
          <AdapterCard adapter={skillsAdapter} />
        )}
      </div>

      {/* 2. Skill 관리 영역 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle icon={<Sparkles size={13} />}>Skill 관리</SectionTitle>
          <ActionButton icon={<RefreshCw size={12} />} onClick={onRefresh}>
            새로고침
          </ActionButton>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <AddSkillRow
            adapter={skillsAdapter}
            adapterMissingReason={adapterMissingReason}
            onRequestAction={onRequestAction}
          />
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-2.5">
            <span className="text-xs font-bold text-[var(--text)]">설치된 Skill ({skillExtensions.length})</span>
            <UpdateAllButton adapter={skillsAdapter} adapterMissingReason={adapterMissingReason} onRequestAction={onRequestAction} />
          </div>
          {skillExtensions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[var(--text-3)]">설치된 skill이 없어요</div>
          ) : (
            skillExtensions.map((ext, i) => (
              <SkillRow
                key={ext.id}
                ext={ext}
                withBorder={i > 0}
                adapter={skillsAdapter}
                adapterMissingReason={adapterMissingReason}
                onRequestAction={onRequestAction}
              />
            ))
          )}
        </div>
      </div>

      {/* 3. Operation Queue */}
      <div ref={queueRef} tabIndex={-1} className="outline-none">
        <SectionTitle icon={<RefreshCw size={13} />}>Operation Queue</SectionTitle>
        {operationsError && operations.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-xs text-[var(--danger)]">
            작업 목록을 불러오지 못했어요
          </div>
        ) : sortedOperations.length === 0 ? (
          <EmptyPane icon={<Sparkles size={20} />} title="아직 실행된 작업이 없어요" description="Skill을 추가·업데이트·삭제하면 여기에 진행 상황이 표시돼요." />
        ) : (
          <>
            {operationsError && (
              <p className="mb-2 text-[11px] text-[var(--danger)]">최신 상태를 불러오지 못했어요 — 이전 상태를 보여주고 있어요</p>
            )}
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
              {sortedOperations.map(op => (
                <OperationRow
                  key={op.id}
                  op={op}
                  adapters={adapters}
                  log={logs[op.id]}
                  logLoading={!!logLoading[op.id]}
                  logError={!!logError[op.id]}
                  onToggleLog={onToggleLog}
                  onCancel={onCancelOperation}
                  onRetry={onRetryOperation}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">{icon}{children}</div>
}

function KVRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-xs">
      <dt className="shrink-0 text-[var(--text-3)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[var(--text)]" title={value}>
        {value}
      </dd>
    </div>
  )
}

function AdapterCard({ adapter }: { adapter: ToolingAdapter }) {
  const primaryReason = !adapter.detected.installed
    ? adapter.capabilities.reasons.canInstall ?? adapter.capabilities.reasons.canList ?? '설치되어 있지 않아요'
    : null
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-3">
        <Blocks size={14} className="text-[var(--text-2)]" />
        <span className="text-xs font-bold text-[var(--text)]">{adapter.display_name}</span>
        <span className="ml-auto">
          <InstallPill installed={adapter.detected.installed} />
        </span>
      </div>
      <dl className="divide-y divide-dashed divide-[var(--border-soft)] px-4">
        <KVRow label="경로" value={adapter.detected.path ?? UNKNOWN} />
        <KVRow label="버전" value={adapter.detected.version ?? UNKNOWN} />
      </dl>
      {primaryReason && (
        <div className="flex items-start gap-2 border-t border-dashed border-[var(--border-soft)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--text-3)]">
          <Info size={13} className="mt-0.5 shrink-0" />
          {primaryReason}
        </div>
      )}
    </div>
  )
}

function AddSkillRow({
  adapter,
  adapterMissingReason,
  onRequestAction,
}: {
  adapter: ToolingAdapter | undefined
  adapterMissingReason: string
  onRequestAction: (request: ToolingPlanRequest) => void
}) {
  const [target, setTarget] = useState('')
  const trimmed = target.trim()
  const formatInvalid = trimmed.length > 0 && !TARGET_PATTERN.test(trimmed)
  const gate = gateCapability(adapter, 'canInstall', { adapterMissingReason })
  const disabled = gate.disabled || trimmed.length === 0 || formatInvalid
  const title = gate.disabled ? gate.title : formatInvalid ? TARGET_HELP_TEXT : undefined

  const submit = () => {
    if (disabled || !adapter) return
    onRequestAction({ action: 'install', provider: adapter.id, target: trimmed })
    setTarget('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <label htmlFor="tooling-add-skill-target" className="text-xs font-semibold text-[var(--text)]">
        새 Skill 추가
      </label>
      <input
        id="tooling-add-skill-target"
        value={target}
        onChange={e => setTarget(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="예: pdf-tools"
        aria-label="추가할 Skill 이름"
        className="min-w-[160px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      <ActionButton variant="accent" disabled={disabled} title={title} icon={<Plus size={13} />} onClick={submit}>
        추가
      </ActionButton>
      {formatInvalid && !gate.disabled && <p className="basis-full text-[10.5px] text-[var(--danger)]">{TARGET_HELP_TEXT}</p>}
    </div>
  )
}

function UpdateAllButton({
  adapter,
  adapterMissingReason,
  onRequestAction,
}: {
  adapter: ToolingAdapter | undefined
  adapterMissingReason: string
  onRequestAction: (request: ToolingPlanRequest) => void
}) {
  const gate = gateCapability(adapter, 'canUpdateAll', { adapterMissingReason })
  return (
    <ActionButton
      variant="accent"
      disabled={gate.disabled}
      title={gate.title}
      icon={<Download size={13} />}
      onClick={() => adapter && onRequestAction({ action: 'update_all', provider: adapter.id })}
    >
      모두 업데이트
    </ActionButton>
  )
}

function SkillRow({
  ext,
  withBorder,
  adapter,
  adapterMissingReason,
  onRequestAction,
}: {
  ext: ToolingExtension
  withBorder: boolean
  adapter: ToolingAdapter | undefined
  adapterMissingReason: string
  onRequestAction: (request: ToolingPlanRequest) => void
}) {
  const updateGate = gateCapability(adapter, 'canUpdate', { adapterMissingReason })
  const removeGate = gateCapability(adapter, 'canRemove', { adapterMissingReason })
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${withBorder ? 'border-t border-dashed border-[var(--border-soft)]' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-[var(--text)]">{ext.name}</div>
        <div className="truncate text-[11px] text-[var(--text-3)]">{ext.description || '설명 없음'}</div>
      </div>
      <ActionButton
        disabled={updateGate.disabled}
        title={updateGate.title}
        icon={<Download size={12} />}
        onClick={() => adapter && onRequestAction({ action: 'update', provider: adapter.id, target: ext.name })}
      >
        업데이트
      </ActionButton>
      <ActionButton
        variant="danger"
        disabled={removeGate.disabled}
        title={removeGate.title}
        icon={<Trash2 size={12} />}
        onClick={() => adapter && onRequestAction({ action: 'remove', provider: adapter.id, target: ext.name })}
      >
        삭제
      </ActionButton>
    </div>
  )
}

function OperationRow({
  op,
  adapters,
  log,
  logLoading,
  logError,
  onToggleLog,
  onCancel,
  onRetry,
}: {
  op: ToolingOperation
  adapters: ToolingAdapter[]
  log: string[] | undefined
  logLoading: boolean
  logError: boolean
  onToggleLog: (id: string, open: boolean) => void
  onCancel: (id: string) => void
  onRetry: (op: ToolingOperation) => void
}) {
  const providerLabel = adapters.find(a => a.id === op.provider)?.display_name ?? op.provider
  const timestamp = formatDateTime(op.started_at ?? op.created_at)
  const canCancel = op.status === 'queued' || op.status === 'running'
  const canRetry = op.status === 'failed'

  return (
    <div className="border-t border-dashed border-[var(--border-soft)] px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <OperationStatusPill status={op.status} />
        <span className="text-xs font-semibold text-[var(--text)]">{ACTION_LABELS[op.action]}</span>
        <span className="text-[11px] text-[var(--text-3)]">{providerLabel}</span>
        {op.target && (
          <span className="rounded bg-[var(--surface-3)] px-1.5 py-[1px] font-mono text-[10px] text-[var(--text-2)]">{op.target}</span>
        )}
        <span className="text-[10px] text-[var(--text-3)]">{timestamp}</span>
        {op.exit_code !== null && <span className="text-[10px] text-[var(--text-3)]">exit {op.exit_code}</span>}
        {op.verified !== null && (
          <span className={`text-[10px] ${op.verified ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            {op.verified ? '검증됨' : '검증 실패'}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {canCancel && (
            <ActionButton variant="warning" onClick={() => onCancel(op.id)}>
              취소
            </ActionButton>
          )}
          {canRetry && (
            <ActionButton icon={<RotateCcw size={12} />} onClick={() => onRetry(op)}>
              다시 시도
            </ActionButton>
          )}
        </span>
      </div>
      {op.error && <p className="mt-1.5 text-[11px] text-[var(--danger)]">{op.error}</p>}
      <details className="mt-2" onToggle={e => onToggleLog(op.id, e.currentTarget.open)}>
        <summary className="cursor-pointer select-none text-[11px] font-semibold text-[var(--text-3)] hover:text-[var(--text)]">로그</summary>
        <div className="mt-1.5 rounded-lg bg-[var(--surface-2)] px-3 py-2">
          {logLoading && <span className="text-[11px] text-[var(--text-3)]">불러오는 중…</span>}
          {logError && <span className="text-[11px] text-[var(--danger)]">로그를 불러오지 못했어요</span>}
          {!logLoading && !logError && log && (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-[var(--text-2)]">
              {log.length > 0 ? log.join('\n') : '로그가 비어 있어요'}
            </pre>
          )}
        </div>
      </details>
    </div>
  )
}
