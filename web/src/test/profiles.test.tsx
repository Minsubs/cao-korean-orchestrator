import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ProfilesView } from '../features/profiles/ProfilesView'
import type { AgentProfileInfo, ProviderInfo } from '../api'
import type { ModelCatalogEntry } from '../api.profiles'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: () => Promise.resolve(data),
  }
}

const PROFILES: AgentProfileInfo[] = [
  { name: 'codex_orchestrator_sol', description: 'Sol orchestrator for multi-agent routing', source: 'built-in' },
  {
    name: 'claude_developer_sonnet',
    description: 'Sonnet primary developer for implementation',
    source: 'user',
    duplicated_in: ['/opt/other/agent-profiles'],
  },
]

const PROVIDERS: ProviderInfo[] = [
  { name: 'claude_code', binary: 'claude', installed: true },
  { name: 'codex', binary: 'codex', installed: false },
]

const MODEL_CATALOG: ModelCatalogEntry[] = [
  { provider: 'claude_code', source: 'known', models: [{ name: 'sonnet' }, { name: 'opus' }], probed_at: null },
]

describe('ProfilesView', () => {
  let modelsFail = false

  const mockFetch = vi.fn(async (url: string) => {
    if (url === '/agents/profiles') return jsonResponse(PROFILES)
    if (url === '/agents/providers') return jsonResponse(PROVIDERS)
    if (url === '/tooling/models') {
      if (modelsFail) return jsonResponse({ detail: 'not found' }, 404)
      return jsonResponse(MODEL_CATALOG)
    }
    return jsonResponse({ detail: `unhandled in test: ${url}` }, 404)
  })

  beforeEach(() => {
    modelsFail = false
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders profile cards from real data only — no invented role/model badges', async () => {
    render(<ProfilesView />)
    expect(await screen.findByText('codex_orchestrator_sol')).toBeInTheDocument()
    expect(screen.getByText('claude_developer_sonnet')).toBeInTheDocument()
    expect(screen.getByText(/Sol orchestrator for multi-agent routing/)).toBeInTheDocument()
    // duplicated_in surfaces as a warning chip
    const dupChip = screen.getByText(/중복 1건/)
    expect(dupChip).toBeInTheDocument()
    // Feedback #4: the chip's tooltip names the actual duplicate directories, not just the count.
    expect(dupChip).toHaveAttribute('title', expect.stringContaining('/opt/other/agent-profiles'))
    // the profile list endpoint has no role field — must not be guessed onto
    // the card grid (the Add Agent modal isn't open, so 'Supervisor' — a
    // role-card label — must not appear anywhere yet).
    expect(screen.queryByText('Supervisor')).not.toBeInTheDocument()
  })

  it('feedback #6: renders the nullable model/provider fields distinctly from the source/scope chip, and "—" when absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/agents/profiles') {
          return jsonResponse([
            { name: 'has_model', description: 'x', source: 'user', provider: 'claude_code', model: 'sonnet' },
            { name: 'no_model', description: 'y', source: 'built-in', provider: null, model: null },
          ])
        }
        if (url === '/agents/providers') return jsonResponse(PROVIDERS)
        if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
        return jsonResponse({ detail: 'unhandled' }, 404)
      }),
    )
    render(<ProfilesView />)

    expect(await screen.findByText('has_model')).toBeInTheDocument()
    // Scoped to the card itself — 'sonnet' also legitimately appears in the
    // (separate) model catalog section below from the shared MODEL_CATALOG fixture.
    const hasModelCard = screen.getByTestId('profile-card-has_model')
    expect(within(hasModelCard).getByText('sonnet')).toBeInTheDocument()
    expect(within(hasModelCard).getByText('claude_code')).toBeInTheDocument()

    // The other profile has neither field — both render '—', never guessed.
    const noModelCard = screen.getByTestId('profile-card-no_model')
    expect(within(noModelCard).getAllByText('—')).toHaveLength(2)
  })

  it('shows an empty state when there are no installed profiles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/agents/profiles') return jsonResponse([])
        if (url === '/agents/providers') return jsonResponse(PROVIDERS)
        if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
        return jsonResponse({ detail: 'unhandled' }, 404)
      }),
    )
    render(<ProfilesView />)
    expect(await screen.findByText('설치된 에이전트 프로필이 없어요')).toBeInTheDocument()
  })

  it('renders the model catalog grouped by provider when the endpoint succeeds', async () => {
    render(<ProfilesView />)
    expect(await screen.findByText('모델 카탈로그')).toBeInTheDocument()
    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('sonnet')).toBeInTheDocument()
    expect(screen.getByText('opus')).toBeInTheDocument()
  })

  it('degrades honestly (no mock data) when the model catalog endpoint is unavailable', async () => {
    modelsFail = true
    render(<ProfilesView />)
    expect(await screen.findByText('모델 목록을 조회할 수 없어요 — 직접 입력하세요')).toBeInTheDocument()
  })

  it('auto-generates the description from role + specialty and updates it as either changes', async () => {
    render(<ProfilesView />)
    fireEvent.click(await screen.findByRole('button', { name: '에이전트 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })

    // Default role (Supervisor) -> first specialty auto-fills the description.
    const description = within(dialog).getByLabelText('에이전트 설명 (description)') as HTMLTextAreaElement
    await waitFor(() => expect(description.value).toContain('범용 오케스트레이션'))
    expect(description.value).toContain('요청을 분석해 계획을 세우고')

    // Switching role resets specialty to that role's first option and regenerates the description.
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Developer' }))
    expect(within(dialog).getByLabelText('전문 분야 (Specialty)')).toHaveValue('Web Developer (Frontend)')
    expect(description.value).toContain('Web Developer (Frontend)')

    // Changing specialty (same role) also regenerates the description.
    fireEvent.change(within(dialog).getByLabelText('전문 분야 (Specialty)'), { target: { value: 'Backend Developer (API 서버)' } })
    expect(description.value).toContain('Backend Developer (API 서버)')
    expect(description.value).toContain('API 서버·비즈니스 로직')
  })

  it('degrades the model field to free text inside the Add Agent modal when the catalog is unavailable', async () => {
    modelsFail = true
    render(<ProfilesView />)
    fireEvent.click(await screen.findByRole('button', { name: '에이전트 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })
    await waitFor(() => expect(within(dialog).getByText('모델 목록을 조회할 수 없어요 — 직접 입력하세요')).toBeInTheDocument())
    // Degraded state means "모델" is a free-text input, not a <select>.
    const modelField = within(dialog).getByLabelText('모델')
    expect(modelField.tagName).toBe('INPUT')
  })

  it('never calls the install API for a freshly generated profile — it degrades to a download + copyable CLI command', async () => {
    render(<ProfilesView />)
    fireEvent.click(await screen.findByRole('button', { name: '에이전트 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })

    fireEvent.change(within(dialog).getByLabelText('이름'), { target: { value: 'nova' } })
    const createButton = within(dialog).getByRole('button', { name: '에이전트 만들기' })
    await waitFor(() => expect(createButton).toBeEnabled())

    fireEvent.click(createButton)

    expect(await within(dialog).findByText(/nova\.md 다운로드/)).toBeInTheDocument()
    expect(within(dialog).getByText(/cao install \.\/nova\.md --provider/)).toBeInTheDocument()
    // Confirmed by reading install_service.py: the real endpoint can't accept
    // inline content, so the modal must never call it for this flow.
    expect(mockFetch).not.toHaveBeenCalledWith('/agents/profiles/install', expect.anything())
  })

  it('feedback #8: the Provider 표시 설정 popover hides an unchecked provider from the model catalog and persists the choice', async () => {
    render(<ProfilesView />)
    expect(await screen.findByText('모델 카탈로그')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Provider 표시 설정' }))
    const popover = await screen.findByRole('dialog', { name: 'Provider 표시 설정' })
    fireEvent.click(within(popover).getByRole('checkbox', { name: 'Claude Code' }))
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))

    await waitFor(() => expect(screen.queryByText('Claude Code')).not.toBeInTheDocument())
    const stored = JSON.parse(window.localStorage.getItem('cao:hidden-providers:v1') || '[]')
    expect(stored).toContain('claude_code')

    // Does not touch the profile card grid — a profile's source/scope chip is a different concept from provider.
    expect(screen.getByText('codex_orchestrator_sol')).toBeInTheDocument()
  })

  it('feedback #2: 프로필 수정 loads the full detail, prefills the form, and saves via installAgentProfileContent with overwrite:true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (url === '/agents/profiles' && opts?.method === 'POST') return jsonResponse({ success: true, message: 'ok' })
        if (url === '/agents/profiles') return jsonResponse(PROFILES)
        if (url === '/agents/providers') return jsonResponse(PROVIDERS)
        if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
        if (url === '/agents/profiles/codex_orchestrator_sol') {
          // Real shape of GET /agents/profiles/{name}: AgentProfile
          // model_dump(exclude_none) — body is `system_prompt`, no `source`,
          // and arbitrary frontmatter keys (mcpServers, allowedTools, role)
          // ride along and must survive a save untouched.
          return jsonResponse({
            name: 'codex_orchestrator_sol',
            description: 'Sol orchestrator for multi-agent routing',
            provider: 'codex',
            model: 'gpt-5',
            role: 'supervisor',
            system_prompt: 'You are Sol, the orchestrator.',
            mcpServers: { 'cao-mcp-server': { type: 'stdio', command: 'cao-mcp-server', args: [] } },
            allowedTools: ['fs_read', 'execute_bash'],
          })
        }
        return jsonResponse({ detail: `unhandled: ${url}` }, 404)
      }),
    )
    render(<ProfilesView />)

    fireEvent.click(await screen.findByRole('button', { name: 'codex_orchestrator_sol 프로필 수정' }))
    const dialog = await screen.findByRole('dialog', { name: 'codex_orchestrator_sol 프로필 수정' })

    const description = await within(dialog).findByLabelText('설명')
    expect(description).toHaveValue('Sol orchestrator for multi-agent routing')
    expect(within(dialog).getByLabelText('모델')).toHaveValue('gpt-5')
    expect(within(dialog).getByLabelText('이름')).toBeDisabled()
    expect(within(dialog).getByLabelText(/프롬프트/)).toHaveValue('You are Sol, the orchestrator.')
    // Honest disclosure: only the shown fields are editable, the rest is preserved.
    expect(within(dialog).getByText(/나머지 설정\(mcpServers, allowedTools 등\)은 그대로 보존/)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('모델'), { target: { value: 'gpt-5.1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => {
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u, o]) => u === '/agents/profiles' && (o as RequestInit)?.method === 'POST')
      expect(call).toBeTruthy()
    })
    const [, postOpts] = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u, o]) => u === '/agents/profiles' && (o as RequestInit)?.method === 'POST')!
    const body = JSON.parse((postOpts as RequestInit).body as string)
    expect(body.overwrite).toBe(true)
    expect(body.name).toBe('codex_orchestrator_sol')
    expect(body.content).toContain('gpt-5.1')
    // Round-trip guarantee: frontmatter the form doesn't edit is re-emitted,
    // not dropped — stripping mcpServers would disconnect the profile from
    // the orchestration MCP tools on its next launch.
    expect(body.content).toContain('mcpServers: {"cao-mcp-server":{"type":"stdio","command":"cao-mcp-server","args":[]}}')
    expect(body.content).toContain('allowedTools: ["fs_read","execute_bash"]')
    expect(body.content).toContain('role: "supervisor"')
    expect(body.content).toContain('provider: codex')
    expect(body.content).toContain('You are Sol, the orchestrator.')
  })

  it('feedback #2: degrades honestly when the profile detail endpoint is unavailable — no fabricated prefill, save disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/agents/profiles') return jsonResponse(PROFILES)
        if (url === '/agents/providers') return jsonResponse(PROVIDERS)
        if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
        if (url === '/agents/profiles/codex_orchestrator_sol') return jsonResponse({ detail: 'not found' }, 404)
        return jsonResponse({ detail: `unhandled: ${url}` }, 404)
      }),
    )
    render(<ProfilesView />)

    fireEvent.click(await screen.findByRole('button', { name: 'codex_orchestrator_sol 프로필 수정' }))
    const dialog = await screen.findByRole('dialog', { name: 'codex_orchestrator_sol 프로필 수정' })

    expect(await within(dialog).findByText(/프로필 상세 정보를 불러오지 못했어요/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '저장' })).toBeDisabled()
  })
})
