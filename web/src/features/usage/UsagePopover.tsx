// Right-aligned popover for the TopBar's AI 사용량 위젯 (spec §2). Owns:
// loading skeleton / error state / empty state, the present:true account
// card list, and the scanned_at + 새로고침 footer with its 60s auto-refresh
// (the interval itself lives in useUsageAccounts.ts, driven by the `active`
// flag UsageButton.tsx passes while this popover is mounted).
//
// Closing: ESC is self-registered here (mirrors CommandPalette.tsx's own
// hotkey registration); the outside-click half of "ESC/외부 클릭 닫힘" lives in
// UsageButton.tsx, which wraps both the trigger button and this popover in
// one ref (same split CustomSelect.tsx uses for its trigger+dropdown).
import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import type { UsageAccount } from '../../api.usage'
import { AccountCard } from './AccountCard'
import { formatRelativeIso } from './formatTokens'

export interface UsagePopoverProps {
  accounts: UsageAccount[]
  scannedAt: string | null
  loading: boolean
  error: string | null
  claudeLimitsOptIn: boolean
  onToggleClaudeLimitsOptIn: (value: boolean) => void
  onRefresh: () => void
  onClose: () => void
}

export function UsagePopover({
  accounts,
  scannedAt,
  loading,
  error,
  claudeLimitsOptIn,
  onToggleClaudeLimitsOptIn,
  onRefresh,
  onClose,
}: UsagePopoverProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const present = accounts.filter(a => a.present)
  // First load only (no data yet, nothing to fall back to) — a background
  // 60s poll or manual refresh that happens to fail while cards are already
  // showing must never blank them back out to a full-page error (see
  // useUsageAccounts.ts's "honesty-over-flicker" comment); it gets a small
  // inline banner above the existing cards instead.
  const initialLoading = loading && present.length === 0 && !error
  const showFullError = !!error && present.length === 0
  const showEmpty = !loading && !error && present.length === 0

  return (
    <div
      role="dialog"
      aria-label="AI 계정 사용량"
      className="absolute right-0 top-full z-[60] mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
    >
      <div className="border-b border-[var(--border-soft)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--text)]">AI 계정 사용량</h2>
        <p className="mt-0.5 text-[11px] text-[var(--text-3)]">계정별 한도와 토큰 사용량이에요.</p>
      </div>

      <div className="max-h-[420px] overflow-y-auto p-3">
        {initialLoading ? (
          <div aria-label="불러오는 중" className="space-y-2.5">
            <div className="h-20 animate-pulse rounded-2xl bg-[var(--surface-2)]" />
            <div className="h-20 animate-pulse rounded-2xl bg-[var(--surface-2)]" />
          </div>
        ) : showFullError ? (
          <div className="px-2 py-8 text-center text-xs text-[var(--danger)]">{error}</div>
        ) : showEmpty ? (
          <div className="px-2 py-8 text-center text-xs text-[var(--text-3)]">
            표시할 사용량 데이터가 없어요 — CLI를 한 번 이상 사용하면 생겨요
          </div>
        ) : (
          <div className="space-y-2.5">
            {error && (
              <div className="rounded-lg bg-[var(--danger-bg)] px-2.5 py-1.5 text-[10.5px] text-[var(--danger)]">{error}</div>
            )}
            {present.map(account => (
              <AccountCard
                key={account.provider}
                account={account}
                claudeLimitsOptIn={claudeLimitsOptIn}
                onToggleClaudeLimitsOptIn={onToggleClaudeLimitsOptIn}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-soft)] px-4 py-2.5">
        <span
          className="text-[10.5px] text-[var(--text-3)]"
          title={scannedAt ? new Date(scannedAt).toLocaleString('ko-KR') : undefined}
        >
          {scannedAt ? `${formatRelativeIso(scannedAt)} 갱신` : '아직 갱신되지 않음'}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="사용량 새로고침"
          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>
    </div>
  )
}
