// Shared constants for the Orchestration Workspace feature.

/** Terminal considered "stalled" once processing has produced no activity for this long. */
export const STALL_MS = 5 * 60 * 1000

/** SSE reconnect backoff: starts at 1s, doubles, caps at 30s (spec §backend contract). */
export const SSE_BACKOFF_INITIAL_MS = 1000
export const SSE_BACKOFF_MAX_MS = 30000

/**
 * sessionStorage handoff for `cao:select-session` fired while Workspace is
 * unmounted (another view active): AppShell stashes the session name here as
 * it switches views; Workspace consumes it once on mount. Session-scoped so a
 * stale value never survives a browser restart.
 */
export const PENDING_SELECT_KEY = 'cao:pending-select-session'

export const STORAGE_KEYS = {
  projects: 'cao:projects:v1',
  sidebarCollapsed: 'cao:workspace:sidebar-collapsed',
  rpanelCollapsed: 'cao:workspace:rpanel-collapsed',
  workbench: 'cao:workspace:workbench:v1',
  composerHistory: 'cao:workspace:composer-history:v1:',
  teamRoster: 'cao:workspace:team-roster:v1:',
  delegationHistory: 'cao:workspace:delegation-history:v1:',
  // Shared with the classic SessionChatPanel (src/components/SessionChatPanel.tsx) —
  // ported logic reads/writes the SAME key prefix so history stays compatible
  // whichever surface (classic modal vs. inline Thread) is used.
  sessionChat: 'cao:session-chat:v2:',
} as const

/** The 6 deterministic pastel avatar pairs available in theme.generated.css. */
export const AVATAR_PALETTE = ['mint', 'sky', 'lilac', 'peach', 'lemon', 'rose'] as const
export type AvatarColorKey = (typeof AVATAR_PALETTE)[number]
