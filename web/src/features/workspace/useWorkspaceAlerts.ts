import type { DelegationCard } from './types'

/**
 * Per-worker notifications are deliberately gone.
 *
 * This hook used to raise NotificationCenter alerts for every delegated worker —
 * completed, error, stall, waiting_input — which on a multi-agent run meant a
 * dozen notifications for one task. Notifications now announce only the
 * orchestrator's own answer, which NotificationCenter raises from its own session
 * poll (`terminals[0]` transitions); nothing in the workspace emits per worker.
 *
 * Nothing is hidden by this. Phase 3 put 승인 대기 and 오류 on the in-chat
 * progress card with 승인하러 가기 / 오류 확인 actions, and the agent side panel
 * shows each worker's live badge — the state is on screen, it is simply not
 * pushed at the user.
 *
 * Kept as a no-op rather than deleted so the Workspace call site, its argument
 * contract and the tests that pin "no worker notifications" all stay in one
 * obvious place. Re-introducing worker alerts means changing this file, which is
 * exactly where someone would look.
 */
export function useWorkspaceAlerts(
  _cards: DelegationCard[],
  _terminalStatuses: Record<string, string>,
  _sessionName: string | null,
): void {
  // intentionally empty — see the note above
}
