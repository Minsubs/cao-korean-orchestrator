import { describe, expect, it, beforeEach } from 'vitest'
import { saveStoredChat, loadStoredChat } from '../features/workspace/orchestratorChat'
import type { ChatEntry } from '../features/workspace/types'

describe('assistant raw preservation', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips assistant raw through save/load', () => {
    // NOTE: brief's Step 1 sample raw ('• Called x\n\n완료했어요.') does not
    // survive formatOrchestratorOutput — with a preceding tool-call line, the
    // sanitizer requires the final answer line to itself start with '•'
    // (see orchestratorChat.ts's lastToolCall branch), otherwise it returns ''
    // and the entry is dropped entirely. Using a sanitizer-compatible fixture
    // that keeps the same round-trip intent.
    const entries: ChatEntry[] = [
      { id: 'a1', role: 'assistant', content: '완료했어요.', raw: '• Called x\n\n• 완료했어요.', ts: 1 },
    ]
    saveStoredChat('cao-demo', entries, 'last', null)
    const loaded = loadStoredChat('cao-demo')
    const a = loaded.entries.find(e => e.id === 'a1')
    expect(a?.raw).toBe('• Called x\n\n• 완료했어요.')
    expect(a?.content).toBe('완료했어요.')
  })
})
