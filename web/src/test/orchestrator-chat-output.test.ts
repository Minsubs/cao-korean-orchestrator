import { describe, expect, it } from 'vitest'
import { formatOrchestratorOutput as formatClassicOutput } from '../components/SessionChatPanel'
import { formatOrchestratorOutput as formatWorkspaceOutput } from '../features/workspace/orchestratorChat'

const formatters = [formatClassicOutput, formatWorkspaceOutput]

describe('orchestrator chat output completion guard', () => {
  it.each(formatters)('keeps a multi-minute Codex handoff frame pending', (formatOutput) => {
    const activeFrame = `• 6개 연결 검사가 모두 전송됐고 현재 워커 응답을 회수 중입니다.

• Called cao-mcp-server.handoff({"agent_profile":"codex_qa_terra"})
  └ {"success":true,"output":"• QA_CONNECTION_OK"}

• Working (2m 07s • esc to interrupt)`

    expect(formatOutput(activeFrame)).toBe('')
  })

  it.each(formatters)('returns the final answer after the progress frame is replaced', (formatOutput) => {
    const completedFrame = `• Called cao-mcp-server.handoff({"agent_profile":"codex_qa_terra"})
  └ {"success":true,"output":"• QA_CONNECTION_OK"}

────────────────────────────────────────

• 전체 연결 테스트 완료: 6/6 연결 성공

─ Worked for 2m 15s ─────────────────────`

    expect(formatOutput(completedFrame)).toBe('전체 연결 테스트 완료: 6/6 연결 성공')
  })
})
