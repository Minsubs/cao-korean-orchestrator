import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Thread } from '../features/workspace/Thread'
import { Composer } from '../features/workspace/Composer'
import type { ComponentProps } from 'react'

// Phase 5: eventsClient already reconnects on its own (exponential backoff,
// 1s → 30s cap). Before this, both `connecting` and `disconnected` rendered the
// same "stream unavailable" copy, so an in-progress reconnect looked identical
// to a dead stream. These pin the three states apart on both surfaces.

function threadProps(status: 'connected' | 'connecting' | 'disconnected'): ComponentProps<typeof Thread> {
  return {
    sessionName: 'sess',
    loading: false,
    threadItems: [],
    connectionStatus: status,
    terminalStatuses: {},
    cards: [],
    supervisorTerminalId: null,
    pendingSince: null,
    pendingMessageId: null,
    onOpenTerminal: () => {},
    onOpenOutput: () => {},
    onOpenLogs: () => {},
    onRequestStop: () => {},
    onMessageTarget: () => {},
    onRequestStatusCheck: async () => {},
    onRetry: () => {},
  }
}

function composerProps(status: 'connected' | 'connecting' | 'disconnected'): ComponentProps<typeof Composer> {
  return {
    sessionName: 'sess',
    target: null,
    targets: [],
    onChangeTarget: () => {},
    onSend: async () => {},
    sending: false,
    streamStatus: status,
  } as ComponentProps<typeof Composer>
}

describe('Thread stream banner', () => {
  it('says a reconnect is in progress while connecting, without telling the user to refresh', () => {
    render(<Thread {...threadProps('connecting')} />)
    const banner = screen.getByText(/재연결 중이에요/)
    expect(banner).toBeTruthy()
    expect(banner.textContent).toContain('계속 동작해요')
    expect(screen.queryByText(/사용할 수 없어요/)).toBeNull()
    expect(banner.textContent).not.toMatch(/새로고침/)
  })

  it('keeps the harder wording only for a genuinely dead stream', () => {
    render(<Thread {...threadProps('disconnected')} />)
    expect(screen.getByText(/사용할 수 없어요/)).toBeTruthy()
    expect(screen.queryByText(/재연결 중이에요/)).toBeNull()
  })

  it('shows no banner at all when connected', () => {
    render(<Thread {...threadProps('connected')} />)
    expect(screen.queryByText(/재연결 중이에요/)).toBeNull()
    expect(screen.queryByText(/사용할 수 없어요/)).toBeNull()
  })
})

describe('Composer stream hint', () => {
  it('distinguishes reconnecting from disconnected and keeps saying sending still works', () => {
    const { unmount } = render(<Composer {...composerProps('connecting')} />)
    expect(screen.getByText(/재연결 중 — 전송은 계속 가능해요/)).toBeTruthy()
    expect(screen.queryByText(/끊김/)).toBeNull()
    unmount()

    render(<Composer {...composerProps('disconnected')} />)
    expect(screen.getByText(/끊김 — 전송은 계속 가능해요/)).toBeTruthy()
    expect(screen.queryByText(/재연결 중/)).toBeNull()
  })

  it('shows no stream hint when connected', () => {
    render(<Composer {...composerProps('connected')} />)
    expect(screen.queryByText(/재연결 중/)).toBeNull()
    expect(screen.queryByText(/끊김/)).toBeNull()
  })
})
