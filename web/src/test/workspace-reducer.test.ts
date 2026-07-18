import { describe, expect, it } from 'vitest'
import {
  applyUiEventToCards,
  applyUiEvents,
  buildCardFromTerminalCreated,
  buildThreadItems,
  filterUiEventsForSession,
  mergeSeededCard,
  seedCardFromTerminalMeta,
  withCallerNames,
} from '../features/workspace/threadReducer'
import type { DelegationCard, UiEvent } from '../features/workspace/types'
import type { TerminalMeta } from '../api'

function ev(id: number, type: UiEvent['type'], detail: Record<string, unknown>, ts = `2026-07-17T00:00:${String(id).padStart(2, '0')}Z`): UiEvent {
  return { id, ts, type, detail }
}

describe('threadReducer: event → card mapping (spec §3)', () => {
  it('keeps status and teardown events for an ephemeral handoff worker absent from REST polling', () => {
    const events: UiEvent[] = [
      ev(1, 'status_changed', { terminal_id: 'worker01', status: 'processing', prev: 'idle' }),
      ev(2, 'terminal_created', { terminal_id: 'worker01', agent_name: 'codex_qa_terra', provider: 'codex', session_id: 'sess-1' }),
      ev(3, 'message_sent', { sender: 'super001', receiver: 'worker01', message: '연결 테스트', orchestration_type: 'handoff', session_id: 'sess-1' }),
      ev(4, 'status_changed', { terminal_id: 'worker01', status: 'completed', prev: 'processing' }),
      ev(5, 'status_changed', { terminal_id: 'worker01', status: 'processing', prev: 'completed' }),
      ev(6, 'terminal_killed', { terminal_id: 'worker01', agent_name: 'codex_qa_terra', provider: 'codex', session_id: 'sess-1' }),
      ev(7, 'status_changed', { terminal_id: 'other001', status: 'processing', prev: 'idle' }),
    ]

    const filtered = filterUiEventsForSession(events, new Set(['sess-1']), new Set(['super001']))
    const cards = applyUiEvents({}, filtered)

    expect(filtered.map(event => event.id)).toEqual([1, 2, 3, 4, 5, 6])
    expect(cards.worker01).toMatchObject({
      agentName: 'codex_qa_terra',
      instruction: '연결 테스트',
      status: 'completed',
      killed: true,
    })
  })

  it('terminal_created creates exactly one new card with agent/provider/session identity', () => {
    const cards = applyUiEventToCards({}, ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    expect(Object.keys(cards)).toEqual(['aaaaaaaa'])
    expect(cards.aaaaaaaa).toMatchObject({ terminalId: 'aaaaaaaa', agentName: 'sonnet', provider: 'claude_code', sessionId: 's1', hasSignal: true })
  })

  it('terminal_created is a no-op re-affirmation when the card already exists (does not clobber known fields)', () => {
    const created = applyUiEventToCards({}, ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    const withInstruction = applyUiEventToCards(
      created,
      ev(2, 'message_sent', { sender: 'zzzzzzzz', receiver: 'aaaaaaaa', message: 'fix it', orchestration_type: 'assign', session_id: 's1' }),
    )
    const again = applyUiEventToCards(withInstruction, ev(3, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    expect(again.aaaaaaaa.instruction).toBe('fix it')
  })

  it('status_changed updates the existing card\'s status/prev in place — never adds a card ("카드 추가 금지")', () => {
    const created = applyUiEventToCards({}, ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    const updated = applyUiEventToCards(created, ev(2, 'status_changed', { terminal_id: 'aaaaaaaa', status: 'processing', prev: 'idle' }))
    expect(Object.keys(updated)).toEqual(['aaaaaaaa'])
    expect(updated.aaaaaaaa).toMatchObject({ status: 'processing', prevStatus: 'idle' })
  })

  it('status_changed for an unknown terminal is dropped entirely (no card created)', () => {
    const cards = applyUiEventToCards({}, ev(1, 'status_changed', { terminal_id: 'unknown1', status: 'processing', prev: 'idle' }))
    expect(cards).toEqual({})
  })

  it('activity for an unknown terminal is dropped (same "no card, no update" rule)', () => {
    const cards = applyUiEventToCards({}, ev(1, 'activity', { terminal_id: 'unknown1' }))
    expect(cards).toEqual({})
  })

  it('terminal_killed flags the existing card as killed without removing it', () => {
    const created = applyUiEventToCards({}, ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    const killed = applyUiEventToCards(created, ev(2, 'terminal_killed', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    expect(killed.aaaaaaaa.killed).toBe(true)
  })

  it('message_sent(assign) attaches the instruction summary to the receiver\'s card only', () => {
    const created = applyUiEventToCards({}, ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    const withAssign = applyUiEventToCards(
      created,
      ev(2, 'message_sent', { sender: 'zzzzzzzz', receiver: 'aaaaaaaa', message: 'implement the fix', orchestration_type: 'assign', session_id: 's1' }),
    )
    expect(withAssign.aaaaaaaa).toMatchObject({ instruction: 'implement the fix', instructionType: 'assign', instructionFromId: 'zzzzzzzz', callerId: 'zzzzzzzz' })
  })

  it('message_sent(handoff) also attaches to the card (both delegate types per spec)', () => {
    const created = applyUiEventToCards({}, ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    const withHandoff = applyUiEventToCards(
      created,
      ev(2, 'message_sent', { sender: 'zzzzzzzz', receiver: 'aaaaaaaa', message: 'take over', orchestration_type: 'handoff', session_id: 's1' }),
    )
    expect(withHandoff.aaaaaaaa.instructionType).toBe('handoff')
  })

  it('message_sent(send_message) never touches any card — it only ever becomes an inner-message group', () => {
    const created = applyUiEventToCards({}, ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }))
    const afterSendMessage = applyUiEventToCards(
      created,
      ev(2, 'message_sent', { sender: 'zzzzzzzz', receiver: 'aaaaaaaa', message: 'fyi', orchestration_type: 'send_message', session_id: 's1' }),
    )
    expect(afterSendMessage.aaaaaaaa.instruction).toBeNull()
  })

  it('activity updates lastActivityAt to the event timestamp for a known card', () => {
    const created = applyUiEventToCards({}, ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }, '2026-07-17T00:00:00Z'))
    const withActivity = applyUiEventToCards(created, ev(2, 'activity', { terminal_id: 'aaaaaaaa' }, '2026-07-17T00:05:00Z'))
    expect(withActivity.aaaaaaaa.lastActivityAt).toBe(Date.parse('2026-07-17T00:05:00Z'))
  })

  it('applyUiEvents folds a whole sequence deterministically', () => {
    const events: UiEvent[] = [
      ev(1, 'terminal_created', { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }),
      ev(2, 'message_sent', { sender: 'zzzzzzzz', receiver: 'aaaaaaaa', message: 'go', orchestration_type: 'assign', session_id: 's1' }),
      ev(3, 'status_changed', { terminal_id: 'aaaaaaaa', status: 'processing', prev: 'idle' }),
      ev(4, 'status_changed', { terminal_id: 'aaaaaaaa', status: 'error', prev: 'processing' }),
    ]
    const cards = applyUiEvents({}, events)
    expect(cards.aaaaaaaa).toMatchObject({ status: 'error', prevStatus: 'processing', instruction: 'go' })
  })
})

describe('threadReducer: REST seed ↔ event merge', () => {
  const terminal: TerminalMeta = {
    id: 'bbbbbbbb',
    tmux_session: 'sess',
    tmux_window: '1',
    provider: 'codex',
    agent_profile: 'terra',
    created_at: '2026-07-17T00:00:00Z',
    last_active: null,
  }

  it('seedCardFromTerminalMeta carries REST identity/location/caller_id', () => {
    const seeded = seedCardFromTerminalMeta(terminal, { callerId: 'zzzzzzzz', lastOutputAt: '2026-07-17T00:02:00Z', location: 'web' })
    expect(seeded).toMatchObject({ terminalId: 'bbbbbbbb', agentName: 'terra', provider: 'codex', callerId: 'zzzzzzzz', location: 'web' })
  })

  it('mergeSeededCard keeps event-derived fields (status/instruction/killed) while REST wins on identity', () => {
    const eventCard: DelegationCard = {
      ...buildCardFromTerminalCreated({ terminal_id: 'bbbbbbbb', agent_name: null, provider: 'unknown', session_id: 's1' }, 500),
      status: 'processing',
      instruction: 'investigate',
      killed: false,
    }
    const seeded = seedCardFromTerminalMeta(terminal)
    const merged = mergeSeededCard(eventCard, seeded)
    expect(merged.status).toBe('processing') // event-derived, preserved
    expect(merged.instruction).toBe('investigate') // event-derived, preserved
    expect(merged.agentName).toBe('terra') // REST wins for identity
    expect(merged.provider).toBe('codex') // REST wins for identity
  })

  it('mergeSeededCard with no prior event card just returns the seeded card untouched', () => {
    const seeded = seedCardFromTerminalMeta(terminal)
    expect(mergeSeededCard(undefined, seeded)).toEqual(seeded)
  })

  it('withCallerNames resolves a card\'s caller/parent display name once the caller card is known', () => {
    const supervisor = buildCardFromTerminalCreated({ terminal_id: 'zzzzzzzz', agent_name: 'sol', provider: 'codex', session_id: 's1' }, 0)
    const worker: DelegationCard = { ...buildCardFromTerminalCreated({ terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }, 100), callerId: 'zzzzzzzz' }
    const resolved = withCallerNames({ zzzzzzzz: supervisor, aaaaaaaa: worker })
    expect(resolved.aaaaaaaa.callerAgentName).toBe('sol')
  })
})

describe('threadReducer: buildThreadItems (chat + cards + system lines + inner-message groups)', () => {
  it('places a card at a fixed position (first-seen) that later updates in place, not a new item', () => {
    const card: DelegationCard = { ...buildCardFromTerminalCreated({ terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }, 1000), status: 'processing' }
    const items = buildThreadItems({ events: [], chat: [], cards: { aaaaaaaa: card } })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'card', id: 'aaaaaaaa', ts: 1000 })
  })

  it('renders session_created/session_killed as system lines', () => {
    const events: UiEvent[] = [
      ev(1, 'session_created', { session_name: 'login-retry-fix', session_id: 's1' }, '2026-07-17T00:00:00Z'),
      ev(2, 'session_killed', { session_name: 'login-retry-fix', session_id: 's1' }, '2026-07-17T01:00:00Z'),
    ]
    const items = buildThreadItems({ events, chat: [], cards: {} })
    expect(items.map(i => i.kind)).toEqual(['system', 'system'])
    expect((items[0] as any).text).toContain('login-retry-fix')
  })

  it('groups consecutive send_message events into one folded inner-message group', () => {
    const events: UiEvent[] = [
      ev(1, 'message_sent', { sender: 'a', receiver: 'b', message: 'm1', orchestration_type: 'send_message', session_id: 's1' }, '2026-07-17T00:00:01Z'),
      ev(2, 'message_sent', { sender: 'b', receiver: 'a', message: 'm2', orchestration_type: 'send_message', session_id: 's1' }, '2026-07-17T00:00:02Z'),
    ]
    const items = buildThreadItems({ events, chat: [], cards: {} })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('inner-group')
    if (items[0].kind === 'inner-group') expect(items[0].messages).toHaveLength(2)
  })

  it('breaks the inner-message run when a card/system line is interleaved', () => {
    // Card's firstSeenAt sits exactly between the two send_message events'
    // timestamps, so it must split one 2-message group into two 1-message groups.
    const card: DelegationCard = buildCardFromTerminalCreated(
      { terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' },
      Date.parse('2026-07-17T00:00:02Z'),
    )
    const events: UiEvent[] = [
      ev(1, 'message_sent', { sender: 'a', receiver: 'b', message: 'm1', orchestration_type: 'send_message', session_id: 's1' }, '2026-07-17T00:00:01Z'),
      ev(2, 'message_sent', { sender: 'b', receiver: 'a', message: 'm2', orchestration_type: 'send_message', session_id: 's1' }, '2026-07-17T00:00:03Z'),
    ]
    const items = buildThreadItems({ events, chat: [], cards: { aaaaaaaa: card } })
    expect(items.map(i => i.kind)).toEqual(['inner-group', 'card', 'inner-group'])
  })

  it('interleaves chat entries and cards by timestamp', () => {
    const card: DelegationCard = buildCardFromTerminalCreated({ terminal_id: 'aaaaaaaa', agent_name: 'sonnet', provider: 'claude_code', session_id: 's1' }, 2000)
    const items = buildThreadItems({
      events: [],
      chat: [
        { id: 'c1', role: 'user', content: 'hello', ts: 1000 },
        { id: 'c2', role: 'assistant', content: 'on it', ts: 3000 },
      ],
      cards: { aaaaaaaa: card },
    })
    expect(items.map(i => i.id)).toEqual(['c1', 'aaaaaaaa', 'c2'])
  })
})
