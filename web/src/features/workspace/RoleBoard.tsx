// RoleBoard (Phase 4-C, mode A) — vertical role-grouped agent roster for the
// sidebar. Groups agents by role via groupAgentsByRole (T2) and renders each
// as a provider-accented card (T1) with a live StatusBadge.
import { groupAgentsByRole } from './agentGrouping'
import { providerAccent } from '../profiles/providerAccent'
import { providerLabel } from '../profiles/roleData'
import { profileLabel } from '../profiles/profilePresentation'
import { StatusBadge } from '../../components/StatusBadge'

export interface AgentVizItem {
  name: string
  provider?: string | null
  model?: string | null
  terminalId?: string | null
}

export function RoleBoard({ agents, statuses }: { agents: AgentVizItem[]; statuses: Record<string, string> }) {
  const groups = groupAgentsByRole(agents)
  return (
    <div className="space-y-3">
      {groups.map(group => (
        <section key={group.key}>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
            {group.label}
            <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[10px]">{group.agents.length}</span>
          </h3>
          <div className="space-y-1.5">
            {group.agents.map(agent => {
              const accent = providerAccent(agent.provider ?? '')
              const status = agent.terminalId ? statuses[agent.terminalId] ?? null : null
              return (
                <div
                  key={agent.name}
                  className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ backgroundColor: accent.bg, color: accent.fg }}
                  >
                    {(providerLabel(agent.provider ?? '?')[0] ?? '?').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-[var(--text)]">{profileLabel(agent.name)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: accent.bg, color: accent.fg }}
                      >
                        {providerLabel(agent.provider ?? '?')}
                      </span>
                      {agent.model && (
                        <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-2)]">
                          {agent.model}
                        </span>
                      )}
                    </div>
                    <div className="mt-1">
                      <StatusBadge status={status} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
