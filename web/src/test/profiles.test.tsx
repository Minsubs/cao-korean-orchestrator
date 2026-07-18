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
  { name: 'my_release_helper', description: 'Custom release helper', source: 'custom' },
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
    expect(screen.getByText(/작업을 나누고 Codex·Claude 팀의 결과를 종합/)).toBeInTheDocument()
    expect(screen.getByText('기본 AI 팀')).toBeInTheDocument()
    expect(screen.getByText('추가 에이전트')).toBeInTheDocument()
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

  it('does not flag packaged execution mirrors as duplicate user profiles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/agents/profiles') {
          return jsonResponse([
            {
              name: 'codex_orchestrator_sol',
              description: 'Sol orchestrator',
              source: 'local',
              duplicated_in: ['installed', 'built-in'],
            },
            {
              name: 'developer',
              description: 'Developer example',
              source: 'installed',
              duplicated_in: ['built-in'],
            },
          ])
        }
        if (url === '/agents/providers') return jsonResponse(PROVIDERS)
        if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
        return jsonResponse({ detail: 'unhandled' }, 404)
      }),
    )

    render(<ProfilesView />)
    expect(await screen.findByText('codex_orchestrator_sol')).toBeInTheDocument()
    expect(screen.getByText('developer')).toBeInTheDocument()
    expect(screen.queryByText(/중복/)).not.toBeInTheDocument()
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
    expect(within(hasModelCard).getByText('Claude Code')).toBeInTheDocument()

    // The other profile has no model and explains that its execution AI is profile-resolved.
    const noModelCard = screen.getByTestId('profile-card-no_model')
    expect(within(noModelCard).getByText('—')).toBeInTheDocument()
    expect(within(noModelCard).getByText('프로필에서 자동 결정')).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: '에이전트 만들기' }))
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
    fireEvent.click(await screen.findByRole('button', { name: '에이전트 만들기' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })
    await waitFor(() => expect(within(dialog).getByText('모델 목록을 조회할 수 없어요 — 직접 입력하세요')).toBeInTheDocument())
    // Degraded state means "모델" is a free-text input, not a <select>.
    const modelField = within(dialog).getByLabelText('모델')
    expect(modelField.tagName).toBe('INPUT')
  })

  it('installs a freshly generated profile and refreshes the list in one action', async () => {
    let installed = false
    const installBodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (url === '/agents/profiles' && opts?.method === 'POST') {
          installed = true
          installBodies.push(JSON.parse(String(opts.body)))
          return jsonResponse({ success: true, message: 'installed' })
        }
        if (url === '/agents/profiles') {
          return jsonResponse(
            installed
              ? [
                  ...PROFILES,
                  {
                    name: 'nova',
                    description: 'new supervisor',
                    source: 'local',
                    provider: 'claude_code',
                    model: 'sonnet',
                    ui_role: 'Supervisor',
                    specialty: '범용 오케스트레이션',
                  },
                ]
              : PROFILES,
          )
        }
        if (url === '/agents/providers') return jsonResponse(PROVIDERS)
        if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
        return jsonResponse({ detail: `unhandled in test: ${url}` }, 404)
      }),
    )

    render(<ProfilesView />)
    fireEvent.click(await screen.findByRole('button', { name: '에이전트 만들기' }))
    const dialog = await screen.findByRole('dialog', { name: '에이전트 추가' })

    fireEvent.change(within(dialog).getByLabelText('이름'), { target: { value: 'nova' } })
    const createButton = within(dialog).getByRole('button', { name: '에이전트 만들기' })
    await waitFor(() => expect(createButton).toBeEnabled())

    fireEvent.click(createButton)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '에이전트 추가' })).not.toBeInTheDocument())
    expect(await screen.findByTestId('profile-card-nova')).toBeInTheDocument()
    expect(installBodies[0]).toMatchObject({ name: 'nova', provider: 'claude_code' })
    expect(String(installBodies[0]?.content)).toContain('uiRole: "Supervisor"')
    expect(String(installBodies[0]?.content)).toContain('specialty:')
  })

  it('splits the default team into orchestrator and worker responsibility groups', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/agents/profiles') {
          return jsonResponse([
            { name: 'codex_orchestrator_sol', description: 'orchestrator', source: 'built-in' },
            { name: 'claude_scout_haiku', description: 'scout', source: 'built-in' },
            { name: 'claude_developer_sonnet', description: 'developer', source: 'built-in' },
            { name: 'codex_qa_terra', description: 'qa', source: 'built-in' },
          ])
        }
        if (url === '/agents/providers') return jsonResponse(PROVIDERS)
        if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
        return jsonResponse({ detail: `unhandled in test: ${url}` }, 404)
      }),
    )

    render(<ProfilesView />)

    expect(await screen.findByText('고정 오케스트레이터')).toBeInTheDocument()
    expect(screen.getByText('탐색·설계')).toBeInTheDocument()
    expect(screen.getByText('구현')).toBeInTheDocument()
    expect(screen.getByText('검증·문서')).toBeInTheDocument()
  })

  it('keeps native Claude specialist agents separate and groups them by their detailed role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/agents/profiles') {
          return jsonResponse([
            { name: 'frontend-developer', description: 'Frontend specialist', source: 'claude_code', provider: 'claude_code' },
            { name: 'backend-developer', description: 'Backend specialist', source: 'claude_code', provider: 'claude_code' },
            { name: 'observability-engineer', description: 'Observability specialist', source: 'claude_code', provider: 'claude_code' },
          ])
        }
        if (url === '/agents/providers') return jsonResponse(PROVIDERS)
        if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
        return jsonResponse({ detail: `unhandled in test: ${url}` }, 404)
      }),
    )

    render(<ProfilesView />)

    expect(await screen.findByTestId('profile-card-frontend-developer')).toBeInTheDocument()
    expect(screen.getByTestId('profile-card-backend-developer')).toBeInTheDocument()
    expect(screen.getByTestId('profile-card-observability-engineer')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '개발·구현' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '운영·관측' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '기타' })).not.toBeInTheDocument()
  })

  it('feedback #8: the Provider 표시 설정 popover hides an unchecked provider from the model catalog and persists the choice', async () => {
    render(<ProfilesView />)
    expect(await screen.findByText('모델 카탈로그')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '실행 AI 표시 설정' }))
    const popover = await screen.findByRole('dialog', { name: '실행 AI 표시 설정' })
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
