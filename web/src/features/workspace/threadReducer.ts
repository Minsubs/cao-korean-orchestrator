// Pure event → UI mapping for the Orchestration Thread (spec §3, unit-tested
// in test/workspace-reducer.test.ts). Two data sources feed the same card:
//
//   - REST (session terminals list): authoritative for identity/location —
//     always available, even when the event stream is down entirely.
//   - `/ui/events` (SSE + history): enriches with instruction summaries,
//     inner-agent messages and system lines that REST alone cannot provide.
//
// Card position in the thread is fixed at first appearance and never moves;
// later signals only mutate the existing card object ("카드 추가 금지" for
// status_changed/activity — no matching card means the event is dropped).
import type { TerminalMeta } from '../../api'
import type {
  ChatEntry,
  DelegationCard,
  InnerMessage,
  MessageSentDetail,
  SessionCreatedDetail,
  SessionKilledDetail,
  StatusChangedDetail,
  TerminalCreatedDetail,
  TerminalKilledDetail,
  ThreadItem,
  UiEvent,
} from './types'

/**
 * Keep all events belonging to one session, including status/activity signals
 * for short-lived handoff terminals that may be created and deleted between
 * two REST terminal-list polls.
 */
export function filterUiEventsForSession(
  events: UiEvent[],
  sessionIds: Set<string>,
  knownTerminalIds: Set<string>,
): UiEvent[] {
  const sessionTerminalIds = new Set(knownTerminalIds)
  for (const event of events) {
    const detail = event.detail as Record<string, unknown>
    if (event.type !== 'terminal_created') continue
    if (typeof detail.session_id !== 'string' || !sessionIds.has(detail.session_id)) continue
    if (typeof detail.terminal_id === 'string') sessionTerminalIds.add(detail.terminal_id)
  }

  return events.filter(event => {
    const detail = event.detail as Record<string, unknown>
    const sessionId = typeof detail.session_id === 'string' ? detail.session_id : null
    if (sessionId) return sessionIds.has(sessionId)
    const terminalId = typeof detail.terminal_id === 'string' ? detail.terminal_id : null
    if (terminalId) return sessionTerminalIds.has(terminalId)
    const sender = typeof detail.sender === 'string' ? detail.sender : null
    const receiver = typeof detail.receiver === 'string' ? detail.receiver : null
    return Boolean((sender && sessionTerminalIds.has(sender)) || (receiver && sessionTerminalIds.has(receiver)))
  })
}

function parseTs(iso: string): number {
  const value = Date.parse(iso)
  return Number.isNaN(value) ? Date.now() : value
}

export function buildCardFromTerminalCreated(detail: TerminalCreatedDetail, ts: number): DelegationCard {
  return {
    terminalId: detail.terminal_id,
    sessionId: detail.session_id ?? null,
    agentName: detail.agent_name ?? null,
    provider: detail.provider ?? null,
    callerId: null,
    callerAgentName: null,
    status: null,
    prevStatus: null,
    location: null,
    locationLoaded: false,
    instruction: null,
    instructionType: null,
    instructionFromId: null,
    killed: false,
    lastActivityAt: null,
    lastOutputAt: null,
    firstSeenAt: ts,
    hasSignal: true,
  }
}

/** Seed a card straight from the existing session-detail REST terminal list — the no-events fallback. */
export function seedCardFromTerminalMeta(
  terminal: TerminalMeta,
  extra?: { callerId?: string | null; lastOutputAt?: string | null; location?: string | null },
): DelegationCard {
  return {
    terminalId: terminal.id,
    sessionId: null,
    agentName: terminal.agent_profile ?? null,
    provider: terminal.provider ?? null,
    callerId: extra?.callerId ?? null,
    callerAgentName: null,
    status: null,
    prevStatus: null,
    location: extra?.location ?? null,
    locationLoaded: extra?.location !== undefined,
    instruction: null,
    instructionType: null,
    instructionFromId: null,
    killed: false,
    lastActivityAt: extra?.lastOutputAt ? parseTs(extra.lastOutputAt) : null,
    lastOutputAt: extra?.lastOutputAt ?? null,
    firstSeenAt: terminal.created_at ? parseTs(terminal.created_at) : Date.now(),
    hasSignal: true,
  }
}

/** REST is authoritative for identity/location; event-derived fields on `existing` (instruction, status, killed…) are preserved. */
export function mergeSeededCard(existing: DelegationCard | undefined, seeded: DelegationCard): DelegationCard {
  if (!existing) return seeded
  return {
    ...existing,
    agentName: seeded.agentName ?? existing.agentName,
    provider: seeded.provider ?? existing.provider,
    sessionId: seeded.sessionId ?? existing.sessionId,
    callerId: existing.callerId ?? seeded.callerId,
    location: seeded.location ?? existing.location,
    locationLoaded: existing.locationLoaded || seeded.locationLoaded,
    lastOutputAt: seeded.lastOutputAt ?? existing.lastOutputAt,
    lastActivityAt: Math.max(existing.lastActivityAt ?? 0, seeded.lastActivityAt ?? 0) || existing.lastActivityAt,
    firstSeenAt: Math.min(existing.firstSeenAt, seeded.firstSeenAt),
    hasSignal: true,
  }
}

/** Apply exactly one `/ui/events` event to the card map. Pure — same input always yields the same output. */
export function applyUiEventToCards(cards: Record<string, DelegationCard>, event: UiEvent): Record<string, DelegationCard> {
  const ts = parseTs(event.ts)

  switch (event.type) {
    case 'terminal_created': {
      const detail = event.detail as unknown as TerminalCreatedDetail
      if (!detail?.terminal_id) return cards
      const existing = cards[detail.terminal_id]
      const next = existing
        ? {
            ...existing,
            agentName: existing.agentName ?? detail.agent_name ?? null,
            provider: existing.provider ?? detail.provider ?? null,
            sessionId: existing.sessionId ?? detail.session_id ?? null,
            firstSeenAt: Math.min(existing.firstSeenAt, ts),
            hasSignal: true,
          }
        : buildCardFromTerminalCreated(detail, ts)
      return { ...cards, [detail.terminal_id]: next }
    }

    case 'status_changed': {
      const detail = event.detail as unknown as StatusChangedDetail
      const existing = detail?.terminal_id ? cards[detail.terminal_id] : undefined
      if (!existing) return cards // "카드 추가 금지" — status alone never creates a card
      return {
        ...cards,
        [detail.terminal_id]: {
          ...existing,
          status: detail.status ?? existing.status,
          prevStatus: detail.prev ?? existing.prevStatus,
          hasSignal: true,
        },
      }
    }

    case 'terminal_killed': {
      const detail = event.detail as unknown as TerminalKilledDetail
      const existing = detail?.terminal_id ? cards[detail.terminal_id] : undefined
      if (!existing) return cards
      const endedStatus = existing.status === 'error' ? 'error' : 'completed'
      return {
        ...cards,
        [detail.terminal_id]: {
          ...existing,
          status: endedStatus,
          prevStatus: existing.status ?? existing.prevStatus,
          killed: true,
        },
      }
    }

    case 'message_sent': {
      const detail = event.detail as unknown as MessageSentDetail
      if (detail?.orchestration_type !== 'assign' && detail?.orchestration_type !== 'handoff') return cards
      const existing = detail?.receiver ? cards[detail.receiver] : undefined
      if (!existing) return cards
      return {
        ...cards,
        [detail.receiver]: {
          ...existing,
          instruction: detail.message ?? existing.instruction,
          instructionType: detail.orchestration_type,
          instructionFromId: detail.sender ?? existing.instructionFromId,
          callerId: existing.callerId ?? detail.sender ?? null,
          hasSignal: true,
        },
      }
    }

    case 'activity': {
      const detail = event.detail as unknown as { terminal_id?: string }
      const existing = detail?.terminal_id ? cards[detail.terminal_id] : undefined
      if (!existing) return cards
      return {
        ...cards,
        [detail.terminal_id as string]: { ...existing, lastActivityAt: Math.max(existing.lastActivityAt ?? 0, ts) },
      }
    }

    default:
      return cards
  }
}

export function applyUiEvents(cards: Record<string, DelegationCard>, events: UiEvent[]): Record<string, DelegationCard> {
  // Lifecycle plugin dispatch is asynchronous: initialization status signals
  // can reach the ring just before post_create_terminal. Pre-seed identities
  // from every create event, then replay chronologically so those early status
  // updates are not dropped as "unknown terminal" signals.
  const seeded = events
    .filter(event => event.type === 'terminal_created')
    .reduce(applyUiEventToCards, cards)
  return events.reduce(applyUiEventToCards, seeded)
}

/** Resolve each card's caller/parent display name once the caller's own card (or itself) is known. */
export function withCallerNames(cards: Record<string, DelegationCard>): Record<string, DelegationCard> {
  const next: Record<string, DelegationCard> = {}
  for (const [id, card] of Object.entries(cards)) {
    const caller = card.callerId ? cards[card.callerId] : undefined
    next[id] = { ...card, callerAgentName: caller?.agentName ?? card.callerAgentName }
  }
  return next
}

// ── Thread item assembly (cards + events + local chat → one ordered list) ──

interface Positionable {
  ts: number
  sortKey: number
  render:
    | { kind: 'chat'; entry: ChatEntry }
    | { kind: 'system'; id: string; text: string }
    | { kind: 'card-first'; card: DelegationCard }
    | { kind: 'inner'; message: InnerMessage }
}

/**
 * How many results each agent has reported back (worker -> caller send_message).
 *
 * These used to be rendered in the thread as `inner-group` blocks. They are not
 * any more — the thread is the conversation with the orchestrator, and one line
 * per worker per turn buried it — so the fact still has to reach the work queue,
 * where "did this agent actually report back" is the question being asked.
 */
export function buildAgentReportCounts(events: UiEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  events.forEach(event => {
    if (event.type !== 'message_sent') return
    const detail = event.detail as unknown as MessageSentDetail
    if (detail.orchestration_type !== 'send_message') return
    const sender = detail.sender
    if (!sender) return
    counts[sender] = (counts[sender] ?? 0) + 1
  })
  return counts
}

/**
 * The thread is the conversation: the user's prompts, the orchestrator's
 * answers, and session-level notices.
 *
 * Delegation cards and agent-to-agent messages are deliberately absent. With a
 * team of three every turn added a card plus a report line per worker, and the
 * orchestrator's actual answer — the thing being read — got pushed off screen.
 * That state belongs where it can be scanned instead of scrolled: the work
 * queue in the agent panel, which renders the same DelegationCard data plus
 * buildAgentReportCounts above.
 */
export function buildThreadItems(params: {
  events: UiEvent[]
  chat: ChatEntry[]
  cards: Record<string, DelegationCard>
}): ThreadItem[] {
  const { events, chat } = params
  const items: Positionable[] = []

  chat.forEach((entry, index) => items.push({ ts: entry.ts, sortKey: index, render: { kind: 'chat', entry } }))

  events.forEach(event => {
    const ts = parseTs(event.ts)
    if (event.type === 'session_created') {
      const d = event.detail as unknown as SessionCreatedDetail
      items.push({ ts, sortKey: event.id, render: { kind: 'system', id: `sys-${event.id}`, text: `세션 ${d.session_name}을(를) 시작했어요` } })
    } else if (event.type === 'session_killed') {
      const d = event.detail as unknown as SessionKilledDetail
      items.push({ ts, sortKey: event.id, render: { kind: 'system', id: `sys-${event.id}`, text: `세션 ${d.session_name}을(를) 종료했어요` } })
    }
  })

  items.sort((a, b) => (a.ts - b.ts) || (a.sortKey - b.sortKey))

  const result: ThreadItem[] = []
  for (const item of items) {
    if (item.render.kind === 'chat') {
      result.push({ kind: 'chat', id: item.render.entry.id, ts: item.ts, entry: item.render.entry })
    } else if (item.render.kind === 'system') {
      result.push({ kind: 'system', id: item.render.id, ts: item.ts, text: item.render.text })
    }
  }

  return result
}
