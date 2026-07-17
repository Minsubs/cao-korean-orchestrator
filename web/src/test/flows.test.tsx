import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { FlowsView } from '../features/flows/FlowsView'
import { humanizeCron } from '../features/flows/cron'
import type { AgentProfileInfo, Flow, ProviderInfo } from '../api'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: () => Promise.resolve(data),
  }
}

const PROFILES: AgentProfileInfo[] = [
  { name: 'codex_orchestrator_sol', description: 'Sol orchestrator', source: 'built-in' },
  { name: 'codex_docs_luna', description: 'Luna docs', source: 'built-in' },
]

const PROVIDERS: ProviderInfo[] = [{ name: 'codex', binary: 'codex', installed: true }]

function makeFlows(): Flow[] {
  return [
    {
      name: 'morning-standup',
      file_path: '/x/morning-standup.flow.md',
      schedule: '0 9 * * 1-5',
      agent_profile: 'codex_orchestrator_sol',
      provider: 'codex',
      script: null,
      last_run: '2026-07-17T09:00:00Z',
      next_run: '2026-07-18T09:00:00Z',
      enabled: true,
      prompt_template: '오늘 할 일을 정리해줘',
    },
    {
      name: 'weekly-report',
      file_path: '/x/weekly-report.flow.md',
      schedule: '0 9 * * 1',
      agent_profile: 'codex_docs_luna',
      provider: 'codex',
      script: null,
      last_run: null,
      next_run: null,
      enabled: false,
      prompt_template: '주간 보고서를 작성해줘',
    },
  ]
}

describe('cron humanizer (humanizeCron)', () => {
  it('handles the basic minute/hour/weekday cases', () => {
    expect(humanizeCron('*/5 * * * *')).toBe('5분마다')
    expect(humanizeCron('0 * * * *')).toBe('매시 00분')
    expect(humanizeCron('0 9 * * *')).toBe('매일 09:00')
    expect(humanizeCron('0 9 * * 1-5')).toBe('평일 09:00')
    expect(humanizeCron('0 9 * * 1')).toBe('매주 월 09:00')
  })

  it('falls back to the raw cron string when it cannot express the schedule simply', () => {
    expect(humanizeCron('0 9 15 * *')).toBe('0 9 15 * *')
    expect(humanizeCron('0 9,17 * * *')).toBe('0 9,17 * * *')
  })
})

describe('FlowsView', () => {
  let flows: Flow[]

  const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/flows' && method === 'GET') return jsonResponse(flows)
    if (url === '/agents/profiles') return jsonResponse(PROFILES)
    if (url === '/agents/providers') return jsonResponse(PROVIDERS)

    const enableMatch = url.match(/^\/flows\/([^/]+)\/enable$/)
    if (enableMatch && method === 'POST') {
      const f = flows.find(x => x.name === decodeURIComponent(enableMatch[1]))
      if (f) f.enabled = true
      return jsonResponse({ success: true })
    }
    const disableMatch = url.match(/^\/flows\/([^/]+)\/disable$/)
    if (disableMatch && method === 'POST') {
      const f = flows.find(x => x.name === decodeURIComponent(disableMatch[1]))
      if (f) f.enabled = false
      return jsonResponse({ success: true })
    }
    const runMatch = url.match(/^\/flows\/([^/]+)\/run$/)
    if (runMatch && method === 'POST') return jsonResponse({ executed: true })

    const deleteMatch = url.match(/^\/flows\/([^/]+)$/)
    if (deleteMatch && method === 'DELETE') {
      flows = flows.filter(x => x.name !== decodeURIComponent(deleteMatch[1]))
      return jsonResponse({ success: true, deleted: [], errors: [] })
    }

    if (url === '/flows' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}')
      const created: Flow = {
        name: body.name,
        file_path: `/x/${body.name}.flow.md`,
        schedule: body.schedule,
        agent_profile: body.agent_profile,
        provider: body.provider ?? 'kiro_cli',
        script: null,
        last_run: null,
        next_run: null,
        enabled: true,
        prompt_template: body.prompt_template,
      }
      flows = [...flows, created]
      return jsonResponse(created, 201)
    }
    return jsonResponse({ detail: `unhandled in test: ${method} ${url}` }, 404)
  })

  beforeEach(() => {
    flows = makeFlows()
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders flow rows with humanized schedule, agent, and last/next run', async () => {
    render(<FlowsView />)
    expect(await screen.findByText('morning-standup')).toBeInTheDocument()
    expect(screen.getByText(/평일 09:00/)).toBeInTheDocument()
    expect(screen.getByText('weekly-report')).toBeInTheDocument()
    // Active/total stat derives from real `enabled` flags only (1 of 2 here).
    expect(screen.getByText('활성 Flow')).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.textContent === '1/2')).toBeInTheDocument()
  })

  it('shows an empty state with no flows', async () => {
    flows = []
    render(<FlowsView />)
    expect(await screen.findByText('등록된 Flow가 없어요')).toBeInTheDocument()
  })

  it('toggles a flow enabled/disabled via the real enable/disable endpoints', async () => {
    render(<FlowsView />)
    const toggle = await screen.findByRole('switch', { name: 'weekly-report 활성화' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/flows/weekly-report/enable', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'weekly-report 비활성화' })).toHaveAttribute('aria-checked', 'true'))
  })

  it('runs a flow now via the run endpoint', async () => {
    render(<FlowsView />)
    const runButton = await screen.findByRole('button', { name: 'morning-standup 지금 실행' })
    fireEvent.click(runButton)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/flows/morning-standup/run', expect.objectContaining({ method: 'POST' })))
  })

  it('deletes a flow after confirming', async () => {
    render(<FlowsView />)
    fireEvent.click(await screen.findByRole('button', { name: 'morning-standup 삭제' }))

    const confirmDialog = await screen.findByRole('dialog', { name: 'Flow 삭제 확인' })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/flows/morning-standup', expect.objectContaining({ method: 'DELETE' })))
    await waitFor(() => expect(screen.queryByText('morning-standup')).not.toBeInTheDocument())
  })

  it('creates a new flow through the modal, matching createFlow API fields', async () => {
    render(<FlowsView />)
    fireEvent.click(await screen.findByRole('button', { name: '새 Flow' }))
    const dialog = await screen.findByRole('dialog', { name: '새 Flow' })

    fireEvent.change(within(dialog).getByLabelText('이름'), { target: { value: 'nightly-regression' } })
    fireEvent.change(within(dialog).getByLabelText('실행할 에이전트'), { target: { value: 'codex_docs_luna' } })
    fireEvent.change(within(dialog).getByLabelText('프롬프트 템플릿'), { target: { value: '회귀 위험을 요약해줘' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Flow 만들기' }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/flows',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'nightly-regression',
            schedule: '0 9 * * 1-5',
            agent_profile: 'codex_docs_luna',
            provider: 'codex',
            prompt_template: '회귀 위험을 요약해줘',
          }),
        }),
      ),
    )
    expect(await screen.findByText('nightly-regression')).toBeInTheDocument()
  })
})
