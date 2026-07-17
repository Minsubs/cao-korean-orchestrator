import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Workbench } from '../features/workspace/Workbench'
import { AgentSidePanel } from '../features/workspace/AgentSidePanel'

// Phase 2d (spec §2d) display-location coverage: the gauge chip must actually
// show up where the spec says it should — the Workbench context-terminal
// header, and each AgentSidePanel row (supervisor + worker cards) — driven
// through the real prop wiring, not just the pure contextGauge.ts logic
// (covered separately in workspace-context-gauge.test.ts) or the chip's own
// render rules in isolation (workspace-context-gauge-chip.test.tsx).

const SUPERVISOR = {
  id: 'aaaaaaaa',
  tmux_session: 'sess-a',
  tmux_window: '1',
  provider: 'claude_code',
  agent_profile: 'sol',
  created_at: null,
  last_active: null,
}

describe('Workbench context header gauge (spec §2d)', () => {
  afterEach(() => window.localStorage.clear())

  it('shows the gauge chip next to the context terminal identity when a percentage is known', () => {
    render(
      <Workbench
        events={[]}
        contextTerminalId="aaaaaaaa"
        contextLabel="sol"
        contextProvider="claude_code"
        contextPercentLeft={42}
        requestedTab={null}
        requestNonce={0}
      />,
    )
    expect(screen.getByText('잔여 42%')).toBeInTheDocument()
  })

  it('renders no gauge at all when the percentage is null (never a placeholder)', () => {
    render(
      <Workbench
        events={[]}
        contextTerminalId="aaaaaaaa"
        contextLabel="sol"
        contextProvider="codex"
        contextPercentLeft={null}
        requestedTab={null}
        requestNonce={0}
      />,
    )
    expect(screen.queryByText(/잔여/)).not.toBeInTheDocument()
  })

  it('omitting contextPercentLeft entirely (prop not passed) degrades the same as null', () => {
    render(<Workbench events={[]} contextTerminalId="aaaaaaaa" contextLabel="sol" contextProvider="claude_code" requestedTab={null} requestNonce={0} />)
    expect(screen.queryByText(/잔여/)).not.toBeInTheDocument()
  })
})

describe('AgentSidePanel row gauges (spec §2d)', () => {
  const noop = () => {}
  beforeEach(() => window.localStorage.clear())

  it('shows the supervisor row\'s gauge from the `gauges` map keyed by terminal id', () => {
    render(
      <AgentSidePanel
        collapsed={false}
        sessionName="sess-a"
        terminals={[SUPERVISOR]}
        cards={[]}
        terminalStatuses={{}}
        sessionWorkingDirectory="/home/user/project"
        gauges={{ aaaaaaaa: 8 }}
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
    expect(screen.getByText('잔여 8%')).toBeInTheDocument()
  })

  it('renders no gauge for a terminal absent from the `gauges` map (e.g. a non-claude_code provider)', () => {
    render(
      <AgentSidePanel
        collapsed={false}
        sessionName="sess-a"
        terminals={[SUPERVISOR]}
        cards={[]}
        terminalStatuses={{}}
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
    expect(screen.queryByText(/잔여/)).not.toBeInTheDocument()
  })
})
