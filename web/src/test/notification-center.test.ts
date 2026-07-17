import { describe, expect, it } from 'vitest'
import { alertForStatusTransition } from '../components/NotificationCenter'

describe('agent notification transitions', () => {
  it('alerts when an orchestrator starts waiting for approval or input', () => {
    expect(alertForStatusTransition('cao-hanwha', 'processing', 'waiting_user_answer')).toMatchObject({
      kind: 'approval',
      title: '승인 또는 응답이 필요합니다',
    })
  })

  it('alerts when processing completes', () => {
    expect(alertForStatusTransition('cao-alarm', 'processing', 'completed')).toMatchObject({
      kind: 'completed',
      title: '작업이 완료되었습니다',
    })
    expect(alertForStatusTransition('cao-alarm', 'processing', 'idle')).toMatchObject({ kind: 'completed' })
  })

  it('does not alert for initial completed or repeated idle states', () => {
    expect(alertForStatusTransition('cao-hanwha', undefined, 'completed')).toBeNull()
    expect(alertForStatusTransition('cao-hanwha', 'idle', 'idle')).toBeNull()
  })

  it('alerts when processing fails', () => {
    expect(alertForStatusTransition('cao-hanwha', 'processing', 'error')).toMatchObject({ kind: 'error' })
  })
})
