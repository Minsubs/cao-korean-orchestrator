// 설정 › AI 계정 사용량 — 예전 사용량 팝오버의 내용이 여기로 옮겨왔다.
//
// The header's usage widget became always-visible per-AI bars (HeaderUsageBars),
// which are display-only. Everything the popover carried besides the bars —
// account cards with token totals and per-model breakdown, the Claude 한도 실측
// opt-in toggle, the honesty `note`, scanned_at and 새로고침 — lives here now, so
// removing the button did not remove any control.
//
// Same states as the popover, for the same reasons: a background 60s poll or a
// manual refresh that fails while cards are already on screen shows a small
// inline banner instead of blanking the cards into a full-panel error.
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { AccountCard } from './AccountCard'
import { loadClaudeLimitsOptIn, saveClaudeLimitsOptIn } from './claudeLimitsOptIn'
import { formatRelativeIso } from './formatTokens'
import { useUsageAccounts } from './useUsageAccounts'

export function UsageAccountsSection() {
  const [claudeLimitsOptIn, setClaudeLimitsOptIn] = useState(loadClaudeLimitsOptIn)
  const usage = useUsageAccounts(true, claudeLimitsOptIn)

  const setClaudeOptIn = (value: boolean) => {
    // saveClaudeLimitsOptIn also notifies HeaderUsageBars, which fetches with
    // the same flag from a different subtree.
    saveClaudeLimitsOptIn(value)
    setClaudeLimitsOptIn(value)
  }

  const present = usage.accounts.filter(account => account.present)
  const initialLoading = usage.loading && present.length === 0 && !usage.error
  const showFullError = !!usage.error && present.length === 0
  const showEmpty = !usage.loading && !usage.error && present.length === 0

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-5" aria-label="AI 계정 사용량">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-2)]">AI 계정 사용량</h3>
        <button
          type="button"
          onClick={usage.refresh}
          disabled={usage.loading}
          aria-label="사용량 새로고침"
          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={12} className={usage.loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>
      <p className="mb-4 text-xs text-[var(--text-3)]">
        계정별 한도와 토큰 사용량이에요. 한도 막대는 상단 바에도 항상 보여요.
      </p>

      {initialLoading ? (
        <div aria-label="불러오는 중" className="space-y-2.5">
          <div className="h-20 animate-pulse rounded-2xl bg-[var(--surface)]" />
          <div className="h-20 animate-pulse rounded-2xl bg-[var(--surface)]" />
        </div>
      ) : showFullError ? (
        <div className="px-2 py-8 text-center text-xs text-[var(--danger)]">{usage.error}</div>
      ) : showEmpty ? (
        <div className="px-2 py-8 text-center text-xs text-[var(--text-3)]">
          표시할 사용량 데이터가 없어요 — CLI를 한 번 이상 사용하면 생겨요
        </div>
      ) : (
        <div className="space-y-2.5">
          {usage.error && (
            <div className="rounded-lg bg-[var(--danger-bg)] px-2.5 py-1.5 text-[10.5px] text-[var(--danger)]">
              {usage.error}
            </div>
          )}
          {present.map(account => (
            <AccountCard
              key={account.provider}
              account={account}
              claudeLimitsOptIn={claudeLimitsOptIn}
              onToggleClaudeLimitsOptIn={setClaudeOptIn}
            />
          ))}
        </div>
      )}

      <div className="mt-3 border-t border-[var(--border-soft)] pt-2.5">
        <span
          className="text-[10.5px] text-[var(--text-3)]"
          title={usage.scannedAt ? new Date(usage.scannedAt).toLocaleString('ko-KR') : undefined}
        >
          {usage.scannedAt ? `${formatRelativeIso(usage.scannedAt)} 갱신` : '아직 갱신되지 않음'}
        </span>
      </div>
    </section>
  )
}
