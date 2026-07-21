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

describe('orchestrator chat output noise stripping', () => {
  it.each(formatters)('strips internal-state narration lines', (formatOutput) => {
    const raw = `• assign 접수만으로는 완료 처리하지 않습니다. 워커 콜백을 기다립니다.
• 재할당은 하지 않으며, 동일 작업자의 메시지 도착만 확인합니다.

로그인 재시도 버그를 고쳤고 회귀 테스트가 통과했습니다.`
    expect(formatOutput(raw)).toBe('로그인 재시도 버그를 고쳤고 회귀 테스트가 통과했습니다.')
  })

  it.each(formatters)('strips tool-result JSON continuation lines', (formatOutput) => {
    const raw = `  └ {"success": true, "message_id": 21, "sender_id": "53c5e264"}
{"terminal_id": "2bd9e73e"}

작업을 세 단계로 나눠 완료했어요.`
    expect(formatOutput(raw)).toBe('작업을 세 단계로 나눠 완료했어요.')
  })

  it.each(formatters)('strips standalone internal markers', (formatOutput) => {
    const raw = `LATEST_ORCHESTRATION_VERIFIED
MTX_CX_CX_FIN_OK

최종 결과: 6/6 연결 성공`
    expect(formatOutput(raw)).toBe('최종 결과: 6/6 연결 성공')
  })

  it.each(formatters)('keeps ordinary prose that merely contains an uppercase word', (formatOutput) => {
    const raw = `API 호출을 3회로 줄였어요. OK 응답을 확인했습니다.`
    expect(formatOutput(raw)).toBe('API 호출을 3회로 줄였어요. OK 응답을 확인했습니다.')
  })

  it.each(formatters)('keeps prose with 재할당/메시지 도착 when not a bullet line', (formatOutput) => {
    const raw = `티켓을 다른 담당자에게 재할당을 완료했습니다. 메시지 도착 알림도 설정했어요.`
    expect(formatOutput(raw)).toBe('티켓을 다른 담당자에게 재할당을 완료했습니다. 메시지 도착 알림도 설정했어요.')
  })

  it.each(formatters)('keeps a legitimate bare JSON config answer', (formatOutput) => {
    const raw = `{"timeout": 30, "retries": 3}`
    expect(formatOutput(raw)).toBe('{"timeout": 30, "retries": 3}')
  })
})
