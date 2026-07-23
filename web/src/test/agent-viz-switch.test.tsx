import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentSidePanel } from '../features/workspace/AgentSidePanel'
import type { DelegationCard } from '../features/workspace/types'

// Phase 4-C Task 4: the agents 탭 summary viz auto-switches between RoleBoard
// (mode A, idle) and DelegationHierarchy (mode B, a worker is PROCESSING),
// driven by isTeamWorking(terminalStatuses) — with a manual toggle that
// overrides the auto pick. Asserted via a `data-testid="agent-viz"
// data-view="board"|"hier"` marker on the summary section wrapper rather than
// text content, since RoleBoard and DelegationHierarchy share the same
// role-group labels and would otherwise be ambiguous to distinguish in the DOM.

const SUPERVISOR = {
  id: 'aaaaaaaa',
  tmux_session: 'sess-a',
  tmux_window: '1',
  provider: 'codex',
  agent_profile: 'codex_orchestrator_sol',
  created_at: null,
  last_active: null,
}

const CARD: DelegationCard = {
  terminalId: 'bbbbbbbb',
  sessionId: 'sess-a',
  agentName: 'codex_qa_terra',
  provider: 'codex',
  callerId: 'aaaaaaaa',
  callerAgentName: 'codex_orchestrator_sol',
  status: 'idle',
  prevStatus: null,
  location: null,
  locationLoaded: true,
  instruction: null,
  instructionType: null,
  instructionFromId: null,
  killed: false,
  lastActivityAt: null,
  lastOutputAt: null,
  firstSeenAt: Date.now(),
  hasSignal: true,
}

function renderPanel(terminalStatuses: Record<string, string>) {
  const noop = () => {}
  return render(
    <AgentSidePanel
      collapsed={false}
      sessionName="sess-a"
      terminals={[SUPERVISOR]}
      cards={[CARD]}
      terminalStatuses={terminalStatuses}
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

describe('AgentSidePanel agent-viz A/B switch (Phase 4-C Task 4)', () => {
  afterEach(() => window.localStorage.clear())

  it('shows the board (A) when the whole team is idle', () => {
    renderPanel({ bbbbbbbb: 'idle' })
    expect(screen.getByTestId('agent-viz')).toHaveAttribute('data-view', 'board')
  })

  it('auto-switches to the hierarchy (B) when a worker is PROCESSING', () => {
    renderPanel({ bbbbbbbb: 'PROCESSING' })
    expect(screen.getByTestId('agent-viz')).toHaveAttribute('data-view', 'hier')
  })

  it('a manual toggle overrides the auto-selected view', () => {
    renderPanel({ bbbbbbbb: 'PROCESSING' })
    expect(screen.getByTestId('agent-viz')).toHaveAttribute('data-view', 'hier')

    fireEvent.click(screen.getByRole('button', { name: '보드' }))
    expect(screen.getByTestId('agent-viz')).toHaveAttribute('data-view', 'board')

    fireEvent.click(screen.getByRole('button', { name: '계층' }))
    expect(screen.getByTestId('agent-viz')).toHaveAttribute('data-view', 'hier')
  })

  it('keeps the existing detailed AgentCard list intact alongside the summary viz (no regression)', () => {
    renderPanel({ bbbbbbbb: 'idle' })
    // Supervisor + worker card action buttons still render (existing detail list).
    expect(screen.getAllByTitle('메시지 보내기').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByTitle('중지').length).toBeGreaterThanOrEqual(2)
  })
})
