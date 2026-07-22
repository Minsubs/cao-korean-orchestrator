// Inline per-AI usage bar (Phase D). Unlike UsageButton/UsagePopover (an
// explicit click-to-open panel), this renders directly inside an agent card
// so the currently active AI's usage is always visible — display only, no
// interaction, same visual tone as ContextGaugeChip.
import type { UsageAccount } from '../../api.usage'
import { getProviderLabel } from './providerLabels'
import { formatUsedPercent, isUsageWarning, clampPercent } from './formatTokens'

export function InlineUsageBar({ provider, accounts }: { provider: string; accounts: UsageAccount[] }) {
  // Defensive: callers may pass a still-loading/undefined list (e.g. a fetch
  // that hasn't resolved to the expected shape yet) — treat as "no data" the
  // same as an empty array rather than crashing the whole side panel.
  const list = Array.isArray(accounts) ? accounts : []
  const account = list.find(a => a.provider === provider) ?? null
  const primary = account?.rate_limits?.primary ?? null
  const label = getProviderLabel(provider)
  if (!primary) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-3)]">
        <span className="font-semibold">{label}</span><span>사용량 데이터 없음</span>
      </div>
    )
  }
  const warn = isUsageWarning(primary.used_percent)
  return (
    <div className="w-full" title="한도 사용량 — 표시 전용">
      <div className="mb-0.5 flex items-baseline justify-between text-[10px]">
        <span className="font-semibold text-[var(--text)]">{label}</span>
        <span className={warn ? 'text-[var(--warning)]' : 'text-[var(--text-3)]'}>{formatUsedPercent(primary.used_percent)} 사용</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full" style={{ width: `${clampPercent(primary.used_percent)}%`, backgroundColor: warn ? 'var(--warning)' : 'var(--accent)' }} />
      </div>
    </div>
  )
}
