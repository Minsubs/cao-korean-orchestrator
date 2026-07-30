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

describe('workspace agent alerts — orchestrator only', () => {
  beforeEach(() => vi.mocked(emitWorkspaceAlert).mockClear())

  // User decision: notifications should announce the orchestrator's answer and
  // nothing else. Per-worker alerts (completed / error / stall / waiting_input)
  // were pure noise on a multi-agent run — a single task could raise a dozen.
  //
  // Nothing is hidden by this: Phase 3 put 승인 대기 and 오류 on the in-chat
  // progress card with 승인하러 가기 / 오류 확인 actions, so the state is still on
  // screen; it just is not pushed as a notification. The orchestrator alert
  // itself lives in NotificationCenter's own session poll, not here.
  it('raises no notification for a worker completing', () => {
    renderHook(() => useWorkspaceAlerts([{ ...card, status: 'completed', killed: true }], { worker01: 'COMPLETED' }, 'cao-login-fix'))
    expect(emitWorkspaceAlert).not.toHaveBeenCalled()
  })

  it('raises no notification for a worker erroring', () => {
    renderHook(() => useWorkspaceAlerts([card], { worker01: 'ERROR' }, 'cao-login-fix'))
    expect(emitWorkspaceAlert).not.toHaveBeenCalled()
  })

  it('raises no notification for a worker waiting on input', () => {
    renderHook(() => useWorkspaceAlerts([card], { worker01: 'WAITING_USER_ANSWER' }, 'cao-login-fix'))
    expect(emitWorkspaceAlert).not.toHaveBeenCalled()
  })

  it('raises no notification for a stalled worker', () => {
    const stale = { ...card, lastActivityAt: Date.now() - 60 * 60 * 1000, firstSeenAt: Date.now() - 60 * 60 * 1000 }
    renderHook(() => useWorkspaceAlerts([stale], { worker01: 'PROCESSING' }, 'cao-login-fix'))
    expect(emitWorkspaceAlert).not.toHaveBeenCalled()
  })
})
