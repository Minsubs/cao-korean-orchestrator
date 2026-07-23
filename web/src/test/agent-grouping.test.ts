import { describe, expect, it } from 'vitest'
import { isTeamWorking, groupAgentsByRole } from '../features/workspace/agentGrouping'

describe('isTeamWorking', () => {
  it('true when any status is PROCESSING', () => {
    expect(isTeamWorking({ a: 'IDLE', b: 'PROCESSING' })).toBe(true)
  })
  it('false when all idle/completed', () => {
    expect(isTeamWorking({ a: 'IDLE', b: 'COMPLETED' })).toBe(false)
  })
})

describe('groupAgentsByRole', () => {
  it('groups orchestrator + workers into ordered role groups', () => {
    const groups = groupAgentsByRole([
      { name: 'codex_orchestrator_sol', provider: 'codex' },
      { name: 'claude_scout_haiku', provider: 'claude_code' },
      { name: 'codex_qa_terra', provider: 'codex' },
    ])
    const keys = groups.map(g => g.key)
    expect(keys[0]).toBe('orchestrator')
    expect(keys).toContain('discovery')
    expect(keys).toContain('verification')
    expect(groups.every(g => g.agents.length > 0)).toBe(true)
  })
})
