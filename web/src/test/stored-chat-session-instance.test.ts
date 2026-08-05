/**
 * A reused session name must not inherit the previous session's transcript.
 *
 * Live report: a freshly created `cao-test` opened with this text as its first
 * message —
 *
 *   Failed to send input: Command '['tmux', 'paste-buffer', '-r', '-b',
 *   'cao_370969a5', '-t', 'cao-test:codex_orchestrator_sol-04cb']' returned
 *   non-zero exit status 1. / 500 Internal Server Error
 *
 * — which reads as a live failure. It was not: that window name belonged to an
 * earlier `cao-test`, the server log for the new session had no send failure at
 * all, and its terminal was at generation 6/6 with every input delivered. The
 * transcript is keyed by session *name*, so the dead session's history (and its
 * pendingReply, pointing at a terminal that no longer exists) came back with it.
 */
import { describe, it, expect, beforeEach } from 'vitest'

import { loadStoredChat, saveStoredChat, clearStoredChat } from '../features/workspace/orchestratorChat'
import { STORAGE_KEYS } from '../features/workspace/constants'

const SESSION = 'cao-test'
const key = `${STORAGE_KEYS.sessionChat}${SESSION}`

function entry(id: string, content: string) {
  return { id, role: 'assistant' as const, content, ts: 1 }
}

describe('stored chat carries the session instance it belongs to', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('stamps the supervisor terminal id', () => {
    saveStoredChat(SESSION, [entry('m1', 'hello')], 'hello', null, 'sup-new')

    expect(JSON.parse(window.localStorage.getItem(key) ?? '{}').workspaceSupervisorId).toBe('sup-new')
    expect(loadStoredChat(SESSION).supervisorId).toBe('sup-new')
  })

  it('reports no instance for a payload written before the stamp existed', () => {
    // Upgrade path: history must stay loadable, and the caller decides what to
    // do with an unknown origin (it adopts the live one rather than wiping).
    window.localStorage.setItem(
      key,
      JSON.stringify({ workspaceMessages: [{ id: 'm1', role: 'assistant', content: 'old' }], lastOutput: 'old' }),
    )

    const loaded = loadStoredChat(SESSION)
    expect(loaded.supervisorId).toBeNull()
    expect(loaded.entries).toHaveLength(1)
  })

  it('does not erase a good stamp when the supervisor is not known yet', () => {
    saveStoredChat(SESSION, [entry('m1', 'hello')], 'hello', null, 'sup-new')
    saveStoredChat(SESSION, [entry('m1', 'hello')], 'hello', null, null)

    expect(loadStoredChat(SESSION).supervisorId).toBe('sup-new')
  })

  it('keeps the transcript when the same instance loads again (reload)', () => {
    saveStoredChat(SESSION, [entry('m1', 'kept across reload')], 'kept across reload', null, 'sup-same')

    const loaded = loadStoredChat(SESSION)
    expect(loaded.supervisorId).toBe('sup-same')
    expect(loaded.entries[0]?.content).toBe('kept across reload')
  })

  it('clearStoredChat forgets the name entirely', () => {
    saveStoredChat(SESSION, [entry('m1', 'dead session output')], 'dead session output', null, 'sup-old')
    clearStoredChat(SESSION)

    const loaded = loadStoredChat(SESSION)
    expect(loaded.entries).toEqual([])
    expect(loaded.pendingReply).toBeNull()
    expect(loaded.supervisorId).toBeNull()
  })

  it('drops a stale pendingReply along with the transcript', () => {
    // The stale pending reply is what left the composer stuck in "sending",
    // waiting on a terminal that had already been torn down.
    saveStoredChat(
      SESSION,
      [entry('m1', 'waiting…')],
      '',
      {
        messageId: 'm1',
        baseline: '',
        terminalId: 'gone-terminal',
        baselineGenerations: {},
        baselineInboxMessageId: 0,
      },
      'sup-old',
    )
    expect(loadStoredChat(SESSION).pendingReply?.terminalId).toBe('gone-terminal')

    clearStoredChat(SESSION)
    expect(loadStoredChat(SESSION).pendingReply).toBeNull()
  })

  it('survives storage that refuses writes', () => {
    const original = window.localStorage.removeItem
    window.localStorage.removeItem = () => {
      throw new Error('storage disabled')
    }
    try {
      expect(() => clearStoredChat(SESSION)).not.toThrow()
    } finally {
      window.localStorage.removeItem = original
    }
  })
})
