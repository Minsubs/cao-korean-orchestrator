import { describe, expect, it } from 'vitest'
import { newTaskBlockReason } from '../features/workspace/newTaskGate'

const ready = { instruction: '테스트 돌려줘', hasOrchestrator: true, sessionNameValid: true, creating: false }

describe('newTaskBlockReason', () => {
  it('returns nothing when the form is ready to submit', () => {
    expect(newTaskBlockReason(ready)).toBeNull()
  })

  it('asks for an instruction first — the most common reason the button is off', () => {
    expect(newTaskBlockReason({ ...ready, instruction: '' })).toBe('작업 지시를 입력하면 시작할 수 있어요.')
    expect(newTaskBlockReason({ ...ready, instruction: '   ' })).toBe('작업 지시를 입력하면 시작할 수 있어요.')
  })

  it('explains a missing orchestrator profile instead of just greying out', () => {
    expect(newTaskBlockReason({ ...ready, hasOrchestrator: false })).toBe(
      '선택한 AI 의 오케스트레이터 프로필이 설치되어 있지 않아요.',
    )
  })

  it('spells out the session-name rule', () => {
    expect(newTaskBlockReason({ ...ready, sessionNameValid: false })).toBe(
      '세션 이름은 영문·숫자·_ 로 시작하고 영문·숫자·_·- 만 쓸 수 있어요 (최대 60자).',
    )
  })

  it('says nothing while the request is in flight — the spinner already speaks', () => {
    expect(newTaskBlockReason({ ...ready, creating: true })).toBeNull()
    expect(newTaskBlockReason({ ...ready, instruction: '', creating: true })).toBeNull()
  })

  it('reports the instruction first when several things are wrong', () => {
    expect(newTaskBlockReason({ instruction: '', hasOrchestrator: false, sessionNameValid: false, creating: false })).toBe(
      '작업 지시를 입력하면 시작할 수 있어요.',
    )
  })
})
