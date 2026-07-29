import {
  isOrchestratorProfile,
  workerGroup,
  additionalProfileRole,
  WORKER_GROUPS,
  ADDITIONAL_ROLE_LABELS,
} from '../profiles/profilePresentation'
import type { ProfileLike } from '../profiles/profilePresentation'
import type { DelegationCard } from './types'

const WORKING_STATUSES = new Set(['PROCESSING', 'WAITING_USER_ANSWER'])

export function isTeamWorking(statuses: Record<string, string>): boolean {
  return Object.values(statuses).some(status => WORKING_STATUSES.has((status || '').toUpperCase()))
}

/**
 * Session-scoped, card-aware status map for the agent panel.
 *
 * The global `terminalStatuses` store is session-agnostic and is never pruned
 * in the Workspace — `clearTerminalStatuses` is only wired into the classic
 * DashboardHome. So a handoff worker that finished and was auto-deleted keeps
 * its last `PROCESSING` in the store indefinitely, and entries belonging to
 * other sessions are visible too. Anything reading the raw store therefore
 * over-reports work (wrong "N/N 워커 작업 중", wrong board→hierarchy switch).
 *
 * Build the map from this session's own supervisor and cards instead, and let
 * an ended card win over whatever the store still remembers — the same rule
 * the per-card badge already applies.
 */
export function sessionStatusMap(params: {
  supervisorId: string | null
  cards: Pick<DelegationCard, 'terminalId' | 'status' | 'killed'>[]
  terminalStatuses: Record<string, string>
}): Record<string, string> {
  const { supervisorId, cards, terminalStatuses } = params
  const map: Record<string, string> = {}

  if (supervisorId) {
    const status = terminalStatuses[supervisorId]
    if (status) map[supervisorId] = status.toUpperCase()
  }

  for (const card of cards) {
    if (card.killed) {
      map[card.terminalId] = (card.status ?? 'completed').toUpperCase()
      continue
    }
    const status = terminalStatuses[card.terminalId] || card.status
    if (status) map[card.terminalId] = status.toUpperCase()
  }

  return map
}

export type AgentRoleGroup<T> = { key: string; label: string; agents: T[] }

const GROUP_ORDER = ['orchestrator', 'discovery', 'implementation', 'verification'] as const

export function groupAgentsByRole<T extends { name: string; provider?: string | null }>(
  agents: T[],
): AgentRoleGroup<T>[] {
  const buckets = new Map<string, { label: string; agents: T[] }>()
  const push = (key: string, label: string, agent: T) => {
    const bucket = buckets.get(key) ?? { label, agents: [] }
    bucket.agents.push(agent)
    buckets.set(key, bucket)
  }

  for (const agent of agents) {
    if (isOrchestratorProfile(agent.name)) {
      push('orchestrator', '오케스트레이터', agent)
      continue
    }
    const profile: ProfileLike = { name: agent.name, source: 'built-in', provider: agent.provider ?? null }
    const group = workerGroup(profile)
    if (group) {
      push(group, WORKER_GROUPS[group].label, agent)
      continue
    }
    const role = additionalProfileRole(profile)
    push(role, ADDITIONAL_ROLE_LABELS[role] ?? role, agent)
  }

  const ordered: AgentRoleGroup<T>[] = []
  for (const key of GROUP_ORDER) {
    const bucket = buckets.get(key)
    if (bucket) {
      ordered.push({ key, ...bucket })
      buckets.delete(key)
    }
  }
  for (const [key, bucket] of buckets) {
    ordered.push({ key, ...bucket })
  }
  return ordered
}
