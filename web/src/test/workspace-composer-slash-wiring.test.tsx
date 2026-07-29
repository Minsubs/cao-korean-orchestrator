import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Workspace } from '../features/workspace/Workspace'
import type { UiConnectionStatus } from '../features/workspace/eventsClient'
import type { UiEvent } from '../features/workspace/types'
import { useStore } from '../store'

// Regression guard for the bug where the Composer's slash-command dropdown
// sourced its provider from whichever terminal happened to be open in the
// Workbench dock (`wbContext`), instead of from the chat TARGET the message
// is actually addressed to (`composerTarget`). The Workbench dock defaults to
// the session's supervisor terminal — here given a provider the backend
// cannot enumerate slash commands for, so that default proves nothing about
// the fix by coincidence. Only reading the provider off the terminal the
// user has switched the chat target to (a worker on 'codex') should unlock
// the dropdown.

const SESSION = { id: 'sess-1', name: 'wiring-fix', status: 'active' }
const SUPERVISOR = {
  id: 'aaaaaaaa',
  tmux_session: 'sess-1',
  tmux_window: '1',
  provider: 'antigravity',
  agent_profile: 'sol',
  created_at: '2026-07-17T00:00:00Z',
  last_active: null,
}
const WORKER = {
  id: 'bbbbbbbb',
  tmux_session: 'sess-1',
  tmux_window: '2',
  provider: 'codex',
  agent_profile: 'terra',
  created_at: '2026-07-17T00:00:00Z',
  last_active: null,
}

const SLASH_COMMANDS = [
  { name: '/compact', scope: 'builtin', kind: 'command', description: 'Compact the conversation', interactive: false },
  { name: '/diff', scope: 'builtin', kind: 'command', description: 'Show diff', interactive: false },
]

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

function installMockFetch() {
  const mockFetch = vi.fn(async (url: string) => {
    if (url === '/sessions') return jsonResponse([SESSION])
    if (url.startsWith('/sessions/sess-1')) return jsonResponse({ session: SESSION, terminals: [SUPERVISOR, WORKER] })
    if (url === '/terminals/aaaaaaaa') {
      return jsonResponse({ ...SUPERVISOR, name: 'sol', session_name: 'sess-1', caller_id: null, status: 'idle', last_output_at: null })
    }
    if (url === '/terminals/bbbbbbbb') {
      return jsonResponse({ ...WORKER, name: 'terra', session_name: 'sess-1', caller_id: 'aaaaaaaa', status: 'idle', last_output_at: null })
    }
    if (url.startsWith('/terminals/aaaaaaaa/working-directory')) return jsonResponse({ working_directory: '~/work/wiring-fix' })
    if (url.startsWith('/terminals/bbbbbbbb/working-directory')) return jsonResponse({ working_directory: '~/work/wiring-fix' })
    if (url.startsWith('/terminals/aaaaaaaa/output')) return jsonResponse({ output: '', mode: 'last' })
    if (url.startsWith('/terminals/bbbbbbbb/output')) return jsonResponse({ output: '', mode: 'last' })
    if (url.startsWith('/ui/slash-commands')) return jsonResponse({ provider: 'codex', cwd: '~/work/wiring-fix', commands: SLASH_COMMANDS })
    if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

/** Stands in for AppShell (owns the stream/selected-session state Workspace now receives as props) — mirrors workspace.test.tsx's own harness. */
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

describe('Workspace composer slash-command wiring (regression: target vs workbench)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useStore.setState({ sessions: [], activeSession: null, activeSessionDetail: null, connected: false, terminalStatuses: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sources the slash dropdown from the selected chat target, not from whichever terminal the Workbench dock happens to be showing', async () => {
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)

    // Workbench dock defaults to the supervisor ('antigravity', not a slash
    // provider) once terminals load — confirm that default landed before
    // proceeding, so this test is actually exercising the "dock elsewhere"
    // scenario the bug report describes.
    // The Workbench restore effect (Workspace.tsx) deliberately gives up for
    // this render when `loading` has already flipped false but the selected
    // session's terminals have not landed yet — see its own comment. Its next
    // opportunity is the next session poll, i.e. up to SESSION_POLL_MS (4s)
    // later. waitFor's 1s default therefore cannot cover the slow path, which
    // is why this went flaky in the full 69-file run and never standalone.
    // The budget below spans one whole poll cycle plus margin; the per-test
    // timeout on `it` is raised to match, since vitest's own 5s default would
    // otherwise fire first.
    await waitFor(
      () => {
        expect(screen.getByText((_, el) => (
          el?.tagName === 'SPAN'
          && el.textContent?.includes('컨텍스트:') === true
          && el.textContent?.includes('aaaaaaaa') === true
        ))).toBeInTheDocument()
      },
      { timeout: 10_000 },
    )

    // Switch the chat TARGET (who the message is addressed to) to the
    // worker, whose provider ('codex') the backend CAN enumerate slash
    // commands for — the Workbench dock itself is left untouched on the
    // supervisor.
    fireEvent.click(await screen.findByRole('button', { name: /sol · 오케스트레이터/ }))
    const targetListbox = screen.getByRole('listbox')
    fireEvent.click(within(targetListbox).getByText('terra'))

    const textarea = await screen.findByLabelText('메시지 입력')
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(await screen.findByRole('listbox', { name: '슬래시 명령' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(SLASH_COMMANDS.length))
  }, 20_000)
})
