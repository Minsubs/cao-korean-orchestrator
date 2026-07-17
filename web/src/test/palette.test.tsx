import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommandPalette } from '../features/command-palette/CommandPalette'
import type { NavigateView } from '../features/command-palette/commands'
import { useStore } from '../store'

describe('CommandPalette', () => {
  let onClose: () => void
  let onNavigate: (view: NavigateView) => void
  let onCommand: (id: string, arg?: string) => void

  beforeEach(() => {
    onClose = vi.fn<() => void>()
    onNavigate = vi.fn<(view: NavigateView) => void>()
    onCommand = vi.fn<(id: string, arg?: string) => void>()
    window.localStorage.clear()
    useStore.setState({ sessions: [] })
  })

  afterEach(() => {
    useStore.setState({ sessions: [] })
    vi.restoreAllMocks()
  })

  it('renders nothing when closed and no hotkey has fired', () => {
    render(<CommandPalette open={false} onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument()
  })

  it('renders the command list, grouped, when open', async () => {
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    expect(await screen.findByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument()
    expect(screen.getByText('이동')).toBeInTheDocument()
    expect(screen.getByText('작업공간 열기')).toBeInTheDocument()
    expect(screen.getByText('새 작업 시작')).toBeInTheDocument()
    expect(screen.getByText('테마 전환 (다크/라이트)')).toBeInTheDocument()
  })

  it('self-registers the ⌘K/Ctrl+K hotkey — opens even when `open` is false', async () => {
    render(<CommandPalette open={false} onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(await screen.findByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument()
  })

  it('closes on Escape and calls onClose', async () => {
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    await screen.findByRole('dialog', { name: 'Command Palette' })

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('filters the command list by the search query', async () => {
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    const input = await screen.findByLabelText('명령 검색')

    fireEvent.change(input, { target: { value: '테마' } })

    expect(screen.getByText('테마 전환 (다크/라이트)')).toBeInTheDocument()
    expect(screen.queryByText('작업공간 열기')).not.toBeInTheDocument()
    expect(screen.queryByText('새 작업 시작')).not.toBeInTheDocument()
  })

  it('delegates navigation commands to onNavigate with the AppShell view key', async () => {
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    fireEvent.click(await screen.findByText('Agent 프로필 열기'))
    expect(onNavigate).toHaveBeenCalledWith('agent-profiles')
  })

  it('routes "새 작업 시작" through onCommand(\'new-task\')', async () => {
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    fireEvent.click(await screen.findByText('새 작업 시작'))
    expect(onCommand).toHaveBeenCalledWith('new-task')
  })

  it('routes "업데이트 확인" to the Tooling view', async () => {
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    fireEvent.click(await screen.findByText('업데이트 확인'))
    expect(onNavigate).toHaveBeenCalledWith('tooling')
  })

  it('toggles the theme by calling into theme.ts directly', async () => {
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    expect(document.documentElement.dataset.theme).not.toBe('dark')

    fireEvent.click(await screen.findByText('테마 전환 (다크/라이트)'))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('filters store.sessions by the typed query and routes selection through onCommand("open-session", name)', async () => {
    useStore.setState({
      sessions: [
        { id: 't1', name: 'login-retry-fix', status: 'processing' },
        { id: 't2', name: 'unrelated-session', status: 'idle' },
      ],
    })
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    const input = await screen.findByLabelText('명령 검색')

    // Sessions only surface once the user actually types something.
    expect(screen.queryByText('login-retry-fix')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'login' } })

    expect(screen.getByText('login-retry-fix')).toBeInTheDocument()
    expect(screen.queryByText('unrelated-session')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('login-retry-fix'))
    expect(onCommand).toHaveBeenCalledWith('open-session', 'login-retry-fix')
  })

  it('supports ArrowDown/ArrowUp + Enter keyboard execution of the highlighted item', async () => {
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCommand={onCommand} />)
    await screen.findByRole('dialog', { name: 'Command Palette' })

    // Default highlight is index 0 ("작업공간 열기"); two ArrowDowns reach
    // index 2 ("도구 및 확장 열기").
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onNavigate).toHaveBeenCalledWith('tooling')
  })
})
