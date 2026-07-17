// Pure formatting/derivation helpers for the AI 사용량 widget — kept dependency
// free (no React, no fetch) so every rule the spec calls out as "순수함수
// 단위테스트" can be exercised directly from web/src/test/usage.test.tsx
// without mounting a component.

/** Compact token-count abbreviation ("1.2M", "534K") — matches the spec's exact examples via Intl's compact notation rather than a hand-rolled divide-and-suffix (which would round 534000 to "534.0K"). */
export function formatTokenCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** Rate-limit `used_percent`, displayed exactly as measured (spec: "실측값 그대로 — 반올림 소수1자리") — rounds for display only, never truncates/clamps the underlying number. */
export function formatUsedPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0%'
  return `${value.toFixed(1)}%`
}

/** Compact whole-number percent for the TopBar badge (spec example: "27%", no decimal — space is tight). */
export function formatBadgePercent(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${Math.round(value)}%`
}

/** Clamps a percent to [0, 100] for a progress-bar *width* only — the accompanying text must still use the unclamped `formatUsedPercent` (a bar can't visually exceed its track, but the honest number must never be lied about). */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** used_percent at/above this is rendered with the warning token, both for the TopBar badge and every rate-limit bar (spec: "80% 이상이면 경고색 토큰"). */
export const USAGE_WARNING_THRESHOLD = 80

export function isUsageWarning(usedPercent: number): boolean {
  return usedPercent >= USAGE_WARNING_THRESHOLD
}

/**
 * window_minutes → 사람이 읽는 한도 주기 라벨 (spec examples: 10080 → "주간",
 * 300 → "5시간"). Divisor-based so any whole-hour/whole-day/whole-week window
 * the backend ever sends resolves sensibly, not just the two example values.
 */
export function windowLabel(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return '알 수 없음'
  if (minutes % 10080 === 0) {
    const weeks = minutes / 10080
    return weeks === 1 ? '주간' : `${weeks}주`
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return days === 1 ? '일간' : `${days}일`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours}시간`
  }
  return `${minutes}분`
}

/**
 * `resets_at` is typed as a raw `number`, not an ISO string (unlike
 * `captured_at`/`last_activity`/`scanned_at`) — its unit (seconds vs
 * milliseconds epoch) isn't pinned down by the spec. Any real-world Unix
 * timestamp in *seconds* is well under 1e12 until the year 2286; any
 * timestamp already in *milliseconds* is comfortably over it (2001+). This
 * heuristic — used by several date libraries for the same ambiguity — picks
 * the right unit without needing a backend-side convention to be finalized
 * first.
 */
export function toEpochMs(value: number): number {
  if (!Number.isFinite(value)) return NaN
  return Math.abs(value) < 1e12 ? value * 1000 : value
}

/** Core relative-time formatter, operating purely in epoch ms — shared by the past (last_activity) and future (resets_at) call sites below. */
export function formatRelativeFromEpochMs(epochMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(epochMs)) return '알 수 없음'
  const diffMs = epochMs - nowMs
  const past = diffMs <= 0
  const abs = Math.abs(diffMs)
  const sec = Math.floor(abs / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)

  if (sec < 60) return past ? '방금 전' : '곧'
  if (min < 60) return past ? `${min}분 전` : `${min}분 후`
  if (hr < 24) return past ? `${hr}시간 전` : `${hr}시간 후`
  return past ? `${day}일 전` : `${day}일 후`
}

/** `last_activity`/`captured_at`-style ISO datetime strings → relative text, with an honest fallback for null/unparseable input (never fabricates "방금"). */
export function formatRelativeIso(value: string | null | undefined, nowMs: number = Date.now()): string {
  if (!value) return '알 수 없음'
  const t = Date.parse(value)
  if (Number.isNaN(t)) return '알 수 없음'
  return formatRelativeFromEpochMs(t, nowMs)
}

/** `resets_at` (raw epoch number, see `toEpochMs`) → relative text — caller appends the "리셋" suffix (e.g. `${formatResetsAt(x)} 리셋`) so this stays reusable for any future future-facing timestamp. */
export function formatResetsAt(value: number | null | undefined, nowMs: number = Date.now()): string {
  if (typeof value !== 'number') return '알 수 없음'
  return formatRelativeFromEpochMs(toEpochMs(value), nowMs)
}

/** TopBar 배지 규칙: rate_limits.primary가 있는 계정 중 최고 used_percent. `null` = 배지를 아예 렌더하지 않음(데이터 없음과 0%는 다르다). */
export function maxUsedPercent(accounts: { rate_limits: { primary: { used_percent: number } | null } | null }[]): number | null {
  const values = accounts
    .map(a => a.rate_limits?.primary?.used_percent)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (values.length === 0) return null
  return Math.max(...values)
}
