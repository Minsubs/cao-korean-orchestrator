// Data fetching for the AI 사용량 widget. Mirrors the shape of
// features/workspace/useFleetSummaries.ts (own the poll once, expose
// loading/error, never fabricate data on failure) but scoped to this
// feature's own endpoint/hook so it stays entirely inside features/usage's
// ownership.
//
// Fetch timing:
//  - Always fetches once on mount (and whenever `claudeLimitsOptIn` flips) so
//    the TopBar badge has data even before the popover is ever opened.
//  - While `active` (the popover is open) it also refreshes every 60s (spec:
//    "열려 있는 동안 60초 자동 갱신") — the interval is torn down the instant
//    `active` goes false or the component unmounts (spec: "닫히면 타이머
//    정리"), so no fetch ever fires after that point.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUsage, type UsageAccount } from '../../api.usage'

const POLL_MS = 60000

export interface UsageAccountsState {
  accounts: UsageAccount[]
  scannedAt: string | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useUsageAccounts(active: boolean, claudeLimitsOptIn: boolean): UsageAccountsState {
  const [accounts, setAccounts] = useState<UsageAccount[]>([])
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchOnce = useCallback(async () => {
    const requestId = ++requestIdRef.current
    // Flips true on *every* cycle, not just the first — lets the popover
    // distinguish "first load, nothing to show yet" (full skeleton) from "a
    // background 60s poll / manual refresh is in flight while we already
    // have data" (small spinner on the refresh button only) using the same
    // flag, without a second piece of state.
    setLoading(true)
    try {
      const res = await apiUsage.getAccounts({ claudeLimits: claudeLimitsOptIn })
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setAccounts(res.accounts)
      setScannedAt(res.scanned_at)
      setError(null)
      setLoading(false)
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      // Keep the last-known accounts in place (honesty-over-flicker, same as
      // useFleetSummaries.ts) — only the error banner appears; the widget
      // never blanks out data that was already successfully shown.
      setError('사용량 API에 연결할 수 없어요')
      setLoading(false)
    }
  }, [claudeLimitsOptIn])

  useEffect(() => {
    void fetchOnce()
    if (!active) return
    const interval = setInterval(() => void fetchOnce(), POLL_MS)
    return () => clearInterval(interval)
  }, [active, fetchOnce])

  return { accounts, scannedAt, loading, error, refresh: fetchOnce }
}
