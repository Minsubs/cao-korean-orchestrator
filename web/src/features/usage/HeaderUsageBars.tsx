// 상단 바의 AI 한도 표시 — 클릭이 아니라 항상 보이는 막대.
//
// This replaces the 사용량 button + popover in the header (사용자 요청): the
// point of a usage indicator is to notice a limit filling up *without* going
// looking for it, and a single aggregated badge behind a click did the
// opposite — it showed one number (the max across accounts) and hid which AI
// it belonged to until you opened the panel.
//
// So the header now shows one bar per active AI, display-only. The full detail
// (token totals, per-model breakdown, reset times, the Claude 한도 실측 opt-in,
// 새로고침) moved to 설정 → AI 계정 사용량 (UsageAccountsSection) so nothing that
// used to live in the popover became unreachable.
//
// "Active" = present && a measured primary rate-limit window. A provider the
// backend reports without limit data contributes no bar rather than an empty
// track — a gauge with nothing behind it reads as 0% used, which is a lie. Those
// accounts are still listed in 설정 with their own reason (`note`).
import { useEffect, useState } from 'react'
import { CLAUDE_LIMITS_OPTIN_EVENT, loadClaudeLimitsOptIn } from './claudeLimitsOptIn'
import { clampPercent, formatBadgePercent, formatUsedPercent, isUsageWarning } from './formatTokens'
import { getProviderLabel } from './providerLabels'
import { useUsageAccounts } from './useUsageAccounts'

export function HeaderUsageBars() {
  // The opt-in is toggled over in 설정, in a different subtree. Mirror it here so
  // the header starts asking the backend for Claude limits as soon as it is
  // turned on, without a reload.
  const [claudeLimitsOptIn, setClaudeLimitsOptIn] = useState(loadClaudeLimitsOptIn)
  useEffect(() => {
    const sync = () => setClaudeLimitsOptIn(loadClaudeLimitsOptIn())
    window.addEventListener(CLAUDE_LIMITS_OPTIN_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CLAUDE_LIMITS_OPTIN_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // `active: true` — unlike the popover, this is always mounted and always
  // visible, so the 60s refresh in useUsageAccounts should always be running.
  const usage = useUsageAccounts(true, claudeLimitsOptIn)
  const bars = usage.accounts.filter(account => account.present && account.rate_limits?.primary)

  // Nothing measured yet (first load, or no CLI has been used): render nothing
  // rather than an empty rail. The header is 50px of shared space.
  if (bars.length === 0) return null

  return (
    <div className="hidden items-center gap-2.5 md:flex" aria-label="AI 한도 사용량">
      {bars.map(account => {
        const primary = account.rate_limits!.primary!
        const label = getProviderLabel(account.provider)
        // Integer in the 50px header (it replaces the old badge, which read the
        // same way); the exact measured value stays in the tooltip and in 설정,
        // so nothing is rounded away from someone who needs it.
        const percent = formatBadgePercent(primary.used_percent)
        const warn = isUsageWarning(primary.used_percent)
        return (
          <div
            key={account.provider}
            className="flex items-center gap-1.5"
            title={`${label} 한도 ${formatUsedPercent(primary.used_percent)} 사용 — 자세히 보기는 설정 › AI 계정 사용량`}
          >
            <span className="text-[10px] font-semibold text-[var(--text-2)]">{label}</span>
            <div
              role="progressbar"
              aria-label={`${label} 한도 사용량`}
              aria-valuenow={clampPercent(primary.used_percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 w-12 overflow-hidden rounded-full bg-[var(--surface-3)]"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${clampPercent(primary.used_percent)}%`,
                  backgroundColor: warn ? 'var(--warning)' : 'var(--accent)',
                }}
              />
            </div>
            <span
              className={`text-[10px] tabular-nums ${warn ? 'text-[var(--warning)]' : 'text-[var(--text-3)]'}`}
            >
              {percent}
            </span>
          </div>
        )
      })}
    </div>
  )
}
