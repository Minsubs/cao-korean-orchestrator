// Context-gauge polling for the Phase 2d remaining-context UI (spec §2d).
//
// Centralized once per selected session (mirrors useWorkspaceAlerts.ts's
// "own the poll once, not per component" shape) so the Workbench header and
// every AgentSidePanel row read the exact same `percent_left` per terminal
// instead of each mounting its own interval against the same endpoint.
//
// Display only: this hook never sends any command (no auto-/compact) — it
// only reads the gauge and, on a debounced downward crossing, raises a single
// low-context notification through the existing workspace-alert path.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUi } from '../../api.ui'
import { emitWorkspaceAlert } from '../../components/NotificationCenter'
import { INITIAL_LOW_CONTEXT_STATE, nextLowContextState, type LowContextState } from './contextGauge'

/** Poll interval for a visible, gauge-eligible terminal (spec: "20s 간격"). */
const POLL_MS = 20000

/**
 * Only claude_code's CLI footer is scraped for a percentage today (Codex has
 * none — see api/ui_features_router.py `get_terminal_context`'s docstring).
 * Spec: "provider가 claude_code가 아니면 호출 자체를 생략해도 됨" — skip the round
 * trip entirely for every other provider instead of polling for a
 * guaranteed-null result.
 */
const GAUGE_PROVIDER = 'claude_code'

export interface GaugeTerminal {
  id: string
  provider: string | null
  /** Best-known display label, used only for the low-context notification text. */
  label: string | null
}

/** terminalId → remaining-context percentage. A terminal absent from this map simply hasn't been polled yet (or isn't gauge-eligible) — same "render nothing" treatment as an explicit `null`. */
export type GaugeMap = Record<string, number | null>

export function useContextGauges(
  terminals: GaugeTerminal[],
  terminalStatuses: Record<string, string>,
  sessionName: string | null,
): GaugeMap {
  const [percentLeft, setPercentLeft] = useState<GaugeMap>({})
  const lowStateRef = useRef<Record<string, LowContextState>>({})
  const prevStatusRef = useRef<Record<string, string>>({})
  const mountedRef = useRef(true)

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  const fetchGauge = useCallback(
    async (terminalId: string, label: string | null) => {
      try {
        const res = await apiUi.getTerminalContext(terminalId)
        if (!mountedRef.current) return
        // Defensive: coerce anything that isn't a real number (an
        // unexpectedly-shaped response, a stubbed test fetch, etc.) to `null`
        // ("no gauge") rather than ever rendering something like `NaN%`.
        const value = typeof res?.percent_left === 'number' ? res.percent_left : null

        setPercentLeft(prev => (prev[terminalId] === value ? prev : { ...prev, [terminalId]: value }))

        const prior = lowStateRef.current[terminalId] ?? INITIAL_LOW_CONTEXT_STATE
        const { state, notify } = nextLowContextState(prior, value)
        lowStateRef.current[terminalId] = state
        if (notify) {
          const shown = label || terminalId.slice(0, 8)
          emitWorkspaceAlert(
            'stall',
            `⚠️ ${shown} 컨텍스트 부족 (${value}%)`,
            '/compact 를 고려하세요 — 컨텍스트가 얼마 남지 않았어요.',
            terminalId,
            sessionName ?? undefined,
          )
        }
      } catch {
        // 404 (terminal gone) or a transient network error — keep the
        // last-known value in place and never crash the poll loop.
      }
    },
    [sessionName],
  )

  const relevant = terminals.filter(t => t.provider === GAUGE_PROVIDER)
  const relevantKey = relevant.map(t => `${t.id}:${t.label ?? ''}`).join(',')

  // 20s poll for every gauge-eligible terminal in the current session.
  useEffect(() => {
    if (relevant.length === 0) return
    const poll = () => relevant.forEach(t => void fetchGauge(t.id, t.label))
    poll()
    const interval = setInterval(poll, POLL_MS)
    return () => clearInterval(interval)
    // `relevantKey` fully captures the (id, label) pairs this closure needs —
    // it only restarts the interval when the actual gauge-eligible set
    // changes, not on every unrelated Workspace re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevantKey, fetchGauge])

  // One immediate re-poll the instant a gauge-eligible terminal flips
  // processing -> idle (spec: "터미널 상태가 processing→idle 전환 시 1회 즉시").
  useEffect(() => {
    relevant.forEach(t => {
      const cur = (terminalStatuses[t.id] || '').toLowerCase()
      const prev = prevStatusRef.current[t.id]
      if (prev === 'processing' && cur === 'idle') void fetchGauge(t.id, t.label)
      prevStatusRef.current[t.id] = cur
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalStatuses, relevantKey, fetchGauge])

  // Drop entries for terminals no longer present (session switch / terminal
  // killed) so a stale percentage can never resurface under a reused id.
  useEffect(() => {
    setPercentLeft(prev => {
      const known = new Set(terminals.map(t => t.id))
      let changed = false
      const next: GaugeMap = {}
      for (const [id, value] of Object.entries(prev)) {
        if (known.has(id)) next[id] = value
        else changed = true
      }
      return changed ? next : prev
    })
  }, [terminals])

  return percentLeft
}
