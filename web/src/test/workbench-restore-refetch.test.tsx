import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Workspace } from '../features/workspace/Workspace'
import type { UiConnectionStatus } from '../features/workspace/eventsClient'
import type { UiEvent } from '../features/workspace/types'
import { useStore } from '../store'

// The Workbench restore effect deliberately refuses to mark restoration
// complete until a terminal belonging to the selected session is in hand
// (HANDOFF §0.10 — otherwise an empty or stale list gets recorded as
// "restored" and the dock never recovers). The gap that leaves: when `loading`
// has already flipped false and the list is still empty, the effect just
// returns, so the next chance is the periodic session poll — SESSION_POLL_MS,
// 4s. The dock sits blank for that whole window.
//
// These tests pin the recovery: the effect asks for the list again immediately
// instead of waiting for the tick, and it asks at most once per session switch
// so a session that genuinely has no terminals does not spin.

const SESSION = { id: 'sess-1', name: 'restore-refetch', status: 'active' }
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

/**
 * Session detail reports no terminals for the first `emptyResponses` calls,
 * then reports the supervisor — the exact shape of the race, without relying
 * on timing.
 */
function installMockFetch(emptyResponses: number) {
  let detailCalls = 0
  const mockFetch = vi.fn(async (url: string) => {
    if (url === '/sessions') return jsonResponse([SESSION])
    if (url.startsWith('/sessions/sess-1')) {
      detailCalls += 1
      const terminals = detailCalls <= emptyResponses ? [] : [SUPERVISOR]
      return jsonResponse({ session: SESSION, terminals })
    }
    if (url === '/terminals/aaaaaaaa') {
      return jsonResponse({ ...SUPERVISOR, name: 'win', session_name: 'sess-1', caller_id: null, status: 'idle', last_output_at: null })
    }
    if (url.startsWith('/terminals/aaaaaaaa/working-directory')) return jsonResponse({ working_directory: '~/work/restore' })
    if (url.startsWith('/terminals/aaaaaaaa/output')) return jsonResponse({ output: '', mode: 'last' })
    if (url.startsWith('/ui/events/history')) return jsonResponse({ events: [] })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return { mockFetch, detailCalls: () => detailCalls }
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

function contextShowsSupervisor(): boolean {
  return !!screen.queryByText((_, el) => (
    el?.tagName === 'SPAN'
    && el.textContent?.includes('컨텍스트:') === true
    && el.textContent?.includes('aaaaaaaa') === true
  ))
}

describe('Workbench restore recovers without waiting for the session poll', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useStore.setState({ sessions: [], activeSession: null, activeSessionDetail: null, connected: false, terminalStatuses: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('re-fetches immediately when the list arrives empty, so the dock fills in without a 4s wait', async () => {
    const { detailCalls } = installMockFetch(1)
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)

    // Well under SESSION_POLL_MS: only an immediate re-fetch can satisfy this.
    await waitFor(() => expect(contextShowsSupervisor()).toBe(true), { timeout: 1500 })
    expect(detailCalls()).toBeGreaterThanOrEqual(2)
  })

  it('asks for the list at most once per session switch when the session really has no terminals', async () => {
    const { detailCalls } = installMockFetch(Number.POSITIVE_INFINITY)
    useStore.setState({ sessions: [SESSION], connected: true })
    render(<TestWorkspace />)

    await waitFor(() => expect(detailCalls()).toBeGreaterThanOrEqual(2), { timeout: 1500 })
    const settled = detailCalls()
    // No terminal ever arrives; the effect must not keep re-requesting on every
    // resulting state change. Anything unbounded shows up as growth here.
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(detailCalls()).toBe(settled)
    expect(contextShowsSupervisor()).toBe(false)
  })
})
