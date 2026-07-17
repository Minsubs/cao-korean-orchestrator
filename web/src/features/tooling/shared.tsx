import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Clock, Info, Loader2, RefreshCw, XCircle } from 'lucide-react'
import type { DiagnosticSeverity, ToolingAction, ToolingAdapter, ToolingOperationStatus } from '../../api.tooling'

/** The one write-capable adapter Phase 4 ships (services/tooling/adapters/registry.py). */
export const GENERIC_SKILLS_ADAPTER_ID = 'generic_skills'

/** Shared "we don't know" copy for null/missing environment & provider fields. */
export const UNKNOWN = '확인할 수 없음'

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return UNKNOWN
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return UNKNOWN
  return d.toLocaleString('ko-KR')
}

// Deterministic pastel token pair per name (provider or kind), so the same
// value always renders the same badge color across renders without a
// hand-maintained map — the provider/extension set is open-ended and comes
// entirely from the backend.
const PASTELS: { bg: string; ink: string }[] = [
  { bg: 'var(--p-mint)', ink: 'var(--p-mint-ink)' },
  { bg: 'var(--p-sky)', ink: 'var(--p-sky-ink)' },
  { bg: 'var(--p-lilac)', ink: 'var(--p-lilac-ink)' },
  { bg: 'var(--p-peach)', ink: 'var(--p-peach-ink)' },
  { bg: 'var(--p-lemon)', ink: 'var(--p-lemon-ink)' },
  { bg: 'var(--p-rose)', ink: 'var(--p-rose-ink)' },
]

export function pastelFor(name: string): { bg: string; ink: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PASTELS[hash % PASTELS.length]
}

export function initials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9가-힣]/g, ' ').trim()
  if (!cleaned) return '??'
  const parts = cleaned.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Korean labels for the `kind` strings that show up across both the
// directory-source listing (SourcesPane, Phase 6c) and the environment
// inventory summary (EnvProfilesPane, Phase 6c) — the two features scan
// overlapping sets of file kinds (skills/commands/prompts/agents plus
// instruction/settings/mcp_config from services/env_migration/inventory.py).
// Falls back to the raw backend string for any kind not listed here, so a
// future backend addition degrades to an honest (if untranslated) label
// rather than disappearing or throwing.
const KIND_LABEL_KO: Record<string, string> = {
  skill: '스킬',
  command: '명령',
  prompt: '프롬프트',
  agent: '에이전트',
  instruction: '지침',
  settings: '설정',
  mcp_config: 'MCP 설정',
  profile: '프로필',
  plugin: '플러그인',
  mcp: 'MCP',
  cli: 'CLI',
}

export function kindLabel(kind: string): string {
  return KIND_LABEL_KO[kind] ?? kind
}

/** Debounces `value` by `delayMs` — used for the Installed pane's search box. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

const SEVERITY_CONFIG: Record<DiagnosticSeverity, { label: string; icon: typeof AlertTriangle; bg: string; text: string }> = {
  error: { label: '오류', icon: XCircle, bg: 'var(--danger-bg)', text: 'var(--danger)' },
  warning: { label: '경고', icon: AlertTriangle, bg: 'var(--warning-bg)', text: 'var(--warning)' },
  info: { label: '정보', icon: Info, bg: 'var(--neutral-bg)', text: 'var(--neutral)' },
}

/** Severity pill (icon + text), styled like StatusBadge's dot-pill pattern. */
export function SeverityPill({ severity }: { severity: DiagnosticSeverity }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info
  const Icon = cfg.icon
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      <Icon size={13} />
      {cfg.label}
    </span>
  )
}

/** 설치됨/미설치 pill (icon + text) for the detected-CLI list. */
export function InstallPill({ installed }: { installed: boolean }) {
  const Icon = installed ? CheckCircle2 : XCircle
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: installed ? 'var(--success-bg)' : 'var(--neutral-bg)',
        color: installed ? 'var(--success)' : 'var(--neutral)',
      }}
    >
      <Icon size={13} />
      {installed ? '설치됨' : '미설치'}
    </span>
  )
}

/** Small square pill for a kind/scope/category label (e.g. "Skill", "Built-in", "MCP") — shared by InstalledPane's rows and DiscoverPane's catalog rows/detail (Phase 5b). */
export function TypeChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded px-1.5 py-[1px] text-[10px] font-bold text-[var(--text-2)]" style={{ backgroundColor: 'var(--surface-3)' }}>
      {children}
    </span>
  )
}

export function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
  tone?: 'danger' | 'warning' | 'accent'
}) {
  const toneColor =
    tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : tone === 'accent' ? 'var(--accent-text)' : 'var(--text)'
  return (
    <div className="min-w-[130px] flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
      <div className="text-xl font-bold tabular-nums" style={{ color: toneColor }}>
        {value}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
        {icon}
        {label}
      </div>
    </div>
  )
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[var(--surface-2)] ${className}`} />
}

/**
 * Generic "nothing to show" block for positive-empty results (no diagnostics
 * found, filter matched nothing, …). Visually modeled on
 * components/EmptyState.tsx but kept local to this feature: that component's
 * own docstring scopes it to "not built yet" placeholders, which isn't what
 * an empty *result set* means here.
 */
export function EmptyPane({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div
      role="region"
      aria-label={title}
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-2)]">{icon}</div>
      <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
      {description && <p className="max-w-sm text-xs leading-relaxed text-[var(--text-3)]">{description}</p>}
    </div>
  )
}

// ── Phase 4b shared write-path pieces ───────────────────────────────────────

/** Client-side mirror of the backend's target validation (services/tooling/runner.py target charset). */
export const TARGET_PATTERN = /^[A-Za-z0-9@/._-]+$/

export const TARGET_HELP_TEXT = '영문/숫자와 @ / . _ - 만 사용할 수 있어요'

export const ACTION_LABELS: Record<ToolingAction, string> = {
  install: '설치',
  remove: '삭제',
  update: '업데이트',
  update_all: '모두 업데이트',
}

const OPERATION_STATUS_CONFIG: Record<
  ToolingOperationStatus,
  { label: string; icon: typeof Clock; spin?: boolean; bg: string; text: string }
> = {
  queued: { label: '대기 중', icon: Clock, bg: 'var(--neutral-bg)', text: 'var(--neutral)' },
  running: { label: '실행 중', icon: Loader2, spin: true, bg: 'var(--info-bg)', text: 'var(--info)' },
  verifying: { label: '검증 중', icon: RefreshCw, spin: true, bg: 'var(--info-bg)', text: 'var(--info)' },
  succeeded: { label: '성공', icon: CheckCircle2, bg: 'var(--success-bg)', text: 'var(--success)' },
  failed: { label: '실패', icon: XCircle, bg: 'var(--danger-bg)', text: 'var(--danger)' },
  cancelled: { label: '취소됨', icon: Ban, bg: 'var(--neutral-bg)', text: 'var(--neutral)' },
  partially_succeeded: { label: '부분 성공', icon: AlertTriangle, bg: 'var(--warning-bg)', text: 'var(--warning)' },
}

export const IN_PROGRESS_STATUSES: ReadonlySet<ToolingOperationStatus> = new Set(['queued', 'running', 'verifying'])

/** Operation status pill (icon + text) — same dot-pill pattern as SeverityPill/InstallPill above. */
export function OperationStatusPill({ status }: { status: ToolingOperationStatus }) {
  const cfg = OPERATION_STATUS_CONFIG[status]
  const Icon = cfg.icon
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      <Icon size={13} className={cfg.spin ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  )
}

/** Small pill-shaped action button shared by Skill 관리 / 상세 / Operation Queue / Preview modal. */
export function ActionButton({
  children,
  onClick,
  disabled,
  title,
  variant = 'default',
  icon,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  variant?: 'default' | 'accent' | 'danger' | 'warning'
  icon?: ReactNode
  type?: 'button' | 'submit'
}) {
  const variantClass =
    variant === 'accent'
      ? 'bg-[var(--accent)] text-[var(--on-accent)] hover:brightness-105'
      : variant === 'danger'
        ? 'border border-[var(--border)] text-[var(--danger)] hover:bg-[var(--danger-bg)]'
        : variant === 'warning'
          ? 'border border-[var(--border)] text-[var(--warning)] hover:bg-[var(--warning-bg)]'
          : 'border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${variantClass}`}
    >
      {icon}
      {children}
    </button>
  )
}

/** The four write actions that are gated by a per-adapter boolean + reason (canList/requiresNewSession/requiresRestart aren't action buttons). */
export type ActionCapabilityKey = 'canInstall' | 'canRemove' | 'canUpdate' | 'canUpdateAll'

/**
 * Shared enable/disable + `title` decision for every write-action button
 * (Skill 관리's 추가/업데이트/삭제/모두 업데이트 in UpdatesPane, and the
 * 설치됨 detail's [업데이트]/[삭제] in InstalledPane) — one place that
 * turns "no adapter data yet" / "adapter reports unsupported" into an
 * honest disabled+title, per the "가짜 성공 상태 금지" rule.
 */
export function gateCapability(
  adapter: ToolingAdapter | undefined,
  key: ActionCapabilityKey,
  opts?: { adapterMissingReason?: string },
): { disabled: boolean; title?: string } {
  if (!adapter) return { disabled: true, title: opts?.adapterMissingReason ?? '어댑터 정보를 확인할 수 없어요' }
  if (adapter.capabilities[key]) return { disabled: false }
  return { disabled: true, title: adapter.capabilities.reasons[key] ?? '이 환경에서는 지원되지 않아요' }
}
