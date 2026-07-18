import { afterEach, describe, expect, it } from 'vitest'
import { buildCardFromTerminalCreated } from '../features/workspace/threadReducer'
import { loadDelegationHistory, saveDelegationHistory } from '../features/workspace/delegationHistory'
import { inferTeamRosterFromOutput, loadTeamRoster, saveTeamRoster } from '../features/workspace/teamRoster'

describe('workspace team and delegation persistence', () => {
  afterEach(() => window.localStorage.clear())

  it('preserves the selected team roster for the session', () => {
    saveTeamRoster('cao-test', [
      { name: 'claude_developer_sonnet', provider: 'claude_code' },
      { name: 'codex_qa_terra', provider: 'codex' },
    ])

    expect(loadTeamRoster('cao-test')).toEqual([
      { name: 'claude_developer_sonnet', provider: 'claude_code' },
      { name: 'codex_qa_terra', provider: 'codex' },
    ])
  })

  it('recovers unique legacy handoff profiles from supervisor output', () => {
    const output = [
      'handoff({"agent_profile":"claude_architect_opus","message":"go"})',
      'handoff({"agent_profile":"codex_qa_terra","message":"go"})',
      'handoff({"agent_profile":"codex_qa_terra","message":"duplicate"})',
      'untrusted agent_profile: ../../bad',
    ].join('\n')

    expect(inferTeamRosterFromOutput(output)).toEqual([
      { name: 'claude_architect_opus', provider: 'claude' },
      { name: 'codex_qa_terra', provider: 'codex' },
    ])
  })

  it('preserves a completed auto-cleaned handoff card across a reload', () => {
    const card = {
      ...buildCardFromTerminalCreated({
        terminal_id: 'worker01',
        agent_name: 'codex_qa_terra',
        provider: 'codex',
        session_id: 'cao-test',
      }, 1000),
      instruction: '연결 테스트',
      status: 'completed',
      killed: true,
    }
    saveDelegationHistory('cao-test', [card])

    expect(loadDelegationHistory('cao-test').worker01).toMatchObject({
      agentName: 'codex_qa_terra',
      instruction: '연결 테스트',
      status: 'completed',
      killed: true,
    })
  })
})
