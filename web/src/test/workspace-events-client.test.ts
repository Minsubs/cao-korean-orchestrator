import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeUiEvents, type EventSourceCtor, type EventSourceLike } from '../features/workspace/eventsClient'
import { SSE_BACKOFF_INITIAL_MS } from '../features/workspace/constants'

class MockEventSource implements EventSourceLike {
  static instances: MockEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(public url: string) {
    MockEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }
}

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) } as Response)
}

describe('subscribeUiEvents (SSE client — spec §backend contract availability defense)', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    // Server wraps history as `{"events": [...]}` (api/main.py `ui_events_history`).
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ events: [] })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reports disconnected immediately, with no instance created, when EventSource is unavailable', () => {
    const onStatusChange = vi.fn()
    subscribeUiEvents({ onEvent: vi.fn(), onStatusChange }, undefined)
    expect(onStatusChange).toHaveBeenCalledWith('disconnected')
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('connects, reports connected on open, and backfills history', async () => {
    const events = [{ id: 1, ts: '2026-07-17T00:00:00Z', type: 'session_created', detail: { session_name: 's', session_id: 's' } }]
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ events })))
    const onStatusChange = vi.fn()
    const onEvent = vi.fn()

    subscribeUiEvents({ onEvent, onStatusChange }, MockEventSource as unknown as EventSourceCtor)
    expect(onStatusChange).toHaveBeenCalledWith('connecting')
    expect(MockEventSource.instances).toHaveLength(1)

    MockEventSource.instances[0].onopen?.()
    expect(onStatusChange).toHaveBeenCalledWith('connected')

    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(events[0]))
  })

  it('delivers a live message and ignores a malformed frame without throwing', () => {
    const onEvent = vi.fn()
    subscribeUiEvents({ onEvent, onStatusChange: vi.fn() }, MockEventSource as unknown as EventSourceCtor)
    const instance = MockEventSource.instances[0]

    expect(() => instance.onmessage?.({ data: 'not json' })).not.toThrow()
    expect(onEvent).not.toHaveBeenCalled()

    const event = { id: 2, ts: '2026-07-17T00:00:01Z', type: 'activity', detail: { terminal_id: 'aaaaaaaa' } }
    instance.onmessage?.({ data: JSON.stringify(event) })
    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it('reconnects on error with exponential backoff (1s → 2s → ...) and stays honestly disconnected in between', () => {
    vi.useFakeTimers()
    const onStatusChange = vi.fn()
    subscribeUiEvents({ onEvent: vi.fn(), onStatusChange }, MockEventSource as unknown as EventSourceCtor)

    const first = MockEventSource.instances[0]
    first.onerror?.()
    expect(onStatusChange).toHaveBeenCalledWith('disconnected')
    expect(first.closed).toBe(true)
    expect(MockEventSource.instances).toHaveLength(1) // no immediate reconnect

    vi.advanceTimersByTime(SSE_BACKOFF_INITIAL_MS)
    expect(MockEventSource.instances).toHaveLength(2)

    MockEventSource.instances[1].onerror?.()
    vi.advanceTimersByTime(SSE_BACKOFF_INITIAL_MS) // not enough — backoff doubled to 2s
    expect(MockEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(SSE_BACKOFF_INITIAL_MS)
    expect(MockEventSource.instances).toHaveLength(3)
  })

  it('close() stops all future reconnect attempts', () => {
    vi.useFakeTimers()
    const handle = subscribeUiEvents({ onEvent: vi.fn(), onStatusChange: vi.fn() }, MockEventSource as unknown as EventSourceCtor)
    const first = MockEventSource.instances[0]

    handle.close()
    expect(first.closed).toBe(true)

    vi.advanceTimersByTime(60000)
    expect(MockEventSource.instances).toHaveLength(1)
  })
})
