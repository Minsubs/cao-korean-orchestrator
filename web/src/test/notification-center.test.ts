import { describe, expect, it } from 'vitest'
import { alertForStatusTransition } from '../components/NotificationCenter'

describe('agent notification transitions', () => {
  it('alerts when an orchestrator starts waiting for approval or input', () => {
    expect(alertForStatusTransition('cao-hanwha', 'codex_orchestrator_sol', 'processing', 'waiting_user_answer')).toMatchObject({
      kind: 'approval',
      title: 'hanwha · 오케스트레이터 입력 필요',
    })
  })

  it('alerts when processing completes', () => {
    expect(alertForStatusTransition('cao-alarm', 'codex_qa_terra', 'processing', 'completed')).toMatchObject({
      kind: 'completed',
      title: 'alarm · 테스트 담당 작업 완료',
    })
    expect(alertForStatusTransition('cao-alarm', 'codex_qa_terra', 'processing', 'idle')).toMatchObject({ kind: 'completed' })
  })

  it('does not alert for initial completed or repeated idle states', () => {
    expect(alertForStatusTransition('cao-hanwha', 'codex_qa_terra', undefined, 'completed')).toBeNull()
    expect(alertForStatusTransition('cao-hanwha', 'codex_qa_terra', 'idle', 'idle')).toBeNull()
  })

  it('alerts when processing fails', () => {
    expect(alertForStatusTransition('cao-hanwha', 'codex_reviewer_sol', 'processing', 'error')).toMatchObject({
      kind: 'error',
      title: 'hanwha · 최종 검토자 작업 오류',
    })
  })
})
