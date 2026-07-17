// Pure remaining-context gauge logic (Phase 2d spec §2d), kept separate from
// any component/hook so the color-bucket rule and the low-context debounce
// state machine stay independently unit-testable (spec §테스트: "pure 로직
// 분리 권장: contextGauge.ts") instead of being buried inside a component or
// polling effect.
//
// `percentLeft` is always the backend's *remaining* percentage (higher =
// more headroom left) — see api.ui.ts's `TerminalContextResponse` /
// api/ui_features_router.py `get_terminal_context`. `null` means "no gauge
// available" (no footer scraped yet, or the provider has none) and every
// function here treats it as a distinct "unknown" case — never as a low
// value, never as 0%.

export type GaugeBucket = 'safe' | 'caution' | 'warning'

const SAFE_MIN = 50
const CAUTION_MIN = 20

/** Bucket boundaries per spec: ≥50 safe, 20–49 caution, <20 warning. */
export function gaugeBucket(percentLeft: number): GaugeBucket {
  if (percentLeft >= SAFE_MIN) return 'safe'
  if (percentLeft >= CAUTION_MIN) return 'caution'
  return 'warning'
}

/**
 * Tailwind class pair for a bucket, built from the existing themed tokens
 * (spec: "기존 토큰 팔레트 사용, 하드코딩 색상 금지") — mirrors the same
 * `bg-[var(--x-bg)] text-[var(--x)]` convention already used for the stream
 * connection chip in Workspace.tsx. Returned as a literal string (not a
 * runtime-built one) so Tailwind's content scan (tailwind.config.js includes
 * `.ts` files) picks up every class unconditionally.
 */
export function gaugeClassName(percentLeft: number): string {
  const bucket = gaugeBucket(percentLeft)
  if (bucket === 'safe') return 'bg-[var(--success-bg)] text-[var(--success)]'
  if (bucket === 'caution') return 'bg-[var(--warning-bg)] text-[var(--warning)]'
  return 'bg-[var(--danger-bg)] text-[var(--danger)]'
}

// ── Low-context notification debounce ───────────────────────────────────
//
// Spec: "터미널당 1회, 25 이상으로 회복하면 재무장" — a small Schmitt-trigger.
// Fires exactly once on the downward crossing below LOW_CONTEXT_THRESHOLD,
// then stays quiet no matter how much further it drops, until percentLeft is
// observed at/above LOW_CONTEXT_REARM_THRESHOLD again, which re-arms it for
// the next crossing. The 15–24 dead zone between the two thresholds
// deliberately leaves the armed flag untouched either way (no flapping right
// at the edge).

export const LOW_CONTEXT_THRESHOLD = 15
export const LOW_CONTEXT_REARM_THRESHOLD = 25

export interface LowContextState {
  /** True = eligible to fire the next time percentLeft drops below the threshold. */
  armed: boolean
}

/** Starts armed: a terminal already below the threshold the first time it's ever observed still gets exactly one notification, not just future crossings. */
export const INITIAL_LOW_CONTEXT_STATE: LowContextState = { armed: true }

export interface LowContextResult {
  state: LowContextState
  /** True exactly once per downward crossing below the threshold. */
  notify: boolean
}

/** `percentLeft === null` ("no gauge yet") never changes the armed state and never notifies. */
export function nextLowContextState(state: LowContextState, percentLeft: number | null): LowContextResult {
  if (percentLeft === null || typeof percentLeft !== 'number' || Number.isNaN(percentLeft)) {
    return { state, notify: false }
  }

  if (percentLeft < LOW_CONTEXT_THRESHOLD) {
    if (!state.armed) return { state, notify: false }
    return { state: { armed: false }, notify: true }
  }

  if (percentLeft >= LOW_CONTEXT_REARM_THRESHOLD) {
    if (state.armed) return { state, notify: false }
    return { state: { armed: true }, notify: false }
  }

  return { state, notify: false }
}
