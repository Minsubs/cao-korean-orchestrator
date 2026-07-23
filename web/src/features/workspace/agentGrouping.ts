import {
  isOrchestratorProfile,
  workerGroup,
  additionalProfileRole,
  WORKER_GROUPS,
  ADDITIONAL_ROLE_LABELS,
} from '../profiles/profilePresentation'
import type { ProfileLike } from '../profiles/profilePresentation'

const WORKING_STATUSES = new Set(['PROCESSING', 'WAITING_USER_ANSWER'])

export function isTeamWorking(statuses: Record<string, string>): boolean {
  return Object.values(statuses).some(status => WORKING_STATUSES.has((status || '').toUpperCase()))
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
