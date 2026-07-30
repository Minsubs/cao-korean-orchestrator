import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { AppShell } from '../app/AppShell'
import { subscribeUiEvents } from '../features/workspace/eventsClient'
import { useStore } from '../store'

// The `/ui/events` stream is owned once in AppShell (above the rail's view
// switch — see AppShell.tsx) so menu navigation never tears it down. Wrapping
// the real subscribeUiEvents in a spy (rather than mocking it away) lets the
// tests below assert on real subscribe/close call counts while every other
// test in this file still exercises the genuine SSE client end to end.
vi.mock('../features/workspace/eventsClient', async () => {
  const actual = await vi.importActual<typeof import('../features/workspace/eventsClient')>(
    '../features/workspace/eventsClient',
  )
  return { ...actual, subscribeUiEvents: vi.fn(actual.subscribeUiEvents) }
})

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

describe('AppShell', () => {
  let memoryEnabled = false

  // Generic backend double: every list endpoint the 5 legacy panels fetch on
  // mount gets a well-shaped empty response so none of them crash regardless
  // of which rail view a test navigates to.
  const mockFetch = vi.fn(async (url: string) => {
    if (url.startsWith('/settings/memory')) return jsonResponse({ enabled: memoryEnabled })
    if (url.startsWith('/settings/agent-dirs')) return jsonResponse({ agent_dirs: {}, extra_dirs: [], disabled_dirs: [] })
    if (url.startsWith('/usage')) return jsonResponse({ accounts: [], scanned_at: new Date().toISOString() })
    return jsonResponse([])
  })

  beforeEach(() => {
    memoryEnabled = false
    mockFetch.mockClear()
    vi.mocked(subscribeUiEvents).mockClear()
    vi.stubGlobal('fetch', mockFetch)
    document.documentElement.dataset.theme = 'dark'
    window.localStorage.clear()
    useStore.setState({ sessions: [], activeSession: null, activeSessionDetail: null, connected: false, terminalStatuses: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the rail with the Workspace view selected by default', async () => {
    render(<AppShell />)
    expect(await screen.findByRole('tab', { name: '작업공간' })).toHaveAttribute('aria-selected', 'true')
    // The header's usage widget is no longer a button: it is always-visible
    // per-AI bars (HeaderUsageBars), and the detail moved to 설정. With this
    // test's fetch mock reporting no measured limits, the bars render nothing —
    // what must hold is that the old click-to-open control is gone.
    expect(screen.queryByRole('button', { name: 'AI 사용량' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '자동화' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: '도구 및 확장' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Agent 프로필' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: '설정' })).toHaveAttribute('aria-selected', 'false')
  })

  it('transitions aria-selected to the clicked rail item', async () => {
    render(<AppShell />)
    fireEvent.click(screen.getByRole('tab', { name: '자동화' }))
    expect(screen.getByRole('tab', { name: '자동화' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '작업공간' })).toHaveAttribute('aria-selected', 'false')
  })

  it('hides the memory rail item when the backend reports memory disabled', async () => {
    memoryEnabled = false
    render(<AppShell />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: '메모리' })).not.toBeInTheDocument()
  })

  it('shows the memory rail item when the backend reports memory enabled', async () => {
    memoryEnabled = true
    render(<AppShell />)
    expect(await screen.findByRole('tab', { name: '메모리' })).toBeInTheDocument()
  })

  it('renders the real ToolingView for Tools & Extensions (honest error state without API)', async () => {
    // The shared mockFetch answers unknown URLs with []; the tooling view must
    // instead see a failing API here so its honest error state is exercised.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/tooling')) throw new TypeError('tooling API unavailable in tests')
        return mockFetch(url)
      }),
    )
    render(<AppShell />)
    fireEvent.click(screen.getByRole('tab', { name: '도구 및 확장' }))
    expect(await screen.findByText(/Tooling API에 연결할 수 없어요/)).toBeInTheDocument()
  })

  it('renders the real ProfilesView for Agent Profiles (empty state with the stubbed backend)', async () => {
    render(<AppShell />)
    fireEvent.click(screen.getByRole('tab', { name: 'Agent 프로필' }))
    // mockFetch answers /agents/profiles with [] — the real view's honest empty state.
    expect(await screen.findByText('설치된 에이전트 프로필이 없어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /에이전트 만들기/ })).toBeInTheDocument()
  })

  it('toggles documentElement.dataset.theme when the theme button is clicked', async () => {
    // Default preference is light (storage is cleared in beforeEach), so the
    // first toggle goes light -> dark, the second back to light.
    render(<AppShell />)
    const toggle = await screen.findByRole('button', { name: /모드로 전환/ })
    fireEvent.click(toggle)
    expect(document.documentElement.dataset.theme).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: /모드로 전환/ }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('switches views via Alt+N over the visible rail order', async () => {
    render(<AppShell />)
    await screen.findByRole('tab', { name: '작업공간' })
    fireEvent.keyDown(window, { key: '2', altKey: true })
    expect(screen.getByRole('tab', { name: '자동화' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(window, { key: '3', altKey: true })
    expect(screen.getByRole('tab', { name: '도구 및 확장' })).toHaveAttribute('aria-selected', 'true')
    // Settings is pinned to the bottom of the rail but stays last in the
    // visible-order list that drives numbering, so with memory hidden (5
    // visible items) it is Alt+5.
    fireEvent.keyDown(window, { key: '5', altKey: true })
    expect(screen.getByRole('tab', { name: '설정' })).toHaveAttribute('aria-selected', 'true')
  })

  // Phase 2c: the Workspace rail view's classic DashboardHome/AgentPanel
  // sub-tabs and the 스레드/클래식 mode toggle (both Phase 1b/2b) are retired —
  // Workspace now always renders its chat-centric UI directly, full-bleed,
  // with no mode toggle above it. This replaces the four Phase 2b tests that
  // exercised 클래식/스레드 switching and DashboardHome's legacy onNavigate
  // wiring (that machinery no longer exists to test).
  it('renders the Workspace view directly — no thread/classic mode toggle, Sidebar immediately visible', async () => {
    render(<AppShell />)
    expect(await screen.findByLabelText('프로젝트와 세션')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '스레드' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '클래식' })).not.toBeInTheDocument()
  })

  // Existing-feature-preserved smoke checks: each legacy panel must still
  // mount cleanly (no ErrorBoundary fallback) when reached through its new
  // rail entry, proving the wrapper/routing change didn't break access.
  it('mounts the new FlowsView without error under the Automation rail item', async () => {
    render(<AppShell />)
    fireEvent.click(screen.getByRole('tab', { name: '자동화' }))
    expect(await screen.findByText('등록된 Flow가 없어요')).toBeInTheDocument()
    expect(screen.queryByText('문제가 발생했습니다')).not.toBeInTheDocument()
  })

  it('mounts the legacy SettingsPanel without error under the pinned Settings rail item', async () => {
    render(<AppShell />)
    fireEvent.click(screen.getByRole('tab', { name: '설정' }))
    expect(await screen.findByText('사용자 지정 디렉터리가 없습니다.')).toBeInTheDocument()
    expect(screen.queryByText('문제가 발생했습니다')).not.toBeInTheDocument()
  })

  it('mounts the legacy MemoryPanel without error under the Memory rail item when enabled', async () => {
    memoryEnabled = true
    render(<AppShell />)
    fireEvent.click(await screen.findByRole('tab', { name: '메모리' }))
    expect(await screen.findByText('저장된 메모리가 없습니다.')).toBeInTheDocument()
    expect(screen.queryByText('문제가 발생했습니다')).not.toBeInTheDocument()
  })

  // Regression: useUiEventStream() used to live inside Workspace, so every
  // rail switch away from 작업공간 unmounted Workspace and closed the
  // EventSource, and switching back mounted a fresh instance and reopened it.
  // It now lives in AppShell (above the view switch, see AppShell.tsx), so
  // the underlying subscribeUiEvents() must only ever be called once no
  // matter how many times the rail is switched away and back.
  it('owns the /ui/events stream once in AppShell so switching rail views never re-subscribes it', async () => {
    render(<AppShell />)
    await screen.findByRole('tab', { name: '작업공간' })
    expect(subscribeUiEvents).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('tab', { name: '도구 및 확장' }))
    fireEvent.click(screen.getByRole('tab', { name: '작업공간' }))
    fireEvent.click(screen.getByRole('tab', { name: '자동화' }))
    fireEvent.click(screen.getByRole('tab', { name: '작업공간' }))

    expect(subscribeUiEvents).toHaveBeenCalledTimes(1)
  })

  // Regression: selectedSessionId used to be local state inside Workspace, so
  // it reset to null every time Workspace remounted on a rail switch, and the
  // "default to the first session" effect would then silently re-select
  // sessions[0] — quietly overriding whatever the user had actually picked.
  // It now lives in AppShell (see AppShell.tsx) and survives Workspace's
  // mount/unmount, so a manually selected session must still be selected
  // after navigating away and back.
  it('preserves the manually selected session across a rail navigation away and back', async () => {
    const sessionOne = { id: 'session-one', name: 'session-one', status: 'active' }
    const sessionTwo = { id: 'session-two', name: 'session-two', status: 'active' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        // AppShell's own 10s fetchSessions() poll (and its immediate on-mount
        // call) hits this too — without it, that poll would overwrite the
        // preset store state below with an empty list on the very next tick.
        if (url === '/sessions') return jsonResponse([sessionOne, sessionTwo])
        if (url === '/sessions/session-one') return jsonResponse({ session: sessionOne, terminals: [] })
        if (url === '/sessions/session-two') return jsonResponse({ session: sessionTwo, terminals: [] })
        return mockFetch(url)
      }),
    )
    useStore.setState({ sessions: [sessionOne, sessionTwo], connected: true })

    render(<AppShell />)
    const sidebar = await screen.findByLabelText('프로젝트와 세션')
    // No prior selection — Workspace's own "default to the first session"
    // effect picks session-one.
    await within(sidebar).findByText('session-one')

    fireEvent.click(within(sidebar).getByText('session-two'))
    await waitFor(() => {
      expect(within(sidebar).getByText('session-two').closest('[role="button"]')).toHaveAttribute('aria-selected', 'true')
    })

    fireEvent.click(screen.getByRole('tab', { name: '자동화' }))
    fireEvent.click(screen.getByRole('tab', { name: '작업공간' }))

    const sidebarAfter = await screen.findByLabelText('프로젝트와 세션')
    expect(within(sidebarAfter).getByText('session-two').closest('[role="button"]')).toHaveAttribute('aria-selected', 'true')
    expect(within(sidebarAfter).getByText('session-one').closest('[role="button"]')).toHaveAttribute('aria-selected', 'false')
  })
})
