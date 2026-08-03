// Phase 3 · 오케스트레이션 실패의 사용자향 분류.
//
// 원칙: 서버 detail, 스택, 경로, 토큰 같은 원문은 사용자 문구에 절대 넣지
// 않는다. 원문은 `raw` 로만 실어 보내고 화면에서는 Phase 1 의 "원문 보기"
// 토글 뒤에 둔다. 분류는 HTTP status 와 AbortError 만 보고 결정한다.

export type OrchestrationErrorKind = 'network' | 'timeout' | 'auth' | 'notfound' | 'gone' | 'server' | 'unknown'

export interface ClassifiedError {
  kind: OrchestrationErrorKind
  /** 사용자에게 그대로 보여줄 한국어 문구. 원문 파편을 포함하지 않는다. */
  userMessage: string
  /** 진단용 원문(서버 detail + 예외 message). 없으면 undefined. */
  raw?: string
}

const MESSAGE: Record<OrchestrationErrorKind, string> = {
  timeout: '요청이 제한 시간 안에 끝나지 않았어요. 잠시 후 다시 시도해 주세요.',
  network: '서버에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.',
  auth: '이 작업을 수행할 권한이 없어요. CLI 로그인 상태를 확인해 주세요.',
  notfound: '대상 에이전트를 찾을 수 없어요. 이미 정리되었을 수 있어요.',
  // 410: 터미널 레코드는 남아 있지만 CLI 가 종료돼 창이 사라진 상태. 이전에는
  // 원시 tmux 명령이 실린 500 이라 "서버 장애"처럼 보였다.
  gone: '이 터미널은 종료됐어요. 새 작업을 시작하거나 다른 에이전트를 선택해 주세요.',
  server: '서버에서 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
  unknown: '메시지를 보내지 못했어요.',
}

function kindOf(error: { name?: string; status?: number } | null): OrchestrationErrorKind {
  if (!error) return 'unknown'
  if (error.name === 'AbortError') return 'timeout'
  const status = error.status
  if (typeof status !== 'number') return 'network'
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'notfound'
  if (status === 410) return 'gone'
  if (status >= 500) return 'server'
  return 'unknown'
}

export function classifyOrchestrationError(error: unknown): ClassifiedError {
  const err =
    error && typeof error === 'object'
      ? (error as { name?: string; message?: string; status?: number; detail?: string })
      : null
  const kind = kindOf(err)
  const parts = [err?.detail, err?.message].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  )
  return { kind, userMessage: MESSAGE[kind], ...(parts.length > 0 ? { raw: parts.join('\n') } : {}) }
}

/** 대기 타임아웃은 실패가 아니다 — 아직 진행 중일 수 있음을 알린다. */
export function pendingTimeoutMessage(): string {
  return '응답이 아직 도착하지 않았어요. 오케스트레이터는 계속 작업 중일 수 있어요 — 잠시 후 새로고침해 확인해 주세요.'
}
