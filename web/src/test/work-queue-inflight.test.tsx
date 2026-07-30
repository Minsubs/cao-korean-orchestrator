import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentSidePanel } from '../features/workspace/AgentSidePanel'
import type { TerminalMeta } from '../api'
import type { DelegationCard } from '../features/workspace/types'

// User-reported: work was in progress but 작업 큐 stayed empty, so the tab looked
// broken. The filter only matched the PROCESSING / WAITING_USER_ANSWER literals,
// which dropped a worker that exists but has not reported a status yet — alive and
// working, counted as nothing. It now shares workerStateFor with the in-chat
// progress card so the two can never disagree.

const SUPERVISOR = {
  id: 'aaaaaaaa',
  tmux_session: 'sess-a',
  tmux_window: '1',
  provider: 'codex',
  agent_profile: 'codex_orchestrator_sol',
  created_at: null,
  last_active: null,
} as unknown as TerminalMeta

function card(over: Partial<DelegationCard> & { terminalId: string }): DelegationCard {
  return {
    sessionId: null,
    agentName: 'codex_qa_terra',
    provider: 'codex',
    callerId: 'aaaaaaaa',
    callerAgentName: null,
    status: null,
    prevStatus: null,
    location: null,
    locationLoaded: false,
    instruction: '검증해줘',
    instructionType: 'assign',
    instructionFromId: 'aaaaaaaa',
    killed: false,
    lastActivityAt: null,
    lastOutputAt: null,
    firstSeenAt: Date.now(),
    hasSignal: true,
    ...over,
  }
}

function renderPanel(cards: DelegationCard[], terminalStatuses: Record<string, string>) {
  const noop = () => {}
  return render(
    <AgentSidePanel
      collapsed={false}
      sessionName="sess-a"
      terminals={[SUPERVISOR]}
      cards={cards}
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

afterEach(() => window.localStorage.clear())

describe('작업 큐 counts what is actually in flight', () => {
  it('counts a worker whose status has not arrived yet', () => {
    renderPanel([card({ terminalId: 'w1' })], {})
    expect(screen.getByRole('tab', { name: '작업 큐 1' })).toBeTruthy()
  })

  it('counts a running worker', () => {
    renderPanel([card({ terminalId: 'w1' })], { w1: 'PROCESSING' })
    expect(screen.getByRole('tab', { name: '작업 큐 1' })).toBeTruthy()
  })

  it('counts a worker blocked on approval', () => {
    renderPanel([card({ terminalId: 'w1' })], { w1: 'WAITING_USER_ANSWER' })
    expect(screen.getByRole('tab', { name: '작업 큐 1' })).toBeTruthy()
  })

  it('excludes finished and errored workers', () => {
    renderPanel(
      [
        card({ terminalId: 'w1', killed: true, status: 'completed' }),
        card({ terminalId: 'w2' }),
        card({ terminalId: 'w3' }),
      ],
      { w2: 'COMPLETED', w3: 'ERROR' },
    )
    expect(screen.getByRole('tab', { name: '작업 큐 0' })).toBeTruthy()
  })

  it('says so plainly when nothing is in flight', () => {
    renderPanel([card({ terminalId: 'w1', killed: true, status: 'completed' })], {})
    fireEvent.click(screen.getByRole('tab', { name: '작업 큐 0' }))
    expect(screen.getByText('진행 중이거나 응답을 기다리는 작업이 없어요.')).toBeTruthy()
  })
})
