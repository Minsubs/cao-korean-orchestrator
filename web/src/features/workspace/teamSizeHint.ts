// 새 작업 모달 — 팀 규모가 무엇을 뜻하는지 알려주는 문구.
//
// The default is the whole 기본 팀, so the orchestrator fans work out to several
// workers and the first answer takes much longer. That trade-off was invisible:
// the modal listed checkboxes but never said what checking more of them costs.
// Pure so it can be asserted without rendering the modal.

export interface TeamSizeHint {
  /** One sentence stating what this many delegates means for the run. */
  text: string
  /** True when the selection is large enough that latency is the headline. */
  slow: boolean
}

/** Above this many delegates, the wait is the thing worth warning about. */
export const SLOW_TEAM_THRESHOLD = 3

export function teamSizeHint(checkedCount: number): TeamSizeHint {
  if (checkedCount <= 0) {
    return {
      text: '오케스트레이터가 직접 처리해요. 가장 빨리 답이 오지만, 한 번에 살펴보는 범위는 좁아요.',
      slow: false,
    }
  }
  if (checkedCount === 1) {
    return {
      text: '필요하면 1개 역할에 위임해요. 대체로 빠르게 끝나요.',
      slow: false,
    }
  }
  if (checkedCount < SLOW_TEAM_THRESHOLD) {
    return {
      text: `필요하면 최대 ${checkedCount}개 역할에 나눠 위임해요.`,
      slow: false,
    }
  }
  return {
    text: `필요하면 최대 ${checkedCount}개 역할에 나눠 위임해요. 여러 에이전트가 각자 작업하는 동안 기다리게 되므로 첫 답변까지 몇 분 이상 걸릴 수 있어요.`,
    slow: true,
  }
}
