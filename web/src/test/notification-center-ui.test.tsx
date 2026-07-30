import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitWorkspaceAlert, NotificationCenter } from '../components/NotificationCenter'

describe('notification center UI', () => {
  afterEach(() => window.localStorage.clear())

  it('opens a persistent in-app notification panel from the header button', () => {
    render(<NotificationCenter sessions={[]} />)

    fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

    expect(screen.getByRole('dialog', { name: '알림 센터' })).toHaveClass('bg-[var(--surface)]')
    expect(screen.getByRole('dialog', { name: '알림 센터' })).not.toHaveClass('bg-gray-900')
    expect(screen.getByText('아직 알림이 없습니다.')).toBeInTheDocument()
    expect(screen.getByText('앱 내 알림 내역은 항상 저장됩니다.')).toBeInTheDocument()
  })

  // Phase 2b (spec §7): the Orchestration Workspace raises 'waiting_input' and
  // 'stall' alerts through this module-level emitter rather than owning its
  // own notification UI. Assert both fold into the same panel/localStorage
  // schema as the pre-existing 'completed' | 'approval' | 'error' alerts.
  it('folds an externally emitted waiting_input alert into the panel and its localStorage history', () => {
    render(<NotificationCenter sessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

    act(() => {
      emitWorkspaceAlert('waiting_input', '입력 대기 — 확인 필요', 'sonnet이(가) 입력을 기다리고 있어요.', 'aaaaaaaa')
    })

    expect(screen.getByText('입력 대기 — 확인 필요')).toBeInTheDocument()
    const stored = JSON.parse(window.localStorage.getItem('cao:notifications:history:v1') || '[]')
    expect(stored[0]).toMatchObject({ kind: 'waiting_input', terminalId: 'aaaaaaaa' })
  })

  it('folds an externally emitted stall alert into the panel', () => {
    render(<NotificationCenter sessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

    act(() => {
      emitWorkspaceAlert('stall', '정체 감지 — sonnet 출력 없음', '작업 중인데 출력 활동이 멈췄어요.', 'bbbbbbbb')
    })

    expect(screen.getByText('정체 감지 — sonnet 출력 없음')).toBeInTheDocument()
  })

  it('shows the exact session and agent for a completed worker', () => {
    render(<NotificationCenter sessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

    act(() => {
      emitWorkspaceAlert(
        'completed',
        'login-fix · 테스트 담당 작업 완료',
        '테스트 담당의 작업이 끝났습니다.',
        'worker01',
        'cao-login-fix',
        'codex_qa_terra',
      )
    })

    expect(screen.getByText('login-fix · 테스트 담당', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('작업 완료', { exact: true })).toBeInTheDocument()
    const stored = JSON.parse(window.localStorage.getItem('cao:notifications:history:v1') || '[]')
    expect(stored[0]).toMatchObject({
      kind: 'completed',
      terminalId: 'worker01',
      sessionName: 'cao-login-fix',
      agentName: 'codex_qa_terra',
    })
  })

  it('does not throw when an alert is emitted with no NotificationCenter mounted', () => {
    expect(() => emitWorkspaceAlert('stall', 't', 'b', 'cccccccc')).not.toThrow()
  })

  // Feedback #17: an alert that knows its session is clickable and dispatches
  // the same 'cao:select-session' event Workspace.tsx's Command Palette seam
  // already listens for, then closes the panel.
  it('feedback #17: clicking an alert with a known session dispatches cao:select-session and closes the panel', () => {
    render(<NotificationCenter sessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

    act(() => {
      emitWorkspaceAlert('stall', '정체 감지 — sonnet 출력 없음', '작업 중인데 출력 활동이 멈췄어요.', 'dddddddd', 'cao-login-fix')
    })

    const handler = vi.fn()
    window.addEventListener('cao:select-session', handler)
    fireEvent.click(screen.getByText('정체 감지 — sonnet 출력 없음').closest('[role="button"]') as HTMLElement)
    window.removeEventListener('cao:select-session', handler)

    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe('cao-login-fix')
    expect(screen.queryByRole('dialog', { name: '알림 센터' })).not.toBeInTheDocument()
  })

  it('feedback #17: an alert with no known session is not clickable and says why', () => {
    render(<NotificationCenter sessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

    act(() => {
      // No 5th (sessionName) argument — the existing emitWorkspaceAlert call
      // shape from before feedback #17, still fully supported.
      emitWorkspaceAlert('waiting_input', '입력 대기 — 확인 필요', 'sonnet이(가) 입력을 기다리고 있어요.', 'eeeeeeee')
    })

    // <p title> -> inner "min-w-0 flex-1" wrapper -> outer alert row div.
    const row = screen.getByText('입력 대기 — 확인 필요').parentElement!.parentElement as HTMLElement
    expect(row).not.toHaveAttribute('role', 'button')
    expect(row).toHaveAttribute('title', '이 알림은 세션 정보가 없어 이동할 수 없어요')
  })
})

// Phase 6 — 알림 배지 읽음/초기화 동선.
//
// Mark-read already existed (opening the popover marks every alert read), but it
// had no test, so nothing protected it. Clearing the stored history did not
// exist at all — that was the one real gap, and the badge could only ever grow
// across sessions. These three cover: the pre-existing read behaviour, the new
// clear flow (including cancel), and the defensive load that silently drops a
// tampered entry.
describe('notification center — 읽음/초기화 동선', () => {
  afterEach(() => window.localStorage.clear())

  const openPanel = () => fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

  it('clears the unread badge once the panel is opened (pre-existing, previously untested)', () => {
    render(<NotificationCenter sessions={[]} />)
    act(() => emitWorkspaceAlert('stall', '정체', '출력이 없어요', 'aaaaaaaa'))

    expect(screen.getByText('1')).toBeInTheDocument()
    openPanel()
    expect(screen.queryByText('1')).toBeNull()

    const stored = JSON.parse(window.localStorage.getItem('cao:notifications:history:v1') || '[]')
    expect(stored[0].read).toBe(true)
  })

  it('asks for confirmation before clearing and leaves the history intact on cancel', () => {
    render(<NotificationCenter sessions={[]} />)
    act(() => emitWorkspaceAlert('stall', '정체', '출력이 없어요', 'aaaaaaaa'))
    openPanel()

    fireEvent.click(screen.getByRole('button', { name: '알림 내역 모두 지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(screen.getByText('정체')).toBeInTheDocument()
    expect(screen.queryByText('아직 알림이 없습니다.')).toBeNull()
  })

  it('empties the history and its storage once the clear is confirmed', () => {
    render(<NotificationCenter sessions={[]} />)
    act(() => emitWorkspaceAlert('stall', '정체', '출력이 없어요', 'aaaaaaaa'))
    openPanel()

    fireEvent.click(screen.getByRole('button', { name: '알림 내역 모두 지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '모두 지우기' }))

    expect(screen.getByText('아직 알림이 없습니다.')).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('cao:notifications:history:v1') || 'null')).toEqual([])
  })

  it('offers no clear action when there is nothing stored', () => {
    render(<NotificationCenter sessions={[]} />)
    openPanel()
    expect(screen.queryByRole('button', { name: '알림 내역 모두 지우기' })).toBeNull()
  })

  it('drops a tampered stored entry instead of throwing (pre-existing, previously untested)', () => {
    window.localStorage.setItem(
      'cao:notifications:history:v1',
      JSON.stringify([
        { kind: 'not-a-real-kind', title: 'x', body: 'y', id: '1', terminalId: 't', createdAt: 'z', read: false },
        { kind: 'stall', title: '살아있는 알림', body: 'y', id: '2', terminalId: 't', createdAt: 'z', read: true },
      ]),
    )
    render(<NotificationCenter sessions={[]} />)
    openPanel()

    expect(screen.getByText('살아있는 알림')).toBeInTheDocument()
    expect(screen.queryByText('x')).toBeNull()
  })
})
