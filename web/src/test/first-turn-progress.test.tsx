import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Workspace } from '../features/workspace/Workspace'
import type { UiConnectionStatus } from '../features/workspace/eventsClient'
import type { UiEvent } from '../features/workspace/types'
import { useStore } from '../store'

// User-reported: starting a new task shows no waiting state at all while the
// orchestrator's first delegate (빠른 탐색가) works. Cause: NewTaskModal sent the
// first prompt itself via api.sendInput, bypassing useWorkspaceSession — so no
// pending turn was registered and the thread stayed empty until an answer
// appeared out of nowhere.
//
// The fix routes the first prompt through the workspace's own sendMessage, which
// is what captures the baseline/generation snapshot the completion check needs.
// These assert the observable consequence: the prompt is delivered to the
// orchestrator terminal, and the thread shows the user's message plus a pending
// state for it.
//
// Waits carry explicit budgets: delivery only happens after the session poll
// lands and the orchestrator terminal appears, so the chain is bounded by
// SESSION_POLL_MS rather than by raw CPU speed. waitFor's 1s default was enough
// locally and not on CI — it failed there with "expected +0 to be 1". The
// per-test timeouts are raised to match, since vitest's own 5s default would
// otherwise fire first.

const SESSION = { id: 'cao-first-turn', name: 'cao-first-turn', status: 'active' }
const SUPERVISOR = {
  id: 'aaaaaaaa',
  tmux_session: 'cao-first-turn',
  tmux_window: '1',
  provider: 'codex',
  agent_profile: 'codex_orchestrator_sol',
  created_at: '2026-07-30T00:00:00Z',
  last_active: null,
}

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

function installMockFetch() {
  // api.sendInput puts the message in the query string, not the body
  // (see api.ts sendInput) — capture the URL.
  const sentInputs: { terminalId: string; url: string }[] = []
  const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/sessions') return jsonResponse([SESSION])
    if (url.startsWith('/sessions/cao-first-turn')) {
      return jsonResponse({ session: SESSION, terminals: [SUPERVISOR] })
    }
    if (url === '/terminals/aaaaaaaa') {
      return jsonResponse({ ...SUPERVISOR, name: 'sol', session_name: 'cao-first-turn', caller_id: null, status: 'idle', last_output_at: null })
    }
    if (url.startsWith('/terminals/aaaaaaaa/input') && opts?.method === 'POST') {
      sentInputs.push({ terminalId: 'aaaaaaaa', url })
      return jsonResponse({ success: true })
    }
    if (url.startsWith('/terminals/aaaaaaaa/output')) return jsonResponse({ output: '', mode: 'last' })
    if (url.includes('/working-directory')) return jsonResponse({ working_directory: '~/work/x' })
    if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return sentInputs
}

/** Mirrors AppShell, plus the pending-first-turn handoff the New Task modal performs. */
function TestWorkspace({
  firstTurn,
}: {
  firstTurn?: { sessionId: string; prompt: string } | null
}) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(firstTurn?.sessionId ?? null)
  const [events] = useState<UiEvent[]>([])
  const [status] = useState<UiConnectionStatus>('connected')
  return (
    <Workspace
      events={events}
      status={status}
      selectedSessionId={selectedSessionId}
      setSelectedSessionId={setSelectedSessionId}
      pendingFirstTurn={firstTurn ?? null}
      onFirstTurnConsumed={() => {}}
    />
  )
}

// Reset ambient state on BOTH sides. Vitest isolates modules per file, but
// localStorage written by an earlier file was still visible here — a leaked
// `cao:*` entry changed how Workspace booted and the initial prompt was never
// delivered, which surfaced only under --no-file-parallelism (and on CI, whose
// core count schedules files differently). Clearing before the test as well as
// after makes this file independent of whatever ran first.
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('first turn of a brand-new session', () => {
  it('sends the initial prompt through the workspace so the turn is tracked', async () => {
    const sent = installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true, terminalStatuses: {} })

    render(<TestWorkspace firstTurn={{ sessionId: 'cao-first-turn', prompt: 'HANDOFF 읽고 다음 할 일 알려줘' }} />)

    await waitFor(() => expect(sent.length).toBe(1), { timeout: 10_000 })
    expect(decodeURIComponent(sent[0].url)).toContain('HANDOFF 읽고 다음 할 일 알려줘')
  }, 20_000)

  it('shows the user prompt and a pending state instead of an empty thread', async () => {
    installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true, terminalStatuses: {} })

    render(<TestWorkspace firstTurn={{ sessionId: 'cao-first-turn', prompt: 'HANDOFF 읽고 다음 할 일 알려줘' }} />)

    expect(await screen.findByText('HANDOFF 읽고 다음 할 일 알려줘', {}, { timeout: 10_000 })).toBeInTheDocument()
    // Pending state: either the live progress card or the waiting placeholder —
    // both mean "this turn is in flight", which is what was missing entirely.
    await waitFor(() => {
      const pending =
        screen.queryByTestId('progress-card') ?? screen.queryByText(/기다리는 중/)
      expect(pending).not.toBeNull()
    }, { timeout: 10_000 })
  }, 20_000)

  it('sends the initial prompt exactly once even as the session keeps polling', async () => {
    const sent = installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true, terminalStatuses: {} })

    render(<TestWorkspace firstTurn={{ sessionId: 'cao-first-turn', prompt: '한 번만' }} />)

    await waitFor(() => expect(sent.length).toBe(1), { timeout: 10_000 })
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(sent.length).toBe(1)
  }, 20_000)

  it('sends nothing when there is no pending first turn', async () => {
    const sent = installMockFetch()
    useStore.setState({ sessions: [SESSION], connected: true, terminalStatuses: {} })

    render(<TestWorkspace firstTurn={null} />)

    await new Promise(resolve => setTimeout(resolve, 400))
    expect(sent.length).toBe(0)
  })
})
