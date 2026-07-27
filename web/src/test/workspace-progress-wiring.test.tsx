import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatBubble, Thread } from '../features/workspace/Thread'
import type { ChatEntry, DelegationCard, ThreadItem } from '../features/workspace/types'

const T0 = Date.now() - 65_000

const WAITING_ENTRY: ChatEntry = {
  id: 'a1',
  role: 'assistant',
  content: '오케스트레이터 응답을 기다리는 중…',
  ts: T0,
}

const WORKER: DelegationCard = {
  terminalId: 'w1',
  sessionId: null,
  agentName: 'codex_qa_terra',
  provider: 'codex',
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
}

function threadProps(over: Partial<ComponentProps<typeof Thread>> = {}): ComponentProps<typeof Thread> {
  const items: ThreadItem[] = [{ kind: 'chat', id: 'a1', ts: T0, entry: WAITING_ENTRY }]
  return {
    sessionName: 'sess',
    loading: false,
    threadItems: items,
    connectionStatus: 'connected',
    terminalStatuses: { w1: 'PROCESSING' },
    cards: [WORKER],
    supervisorTerminalId: 'sup',
    pendingSince: T0,
    pendingMessageId: 'a1',
    onOpenTerminal: () => {},
    onOpenOutput: () => {},
    onOpenLogs: () => {},
    onRequestStop: () => {},
    onMessageTarget: () => {},
    onRequestStatusCheck: async () => {},
    ...over,
  }
}

describe('Thread progress wiring', () => {
  it('replaces the WAITING bubble with the live progress card', () => {
    render(<Thread {...threadProps()} />)
    expect(screen.getByTestId('progress-card')).toBeTruthy()
    expect(screen.queryByText('오케스트레이터 응답을 기다리는 중…')).toBeNull()
  })

  it('keeps the WAITING bubble when the turn has no recorded start time', () => {
    render(<Thread {...threadProps({ pendingSince: null })} />)
    expect(screen.queryByTestId('progress-card')).toBeNull()
    expect(screen.getByText('오케스트레이터 응답을 기다리는 중…')).toBeTruthy()
  })

  it('leaves other chat entries alone while a turn is pending', () => {
    const other: ChatEntry = { id: 'u1', role: 'user', content: '테스트 돌려줘', ts: T0 - 1 }
    render(
      <Thread
        {...threadProps({
          threadItems: [
            { kind: 'chat', id: 'u1', ts: T0 - 1, entry: other },
            { kind: 'chat', id: 'a1', ts: T0, entry: WAITING_ENTRY },
          ],
        })}
      />,
    )
    expect(screen.getByText('테스트 돌려줘')).toBeTruthy()
    expect(screen.getByTestId('progress-card')).toBeTruthy()
  })

  it('does not swap a settled reply that happens to share no pending id', () => {
    const settled: ChatEntry = { id: 'a2', role: 'assistant', content: '전부 통과했어요', ts: T0 }
    render(
      <Thread
        {...threadProps({
          threadItems: [{ kind: 'chat', id: 'a2', ts: T0, entry: settled }],
          pendingMessageId: 'a1',
        })}
      />,
    )
    expect(screen.getByText('전부 통과했어요')).toBeTruthy()
    expect(screen.queryByTestId('progress-card')).toBeNull()
  })
})

describe('ChatBubble completion summary', () => {
  it('renders the frozen summary above a finished reply', () => {
    render(
      <ChatBubble
        entry={{
          id: 'a1',
          role: 'assistant',
          content: '전부 통과했어요',
          ts: T0,
          progress: { workerCount: 2, durationMs: 125_000, workerLabels: ['테스트 담당', '탐색 담당'] },
        }}
      />,
    )
    expect(screen.getByText('✓ 완료 · 워커 2 · 소요 2분 5초')).toBeTruthy()
    expect(screen.getByText(/전부 통과했어요/)).toBeTruthy()
  })

  it('renders nothing extra when there is no summary', () => {
    render(<ChatBubble entry={{ id: 'a1', role: 'assistant', content: '답변', ts: T0 }} />)
    expect(screen.queryByText(/✓ 완료/)).toBeNull()
  })
})
