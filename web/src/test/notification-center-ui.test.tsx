import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitWorkspaceAlert, NotificationCenter } from '../components/NotificationCenter'

describe('notification center UI', () => {
  afterEach(() => window.localStorage.clear())

  it('opens a persistent in-app notification panel from the header button', () => {
    render(<NotificationCenter sessions={[]} />)

    fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

    expect(screen.getByRole('dialog', { name: '알림 센터' })).toBeInTheDocument()
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
