// SSE client for `/ui/events`, with history backfill on (re)connect.
//
// Availability defense (spec §backend contract): a 404/connection failure is
// never hidden — `onStatusChange('disconnected')` fires and stays honest.
// Reconnects use exponential backoff (1s → 30s cap). Every reconnect (including
// the first connect) backfills via `/ui/events/history?since_id=` so no event
// is silently lost across a drop, up to the ring buffer's retention.
import { apiUi } from '../../api.ui'
import { SSE_BACKOFF_INITIAL_MS, SSE_BACKOFF_MAX_MS } from './constants'
import type { UiEvent } from './types'

export type UiConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface UiEventStreamHandlers {
  onEvent: (event: UiEvent) => void
  onStatusChange: (status: UiConnectionStatus) => void
}

/** Minimal structural subset of the DOM `EventSource` this client depends on — kept narrow so tests can pass a plain mock class. */
export interface EventSourceLike {
  onopen: (() => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onerror: (() => void) | null
  close: () => void
}

export type EventSourceCtor = new (url: string) => EventSourceLike

export interface UiEventStreamHandle {
  close: () => void
}

function resolveEventSourceCtor(): EventSourceCtor | undefined {
  const g = globalThis as unknown as { EventSource?: EventSourceCtor }
  return g.EventSource
}

export function subscribeUiEvents(handlers: UiEventStreamHandlers, EventSourceImpl?: EventSourceCtor): UiEventStreamHandle {
  const Impl = EventSourceImpl ?? resolveEventSourceCtor()
  let closed = false
  let es: EventSourceLike | null = null
  let backoff = SSE_BACKOFF_INITIAL_MS
  let lastId: number | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const backfill = () => {
    apiUi
      .getUiEventsHistory(lastId !== undefined ? { sinceId: lastId } : {})
      .then(events => {
        events.forEach(event => {
          if (typeof event.id === 'number') lastId = lastId === undefined ? event.id : Math.max(lastId, event.id)
          handlers.onEvent(event)
        })
      })
      .catch(() => {
        // History endpoint unavailable — live events (if any arrive) still flow through onmessage.
      })
  }

  const connect = () => {
    if (closed) return
    if (!Impl) {
      handlers.onStatusChange('disconnected')
      return
    }
    handlers.onStatusChange('connecting')
    const source = new Impl(apiUi.uiEventsStreamUrl)
    es = source
    source.onopen = () => {
      backoff = SSE_BACKOFF_INITIAL_MS
      handlers.onStatusChange('connected')
      backfill()
    }
    source.onmessage = ev => {
      try {
        const parsed = JSON.parse(ev.data) as UiEvent
        if (typeof parsed?.id === 'number') lastId = lastId === undefined ? parsed.id : Math.max(lastId, parsed.id)
        handlers.onEvent(parsed)
      } catch {
        // Malformed frame — never let one bad message take down the stream.
      }
    }
    source.onerror = () => {
      handlers.onStatusChange('disconnected')
      source.close()
      if (es === source) es = null
      if (closed) return
      retryTimer = setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, SSE_BACKOFF_MAX_MS)
    }
  }

  connect()

  return {
    close: () => {
      closed = true
      if (retryTimer) clearTimeout(retryTimer)
      es?.close()
      es = null
    },
  }
}
