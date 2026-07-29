// Phase 6 · "작업 시작" 이 비활성인 이유를 사용자에게 말해 주는 순수 판정.
//
// 버튼만 흐릿해지면 사용자는 무엇을 채워야 하는지 알 수 없다. canSubmit 과
// 같은 조건을 쓰되, 무엇을 먼저 해결해야 하는지 순서대로 하나만 알려준다.
// 요청이 진행 중일 때는 스피너가 이미 상태를 말하므로 침묵한다.

export function newTaskBlockReason(params: {
  instruction: string
  /** 선택한 provider 의 오케스트레이터 프로필이 실제로 설치돼 있는지. */
  hasOrchestrator: boolean
  sessionNameValid: boolean
  creating: boolean
}): string | null {
  const { instruction, hasOrchestrator, sessionNameValid, creating } = params
  if (creating) return null
  if (instruction.trim().length === 0) return '작업 지시를 입력하면 시작할 수 있어요.'
  if (!hasOrchestrator) return '선택한 AI 의 오케스트레이터 프로필이 설치되어 있지 않아요.'
  if (!sessionNameValid) return '세션 이름은 영문·숫자·_ 로 시작하고 영문·숫자·_·- 만 쓸 수 있어요 (최대 60자).'
  return null
}
