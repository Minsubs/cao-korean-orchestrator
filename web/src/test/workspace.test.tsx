import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Workspace } from '../features/workspace/Workspace'
import { useStore } from '../store'

const SESSION = { id: 'sess-1', name: 'login-retry-fix', status: 'active' }
const SUPERVISOR = {
  id: 'aaaaaaaa',
  tmux_session: 'sess-1',
  tmux_window: '1',
  provider: 'codex',
  agent_profile: 'sol',
  created_at: '2026-07-17T00:00:00Z',
  last_active: null,
}

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

function installMockFetch() {
  const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/sessions') return jsonResponse([SESSION])
    if (url.startsWith('/sessions/sess-1')) return jsonResponse({ session: SESSION, terminals: [SUPERVISOR] })
    if (url === '/terminals/aaaaaaaa') {
      return jsonResponse({ ...SUPERVISOR, name: 'win', session_name: 'sess-1', caller_id: null, status: 'idle', last_output_at: null })
    }
    if (url.startsWith('/terminals/aaaaaaaa/working-directory')) return jsonResponse({ working_directory: '~/work/alarm-solution' })
    if (url.startsWith('/terminals/aaaaaaaa/output')) return jsonResponse({ output: '', mode: 'last' })
    if (url.startsWith('/terminals/aaaaaaaa/input')) return jsonResponse({ success: true })
    if (url.startsWith('/agents/profiles')) return jsonResponse([{ name: 'sol', description: 'Supervisor', source: 'codex' }])
    if (url.startsWith('/agents/providers')) return jsonResponse([{ name: 'codex', binary: 'codex', installed: true }])
    if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

describe('Workspace (Phase 2b render-level)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useStore.setState({ sessions: [], activeSession: null, activeSessionDetail: null, connected: false, terminalStatuses: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the fleet Overview onboarding empty state with no sessions, and never fakes the event stream as connected', async () => {
    // Phase 2c spec §1: no session selected = the fleet Overview, not a bare
    // "select a session" placeholder (that text/behavior moved to Overview.tsx
    // — see workspace-overview.test.tsx for its own dedicated coverage).
    installMockFetch()
    render(<Workspace />)
    expect(await screen.findByText('아직 실행 중인 세션이 없어요')).toBeInTheDocument()
    // jsdom has no EventSource — the top-bar chip honestly reports disconnected, never faked as connected.
    expect(await screen.findByText('이벤트 끊김')).toBeInTheDocument()
  })

  it('shows "이벤트 없음" for a selected session with no observed activity yet (never invents a plan/state)', async () => {
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<Workspace />)
    expect(await screen.findByText(/이벤트 없음/)).toBeInTheDocument()
  })

  it('collapses and re-expands the sidebar from the workspace toolbar toggle', async () => {
    installMockFetch()
    render(<Workspace />)
    expect(await screen.findByLabelText('프로젝트와 세션')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '사이드바 열기/접기' }))
    expect(screen.queryByLabelText('프로젝트와 세션')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '사이드바 열기/접기' }))
    expect(await screen.findByLabelText('프로젝트와 세션')).toBeInTheDocument()
  })

  it('opens the New Task modal and only enables submit once instruction + Supervisor profile are filled', async () => {
    installMockFetch()
    render(<Workspace />)

    // Exact match: with no sessions, Overview's own onboarding CTA
    // ("새 작업 시작") also renders and would otherwise ambiguously match a
    // loose /새 작업/ pattern alongside the toolbar's "새 작업" button.
    fireEvent.click(await screen.findByRole('button', { name: '새 작업' }))
    const dialog = await screen.findByRole('dialog', { name: '새 작업' })
    const submit = within(dialog).getByRole('button', { name: /작업 시작/ })
    expect(submit).toBeDisabled()

    fireEvent.change(within(dialog).getByPlaceholderText(/세션 만료 후 재로그인/), { target: { value: '버그를 고쳐줘' } })
    expect(submit).toBeDisabled() // still no Supervisor profile chosen

    fireEvent.click(within(dialog).getByText('프로필 선택...'))
    // "sol" also appears in the (display-only) 팀 프리셋 checklist once no
    // Supervisor is chosen yet, so scope to the dropdown *option* specifically
    // — the only role="button" whose accessible name contains it.
    const profileOption = await within(dialog).findByRole('button', { name: /^sol/ })
    fireEvent.click(profileOption)

    expect(submit).not.toBeDisabled()
  })

  it('switches Workbench tabs and opens the dock, showing an honest empty Logs list with no terminal selected', async () => {
    installMockFetch()
    render(<Workspace />)
    // No session selected yet (Overview renders) — wait for it to settle before driving the Workbench.
    await screen.findByText('아직 실행 중인 세션이 없어요')

    fireEvent.click(screen.getByRole('tab', { name: /Logs/ }))
    expect(screen.getByRole('tab', { name: /Logs/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('이벤트 없음')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /^Terminal/ }))
    expect(screen.getByText('에이전트 카드에서 터미널/Output/Inbox를 선택하면 여기에 표시돼요.')).toBeInTheDocument()
  })

  it('sends a Composer message on Cmd+Enter and posts it to the Supervisor terminal', async () => {
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<Workspace />)

    const textarea = await screen.findByLabelText('메시지 입력')
    fireEvent.change(textarea, { target: { value: '진행 상황 알려줘' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    await waitFor(() => {
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][]
      expect(calls.some(([url, opts]) => url.startsWith('/terminals/aaaaaaaa/input') && opts?.method === 'POST')).toBe(true)
    })
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('feedback #3: "세션 종료" calls DELETE /sessions/{name}, then clears the selection and refreshes the list', async () => {
    let deleted = false
    const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/sessions') return jsonResponse(deleted ? [] : [SESSION])
      if (url === '/sessions/sess-1' && opts?.method === 'DELETE') {
        deleted = true
        return jsonResponse({ success: true, deleted: ['sess-1'], errors: [] })
      }
      if (url.startsWith('/sessions/sess-1')) return jsonResponse({ session: SESSION, terminals: [SUPERVISOR] })
      if (url === '/terminals/aaaaaaaa') {
        return jsonResponse({ ...SUPERVISOR, name: 'win', session_name: 'sess-1', caller_id: null, status: 'idle', last_output_at: null })
      }
      if (url.startsWith('/terminals/aaaaaaaa/working-directory')) return jsonResponse({ working_directory: '~/work/alarm-solution' })
      if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<Workspace />)

    fireEvent.click(await screen.findByRole('tab', { name: /세션 정보/ }))
    fireEvent.click(await screen.findByRole('button', { name: '세션 종료' }))
    // Two elements now read "세션 종료" — the trigger button (still mounted
    // behind the modal) and the confirm modal's own confirm button, which is
    // the one appended last in document order.
    const buttons = screen.getAllByText('세션 종료').filter(el => el.tagName === 'BUTTON')
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u, o]) => u === '/sessions/sess-1' && (o as RequestInit)?.method === 'DELETE')).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getByText('아직 실행 중인 세션이 없어요')).toBeInTheDocument()
    })
  })

  it('feedback #13: hides the internal cao- session prefix in the toolbar header and sidebar row', async () => {
    const prefixedSession = { id: 'cao-abc12345', name: 'cao-abc12345', status: 'active' }
    const mockFetch = vi.fn(async (url: string) => {
      if (url === '/sessions') return jsonResponse([prefixedSession])
      if (url.startsWith('/sessions/cao-abc12345')) return jsonResponse({ session: prefixedSession, terminals: [] })
      if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)
    useStore.setState({ sessions: [prefixedSession], connected: true })
    render(<Workspace />)

    expect((await screen.findAllByText('abc12345')).length).toBeGreaterThan(0)
    expect(screen.queryByText('cao-abc12345')).not.toBeInTheDocument()
  })

  it('feedback #1 + #5: omits the provider query param for a profile with no provider, and prepends checked team-preset names to the first instruction', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url === '/sessions') return jsonResponse([])
      if (url.startsWith('/agents/profiles')) {
        return jsonResponse([
          { name: 'sol', description: 'Supervisor', source: 'codex', provider: null, model: null },
          { name: 'nova', description: 'Worker', source: 'built-in', provider: 'claude_code', model: 'sonnet' },
        ])
      }
      if (url.startsWith('/sessions?')) return jsonResponse({ id: 'term-1', session_name: 'auto-1' })
      // Post-creation, Workspace switches to the new session and
      // useWorkspaceSession immediately polls its detail — give it a
      // well-formed (if empty) response rather than falling through to the
      // catch-all `[]`, which isn't shaped like {session, terminals}.
      if (url.startsWith('/sessions/auto-1')) return jsonResponse({ session: { id: 'auto-1', name: 'auto-1', status: 'active' }, terminals: [] })
      if (url.startsWith('/terminals/term-1/input')) return jsonResponse({ success: true })
      if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)
    render(<Workspace />)

    fireEvent.click(await screen.findByRole('button', { name: '새 작업' }))
    const dialog = await screen.findByRole('dialog', { name: '새 작업' })

    fireEvent.change(within(dialog).getByPlaceholderText(/세션 만료 후 재로그인/), { target: { value: '버그를 고쳐줘' } })
    fireEvent.click(within(dialog).getByText('프로필 선택...'))
    fireEvent.click(await within(dialog).findByRole('button', { name: /^sol/ }))

    // Feedback #11: the remaining preset candidate ('nova' — 'sol' is now the
    // chosen Supervisor, excluded from its own preset list) is grouped by its
    // real `provider` field, with a visible count.
    expect(await within(dialog).findByText(/Claude Code/)).toBeInTheDocument()
    expect(within(dialog).getByText('(1)')).toBeInTheDocument()

    const submit = within(dialog).getByRole('button', { name: /작업 시작/ })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => (u as string).startsWith('/sessions?'))).toBe(true)
    })
    const [createUrl] = mockFetch.mock.calls.find(([u]) => (u as string).startsWith('/sessions?'))!
    expect(createUrl as string).not.toContain('provider=')

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => (u as string).startsWith('/terminals/term-1/input'))).toBe(true)
    })
    const [inputUrl] = mockFetch.mock.calls.find(([u]) => (u as string).startsWith('/terminals/term-1/input'))!
    const sentMessage = decodeURIComponent((inputUrl as string).split('message=')[1])
    expect(sentMessage).toContain('[팀] 위임 가능한 워커 프로필: nova')
    expect(sentMessage).toContain('assign/handoff 시 이 프로필 이름을 사용하세요.')
  })

  it('feedback #12: client-validates the session name against the server pattern and disables submit for invalid characters', async () => {
    installMockFetch()
    render(<Workspace />)

    fireEvent.click(await screen.findByRole('button', { name: '새 작업' }))
    const dialog = await screen.findByRole('dialog', { name: '새 작업' })

    fireEvent.change(within(dialog).getByPlaceholderText(/세션 만료 후 재로그인/), { target: { value: '버그를 고쳐줘' } })
    fireEvent.click(within(dialog).getByText('프로필 선택...'))
    fireEvent.click(await within(dialog).findByRole('button', { name: /^sol/ }))
    const submit = within(dialog).getByRole('button', { name: /작업 시작/ })
    await waitFor(() => expect(submit).not.toBeDisabled())

    const nameInput = within(dialog).getByPlaceholderText('예: login-retry-fix')

    fireEvent.change(nameInput, { target: { value: '한글이름' } })
    expect(await within(dialog).findByText('세션 이름은 영문/숫자/-/_만 가능해요')).toBeInTheDocument()
    expect(submit).toBeDisabled()

    // Server rule requires the first character to be alnum/underscore — a leading dash must fail too.
    fireEvent.change(nameInput, { target: { value: '-leading-dash' } })
    expect(await within(dialog).findByText('세션 이름은 영문/숫자/-/_만 가능해요')).toBeInTheDocument()
    expect(submit).toBeDisabled()

    fireEvent.change(nameInput, { target: { value: 'valid-name_123' } })
    expect(within(dialog).queryByText('세션 이름은 영문/숫자/-/_만 가능해요')).not.toBeInTheDocument()
    expect(submit).not.toBeDisabled()
  })

  it('feedback #16: shows a "완료" badge on the sidebar row once every terminal has settled with at least one completed', async () => {
    const doneSession = { id: 'sess-done', name: 'sess-done', status: 'active' }
    const mockFetch = vi.fn(async (url: string) => {
      if (url === '/sessions') return jsonResponse([doneSession])
      if (url.startsWith('/sessions/sess-done')) {
        return jsonResponse({
          session: doneSession,
          terminals: [
            { id: 'tttttttt', tmux_session: 'sess-done', tmux_window: '1', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed' },
          ],
        })
      }
      if (url === '/terminals/tttttttt') {
        return jsonResponse({ id: 'tttttttt', name: 'win', provider: 'codex', session_name: 'sess-done', agent_profile: 'sol', caller_id: null, status: 'completed', last_active: null, last_output_at: null })
      }
      if (url.startsWith('/terminals/tttttttt/working-directory')) return jsonResponse({ working_directory: null })
      if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)
    useStore.setState({ sessions: [doneSession], connected: true })
    render(<Workspace />)

    expect(await screen.findByText('완료')).toBeInTheDocument()
  })

  it('feedback #14: persists the workbench terminal/tab context for the active session when opened from a card', async () => {
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<Workspace />)

    // "Output 열기" (not "터미널 열기") deliberately — mounting the real
    // Terminal tab pulls in xterm.js, which needs window.matchMedia; jsdom
    // doesn't provide it (see workspace-embedded.test.tsx's own note on why
    // TerminalView isn't exercised directly in this suite). openInWorkbench's
    // persistence logic is identical regardless of which tab is opened.
    fireEvent.click(await screen.findByRole('tab', { name: /에이전트/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Output 열기' }))

    await waitFor(() => {
      const stored = window.localStorage.getItem('cao:workbench:v1:sess-1')
      expect(stored).not.toBeNull()
      expect(JSON.parse(stored!)).toEqual({ terminalId: 'aaaaaaaa', tab: 'output' })
    })
  })
})
