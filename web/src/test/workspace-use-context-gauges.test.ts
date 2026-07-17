import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useContextGauges } from '../features/workspace/useContextGauges'

// Phase 2d (spec §2d) hook-level wiring: fetch -> gauge map, the
// claude_code-only provider gate, and the "processing -> idle" immediate
// re-poll. The color/debounce *rules themselves* are covered purely in
// workspace-context-gauge.test.ts; this file only checks that the hook
// actually calls them at the right time.

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

describe('useContextGauges (spec §2d)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('polls only claude_code terminals and reports their percent_left; a non-claude_code terminal never appears in the map', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url === '/ui/terminals/aaaaaaaa/context') {
        return jsonResponse({ terminal_id: 'aaaaaaaa', percent_left: 60, source: 'footer', checked_at: '2026-07-17T00:00:00Z' })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', mockFetch)

    const { result } = renderHook(() =>
      useContextGauges(
        [
          { id: 'aaaaaaaa', provider: 'claude_code', label: 'sol' },
          { id: 'bbbbbbbb', provider: 'codex', label: 'nova' },
        ],
        {},
        'sess-1',
      ),
    )

    await waitFor(() => expect(result.current.aaaaaaaa).toBe(60))
    expect(mockFetch.mock.calls.some(([u]) => (u as string).includes('bbbbbbbb'))).toBe(false)
    expect(result.current.bbbbbbbb).toBeUndefined()
  })

  it('a fetch failure (404/network) never crashes the poll loop and leaves no entry for that terminal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found', json: () => Promise.resolve({ detail: 'terminal not found' }) })),
    )

    const { result } = renderHook(() => useContextGauges([{ id: 'cccccccc', provider: 'claude_code', label: null }], {}, 'sess-1'))

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(result.current.cccccccc).toBeUndefined()
  })

  it('re-polls immediately (an extra call beyond the initial one) the instant a terminal flips from PROCESSING to IDLE', async () => {
    const mockFetch = vi.fn(async (_url: string) => jsonResponse({ terminal_id: 'aaaaaaaa', percent_left: 70, source: 'footer', checked_at: 'x' }))
    vi.stubGlobal('fetch', mockFetch)

    const terminals = [{ id: 'aaaaaaaa', provider: 'claude_code', label: 'sol' }]
    const { rerender } = renderHook(({ statuses }) => useContextGauges(terminals, statuses, 'sess-1'), {
      initialProps: { statuses: { aaaaaaaa: 'PROCESSING' } },
    })

    await waitFor(() => expect(mockFetch.mock.calls.filter(([u]) => u === '/ui/terminals/aaaaaaaa/context')).toHaveLength(1))

    rerender({ statuses: { aaaaaaaa: 'IDLE' } })

    await waitFor(() => expect(mockFetch.mock.calls.filter(([u]) => u === '/ui/terminals/aaaaaaaa/context')).toHaveLength(2))
  })

  it('does not re-poll for a status change that is not a processing -> idle transition', async () => {
    const mockFetch = vi.fn(async (_url: string) => jsonResponse({ terminal_id: 'aaaaaaaa', percent_left: 70, source: 'footer', checked_at: 'x' }))
    vi.stubGlobal('fetch', mockFetch)

    const terminals = [{ id: 'aaaaaaaa', provider: 'claude_code', label: 'sol' }]
    const { rerender } = renderHook(({ statuses }) => useContextGauges(terminals, statuses, 'sess-1'), {
      initialProps: { statuses: { aaaaaaaa: 'IDLE' } },
    })

    await waitFor(() => expect(mockFetch.mock.calls.filter(([u]) => u === '/ui/terminals/aaaaaaaa/context')).toHaveLength(1))

    rerender({ statuses: { aaaaaaaa: 'WAITING_USER_ANSWER' } })

    // Give any (incorrect) extra poll a chance to fire before asserting it didn't.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(mockFetch.mock.calls.filter(([u]) => u === '/ui/terminals/aaaaaaaa/context')).toHaveLength(1)
  })
})
