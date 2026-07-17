import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
}

/**
 * Honest "not built yet" placeholder for shell views that don't have Phase 2/3
 * content behind them yet (Phase 1b principle: no fake UI — no buttons that
 * do nothing, no empty skeletons pretending to be a feature). Just what's
 * missing and where the real functionality lives today.
 *
 * Styled entirely from theme.generated.css variables (Phase 1a) so it fully
 * supports both light and dark, unlike the legacy panels it sits alongside.
 */
export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div
      role="region"
      aria-label={title}
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-2)]">
        {icon}
      </div>
      <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
      <p className="max-w-sm text-xs leading-relaxed text-[var(--text-3)]">{description}</p>
    </div>
  )
}
