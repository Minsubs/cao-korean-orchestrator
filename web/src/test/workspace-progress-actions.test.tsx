import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProgressCard } from '../features/workspace/ProgressCard'
import { ChatBubble } from '../features/workspace/Thread'
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

describe('ProgressCard blocked/error handling', () => {
  it('labels a 승인 대기 worker and offers a one-click jump to its terminal', () => {
    const onOpenWorker = vi.fn()
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        terminalStatuses={{ w1: 'WAITING_USER_ANSWER' }}
        onOpenWorker={onOpenWorker}
      />,
    )
    expect(screen.getByText('승인 대기')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '승인하러 가기' }))
    expect(onOpenWorker).toHaveBeenCalledWith('w1')
  })

  it('labels an errored worker and offers a one-click jump to its terminal', () => {
    const onOpenWorker = vi.fn()
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        terminalStatuses={{ w1: 'ERROR' }}
        onOpenWorker={onOpenWorker}
      />,
    )
    expect(screen.getByText('오류')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '오류 확인' }))
    expect(onOpenWorker).toHaveBeenCalledWith('w1')
  })

  it('offers no action button for a healthy worker', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        terminalStatuses={{ w1: 'PROCESSING' }}
        onOpenWorker={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '승인하러 가기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '오류 확인' })).toBeNull()
  })

  it('summarises blocked and errored counts in the header', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[
          card({ terminalId: 'w1', agentName: 'codex_qa_terra', firstSeenAt: T0 + 1000 }),
          card({ terminalId: 'w2', agentName: 'claude_scout_haiku', firstSeenAt: T0 + 2000 }),
        ]}
        terminalStatuses={{ w1: 'WAITING_USER_ANSWER', w2: 'ERROR' }}
        onOpenWorker={() => {}}
      />,
    )
    expect(screen.getByText('승인 대기 1 · 오류 1')).toBeTruthy()
  })

  it('shows no problem summary when nothing is blocked or errored', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        terminalStatuses={{ w1: 'PROCESSING' }}
        onOpenWorker={() => {}}
      />,
    )
    expect(screen.queryByText(/승인 대기 \d/)).toBeNull()
  })

  it('shows each worker its own elapsed time', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra', firstSeenAt: Date.now() - 30_000 })]}
        terminalStatuses={{ w1: 'PROCESSING' }}
        onOpenWorker={() => {}}
      />,
    )
    expect(screen.getByText('30초')).toBeTruthy()
  })
})

describe('ChatBubble retry action', () => {
  it('offers 다시 보내기 on a failed send and passes the original prompt back', () => {
    const onRetry = vi.fn()
    render(
      <ChatBubble
        entry={{
          id: 'a1',
          role: 'assistant',
          content: '서버에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.',
          ts: T0,
          retryPrompt: '테스트 돌려줘',
        }}
        onRetry={onRetry}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
    expect(onRetry).toHaveBeenCalledWith('테스트 돌려줘')
  })

  it('offers no retry when the entry did not fail', () => {
    render(<ChatBubble entry={{ id: 'a1', role: 'assistant', content: '완료', ts: T0 }} onRetry={() => {}} />)
    expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull()
  })
})
