import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import { SessionChatPanel } from '../components/SessionChatPanel'

describe('SessionChatPanel', () => {
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
    const send = vi.spyOn(api, 'sendInput').mockResolvedValue({ success: true })

    render(<SessionChatPanel sessionName="cao-alarm" terminalId="orchestrator-2" onClose={() => {}} />)
    await screen.findByText('이전 응답')

    fireEvent.change(screen.getByLabelText('오케스트레이터 프롬프트'), { target: { value: '알람 기능을 설계해줘' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(send).toHaveBeenCalledWith('orchestrator-2', '알람 기능을 설계해줘')
    expect(screen.getByText('알람 기능을 설계해줘')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('새 작업을 확인했습니다.')).toBeInTheDocument())
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
