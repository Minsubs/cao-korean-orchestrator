import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { AgentSidePanel } from '../features/workspace/AgentSidePanel'
import { useStore } from '../store'

// Phase 2c spec §2: AgentSidePanel header [+ 에이전트 추가] — manually add a
// worker terminal to the active session via the exact same
// `addTerminalToSession` call the classic AgentPanel.tsx "에이전트 추가" inline
// form used. Spec §테스트: "모달 열기→프로필 선택→추가 호출 인자 검증→성공 스낵바".

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

const SUPERVISOR = {
  id: 'aaaaaaaa',
  tmux_session: 'sess-a',
  tmux_window: '1',
  provider: 'codex',
  agent_profile: 'sol',
  created_at: null,
  last_active: null,
}

function installMockFetch() {
  const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url.startsWith('/agents/profiles')) return jsonResponse([{ name: 'developer', description: '구현 담당', source: 'built-in' }])
    if (url.startsWith('/agents/providers')) return jsonResponse([{ name: 'claude_code', binary: 'claude', installed: true }])
    if (url.startsWith('/sessions/sess-a/terminals'))
      return jsonResponse({ id: 'dddddddd', name: 'win', provider: 'kiro_cli', session_name: 'sess-a', agent_profile: 'developer' })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

function renderPanel(onAgentAdded: () => void = () => {}) {
  const noop = () => {}
  return render(
    <AgentSidePanel
      collapsed={false}
      sessionName="sess-a"
      terminals={[SUPERVISOR]}
      cards={[]}
      terminalStatuses={{}}
      sessionWorkingDirectory="/home/user/project"
      onMessageTarget={noop}
      onOpenTerminal={noop}
      onOpenOutput={noop}
      onOpenInbox={noop}
      onRequestStop={noop}
      onRequestDelete={noop}
      onRequestEndSession={noop}
      onAgentAdded={onAgentAdded}
    />,
  )
}

describe('AgentSidePanel — manual worker add (Phase 2c §2)', () => {
  beforeEach(() => {
    useStore.setState({ snackbar: null })
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('disables the header [+] button when no session is selected', () => {
    render(
      <AgentSidePanel
        collapsed={false}
        sessionName={null}
        terminals={[]}
        cards={[]}
        terminalStatuses={{}}
        sessionWorkingDirectory={null}
        onMessageTarget={() => {}}
        onOpenTerminal={() => {}}
        onOpenOutput={() => {}}
        onOpenInbox={() => {}}
        onRequestStop={() => {}}
        onRequestDelete={() => {}}
        onRequestEndSession={() => {}}
        onAgentAdded={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '에이전트 추가' })).toBeDisabled()
  })

  it('opens the Add Agent modal from the header [+] button, prefilled with the session working directory', async () => {
    installMockFetch()
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })
    expect(within(dialog).getByDisplayValue('/home/user/project')).toBeInTheDocument()
  })

  it('selects a profile, submits, calls addTerminalToSession with the right args, shows a success snackbar, and refreshes the card list', async () => {
    const mockFetch = installMockFetch()
    const onAgentAdded = vi.fn()
    renderPanel(onAgentAdded)

    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })

    fireEvent.click(within(dialog).getByText('프로필 선택...'))
    fireEvent.click(await within(dialog).findByRole('button', { name: /^developer/ }))

    fireEvent.click(within(dialog).getByRole('button', { name: '추가' }))

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u]) => u.startsWith('/sessions/sess-a/terminals'))).toBe(true)
    })
    const [url, opts] = mockFetch.mock.calls.find(([u]) => u.startsWith('/sessions/sess-a/terminals'))!
    expect(opts?.method).toBe('POST')
    // Feedback #8: 'kiro_cli' is one of the default-hidden providers, and this
    // mock's /agents/providers only returns 'claude_code' anyway — the modal
    // corrects its initial 'kiro_cli' default to the one actually-visible
    // provider rather than silently submitting a hidden/unlisted one.
    expect(url).toContain('provider=claude_code')
    expect(url).toContain('agent_profile=developer')
    expect(url).toContain(`working_directory=${encodeURIComponent('/home/user/project')}`)

    await waitFor(() => expect(useStore.getState().snackbar).toMatchObject({ type: 'success' }))
    expect(onAgentAdded).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '에이전트 추가' })).not.toBeInTheDocument()
  })

  it('shows an error snackbar and keeps the modal open when addTerminalToSession fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/agents/profiles')) return jsonResponse([{ name: 'developer', description: '구현 담당', source: 'built-in' }])
        if (url.startsWith('/agents/providers')) return jsonResponse([{ name: 'claude_code', binary: 'claude', installed: true }])
        if (url.startsWith('/sessions/sess-a/terminals')) return { ok: false, status: 500, statusText: 'Internal Server Error', json: () => Promise.resolve({ detail: '실패' }) }
        return jsonResponse([])
      }),
    )
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })
    fireEvent.click(within(dialog).getByText('프로필 선택...'))
    fireEvent.click(await within(dialog).findByRole('button', { name: /^developer/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '추가' }))

    await waitFor(() => expect(useStore.getState().snackbar).toMatchObject({ type: 'error' }))
    expect(screen.getByRole('dialog', { name: '에이전트 추가' })).toBeInTheDocument()
  })

  it('feedback #8: a default-hidden provider (kiro_cli) never appears as a selectable option', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/agents/profiles')) return jsonResponse([{ name: 'developer', description: '구현 담당', source: 'built-in' }])
        if (url.startsWith('/agents/providers')) return jsonResponse([{ name: 'kiro_cli', binary: 'kiro', installed: true }, { name: 'claude_code', binary: 'claude', installed: true }])
        return jsonResponse([])
      }),
    )
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })

    // The provider select auto-corrects off the hidden 'kiro_cli' default the
    // moment the (filtered) provider list resolves, so it already reads
    // "claude_code" rather than the placeholder — open it from there. Its
    // trigger button and the now-visible dropdown option both match
    // "claude_code" (getAllByRole, not getByRole, to tolerate that) — the
    // real assertion is that 'kiro_cli' has zero matches anywhere at all.
    const providerTrigger = await within(dialog).findByText('claude_code')
    fireEvent.click(providerTrigger)
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: /^claude_code/ }).length).toBeGreaterThanOrEqual(1))
    expect(within(dialog).queryByRole('button', { name: /^kiro_cli/ })).not.toBeInTheDocument()
  })

  it('feedback #1: selecting a profile with a real `provider` field auto-fills the provider select', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/agents/profiles')) {
          return jsonResponse([{ name: 'nova', description: 'x', source: 'user', provider: 'claude_code', model: 'sonnet' }])
        }
        if (url.startsWith('/agents/providers')) {
          return jsonResponse([{ name: 'claude_code', binary: 'claude', installed: true }, { name: 'codex', binary: 'codex', installed: true }])
        }
        if (url.startsWith('/sessions/sess-a/terminals'))
          return jsonResponse({ id: 'dddddddd', name: 'win', provider: 'claude_code', session_name: 'sess-a', agent_profile: 'nova' })
        return jsonResponse([])
      }),
    )
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })

    fireEvent.click(within(dialog).getByText('프로필 선택...'))
    fireEvent.click(await within(dialog).findByRole('button', { name: /^nova/ }))

    fireEvent.click(within(dialog).getByRole('button', { name: '추가' }))

    await waitFor(() => {
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => (u as string).startsWith('/sessions/sess-a/terminals'))).toBe(true)
    })
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => (u as string).startsWith('/sessions/sess-a/terminals'))!
    expect(url as string).toContain('provider=claude_code')
  })
})
