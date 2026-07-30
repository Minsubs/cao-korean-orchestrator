import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentSidePanel } from '../features/workspace/AgentSidePanel'
import type { DelegationCard } from '../features/workspace/types'

// Live-verification defect: the supervisor's AgentCard rendered its profile label
// (오케스트레이터) *and* a hardcoded 오케스트레이터 role badge, so the panel read
// "오케스트레이터오케스트레이터". Pinned here on the rendered DOM rather than only
// on the helper, because the defect was in how the card composed the two values.

const SUPERVISOR = {
  id: '75c0c44a',
  tmux_session: 'sess-a',
  tmux_window: '1',
  provider: 'codex',
  agent_profile: 'codex_orchestrator_sol',
  created_at: null,
  last_active: null,
}

const WORKER: DelegationCard = {
  terminalId: '16b8e26a',
  sessionId: 'sess-a',
  agentName: 'claude_scout_haiku',
  provider: 'claude_code',
  callerId: '75c0c44a',
  callerAgentName: 'codex_orchestrator_sol',
  status: 'completed',
  prevStatus: null,
  location: null,
  locationLoaded: true,
  instruction: null,
  instructionType: null,
  instructionFromId: null,
  killed: true,
  lastActivityAt: null,
  lastOutputAt: null,
  firstSeenAt: Date.now(),
  hasSignal: true,
}

function renderPanel(supervisorProfile = SUPERVISOR.agent_profile) {
  const noop = () => {}
  return render(
    <AgentSidePanel
      collapsed={false}
      sessionName="sess-a"
      terminals={[{ ...SUPERVISOR, agent_profile: supervisorProfile }]}
      cards={[WORKER]}
      terminalStatuses={{ '75c0c44a': 'COMPLETED' }}
      sessionWorkingDirectory="/home/user/project"
      onMessageTarget={noop}
      onOpenTerminal={noop}
      onOpenOutput={noop}
      onOpenInbox={noop}
      onRequestStop={noop}
      onRequestDelete={noop}
      onRequestEndSession={noop}
      onAgentAdded={noop}
    />,
  )
}

describe('AgentCard role badge', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('never prints the orchestrator role twice on the supervisor card', () => {
    renderPanel()
    expect(document.body.textContent).not.toContain('오케스트레이터오케스트레이터')
  })

  it('still marks a differently-named orchestrator profile with its role', () => {
    // Guard against "fixing" this by deleting the badge outright: an unknown
    // profile falls back to its own name, and then the role mark is the only
    // thing identifying which card is the supervisor.
    renderPanel('release_captain')
    expect(screen.getAllByText('오케스트레이터').length).toBeGreaterThanOrEqual(1)
  })
})
