// Shared terminal-status → theme-color mapping (Phase 2c).
//
// Extracted out of Sidebar.tsx (its former private `statusDotColor`) so the
// fleet Overview's session-grid dots (Overview.tsx) use the exact same color
// rule as the sidebar's session rows, instead of a second hand-copied version
// silently drifting out of sync.

/**
 * Maps a terminal status string (any case) to its themed dot color. Missing
 * or unrecognized status renders neutral rather than guessing.
 */
export function statusDotColor(status: string | null | undefined): string {
  const s = (status || '').toLowerCase()
  if (s === 'processing') return 'var(--info)'
  if (s === 'waiting_user_answer') return 'var(--warning)'
  if (s === 'error') return 'var(--danger)'
  if (s === 'completed') return 'var(--success)'
  return 'var(--neutral)'
}
