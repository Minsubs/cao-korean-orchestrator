import { useEffect, useRef, useState } from 'react'
import { subscribeUiEvents, type UiConnectionStatus } from './eventsClient'
import type { UiEvent } from './types'

const EVENT_RING_LIMIT = 1000

/**
 * One `/ui/events` SSE connection for the whole Workspace (not per-session —
 * the stream is global; each session's Thread filters this shared ring by
 * membership). Mount once near the Workspace root.
 */
export function useUiEventStream(): { events: UiEvent[]; status: UiConnectionStatus } {
  const [events, setEvents] = useState<UiEvent[]>([])
  const [status, setStatus] = useState<UiConnectionStatus>('connecting')
  const seenIds = useRef<Set<number>>(new Set())

  useEffect(() => {
    const handle = subscribeUiEvents({
      onStatusChange: setStatus,
      onEvent: event => {
        if (seenIds.current.has(event.id)) return
        seenIds.current.add(event.id)
        setEvents(current => {
          const next = [...current, event].sort((a, b) => a.id - b.id)
          if (next.length > EVENT_RING_LIMIT) {
            const dropped = next.splice(0, next.length - EVENT_RING_LIMIT)
            dropped.forEach(d => seenIds.current.delete(d.id))
          }
          return next
        })
      },
    })
    return () => handle.close()
  }, [])

  return { events, status }
}
