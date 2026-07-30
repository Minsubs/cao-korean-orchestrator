import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { NewTaskModal } from '../features/workspace/NewTaskModal'
import { Workspace } from '../features/workspace/Workspace'
import type { UiConnectionStatus } from '../features/workspace/eventsClient'
import type { ProjectsData, UiEvent } from '../features/workspace/types'
import { useStore } from '../store'

// Phase 5 Task 3: showOverlay/hideOverlay must bracket the two longest
// user-facing waits — new-task create and session teardown — with the
// ref-count landing back at 0 on every settle path (success shown here;
// the finally-block wiring in NewTaskModal.tsx/Workspace.tsx is what also
// covers the error path, since show/hide sit outside the try/catch split).

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

/** A promise this test can resolve on its own schedule, to observe the overlay mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

describe('overlay wiring — new task create', () => {
  const EMPTY_PROJECTS: ProjectsData = { groups: [], projects: [], pinned: [] }

  beforeEach(() => {
    useStore.setState({ overlay: { count: 0, message: '', sub: null } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('raises overlay.count while the session is being created and drops it back to 0 once everything settles', async () => {
    const createDeferred = deferred<Record<string, unknown>>()
    const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url.startsWith('/agents/profiles')) {
        return jsonResponse([
          { name: 'codex_orchestrator_sol', provider: 'codex' },
          { name: 'claude_orchestrator_opus', provider: 'claude_code' },
          { name: 'antigravity_orchestrator_agy', provider: 'antigravity_cli' },
        ])
      }
      if (url.startsWith('/sessions?') && opts?.method === 'POST') {
        const terminal = await createDeferred.promise
        return jsonResponse(terminal)
      }
      if (url.startsWith('/terminals/') && url.includes('/input')) return jsonResponse({ success: true })
      if (url === '/sessions') return jsonResponse([])
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)

    render(<NewTaskModal projects={EMPTY_PROJECTS} onClose={() => {}} onCreated={() => {}} />)

    // Wait for profiles to load (canSubmit needs a resolved orchestrator profile).
    await screen.findByRole('radio', { name: 'Codex 오케스트레이터' })
    fireEvent.change(screen.getByPlaceholderText(/세션 만료 후/), { target: { value: '로그인 재시도 버그 고쳐줘' } })

    expect(useStore.getState().overlay.count).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '작업 시작' }))

    // showOverlay fires synchronously before the first await in the create
    // handler, so this is already true the instant the click handler returns.
    expect(useStore.getState().overlay.count).toBe(1)

    createDeferred.resolve({
      id: 'term-created',
      name: 'win',
      provider: 'codex',
      session_name: 'sess-created',
      agent_profile: 'codex_orchestrator_sol',
      status: 'idle',
      last_active: null,
    })

    await waitFor(() => expect(useStore.getState().overlay.count).toBe(0))
  })
})

describe('overlay wiring — session end', () => {
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

  beforeEach(() => {
    window.localStorage.clear()
    useStore.setState({
      sessions: [],
      activeSession: null,
      activeSessionDetail: null,
      connected: false,
      terminalStatuses: {},
      overlay: { count: 0, message: '', sub: null },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('raises overlay.count while a session is being torn down and drops it back to 0 once it settles', async () => {
    const deleteDeferred = deferred<{ success: boolean; deleted: string[]; errors: unknown[] }>()
    const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/sessions') return jsonResponse([SESSION])
      if (url.startsWith('/sessions/sess-1') && opts?.method === 'DELETE') {
        const body = await deleteDeferred.promise
        return jsonResponse(body)
      }
      if (url.startsWith('/sessions/sess-1')) return jsonResponse({ session: SESSION, terminals: [SUPERVISOR] })
      if (url === '/terminals/aaaaaaaa') {
        return jsonResponse({ ...SUPERVISOR, name: 'win', session_name: 'sess-1', caller_id: null, status: 'idle', last_output_at: null })
      }
      if (url.startsWith('/terminals/aaaaaaaa/working-directory')) return jsonResponse({ working_directory: '~/work/alarm-solution' })
      if (url.startsWith('/terminals/aaaaaaaa/output')) return jsonResponse({ output: '', mode: 'last' })
      if (url.startsWith('/agents/profiles')) return jsonResponse([])
      if (url.startsWith('/agents/providers')) return jsonResponse([])
      if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', mockFetch)

    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)

    fireEvent.click(await screen.findByRole('tab', { name: '세션 정보' }))
    fireEvent.click(await screen.findByRole('button', { name: '세션 종료' }))

    const dialog = screen.getByRole('dialog', { name: '세션 종료' })
    expect(useStore.getState().overlay.count).toBe(0)

    fireEvent.click(within(dialog).getByRole('button', { name: '세션 종료' }))

    // showOverlay fires synchronously before the first await in
    // handleConfirmEndSession, so this is already true post-click.
    expect(useStore.getState().overlay.count).toBe(1)

    deleteDeferred.resolve({ success: true, deleted: ['sess-1'], errors: [] })

    await waitFor(() => expect(useStore.getState().overlay.count).toBe(0))
  })
})
