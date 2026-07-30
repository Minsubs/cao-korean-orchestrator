import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Workspace } from '../features/workspace/Workspace'
import type { UiConnectionStatus } from '../features/workspace/eventsClient'
import type { UiEvent } from '../features/workspace/types'
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
    if (url.startsWith('/agents/profiles')) {
      return jsonResponse([
        { name: 'codex_orchestrator_sol', description: 'Orchestrator', source: 'local', provider: 'codex', model: 'gpt-5.6-sol' },
        { name: 'claude_orchestrator_opus', description: 'Orchestrator', source: 'local', provider: 'claude_code', model: 'opus' },
      ])
    }
    if (url.startsWith('/agents/providers')) return jsonResponse([{ name: 'codex', binary: 'codex', installed: true }, { name: 'claude_code', binary: 'claude', installed: true }])
    if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

/**
 * Workspace used to own its `/ui/events` stream and selected-session state
 * directly; both moved up to AppShell (see AppShell.tsx) so navigating the
 * rail never tears down the stream or forgets the selected session. This
 * harness stands in for AppShell in these render-level tests: it owns exactly
 * that state and threads it down as props, so the tests below keep exercising
 * the real Workspace component unchanged.
 */
function TestWorkspace({ events = [], status = 'disconnected' }: { events?: UiEvent[]; status?: UiConnectionStatus } = {}) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  return (
    <Workspace
      events={events}
      status={status}
      selectedSessionId={selectedSessionId}
      setSelectedSessionId={setSelectedSessionId}
    />
  )
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
    render(<TestWorkspace />)
    expect(await screen.findByText('아직 실행 중인 세션이 없어요')).toBeInTheDocument()
    // Workspace renders exactly whatever stream status it's handed (it no
    // longer owns the connection itself — see TestWorkspace above) and
    // TestWorkspace's own default is 'disconnected', so it never fakes connected.
    expect(await screen.findByText('이벤트 끊김')).toBeInTheDocument()
  })

  it('shows "이벤트 없음" for a selected session with no observed activity yet (never invents a plan/state)', async () => {
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)
    expect(await screen.findByText(/이벤트 없음/)).toBeInTheDocument()
  })

  it('selects the session orchestrator as the Workbench context once its terminals load', async () => {
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)

    await waitFor(() => {
      expect(screen.queryByText('컨텍스트: 선택된 에이전트 없음')).not.toBeInTheDocument()
      expect(screen.getByText((_, element) => (
        element?.tagName === 'SPAN'
        && element.textContent?.includes('컨텍스트:') === true
        && element.textContent?.includes('aaaaaaaa') === true
      ))).toBeInTheDocument()
    })
  })

  it('shows every selected team profile in the right agent tab before delegation', async () => {
    window.localStorage.setItem('cao:workspace:team-roster:v1:sess-1', JSON.stringify([
      { name: 'claude_developer_sonnet', provider: 'claude_code' },
      { name: 'codex_qa_terra', provider: 'codex' },
      { name: 'codex_docs_luna', provider: 'codex' },
    ]))
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)

    expect(await screen.findByRole('tab', { name: '에이전트 4' })).toBeInTheDocument()
    expect(screen.getByText('개발자')).toBeInTheDocument()
    expect(screen.getByText('테스트 담당')).toBeInTheDocument()
    expect(screen.getByText('문서 정리')).toBeInTheDocument()
    expect(screen.getAllByText(/호출 대기/)).toHaveLength(3)
  })

  it('collapses and re-expands the sidebar from the workspace toolbar toggle', async () => {
    installMockFetch()
    render(<TestWorkspace />)
    expect(await screen.findByLabelText('프로젝트와 세션')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '사이드바 열기/접기' }))
    expect(screen.queryByLabelText('프로젝트와 세션')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '사이드바 열기/접기' }))
    expect(await screen.findByLabelText('프로젝트와 세션')).toBeInTheDocument()
  })

  it('keeps the orchestrator role fixed and enables submit once an instruction is filled', async () => {
    installMockFetch()
    render(<TestWorkspace />)

    // Exact match: with no sessions, Overview's own onboarding CTA
    // ("새 작업 시작") also renders and would otherwise ambiguously match a
    // loose /새 작업/ pattern alongside the toolbar's "새 작업" button.
    fireEvent.click(await screen.findByRole('button', { name: '새 작업' }))
    const dialog = await screen.findByRole('dialog', { name: '새 작업' })
    const submit = within(dialog).getByRole('button', { name: /작업 시작/ })
    expect(submit).toBeDisabled()
    expect(within(dialog).getByText('고정 역할')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Codex 오케스트레이터' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).getByRole('radio', { name: 'Claude 오케스트레이터' })).toBeEnabled()

    fireEvent.change(within(dialog).getByPlaceholderText(/세션 만료 후 재로그인/), { target: { value: '버그를 고쳐줘' } })
    expect(submit).not.toBeDisabled()
  })

  it('switches Workbench tabs and opens the dock, showing an honest empty Logs list with no terminal selected', async () => {
    installMockFetch()
    render(<TestWorkspace />)
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
    render(<TestWorkspace />)

    const textarea = await screen.findByLabelText('메시지 입력')
    fireEvent.change(textarea, { target: { value: '진행 상황 알려줘' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    await waitFor(() => {
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][]
      expect(calls.some(([url, opts]) => url.startsWith('/terminals/aaaaaaaa/input') && opts?.method === 'POST')).toBe(true)
    })
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps the active Workspace turn pending while a delegated worker is processing', async () => {
    let sent = false
    const worker = { ...SUPERVISOR, id: 'bbbbbbbb', tmux_window: '2', agent_profile: 'terra' }
    const mockFetch = vi.fn(async (url: string) => {
      if (url === '/sessions') return jsonResponse([SESSION])
      if (url.startsWith('/sessions/sess-1')) {
        return jsonResponse({
          session: SESSION,
          terminals: sent
            ? [
                { ...SUPERVISOR, status: 'completed', caller_id: null, input_generation: 1, ready_generation: 1 },
                { ...worker, status: 'processing', caller_id: 'aaaaaaaa', input_generation: 1, ready_generation: 0 },
              ]
            : [{ ...SUPERVISOR, status: 'idle', caller_id: null, input_generation: 0, ready_generation: 0 }],
        })
      }
      if (url === '/terminals/aaaaaaaa') {
        return jsonResponse({ ...SUPERVISOR, name: 'supervisor', session_name: 'sess-1', caller_id: null, status: sent ? 'completed' : 'idle', last_output_at: null })
      }
      if (url === '/terminals/bbbbbbbb') {
        return jsonResponse({ ...worker, name: 'worker', session_name: 'sess-1', caller_id: 'aaaaaaaa', status: 'processing', last_output_at: null })
      }
      if (url.startsWith('/terminals/aaaaaaaa/output')) return jsonResponse({ output: sent ? '워커에게 위임했습니다.' : '', mode: 'last' })
      if (url.startsWith('/terminals/aaaaaaaa/input')) {
        sent = true
        return jsonResponse({ success: true })
      }
      if (url.includes('/working-directory')) return jsonResponse({ working_directory: '~/work/alarm-solution' })
      if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)

    const textarea = await screen.findByLabelText('메시지 입력')
    fireEvent.change(textarea, { target: { value: '팀 연결 테스트' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    // Phase 2: the pending placeholder now renders as the live progress card
    // instead of the plain WAITING sentence — the turn must still read as
    // unresolved, and the worker's intermediate output must not be promoted.
    expect(await screen.findByTestId('progress-card')).toBeInTheDocument()
    expect(screen.queryByText('오케스트레이터 응답을 기다리는 중…')).not.toBeInTheDocument()
    expect(screen.queryByText('워커에게 위임했습니다.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송 중' })).toBeDisabled()
  })

  it('persists pending metadata before input resolves and restores it after remount', async () => {
    let resolveInput: ((value: ReturnType<typeof jsonResponse>) => void) | undefined
    const inputRequest = new Promise<ReturnType<typeof jsonResponse>>(resolve => {
      resolveInput = resolve
    })
    const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/sessions') return jsonResponse([SESSION])
      if (url.startsWith('/sessions/sess-1')) {
        return jsonResponse({
          session: SESSION,
          terminals: [{ ...SUPERVISOR, status: 'idle', caller_id: null, input_generation: 0, ready_generation: 0 }],
        })
      }
      if (url === '/terminals/aaaaaaaa') return jsonResponse({ ...SUPERVISOR, name: 'supervisor', session_name: 'sess-1', caller_id: null, status: 'idle', last_output_at: null })
      if (url.startsWith('/terminals/aaaaaaaa/output')) return jsonResponse({ output: '이전 응답', mode: 'last' })
      if (url.startsWith('/terminals/aaaaaaaa/input') && opts?.method === 'POST') return inputRequest
      if (url.includes('/working-directory')) return jsonResponse({ working_directory: '~/work/alarm-solution' })
      if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)
    useStore.setState({ sessions: [SESSION], connected: true })

    const first = render(<TestWorkspace />)
    const textarea = await screen.findByLabelText('메시지 입력')
    fireEvent.change(textarea, { target: { value: '팀 연결 테스트' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('cao:session-chat:v2:sess-1') || '{}')
      expect(stored.workspacePendingReply).toMatchObject({
        terminalId: 'aaaaaaaa',
        baselineGenerations: { aaaaaaaa: 0 },
        baselineInboxMessageId: 0,
      })
      // Phase 2: the turn's start time is part of the persisted metadata, so a
      // restored turn can keep counting instead of restarting its elapsed clock.
      expect(typeof stored.workspacePendingReply.startedAt).toBe('number')
    })
    first.unmount()
    await act(async () => resolveInput?.(jsonResponse({ success: true })))

    render(<TestWorkspace />)

    expect(await screen.findByText('팀 연결 테스트')).toBeInTheDocument()
    // Restored as still-pending — now surfaced by the Phase 2 progress card.
    expect(screen.getByTestId('progress-card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송 중' })).toBeDisabled()
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
    render(<TestWorkspace />)

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
    render(<TestWorkspace />)

    expect((await screen.findAllByText('abc12345')).length).toBeGreaterThan(0)
    expect(screen.queryByText('cao-abc12345')).not.toBeInTheDocument()
  })

  it('starts the fixed Codex orchestrator and prepends checked role-based team profiles to the first instruction', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url === '/sessions') return jsonResponse([])
      if (url.startsWith('/agents/profiles')) {
        return jsonResponse([
          { name: 'codex_orchestrator_sol', description: 'Orchestrator', source: 'local', provider: 'codex', model: 'gpt-5.6-sol' },
          { name: 'claude_orchestrator_opus', description: 'Orchestrator', source: 'local', provider: 'claude_code', model: 'opus' },
          { name: 'claude_developer_sonnet', description: 'Worker', source: 'local', provider: 'claude_code', model: 'sonnet' },
        ])
      }
      if (url.startsWith('/sessions?')) return jsonResponse({ id: 'term-1', session_name: 'auto-1' })
      // Post-creation, Workspace switches to the new session and
      // useWorkspaceSession immediately polls its detail. This used to answer
      // with an empty terminal list, which no real server does right after
      // creating one — and it stopped mattering only because the modal POSTed
      // the first prompt directly. The first prompt now goes through the
      // workspace's own sendMessage (so the turn is tracked), which needs the
      // orchestrator terminal to actually show up here.
      if (url.startsWith('/sessions/auto-1')) {
        return jsonResponse({
          session: { id: 'auto-1', name: 'auto-1', status: 'active' },
          terminals: [{
            id: 'term-1',
            tmux_session: 'auto-1',
            tmux_window: '1',
            provider: 'codex',
            agent_profile: 'codex_orchestrator_sol',
            created_at: '2026-07-30T00:00:00Z',
            last_active: null,
          }],
        })
      }
      if (url === '/terminals/term-1') {
        return jsonResponse({ id: 'term-1', name: 'sol', session_name: 'auto-1', tmux_session: 'auto-1', tmux_window: '1', provider: 'codex', agent_profile: 'codex_orchestrator_sol', caller_id: null, status: 'idle', last_output_at: null, created_at: '2026-07-30T00:00:00Z', last_active: null })
      }
      if (url.startsWith('/terminals/term-1/output')) return jsonResponse({ output: '', mode: 'last' })
      if (url.startsWith('/terminals/term-1/working-directory')) return jsonResponse({ working_directory: '~/work/x' })
      if (url.startsWith('/terminals/term-1/input')) return jsonResponse({ success: true })
      if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)
    render(<TestWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: '새 작업' }))
    const dialog = await screen.findByRole('dialog', { name: '새 작업' })

    fireEvent.change(within(dialog).getByPlaceholderText(/세션 만료 후 재로그인/), { target: { value: '버그를 고쳐줘' } })

    expect(await within(dialog).findByText('구현')).toBeInTheDocument()
    expect(within(dialog).getByText('(1)')).toBeInTheDocument()
    expect(within(dialog).getByText('개발자')).toBeInTheDocument()

    const submit = within(dialog).getByRole('button', { name: /작업 시작/ })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => (u as string).startsWith('/sessions?'))).toBe(true)
    })
    const [createUrl] = mockFetch.mock.calls.find(([u]) => (u as string).startsWith('/sessions?'))!
    expect(createUrl as string).toContain('provider=codex')
    expect(createUrl as string).toContain('agent_profile=codex_orchestrator_sol')

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => (u as string).startsWith('/terminals/term-1/input'))).toBe(true)
    })
    const [inputUrl] = mockFetch.mock.calls.find(([u]) => (u as string).startsWith('/terminals/term-1/input'))!
    const sentMessage = decodeURIComponent((inputUrl as string).split('message=')[1])
    expect(sentMessage).toContain('[팀] 위임 가능한 워커 프로필: claude_developer_sonnet')
    expect(sentMessage).toContain('assign/handoff 시 이 프로필 이름을 사용하세요.')
    expect(JSON.parse(window.localStorage.getItem('cao:workspace:team-roster:v1:auto-1') || '[]')).toEqual([
      { name: 'claude_developer_sonnet', provider: 'claude_code' },
    ])
  })

  it('switches only the fixed orchestrator execution AI when Claude is selected', async () => {
    const mockFetch = installMockFetch()
    render(<TestWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: '새 작업' }))
    const dialog = await screen.findByRole('dialog', { name: '새 작업' })
    fireEvent.change(within(dialog).getByPlaceholderText(/세션 만료 후 재로그인/), { target: { value: '설계를 검토해줘' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Claude 오케스트레이터' }))
    expect(within(dialog).getByRole('radio', { name: 'Claude 오케스트레이터' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: /작업 시작/ }))

    await waitFor(() => expect(mockFetch.mock.calls.some(([u]) => (u as string).startsWith('/sessions?'))).toBe(true))
    const [createUrl] = mockFetch.mock.calls.find(([u]) => (u as string).startsWith('/sessions?'))!
    expect(createUrl as string).toContain('provider=claude_code')
    expect(createUrl as string).toContain('agent_profile=claude_orchestrator_opus')
  })

  it('feedback #12: client-validates the session name against the server pattern and disables submit for invalid characters', async () => {
    installMockFetch()
    render(<TestWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: '새 작업' }))
    const dialog = await screen.findByRole('dialog', { name: '새 작업' })

    fireEvent.change(within(dialog).getByPlaceholderText(/세션 만료 후 재로그인/), { target: { value: '버그를 고쳐줘' } })
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
    render(<TestWorkspace />)

    expect(await screen.findByText('완료')).toBeInTheDocument()
  })

  it('feedback #14: persists the workbench terminal/tab context for the active session when opened from a card', async () => {
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)

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
