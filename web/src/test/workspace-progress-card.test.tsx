import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressCard } from '../features/workspace/ProgressCard'
import type { DelegationCard } from '../features/workspace/types'

const T0 = Date.now() - 65_000

function card(over: Partial<DelegationCard> & { terminalId: string }): DelegationCard {
  return {
    sessionId: null,
    agentName: null,
    provider: null,
    callerId: null,
    callerAgentName: null,
    status: null,
    prevStatus: null,
    location: null,
    locationLoaded: false,
    instruction: null,
    instructionType: null,
    instructionFromId: null,
    killed: false,
    lastActivityAt: null,
    lastOutputAt: null,
    firstSeenAt: T0 + 1000,
    hasSignal: true,
    ...over,
  }
}

describe('ProgressCard', () => {
  it('shows the dispatching stage before any worker exists', () => {
    render(<ProgressCard pendingSince={T0} supervisorTerminalId="sup" cards={[]} terminalStatuses={{}} onOpenWorker={() => {}} />)
    const root = screen.getByTestId('progress-card')
    expect(root.getAttribute('data-stage')).toBe('dispatching')
    expect(screen.getByText('작업 배정 중')).toBeTruthy()
    expect(screen.getByText('워커를 배정하는 중이에요')).toBeTruthy()
  })

  it('lists the working worker by display label and names who it waits on', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra', provider: 'codex' })]}
        onOpenWorker={() => {}}
        terminalStatuses={{ w1: 'PROCESSING' }}
      />,
    )
    expect(screen.getByTestId('progress-card').getAttribute('data-stage')).toBe('working')
    expect(screen.queryByText('codex_qa_terra')).toBeNull()
    expect(screen.getByText('작업 중')).toBeTruthy()
    expect(screen.getByText(/콜백 대기 중$/)).toBeTruthy()
  })

  // Phase 3 added a second elapsed label per worker, so the turn-level one is
  // no longer the only match — both are expected to be on screen.
  it('renders the elapsed time of the turn alongside the worker one', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        onOpenWorker={() => {}}
        terminalStatuses={{ w1: 'PROCESSING' }}
      />,
    )
    expect(screen.getAllByText(/^1분/)).toHaveLength(2)
  })

  it('warns when a worker is stalled', () => {
    render(
      <ProgressCard
        pendingSince={Date.now() - 7 * 60 * 1000}
        supervisorTerminalId="sup"
        cards={[
          card({
            terminalId: 'w1',
            agentName: 'codex_qa_terra',
            status: 'processing',
            firstSeenAt: Date.now() - 7 * 60 * 1000,
          }),
        ]}
        onOpenWorker={() => {}}
        terminalStatuses={{ w1: 'PROCESSING' }}
      />,
    )
    expect(screen.getByText(/응답이 없어요/)).toBeTruthy()
  })

  it('reports the callback stage with a done count once every worker finished', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra', killed: true })]}
        onOpenWorker={() => {}}
        terminalStatuses={{}}
      />,
    )
    expect(screen.getByTestId('progress-card').getAttribute('data-stage')).toBe('callback')
    expect(screen.getByText('1/1 완료')).toBeTruthy()
  })

  it('never leaks a raw profile id when the worker has no known display label', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'abcdef123456' })]}
        onOpenWorker={() => {}}
        terminalStatuses={{ abcdef123456: 'PROCESSING' }}
      />,
    )
    expect(screen.queryByText('abcdef123456')).toBeNull()
    expect(screen.getByText('abcdef12')).toBeTruthy()
  })
})
