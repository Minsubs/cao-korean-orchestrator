import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import { SessionChatPanel } from '../components/SessionChatPanel'

describe('SessionChatPanel', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getInboxMessages').mockResolvedValue([])
    vi.spyOn(api, 'getSession').mockResolvedValue({
      session: { id: 'session', name: 'session', status: 'active' },
      terminals: [
        { id: 'orchestrator', tmux_session: 'session', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed', input_generation: 0, ready_generation: 0 },
      ],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('loads the orchestrator recent output for the selected session', async () => {
    vi.spyOn(api, 'getTerminalOutput').mockResolvedValue({ output: '최근 작업 결과', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('completed')

    render(<SessionChatPanel sessionName="cao-hanwha" terminalId="orchestrator-1" onClose={() => {}} />)

    expect(await screen.findByText('최근 작업 결과')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'cao-hanwha 오케스트레이터 채팅' })).toBeInTheDocument()
    expect(screen.getByText('완료')).toBeInTheDocument()
  })

  it('sends a prompt and replaces the waiting bubble with the orchestrator response', async () => {
    const output = vi.spyOn(api, 'getTerminalOutput')
    output.mockResolvedValueOnce({ output: '이전 응답', mode: 'last' })
    output.mockResolvedValue({ output: '새 작업을 확인했습니다.', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('completed')
    vi.spyOn(api, 'getSession')
      .mockResolvedValueOnce({
        session: { id: 'cao-alarm', name: 'cao-alarm', status: 'active' },
        terminals: [{ id: 'orchestrator-2', tmux_session: 'cao-alarm', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed', input_generation: 0, ready_generation: 0 }],
      })
      .mockResolvedValue({
        session: { id: 'cao-alarm', name: 'cao-alarm', status: 'active' },
        terminals: [{ id: 'orchestrator-2', tmux_session: 'cao-alarm', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed', input_generation: 1, ready_generation: 1 }],
      })
    const send = vi.spyOn(api, 'sendInput').mockResolvedValue({ success: true })

    render(<SessionChatPanel sessionName="cao-alarm" terminalId="orchestrator-2" onClose={() => {}} />)
    await screen.findByText('이전 응답')

    fireEvent.change(screen.getByLabelText('오케스트레이터 프롬프트'), { target: { value: '알람 기능을 설계해줘' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    await waitFor(() => expect(send).toHaveBeenCalledWith('orchestrator-2', '알람 기능을 설계해줘'))
    expect(screen.getByText('알람 기능을 설계해줘')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('새 작업을 확인했습니다.')).toBeInTheDocument())
  })

  it('keeps the chat pending when the orchestrator turn ends before its worker', async () => {
    let sent = false
    const output = vi.spyOn(api, 'getTerminalOutput')
    output.mockResolvedValueOnce({ output: '이전 응답', mode: 'last' })
    output.mockResolvedValue({ output: '워커에게 위임했습니다.', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('completed')
    vi.spyOn(api, 'getSession').mockImplementation(async () => ({
      session: { id: 'cao-team', name: 'cao-team', status: 'active' },
      terminals: sent
        ? [
            { id: 'orchestrator-team', tmux_session: 'cao-team', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed', caller_id: null, input_generation: 1, ready_generation: 1 },
            { id: 'worker-team', tmux_session: 'cao-team', tmux_window: '1', provider: 'codex', agent_profile: 'terra', created_at: null, last_active: null, status: 'processing', caller_id: 'orchestrator-team', input_generation: 1, ready_generation: 0 },
          ]
        : [{ id: 'orchestrator-team', tmux_session: 'cao-team', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed', caller_id: null, input_generation: 0, ready_generation: 0 }],
    }))
    vi.spyOn(api, 'sendInput').mockImplementation(async () => {
      sent = true
      return { success: true }
    })

    render(<SessionChatPanel sessionName="cao-team" terminalId="orchestrator-team" onClose={() => {}} />)
    await screen.findByText('이전 응답')

    fireEvent.change(screen.getByLabelText('오케스트레이터 프롬프트'), { target: { value: '팀 연결 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(await screen.findByText('오케스트레이터 응답을 기다리는 중…')).toBeInTheDocument()
    expect(screen.queryByText('워커에게 위임했습니다.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('오케스트레이터 프롬프트')).toBeDisabled()
  })

  it('shows a send error without dropping the user message', async () => {
    vi.spyOn(api, 'getTerminalOutput').mockResolvedValue({ output: '', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('idle')
    vi.spyOn(api, 'sendInput').mockRejectedValue({ detail: '터미널이 응답하지 않습니다' })

    render(<SessionChatPanel sessionName="cao-alarm" terminalId="orchestrator-3" onClose={() => {}} />)
    await screen.findByText('오케스트레이터에게 첫 작업을 요청해 보세요.')

    fireEvent.change(screen.getByLabelText('오케스트레이터 프롬프트'), { target: { value: '상태를 확인해줘' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(await screen.findByText('터미널이 응답하지 않습니다')).toBeInTheDocument()
    expect(screen.getByText('상태를 확인해줘')).toBeInTheDocument()
  })

  it('hides tool calls and loaded skill content from the chat response', async () => {
    vi.spyOn(api, 'getTerminalOutput').mockResolvedValue({
      output: `• 작업을 시작합니다.\n\n• Called cao-mcp-server.load_skill({"name":"cao-session-management"})\n  └ # CAO Session Management\n    긴 스킬 본문\n\n• Called cao-mcp-server.send_message({"receiver_id":"worker"})\n  └ {"success":true}\n\n────────────────────────────────────────\n\n• Haiku 탐색가에게 확인을 위임했습니다. 결과가 오면 이어서 진행하겠습니다.\n─ Worked for 11m 58s ───────────────────────────────────────\n\n────────────────────────────────────────`,
      mode: 'last',
    })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('completed')

    render(<SessionChatPanel sessionName="cao-filter" terminalId="orchestrator-filter" onClose={() => {}} />)

    expect(await screen.findByText('Haiku 탐색가에게 확인을 위임했습니다. 결과가 오면 이어서 진행하겠습니다.')).toBeInTheDocument()
    expect(screen.queryByText(/Called cao-mcp-server/)).not.toBeInTheDocument()
    expect(screen.queryByText(/CAO Session Management/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Worked for/)).not.toBeInTheDocument()
  })

  it('restores session chat messages after the panel is closed and reopened', async () => {
    const output = vi.spyOn(api, 'getTerminalOutput')
    output.mockResolvedValueOnce({ output: '', mode: 'last' })
    output.mockResolvedValue({ output: '저장된 최종 응답', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('completed')
    vi.spyOn(api, 'getSession')
      .mockResolvedValueOnce({
        session: { id: 'cao-persist', name: 'cao-persist', status: 'active' },
        terminals: [{ id: 'orchestrator-persist', tmux_session: 'cao-persist', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed', input_generation: 0, ready_generation: 0 }],
      })
      .mockResolvedValue({
        session: { id: 'cao-persist', name: 'cao-persist', status: 'active' },
        terminals: [{ id: 'orchestrator-persist', tmux_session: 'cao-persist', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed', input_generation: 1, ready_generation: 1 }],
      })
    vi.spyOn(api, 'sendInput').mockResolvedValue({ success: true })

    const first = render(<SessionChatPanel sessionName="cao-persist" terminalId="orchestrator-persist" onClose={() => {}} />)
    await screen.findByText('오케스트레이터에게 첫 작업을 요청해 보세요.')
    fireEvent.change(screen.getByLabelText('오케스트레이터 프롬프트'), { target: { value: '이 대화를 기억해줘' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await screen.findByText('저장된 최종 응답')
    first.unmount()

    render(<SessionChatPanel sessionName="cao-persist" terminalId="orchestrator-persist" onClose={() => {}} />)
    expect(await screen.findByText('이 대화를 기억해줘')).toBeInTheDocument()
    expect(screen.getByText('저장된 최종 응답')).toBeInTheDocument()
  })

  it('restores the exact pending turn baselines instead of inventing zero baselines', async () => {
    window.localStorage.setItem('cao:session-chat:v2:cao-pending', JSON.stringify({
      messages: [
        { id: 'pending-user', role: 'user', content: '팀 연결 테스트' },
        { id: 'pending-assistant', role: 'assistant', content: '오케스트레이터 응답을 기다리는 중…' },
      ],
      lastOutput: '워커 응답 대기 중',
      pendingReply: {
        messageId: 'pending-assistant',
        baseline: '워커 응답 대기 중',
        baselineGenerations: { 'orchestrator-pending': 3, 'worker-pending': 7 },
        baselineInboxMessageId: 14,
      },
    }))
    vi.spyOn(api, 'getTerminalOutput').mockResolvedValue({ output: '워커 응답 대기 중', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('completed')
    vi.spyOn(api, 'getSession').mockResolvedValue({
      session: { id: 'cao-pending', name: 'cao-pending', status: 'active' },
      terminals: [
        { id: 'orchestrator-pending', tmux_session: 'cao-pending', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'completed', caller_id: null, input_generation: 3, ready_generation: 3 },
        { id: 'worker-pending', tmux_session: 'cao-pending', tmux_window: '1', provider: 'codex', agent_profile: 'terra', created_at: null, last_active: null, status: 'completed', caller_id: 'orchestrator-pending', input_generation: 7, ready_generation: 7 },
      ],
    })

    render(<SessionChatPanel sessionName="cao-pending" terminalId="orchestrator-pending" onClose={() => {}} />)

    expect(await screen.findByText('팀 연결 테스트')).toBeInTheDocument()
    expect(screen.getByLabelText('오케스트레이터 프롬프트')).toBeDisabled()
  })

  it('persists pending metadata before the input request resolves', async () => {
    let resolveInput: ((value: { success: boolean }) => void) | undefined
    const inputRequest = new Promise<{ success: boolean }>(resolve => {
      resolveInput = resolve
    })
    vi.spyOn(api, 'getTerminalOutput').mockResolvedValue({ output: '이전 응답', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('idle')
    vi.spyOn(api, 'getSession').mockResolvedValue({
      session: { id: 'cao-pending-request', name: 'cao-pending-request', status: 'active' },
      terminals: [{ id: 'orchestrator-request', tmux_session: 'cao-pending-request', tmux_window: '0', provider: 'codex', agent_profile: 'sol', created_at: null, last_active: null, status: 'idle', input_generation: 4, ready_generation: 4 }],
    })
    vi.spyOn(api, 'sendInput').mockReturnValue(inputRequest)

    const first = render(<SessionChatPanel sessionName="cao-pending-request" terminalId="orchestrator-request" onClose={() => {}} />)
    await screen.findByText('이전 응답')
    fireEvent.change(screen.getByLabelText('오케스트레이터 프롬프트'), { target: { value: '연결 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('cao:session-chat:v2:cao-pending-request') || '{}')
      expect(stored.pendingReply).toMatchObject({
        baseline: '이전 응답',
        baselineGenerations: { 'orchestrator-request': 4 },
        baselineInboxMessageId: 0,
      })
    })
    first.unmount()
    await act(async () => resolveInput?.({ success: true }))

    render(<SessionChatPanel sessionName="cao-pending-request" terminalId="orchestrator-request" onClose={() => {}} />)
    expect(await screen.findByText('연결 테스트')).toBeInTheDocument()
    expect(screen.getByLabelText('오케스트레이터 프롬프트')).toBeDisabled()
  })

  it('does not fabricate pending metadata for legacy waiting bubbles', async () => {
    window.localStorage.setItem('cao:session-chat:v2:cao-legacy-pending', JSON.stringify({
      messages: [
        { id: 'legacy-wait', role: 'assistant', content: '오케스트레이터 응답을 기다리는 중…' },
      ],
      lastOutput: '',
    }))
    vi.spyOn(api, 'getTerminalOutput').mockResolvedValue({ output: '', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('completed')

    render(<SessionChatPanel sessionName="cao-legacy-pending" terminalId="orchestrator-legacy" onClose={() => {}} />)

    expect(await screen.findByText('오케스트레이터 응답을 기다리는 중…')).toBeInTheDocument()
    expect(screen.getByLabelText('오케스트레이터 프롬프트')).toBeEnabled()
  })

  it('cleans provider timing footers from previously stored assistant messages', async () => {
    window.localStorage.setItem('cao:session-chat:v2:cao-migrate', JSON.stringify({
      messages: [
        { id: 'old-user', role: 'user', content: '진행 상황 알려줘' },
        { id: 'old-assistant', role: 'assistant', content: '작업을 완료했습니다.\n─ Worked for 11m 58s ─────────────────────────────' },
      ],
      lastOutput: '',
    }))
    vi.spyOn(api, 'getTerminalOutput').mockResolvedValue({ output: '', mode: 'last' })
    vi.spyOn(api, 'getTerminalStatus').mockResolvedValue('completed')

    render(<SessionChatPanel sessionName="cao-migrate" terminalId="orchestrator-migrate" onClose={() => {}} />)

    expect(await screen.findByText('작업을 완료했습니다.')).toBeInTheDocument()
    expect(screen.queryByText(/Worked for/)).not.toBeInTheDocument()
  })
})
