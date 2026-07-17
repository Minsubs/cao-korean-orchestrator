// One provider's account card inside UsagePopover. Split out of
// UsagePopover.tsx because it carries most of the feature's actual display
// logic (rate-limit bars, the Claude opt-in toggle, token totals, model
// chips, the honesty note).
//
// Spec delta (사용자 확정, 이 파일에 전부 반영):
//   1. rate_limits가 있으면 그 진행바(들)가 카드의 메인 표시 — 토큰 합계는
//      그 아래 작은 보조 줄로 내려간다(제거하지 않음).
//   2. Claude(`claude_code`) 카드가 rate_limits: null이고 아직 옵트인 전이면
//      "한도 실측 조회" 토글을 보여준다. 옵트인하거나 rate_limits가 생기면
//      이 토글은 더 이상 그 조건에 맞지 않으므로 사라진다.
//   3. 옵트인 후에도 backend가 실측에 실패하면(만료/형식미인식/네트워크) 그
//      사유는 `note`로 내려온다 — 카드에 그대로 노출한다(가짜 게이지 금지).
import type { UsageAccount, UsageBucket } from '../../api.usage'
import { CLAUDE_PROVIDER, getProviderLabel } from './providerLabels'
import {
  clampPercent,
  formatRelativeIso,
  formatResetsAt,
  formatTokenCount,
  formatUsedPercent,
  isUsageWarning,
  windowLabel,
} from './formatTokens'

const PASTELS: { bg: string; ink: string }[] = [
  { bg: 'var(--p-mint)', ink: 'var(--p-mint-ink)' },
  { bg: 'var(--p-sky)', ink: 'var(--p-sky-ink)' },
  { bg: 'var(--p-lilac)', ink: 'var(--p-lilac-ink)' },
  { bg: 'var(--p-peach)', ink: 'var(--p-peach-ink)' },
  { bg: 'var(--p-lemon)', ink: 'var(--p-lemon-ink)' },
  { bg: 'var(--p-rose)', ink: 'var(--p-rose-ink)' },
]

// Deterministic pastel pair per name, same hash-and-cycle approach as
// features/tooling/shared.tsx's pastelFor — duplicated rather than imported
// since features/tooling is outside this feature's ownership and under
// active parallel work.
function pastelFor(name: string): { bg: string; ink: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PASTELS[hash % PASTELS.length]
}

function initialsFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9가-힣]/g, ' ').trim()
  if (!cleaned) return '??'
  const parts = cleaned.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

interface RateLimitWindow {
  used_percent: number
  window_minutes: number
  resets_at: number
}

/** One 한도 진행바 row — spec: "실측값 그대로 — 반올림 소수1자리", bar width clamped for display but the text never is. */
function RateLimitRow({ limit }: { limit: RateLimitWindow }) {
  const warn = isUsageWarning(limit.used_percent)
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className={warn ? 'font-semibold text-[var(--warning)]' : 'font-semibold text-[var(--text)]'}>
          {windowLabel(limit.window_minutes)} 한도 {formatUsedPercent(limit.used_percent)} 사용
        </span>
        <span className="shrink-0 text-[var(--text-3)]">{formatResetsAt(limit.resets_at)} 리셋</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${clampPercent(limit.used_percent)}%`, backgroundColor: warn ? 'var(--warning)' : 'var(--accent)' }}
        />
      </div>
    </div>
  )
}

/** 오늘/이번 주 토큰 합계 — spec delta로 보조 줄로 격하되었을 뿐 계속 표시된다. `null` 버킷은 0으로 지어내지 않고 "데이터 없음"이라고 정직하게 말한다. */
function TokenStat({ label, bucket }: { label: string; bucket: UsageBucket | null }) {
  if (!bucket) {
    return (
      <span>
        {label} <span>데이터 없음</span>
      </span>
    )
  }
  const tooltip = `입력 ${formatTokenCount(bucket.input)} · 출력 ${formatTokenCount(bucket.output)} · 캐시 읽기 ${formatTokenCount(bucket.cache_read)} · 캐시 생성 ${formatTokenCount(bucket.cache_creation)}`
  return (
    <span title={tooltip}>
      {label} <span className="font-semibold text-[var(--text-2)]">{formatTokenCount(bucket.total)}</span>
    </span>
  )
}

/** by_model_today 칩 — 스펙: "최대 3개". 나머지는 숨기지 않고 "+N개 더"로 정직하게 알린다. */
function ModelChips({ models }: { models: { model: string; total: number }[] }) {
  const shown = models.slice(0, 3)
  const extra = models.length - shown.length
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {shown.map(m => {
        const pastel = pastelFor(m.model)
        return (
          <span
            key={m.model}
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: pastel.bg, color: pastel.ink }}
          >
            {m.model} · {formatTokenCount(m.total)}
          </span>
        )
      })}
      {extra > 0 && <span className="text-[10px] text-[var(--text-3)]">+{extra}개 더</span>}
    </div>
  )
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--surface)] shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

/** 스펙 델타 §2: rate_limits: null + 옵트인 꺼짐일 때만 등장하는 Claude 전용 토글. */
function ClaudeLimitsOptInRow({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[var(--text)]">한도 실측 조회</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-3)]">
          저장된 Claude 로그인 토큰으로 Anthropic 사용량 API를 조회해요 — 토큰은 이 머신에서 Anthropic으로만 전송돼요
        </p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} label="한도 실측 조회" />
    </div>
  )
}

export function AccountCard({
  account,
  claudeLimitsOptIn,
  onToggleClaudeLimitsOptIn,
}: {
  account: UsageAccount
  claudeLimitsOptIn: boolean
  onToggleClaudeLimitsOptIn: (value: boolean) => void
}) {
  const label = getProviderLabel(account.provider)
  const pastel = pastelFor(account.provider)
  const primary = account.rate_limits?.primary ?? null
  const secondary = account.rate_limits?.secondary ?? null
  const hasBars = !!(primary || secondary)
  // 옵트인 UI는 오직 Claude 카드가, rate_limits가 없고, 아직 옵트인하지 않은
  // 동안에만 뜬다 — 옵트인하거나 실측 데이터가 생기면 이 조건 자체가 거짓이
  // 되어 자연히 사라진다(스펙 델타 §2의 문면 그대로).
  const showOptIn = account.provider === CLAUDE_PROVIDER && !account.rate_limits && !claudeLimitsOptIn
  const hasNote = account.note.trim().length > 0

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
          style={{ backgroundColor: pastel.bg, color: pastel.ink }}
        >
          {initialsFor(label)}
        </span>
        <span className="text-xs font-semibold text-[var(--text)]">{label}</span>
        {account.rate_limits?.plan && (
          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-text)]">
            {account.rate_limits.plan}
          </span>
        )}
      </div>

      {/* 스펙 델타 §1: rate_limits 진행바가 카드의 메인 표시. */}
      {hasBars && (
        <div className="mt-3 space-y-2.5">
          {primary && <RateLimitRow limit={primary} />}
          {secondary && <RateLimitRow limit={secondary} />}
        </div>
      )}

      {showOptIn && <ClaudeLimitsOptInRow checked={claudeLimitsOptIn} onChange={onToggleClaudeLimitsOptIn} />}

      {/* 토큰 합계는 보조 줄로 격하 — 여전히 표시된다. */}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-3)] ${hasBars || showOptIn ? 'mt-3' : 'mt-2.5'}`}>
        <TokenStat label="오늘" bucket={account.today} />
        <TokenStat label="이번 주" bucket={account.week} />
      </div>

      {account.by_model_today.length > 0 && <ModelChips models={account.by_model_today} />}

      <div className="mt-2.5 border-t border-dashed border-[var(--border-soft)] pt-2.5">
        <p className="text-[10px] text-[var(--text-3)]">
          {account.last_activity ? `마지막 활동 ${formatRelativeIso(account.last_activity)}` : '활동 기록 없음'}
        </p>
        {hasNote && <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">{account.note}</p>}
      </div>
    </div>
  )
}
