import { profileLabel } from '../profiles/profilePresentation'

// 이름 옆에 붙는 역할 표기를 한 곳에서 만든다.
//
// Two defects found while verifying the live server made the same mistake in two
// places: they combined a profile's display name with a role word without
// checking whether the name *already is* that word. The supervisor AgentCard
// rendered `오케스트레이터` plus an `오케스트레이터` badge, and the composer's
// target button showed `codex_orchestrator_sol · 오케스트레이터` — a raw profile
// id in user-facing copy, which is exactly what profileLabel() exists to keep
// out of the UI.
//
// The role word is still worth showing when it adds something: a custom
// orchestrator profile named "릴리즈 지휘" needs the `오케스트레이터` mark to be
// recognisable as the fixed role. So the rule is not "drop the role" but "drop
// the role when it repeats the name".

/** The fixed supervisor role, as users read it. */
export const ORCHESTRATOR_ROLE = '오케스트레이터'

/**
 * The role badge to render next to `name`, or null when it would just repeat it.
 */
export function roleBadgeFor(name: string, role: string | null | undefined): string | null {
  if (!role) return null
  return role.trim() === name.trim() ? null : role
}

/**
 * Label for one entry in the composer's 받는 대상 list. Never exposes a profile
 * id: an unknown profile falls back through profileLabel(), and a terminal with
 * no profile at all falls back to its short id (the only identifier there is).
 */
export function composerTargetLabel(
  agentProfile: string | null | undefined,
  terminalId: string,
  isSupervisor: boolean,
): string {
  const name = agentProfile ? profileLabel(agentProfile) : terminalId.slice(0, 8)
  if (!isSupervisor) return name
  const role = roleBadgeFor(name, ORCHESTRATOR_ROLE)
  return role ? `${name} · ${role}` : name
}
