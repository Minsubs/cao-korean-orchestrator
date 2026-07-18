import { useEffect, useRef, useState } from 'react'
import { Gauge } from 'lucide-react'
import { loadClaudeLimitsOptIn, saveClaudeLimitsOptIn } from './claudeLimitsOptIn'
import { formatBadgePercent, isUsageWarning, maxUsedPercent } from './formatTokens'
import { UsagePopover } from './UsagePopover'
import { useUsageAccounts } from './useUsageAccounts'

export function UsageButton() {
  const [open, setOpen] = useState(false)
  const [claudeLimitsOptIn, setClaudeLimitsOptIn] = useState(loadClaudeLimitsOptIn)
  const rootRef = useRef<HTMLDivElement>(null)
  const usage = useUsageAccounts(open, claudeLimitsOptIn)
  const badge = maxUsedPercent(usage.accounts)
  const warning = badge !== null && isUsageWarning(badge)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  const setClaudeOptIn = (value: boolean) => {
    saveClaudeLimitsOptIn(value)
    setClaudeLimitsOptIn(value)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="AI 사용량"
        aria-expanded={open}
        title="AI 계정별 한도와 토큰 사용량"
        onClick={() => setOpen(current => !current)}
        className={`relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
          open
            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
            : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'
        }`}
      >
        <Gauge size={15} />
        <span className="hidden sm:inline">사용량</span>
        {badge !== null && (
          <span
            className={`min-w-7 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              warning
                ? 'bg-[var(--warning-bg)] text-[var(--warning)]'
                : 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
            }`}
          >
            {formatBadgePercent(badge)}
          </span>
        )}
      </button>

      {open && (
        <UsagePopover
          accounts={usage.accounts}
          scannedAt={usage.scannedAt}
          loading={usage.loading}
          error={usage.error}
          claudeLimitsOptIn={claudeLimitsOptIn}
          onToggleClaudeLimitsOptIn={setClaudeOptIn}
          onRefresh={usage.refresh}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
