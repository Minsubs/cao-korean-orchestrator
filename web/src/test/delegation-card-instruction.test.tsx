import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentSidePanel } from '../features/workspace/AgentSidePanel'
import type { DelegationCard } from '../features/workspace/types'

// The 배정 line must read as a summary with the plumbing gone, and offer the
// full text on demand. It used to live on the in-thread delegation card; the
// thread now carries only the conversation, so the same requirement applies to
// the work queue row that replaced it. Fixture is the real live string.
const RAW = `배정: 최종 정확성/보안/릴리즈 리뷰 전용, 파일 수정 금지. 작업 디렉터리 /home/minsub57/hunesion_workspace/AI_Rule/i-oneNGS/k8s-access-control. 신규 문서를 기존 문서와 비교하라. 중점: (1) 핵심 설계 누락/왜곡/상충, (2) 확정·가정·제안·미결정 분류 정확성. finding은 severity, 파일 line, 근거, 최소 수정안으로 작성. 150줄 이내 callback. [Assigned by terminal 75c0c44a. When done, send results back to terminal 75c0c44a using send_message]`

const CARD: DelegationCard = {
  terminalId: 'bbbbbbbb',
  sessionId: null,
  agentName: 'codex_reviewer_sol',
  provider: 'codex',
  callerId: null,
  callerAgentName: null,
  status: 'processing',
  prevStatus: null,
  location: null,
  locationLoaded: false,
  instruction: RAW,
  instructionType: 'assign',
  instructionFromId: null,
  killed: false,
  lastActivityAt: Date.now(),
  lastOutputAt: null,
  firstSeenAt: Date.now(),
  hasSignal: true,
}

function renderQueue() {
  const view = render(
    <AgentSidePanel
      collapsed={false}
      sessionName="cao-sess"
      terminals={[]}
      cards={[CARD]}
      terminalStatuses={{ bbbbbbbb: 'PROCESSING' }}
      sessionWorkingDirectory={null}
      onMessageTarget={() => {}}
      onOpenTerminal={() => {}}
      onOpenOutput={() => {}}
      onOpenInbox={() => {}}
      onRequestStop={() => {}}
      onRequestDelete={() => {}}
      onRequestEndSession={() => {}}
      onAgentAdded={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('tab', { name: /작업 큐/ }))
  return view
}

describe('work queue 배정 line', () => {
  it('hides the orchestration plumbing and the terminal ids from it', () => {
    renderQueue()
    expect(screen.queryByText(/Assigned by terminal/)).toBeNull()
    expect(screen.queryByText(/send_message/)).toBeNull()
  })

  it('shows a shortened summary with a way to expand it', () => {
    renderQueue()
    const expand = screen.getByRole('button', { name: '전체 보기' })
    expect(screen.getByText(/최종 정확성\/보안\/릴리즈 리뷰 전용/)).toBeTruthy()

    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: '요약 보기' })).toBeTruthy()
    // Expanded shows the rest of the real instruction — still without plumbing.
    expect(screen.getByText(/150줄 이내 callback/)).toBeTruthy()
    expect(screen.queryByText(/Assigned by terminal/)).toBeNull()
  })
})
