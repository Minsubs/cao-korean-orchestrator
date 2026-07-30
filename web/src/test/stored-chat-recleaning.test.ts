import { beforeEach, describe, expect, it } from 'vitest'
import { loadStoredChat } from '../features/workspace/orchestratorChat'
import { STORAGE_KEYS } from '../features/workspace/constants'

// 이미 저장된 대화도 새 정리 규칙으로 다시 읽힌다.
//
// The user asked whether the mangled completion reply they are looking at is just
// the pre-fix render. It is — and it matters that reloading fixes it, because a
// message that arrived before the fix would otherwise stay ugly forever in that
// session's history.
//
// loadStoredChat re-runs formatOrchestratorOutput over each stored entry on every
// load, so the cleaning rules apply retroactively. That is load-bearing behaviour,
// not an accident, so it is pinned here: the same status bar and table rules that
// leaked into a live reply must also disappear from history on the next load.

const SESSION = 'cao-recleaning'

function seed(storedContent: string, raw?: string) {
  window.localStorage.setItem(
    `${STORAGE_KEYS.sessionChat}${SESSION}`,
    JSON.stringify({
      workspaceMessages: [
        { id: 'a1', role: 'user', content: '크로스 테스트 해줘' },
        { id: 'a2', role: 'assistant', content: storedContent, ...(raw ? { raw } : {}) },
      ],
      lastOutput: '',
      workspacePendingReply: null,
    }),
  )
}

const MANGLED = [
  'gpt-5.6-sol high fast · ~/hunesion_workspace/AI_Rule · Context 28% used · weekly 30% left · Fast on · Read Only',
  '',
  '  ─────────────────────────  ──────',
  '   codex_reviewer_sol         정상',
  '  ─────────────────────────  ──────',
  '   documentation-writer       실패',
].join('\n')

describe('stored chat history is re-cleaned on load', () => {
  beforeEach(() => window.localStorage.clear())

  it('strips the status bar and table rules from an entry stored before the fix', () => {
    seed(MANGLED)
    const { entries } = loadStoredChat(SESSION)
    const assistant = entries.find(entry => entry.role === 'assistant')

    expect(assistant?.content).toBeTruthy()
    expect(assistant?.content).not.toContain('Context 28% used')
    expect(assistant?.content).not.toMatch(/[─-╿]/)
    // The information survives the cleanup — this is a formatting fix, not a purge.
    expect(assistant?.content).toContain('codex_reviewer_sol')
    expect(assistant?.content).toContain('documentation-writer')
  })

  it('prefers the stored raw transcript when one was kept', () => {
    // Assistant entries keep the pre-cleaning transcript in `raw` for the 원문 보기
    // toggle; re-cleaning must start from that, so a later rule can recover text an
    // earlier rule had dropped.
    seed('짧게 잘린 옛 표시', MANGLED)
    const assistant = loadStoredChat(SESSION).entries.find(entry => entry.role === 'assistant')

    expect(assistant?.content).toContain('documentation-writer')
    expect(assistant?.raw).toBe(MANGLED)
  })

  it('keeps the user turn untouched', () => {
    seed(MANGLED)
    const user = loadStoredChat(SESSION).entries.find(entry => entry.role === 'user')
    expect(user?.content).toBe('크로스 테스트 해줘')
  })
})
