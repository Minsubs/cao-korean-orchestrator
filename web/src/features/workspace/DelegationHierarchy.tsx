// DelegationHierarchy (Phase 4-C, mode B) — "who delegated to whom" view for
// the sidebar: the orchestrator on top (highlighted, with an aggregate
// working-count), a vertical connector, and the role groups (T2's
// groupAgentsByRole) stacked below it. A role group is highlighted while any
// of its members' terminals is PROCESSING — this is the view AgentSidePanel
// auto-switches to while the team is working (see agentGrouping.isTeamWorking).
import { groupAgentsByRole } from './agentGrouping'
import { providerAccent } from '../profiles/providerAccent'
import { providerLabel } from '../profiles/roleData'
import { profileLabel } from '../profiles/profilePresentation'
import { StatusBadge } from '../../components/StatusBadge'
import type { AgentVizItem } from './RoleBoard'

const WORKING_STATUSES = new Set(['PROCESSING', 'WAITING_USER_ANSWER'])

function statusOf(agent: AgentVizItem, statuses: Record<string, string>): string | null {
  return agent.terminalId ? statuses[agent.terminalId] ?? null : null
}

export function DelegationHierarchy({
  orchestrator,
  agents,
  statuses,
}: {
  orchestrator: AgentVizItem
  agents: AgentVizItem[]
  statuses: Record<string, string>
}) {
  const groups = groupAgentsByRole(agents)
  const total = agents.length
  const working = agents.filter(agent => {
    const status = statusOf(agent, statuses)
    return status ? WORKING_STATUSES.has(status.toUpperCase()) : false
  }).length
  const orchestratorAccent = providerAccent(orchestrator.provider ?? '')

  return (
    <div>
      <div className="rounded-xl border-2 border-[var(--accent)] bg-[var(--surface)] p-2.5">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{ backgroundColor: orchestratorAccent.bg, color: orchestratorAccent.fg }}
          >
            {(providerLabel(orchestrator.provider ?? '?')[0] ?? '?').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold text-[var(--text)]">{profileLabel(orchestrator.name)}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: orchestratorAccent.bg, color: orchestratorAccent.fg }}
              >
                {providerLabel(orchestrator.provider ?? '?')}
              </span>
              {orchestrator.model && (
                <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-2)]">
                  {orchestrator.model}
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-[10.5px] text-[var(--text-3)]">{working}/{total} 워커 작업 중</p>
      </div>

      <div className="ml-4 border-l-2 border-dashed border-[var(--border)] pl-3">
        <div className="space-y-2 py-2">
          {groups.map(group => {
            const active = group.agents.some(agent => statusOf(agent, statuses)?.toUpperCase() === 'PROCESSING')
            return (
              <section
                key={group.key}
                className={`rounded-xl border p-2 ${
                  active ? 'border-[var(--warning)] bg-[var(--warning-bg)]' : 'border-dashed border-[var(--border)]'
                }`}
              >
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">{group.label}</h3>
                <div className="space-y-1">
                  {group.agents.map(agent => {
                    const accent = providerAccent(agent.provider ?? '')
                    const status = statusOf(agent, statuses)
                    return (
                      <div key={agent.name} className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: accent.bg, color: accent.fg }}
                        >
                          {providerLabel(agent.provider ?? '?')}
                        </span>
                        <span className="truncate text-[11px] font-medium text-[var(--text)]">{profileLabel(agent.name)}</span>
                        {agent.model && (
                          <span className="truncate font-mono text-[10px] text-[var(--text-2)]">{agent.model}</span>
                        )}
                        <StatusBadge status={status} />
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
