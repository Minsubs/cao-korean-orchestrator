import { describe, expect, it } from 'vitest'
import { classifyOrchestrationError, pendingTimeoutMessage } from '../features/workspace/orchestrationError'

function apiError(status: number, detail?: string, message = `${status} err`): Error & { status: number; detail?: string } {
  const err = new Error(message) as Error & { status: number; detail?: string }
  err.status = status
  if (detail !== undefined) err.detail = detail
  return err
}

describe('classifyOrchestrationError', () => {
  it('maps an aborted request to a timeout, not a generic failure', () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    const result = classifyOrchestrationError(err)
    expect(result.kind).toBe('timeout')
    expect(result.userMessage).toBe('요청이 제한 시간 안에 끝나지 않았어요. 잠시 후 다시 시도해 주세요.')
  })

  it('maps a status-less failure to a connection problem', () => {
    const result = classifyOrchestrationError(new TypeError('Failed to fetch'))
    expect(result.kind).toBe('network')
    expect(result.userMessage).toBe('서버에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.')
  })

  it('maps 401 and 403 to an authentication problem', () => {
    expect(classifyOrchestrationError(apiError(401)).kind).toBe('auth')
    const result = classifyOrchestrationError(apiError(403))
    expect(result.kind).toBe('auth')
    expect(result.userMessage).toBe('이 작업을 수행할 권한이 없어요. CLI 로그인 상태를 확인해 주세요.')
  })

  it('maps 404 to a missing target', () => {
    const result = classifyOrchestrationError(apiError(404))
    expect(result.kind).toBe('notfound')
    expect(result.userMessage).toBe('대상 에이전트를 찾을 수 없어요. 이미 정리되었을 수 있어요.')
  })

  it('maps 5xx to a server-side failure', () => {
    expect(classifyOrchestrationError(apiError(500)).kind).toBe('server')
    expect(classifyOrchestrationError(apiError(503)).userMessage).toBe('서버에서 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
  })

  it('falls back to a generic message for an unmapped status', () => {
    const result = classifyOrchestrationError(apiError(418))
    expect(result.kind).toBe('unknown')
    expect(result.userMessage).toBe('메시지를 보내지 못했어요.')
  })

  it('never puts the server detail or the raw message into the user-facing text', () => {
    const result = classifyOrchestrationError(
      apiError(500, 'Traceback: /home/minsub57/secret/path.py line 42 KeyError token_abc123', '500 Internal Server Error'),
    )
    expect(result.userMessage).not.toContain('Traceback')
    expect(result.userMessage).not.toContain('token_abc123')
    expect(result.userMessage).not.toContain('/home/minsub57')
    expect(result.userMessage).not.toContain('500')
  })

  it('preserves the raw detail separately so the 원문 보기 toggle can show it', () => {
    const result = classifyOrchestrationError(apiError(500, 'KeyError: token', '500 Internal Server Error'))
    expect(result.raw).toContain('KeyError: token')
    expect(result.raw).toContain('500 Internal Server Error')
  })

  it('leaves raw undefined when there is nothing beyond the user message to show', () => {
    expect(classifyOrchestrationError(undefined).raw).toBeUndefined()
    expect(classifyOrchestrationError(undefined).kind).toBe('unknown')
  })
})

describe('pendingTimeoutMessage', () => {
  it('tells the user the turn is still running rather than claiming failure', () => {
    expect(pendingTimeoutMessage()).toBe(
      '응답이 아직 도착하지 않았어요. 오케스트레이터는 계속 작업 중일 수 있어요 — 잠시 후 새로고침해 확인해 주세요.',
    )
  })
})
