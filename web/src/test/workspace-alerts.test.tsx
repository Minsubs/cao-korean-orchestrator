import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitWorkspaceAlert } from '../components/NotificationCenter'
import { useWorkspaceAlerts } from '../features/workspace/useWorkspaceAlerts'
import type { DelegationCard } from '../features/workspace/types'

vi.mock('../components/NotificationCenter', () => ({
  emitWorkspaceAlert: vi.fn(),
}))

const card: DelegationCard = {
  terminalId: 'worker01',
  sessionId: 'cao-login-fix',
  agentName: 'codex_qa_terra',
  provider: 'codex',
  callerId: 'parent01',
  callerAgentName: 'codex_orchestrator_sol',
  status: 'processing',
  prevStatus: null,
  location: null,
  locationLoaded: false,
  instruction: '연결 테스트',
  instructionType: 'handoff',
  instructionFromId: 'parent01',
  killed: false,
  lastActivityAt: Date.now(),
  lastOutputAt: null,
  firstSeenAt: Date.now(),
  hasSignal: true,
}

describe('workspace agent alerts', () => {
  beforeEach(() => vi.mocked(emitWorkspaceAlert).mockClear())

  it('emits the exact session and agent when an auto-cleaned worker completes', () => {
    const { rerender } = renderHook(
      ({ worker }) => useWorkspaceAlerts([worker], { worker01: 'processing' }, 'cao-login-fix'),
      { initialProps: { worker: card } },
    )

    rerender({ worker: { ...card, status: 'completed', prevStatus: 'processing', killed: true } })

    expect(emitWorkspaceAlert).toHaveBeenCalledWith(
      'completed',
      'login-fix · 테스트 담당 작업 완료',
      '테스트 담당의 작업이 끝났습니다.',
      'worker01',
      'cao-login-fix',
      'codex_qa_terra',
    )
  })
})
