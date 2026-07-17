import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Overview } from '../features/workspace/Overview'
import { useStore } from '../store'

// Phase 2c spec §1: the fleet Overview replaces the bare "select a session"
// placeholder whenever no session is selected. These tests cover exactly the
// three cases spec §테스트 calls out: sessions present/absent, the attention
// section's click → onSelectSession wiring, and the summary aggregation
// (built entirely from a mocked GET /sessions/{name} — never fabricated).

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

function terminal(id: string, status: string, agentProfile: string | null = null) {
  return {
    id,
    tmux_session: 'sess',
    tmux_window: '1',
    provider: 'codex',
    agent_profile: agentProfile,
    created_at: null,
    last_active: null,
    status,
  }
}

function installMockFetch(bySession: Record<string, { session: { id: string; name: string; status: string }; terminals: unknown[] }>) {
  const mockFetch = vi.fn(async (url: string) => {
    const match = url.match(/^\/sessions\/([^/?]+)$/)
    if (match && bySession[match[1]]) return jsonResponse(bySession[match[1]])
    if (/^\/terminals\/[^/]+\/working-directory$/.test(url)) return jsonResponse({ working_directory: null })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

describe('Overview (fleet overview — Phase 2c)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useStore.setState({ sessions: [], activeSession: null, activeSessionDetail: null, connected: false, terminalStatuses: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the onboarding empty state and wires its CTA to onNewTask when there are no sessions', async () => {
    installMockFetch({})
    const onNewTask = vi.fn()
    render(<Overview onSelectSession={() => {}} onNewTask={onNewTask} />)

    expect(await screen.findByText('아직 실행 중인 세션이 없어요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '새 작업 시작' }))
    expect(onNewTask).toHaveBeenCalledTimes(1)
  })

  it('aggregates 세션/작업 중/입력 대기/오류 counts from the per-session GET /sessions/{name} fetch', async () => {
    useStore.setState({
      sessions: [
        { id: 'sess-a', name: 'sess-a', status: 'active' },
        { id: 'sess-b', name: 'sess-b', status: 'active' },
      ],
    })
    installMockFetch({
      'sess-a': { session: { id: 'sess-a', name: 'sess-a', status: 'active' }, terminals: [terminal('aaaaaaaa', 'processing', 'dev')] },
      'sess-b': {
        session: { id: 'sess-b', name: 'sess-b', status: 'active' },
        terminals: [terminal('bbbbbbbb', 'waiting_user_answer', 'reviewer'), terminal('cccccccc', 'error', 'qa')],
      },
    })

    render(<Overview onSelectSession={() => {}} onNewTask={() => {}} />)

    expect(await screen.findByLabelText('세션 2')).toBeInTheDocument()
    expect(screen.getByLabelText('작업 중 1')).toBeInTheDocument()
    expect(screen.getByLabelText('입력 대기 1')).toBeInTheDocument()
    expect(screen.getByLabelText('오류 1')).toBeInTheDocument()
  })

  it('shows the quiet empty state when no terminal needs attention', async () => {
    useStore.setState({ sessions: [{ id: 'sess-a', name: 'sess-a', status: 'active' }] })
    installMockFetch({
      'sess-a': { session: { id: 'sess-a', name: 'sess-a', status: 'active' }, terminals: [terminal('aaaaaaaa', 'processing', 'dev')] },
    })

    render(<Overview onSelectSession={() => {}} onNewTask={() => {}} />)

    expect(await screen.findByText('지금은 조용해요 ✨')).toBeInTheDocument()
  })

  it('lists a waiting-for-input terminal in the attention section, and selecting it calls onSelectSession with its session id', async () => {
    useStore.setState({
      sessions: [
        { id: 'sess-a', name: 'sess-a', status: 'active' },
        { id: 'sess-b', name: 'sess-b', status: 'active' },
      ],
    })
    installMockFetch({
      'sess-a': { session: { id: 'sess-a', name: 'sess-a', status: 'active' }, terminals: [terminal('aaaaaaaa', 'processing', 'dev')] },
      'sess-b': { session: { id: 'sess-b', name: 'sess-b', status: 'active' }, terminals: [terminal('bbbbbbbb', 'waiting_user_answer', 'reviewer')] },
    })
    const onSelectSession = vi.fn()

    render(<Overview onSelectSession={onSelectSession} onNewTask={() => {}} />)

    const attentionButton = await screen.findByRole('button', { name: 'sess-b 세션 선택 — 주의 필요' })
    fireEvent.click(attentionButton)
    expect(onSelectSession).toHaveBeenCalledWith('sess-b')
  })

  it('selecting a session card from the grid also calls onSelectSession with its id', async () => {
    useStore.setState({ sessions: [{ id: 'sess-a', name: 'sess-a', status: 'active' }] })
    installMockFetch({
      'sess-a': { session: { id: 'sess-a', name: 'sess-a', status: 'active' }, terminals: [terminal('aaaaaaaa', 'idle', 'dev')] },
    })
    const onSelectSession = vi.fn()

    render(<Overview onSelectSession={onSelectSession} onNewTask={() => {}} />)

    // idle isn't an attention status, so 'sess-a 세션 선택' is unambiguous here (grid only).
    const card = await screen.findByRole('button', { name: 'sess-a 세션 선택' })
    fireEvent.click(card)
    expect(onSelectSession).toHaveBeenCalledWith('sess-a')
  })

  it('feedback #16: shows a "완료" badge on a session card once every terminal has settled with at least one completed', async () => {
    useStore.setState({
      sessions: [
        { id: 'sess-done', name: 'sess-done', status: 'active' },
        { id: 'sess-running', name: 'sess-running', status: 'active' },
      ],
    })
    installMockFetch({
      'sess-done': { session: { id: 'sess-done', name: 'sess-done', status: 'active' }, terminals: [terminal('aaaaaaaa', 'completed', 'dev')] },
      'sess-running': { session: { id: 'sess-running', name: 'sess-running', status: 'active' }, terminals: [terminal('bbbbbbbb', 'processing', 'dev')] },
    })

    render(<Overview onSelectSession={() => {}} onNewTask={() => {}} />)

    const doneCard = await screen.findByRole('button', { name: 'sess-done 세션 선택' })
    expect(within(doneCard).getByText('완료')).toBeInTheDocument()

    const runningCard = screen.getByRole('button', { name: 'sess-running 세션 선택' })
    expect(within(runningCard).queryByText('완료')).not.toBeInTheDocument()
  })

  it('feedback #16: renders immediately from a parent-supplied summariesOverride instead of always polling itself', async () => {
    // installMockFetch({}) here has no entry for 'sess-a' at all — if this
    // component fell back to its own useFleetSummaries(sessions) poll
    // despite summariesOverride being supplied, its terminals/status would
    // come back empty and the completion badge would never render.
    installMockFetch({})
    useStore.setState({ sessions: [{ id: 'sess-a', name: 'sess-a', status: 'active' }] })

    render(
      <Overview
        onSelectSession={() => {}}
        onNewTask={() => {}}
        summariesOverride={{
          summaries: { 'sess-a': { sessionId: 'sess-a', sessionName: 'sess-a', terminals: [{ id: 'aaaaaaaa', status: 'completed', agentProfile: 'dev', provider: 'codex' }] } },
          loading: false,
          allFailed: false,
        }}
      />,
    )

    const card = await screen.findByRole('button', { name: 'sess-a 세션 선택' })
    expect(within(card).getByText('완료')).toBeInTheDocument()
    expect(within(card).getByText('터미널 1개')).toBeInTheDocument()
  })
})
