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

describe('작업 큐 lists the turn\'s delegated work', () => {
  // Contract change (사용자 재보고: "작업큐 저건 왜 동작안해"). The badge used to
  // count only in-flight workers, and the tab looked permanently broken: the
  // orchestrator calls delete_terminal the moment a worker's callback lands, so a
  // card is killed → done within seconds. On a run that delegated eight tasks the
  // queue read 0 the whole time, because no two workers were ever alive together.
  //
  // The queue is now the turn's work list: every delegated task, each row carrying
  // its own state, active states sorted first. The in-flight number moved to a
  // summary line where it can be 0 without the tab looking empty.
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

  it('keeps finished work in the list instead of emptying the queue', () => {
    // This is the reported defect, pinned: three delegated tasks, none still
    // running, and the queue must still show what the turn did.
    renderPanel(
      [
        card({ terminalId: 'w1', killed: true, status: 'completed' }),
        card({ terminalId: 'w2' }),
        card({ terminalId: 'w3' }),
      ],
      { w2: 'COMPLETED', w3: 'ERROR' },
    )
    fireEvent.click(screen.getByRole('tab', { name: '작업 큐 3' }))
    expect(screen.getByTestId('queue-summary').textContent).toContain('진행 중 0')
    expect(screen.getByTestId('queue-summary').textContent).toContain('전체 3')
    expect(screen.getByTestId('queue-row-w1').getAttribute('data-state')).toBe('done')
    expect(screen.getByTestId('queue-row-w2').getAttribute('data-state')).toBe('done')
    expect(screen.getByTestId('queue-row-w3').getAttribute('data-state')).toBe('error')
  })

  it('sorts work that needs attention above work that is finished', () => {
    renderPanel(
      [
        card({ terminalId: 'done1', killed: true, status: 'completed', firstSeenAt: 1 }),
        card({ terminalId: 'run1', firstSeenAt: 2 }),
        card({ terminalId: 'block1', firstSeenAt: 3 }),
      ],
      { run1: 'PROCESSING', block1: 'WAITING_USER_ANSWER' },
    )
    fireEvent.click(screen.getByRole('tab', { name: '작업 큐 3' }))
    const order = Array.from(document.querySelectorAll('[data-testid^="queue-row-"]')).map(el =>
      el.getAttribute('data-testid'),
    )
    // 입력 대기 first — it is the only row that cannot progress without the user.
    expect(order).toEqual(['queue-row-block1', 'queue-row-run1', 'queue-row-done1'])
  })

  it('says so plainly when nothing has been delegated at all', () => {
    renderPanel([], {})
    fireEvent.click(screen.getByRole('tab', { name: '작업 큐 0' }))
    expect(screen.getByText(/아직 배정된 작업이 없어요/)).toBeTruthy()
  })
})
