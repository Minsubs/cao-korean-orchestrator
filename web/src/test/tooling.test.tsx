import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ToolingView } from '../features/tooling/ToolingView'
import type { ToolingDiagnostic, ToolingEnvironment, ToolingExtension, ToolingProvider } from '../api.tooling'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: () => Promise.resolve(data),
  }
}

const FULL_ENVIRONMENT: ToolingEnvironment = {
  os: 'macOS',
  os_version: '15.5',
  arch: 'arm64',
  shell: '/bin/zsh',
  is_wsl: false,
  server_version: 'v2.3.0',
  python_version: '3.11.4',
  checked_at: '2026-07-17T10:00:00Z',
}

const NULL_ENVIRONMENT: ToolingEnvironment = {
  os: null,
  os_version: null,
  arch: null,
  shell: null,
  is_wsl: null,
  server_version: null,
  python_version: null,
  checked_at: null,
}

const PROVIDERS: ToolingProvider[] = [
  {
    name: 'claude_code',
    display_name: 'Claude Code',
    binary: 'claude',
    installed: true,
    path: '/opt/homebrew/bin/claude',
    version: '2.1.211',
    version_error: null,
    checked_at: '2026-07-17T10:00:00Z',
  },
  {
    name: 'codex',
    display_name: 'Codex CLI',
    binary: 'codex',
    installed: true,
    path: '/opt/homebrew/bin/codex',
    version: null,
    version_error: 'exit code 1',
    checked_at: '2026-07-17T10:00:00Z',
  },
  {
    name: 'kiro_cli',
    display_name: 'Kiro CLI',
    binary: 'kiro',
    installed: false,
    path: null,
    version: null,
    version_error: null,
    checked_at: null,
  },
]

const EXTENSIONS: ToolingExtension[] = [
  {
    id: 'ext-frontend-design',
    kind: 'plugin',
    name: 'frontend-design',
    description: '고품질 프런트엔드 UI 생성 스킬 팩',
    scope: 'user',
    source_path: '/Users/dev/.claude/plugins/frontend-design',
    provider: 'claude_code',
    enabled: true,
  },
  {
    id: 'ext-supervisor',
    kind: 'skill',
    name: 'cao-supervisor-protocols',
    description: 'Supervisor 오케스트레이션 프로토콜',
    scope: 'built-in',
    source_path: '/opt/cao/skills/cao-supervisor-protocols',
    provider: 'claude_code',
    enabled: true,
  },
  {
    id: 'ext-profile',
    kind: 'profile',
    name: 'codex_orchestrator_sol',
    description: '오케스트레이션 총괄 Supervisor 프로필',
    scope: 'user',
    source_path: '/Users/dev/.cao/agent-profiles/codex_orchestrator_sol.md',
    provider: 'codex',
    enabled: false,
  },
]

const DIAGNOSTICS: ToolingDiagnostic[] = [
  {
    severity: 'error',
    code: 'mcp_exec_fail',
    title: 'MCP Server 실행 실패 — context7',
    cause: 'npx 실행 시 Node 22 필요 — 현재 PATH의 Node는 v18',
    impact: 'Codex 세션에서 context7 도구 사용 불가',
    recommendation: 'Node 22로 전환 후 재검사',
    provider: 'codex',
    path: null,
  },
  {
    severity: 'warning',
    code: 'hook_needs_restart',
    title: '새 세션 필요 — fmt-on-save Hook',
    cause: 'Hook 설치 후 세션이 재시작되지 않음',
    impact: '현재 세션에는 적용되지 않아요',
    recommendation: '작업이 끝난 뒤 세션을 새로 시작하세요',
    provider: null,
    path: null,
  },
]

describe('ToolingView', () => {
  let environment: ToolingEnvironment
  let providers: ToolingProvider[]
  let extensions: ToolingExtension[]
  let diagnostics: ToolingDiagnostic[]
  let failEndpoint: string | null
  let scanCalls: number
  let scannedAtResponse: string

  const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (failEndpoint && url === failEndpoint) return jsonResponse({ detail: 'not found' }, 404)
    if (url === '/tooling/environment') return jsonResponse(environment)
    if (url === '/tooling/providers') return jsonResponse(providers)
    if (url === '/tooling/extensions') return jsonResponse(extensions)
    if (url === '/tooling/diagnostics') return jsonResponse(diagnostics)
    if (url === '/tooling/scan' && init?.method === 'POST') {
      scanCalls++
      return jsonResponse({ scanned_at: scannedAtResponse })
    }
    return jsonResponse({ detail: 'unhandled in test' }, 404)
  })

  beforeEach(() => {
    environment = { ...FULL_ENVIRONMENT }
    providers = PROVIDERS.map(p => ({ ...p }))
    extensions = EXTENSIONS.map(e => ({ ...e }))
    diagnostics = DIAGNOSTICS.map(d => ({ ...d }))
    failEndpoint = null
    scanCalls = 0
    scannedAtResponse = '2026-07-17T12:30:00Z'
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Overview ────────────────────────────────────────────────────────────
  it('renders overview stats, environment card, and detected CLI list', async () => {
    render(<ToolingView />)
    expect(await screen.findByRole('heading', { name: /도구 및 확장/ })).toBeInTheDocument()

    // Stat chips: 2/3 CLIs detected, 3 extensions installed, 1 non-info diagnostic warning (error counts too)
    expect(screen.getByText('설치된 확장').previousElementSibling).toHaveTextContent('3')
    expect(screen.getByText('진단 경고').previousElementSibling).toHaveTextContent('2')

    // Environment card
    expect(screen.getByText('macOS 15.5')).toBeInTheDocument()
    expect(screen.getByText('arm64')).toBeInTheDocument()
    expect(screen.getByText('/bin/zsh')).toBeInTheDocument()
    expect(screen.getByText('아니오')).toBeInTheDocument() // is_wsl: false
    expect(screen.getByText('v2.3.0')).toBeInTheDocument()

    // Detected CLI list: installed with version, installed with version_error, not installed
    const cliList = screen.getByRole('list', { name: '감지된 AI CLI 목록' })
    expect(within(cliList).getByText('Claude Code')).toBeInTheDocument()
    expect(within(cliList).getByText('2.1.211')).toBeInTheDocument()
    expect(within(cliList).getByText('Codex CLI')).toBeInTheDocument()
    expect(within(cliList).getByText('exit code 1')).toBeInTheDocument()
    expect(within(cliList).getByText('Kiro CLI')).toBeInTheDocument()
    expect(within(cliList).getAllByText('미설치').length).toBe(1)
    expect(within(cliList).getAllByText('설치됨').length).toBe(2)
  })

  it('shows "확인할 수 없음" for every null environment field', async () => {
    environment = { ...NULL_ENVIRONMENT }
    render(<ToolingView />)
    await screen.findByRole('heading', { name: /도구 및 확장/ })

    // OS, Architecture, Shell, WSL 여부, 서버 버전 — all five null fields
    expect(screen.getAllByText('확인할 수 없음').length).toBeGreaterThanOrEqual(5)
  })

  // ── Installed (filter / search / select→detail) ────────────────────────
  it('filters, searches, and shows selected-extension detail in the Installed tab', async () => {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /설치됨/ }))

    // All three extensions visible initially
    expect(await screen.findByRole('option', { name: /frontend-design/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /cao-supervisor-protocols/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /codex_orchestrator_sol/ })).toBeInTheDocument()

    // Filter: keep only the Plugin kind checkbox checked
    fireEvent.click(screen.getByRole('checkbox', { name: /Skill/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Profile/ }))
    expect(screen.getByRole('option', { name: /frontend-design/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /cao-supervisor-protocols/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /codex_orchestrator_sol/ })).not.toBeInTheDocument()

    // Re-check Skill/Profile to restore the full list before searching
    fireEvent.click(screen.getByRole('checkbox', { name: /Skill/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Profile/ }))
    expect(await screen.findByRole('option', { name: /codex_orchestrator_sol/ })).toBeInTheDocument()

    // Search (debounced 200ms)
    fireEvent.change(screen.getByLabelText('설치된 확장 검색'), { target: { value: 'supervisor' } })
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /frontend-design/ })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: /cao-supervisor-protocols/ })).toBeInTheDocument()

    // Select → detail pane shows the full record
    fireEvent.click(screen.getByRole('option', { name: /cao-supervisor-protocols/ }))
    expect(screen.getByText('ext-supervisor')).toBeInTheDocument()
    expect(screen.getByText('/opt/cao/skills/cao-supervisor-protocols')).toBeInTheDocument()
    // Phase 4b: kind=skill now gets real [업데이트]/[삭제] buttons gated on the
    // generic_skills adapter's capabilities (replacing the old static "Phase 4"
    // placeholder). This test's fetch mock doesn't serve /tooling/adapters, so
    // they're honestly disabled with a reason rather than silently missing.
    const updateBtn = await screen.findByRole('button', { name: '최신화' })
    expect(updateBtn).toBeDisabled()
    expect(updateBtn).toHaveAttribute('title', '어댑터 정보를 불러오지 못했어요')
  })

  // ── Diagnostics ─────────────────────────────────────────────────────────
  it('shows the empty state when there are no diagnostics', async () => {
    diagnostics = []
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /진단/ }))
    expect(await screen.findByText('발견된 문제가 없어요 ✨')).toBeInTheDocument()
  })

  it('renders diagnostic cards with severity, cause, impact, and recommendation', async () => {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /진단/ }))
    expect(await screen.findByText('MCP Server 실행 실패 — context7')).toBeInTheDocument()
    expect(screen.getByText(/npx 실행 시 Node 22 필요/)).toBeInTheDocument()
    expect(screen.getByText('오류')).toBeInTheDocument()
    expect(screen.getByText('경고')).toBeInTheDocument()
  })

  // ── All tabs active (Phase 6c) ──────────────────────────────────────────
  // Phase 5b activated 탐색; Phase 6c activates the last two (소스/환경
  // 프로필 — see test/tooling-sources.test.tsx and
  // test/tooling-envprofiles.test.tsx for their own tab content) — no tab is
  // disabled anymore.
  it('renders every tab as enabled and switches into 소스/환경 프로필 on click', async () => {
    window.localStorage.removeItem('cao:env-profiles:v1')
    render(<ToolingView />)
    await screen.findByRole('heading', { name: /도구 및 확장/ })

    // Query the full tablist rather than name-matching each label — several
    // tabs (설치됨/진단) carry a count badge that gets folded into their
    // accessible name, so an exact-string match per label is brittle here.
    const tablist = screen.getByRole('tablist', { name: '도구 및 확장 하위 탭' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs).toHaveLength(7)
    for (const t of tabs) {
      expect(t).not.toBeDisabled()
      expect(t).not.toHaveAttribute('title', 'Phase 4~6에서 제공돼요')
    }

    // 소스: this file's fetch mock doesn't implement /tooling/sources, so the
    // tab honestly degrades to its own error state (same availability stance
    // as every other Tooling endpoint) rather than blocking navigation.
    fireEvent.click(screen.getByRole('tab', { name: /^소스/ }))
    expect(screen.getByRole('tab', { name: /^소스/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Tooling API에 연결할 수 없어요')).toBeInTheDocument()

    // 환경 프로필: no fetch on mount (스냅샷 생성 is user-triggered) — renders immediately.
    fireEvent.click(screen.getByRole('tab', { name: /^환경 프로필/ }))
    expect(screen.getByRole('tab', { name: /^환경 프로필/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('저장된 스냅샷이 없어요')).toBeInTheDocument()
  })

  // ── Availability defense ────────────────────────────────────────────────
  it('shows a full-screen error state when a Tooling endpoint 404s, with no mock fallback', async () => {
    failEndpoint = '/tooling/diagnostics'
    render(<ToolingView />)
    expect(await screen.findByText('Tooling API에 연결할 수 없어요')).toBeInTheDocument()
    expect(screen.getByText('서버 버전을 확인하세요')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /개요/ })).not.toBeInTheDocument()
    // No fixture data leaks into the error screen
    expect(screen.queryByText('frontend-design')).not.toBeInTheDocument()
  })

  it('recovers from the error state when "다시 시도" succeeds', async () => {
    failEndpoint = '/tooling/diagnostics'
    render(<ToolingView />)
    const retry = await screen.findByRole('button', { name: '다시 시도' })
    failEndpoint = null
    fireEvent.click(retry)
    expect(await screen.findByRole('heading', { name: /도구 및 확장/ })).toBeInTheDocument()
  })

  // ── Manual rescan ───────────────────────────────────────────────────────
  it('re-fetches all Tooling data and updates the last-scanned stat after "다시 검사"', async () => {
    render(<ToolingView />)
    await screen.findByRole('heading', { name: /도구 및 확장/ })
    const callsBeforeRescan = mockFetch.mock.calls.filter(c => c[0] === '/tooling/environment').length

    fireEvent.click(screen.getByRole('button', { name: '다시 검사' }))
    expect(screen.getByRole('button', { name: '검사 중...' })).toBeDisabled()

    await waitFor(() => expect(scanCalls).toBe(1))
    await waitFor(() => {
      const callsAfter = mockFetch.mock.calls.filter(c => c[0] === '/tooling/environment').length
      expect(callsAfter).toBe(callsBeforeRescan + 1)
    })
    await screen.findByRole('button', { name: '다시 검사' })
    expect(screen.getByText(new Date(scannedAtResponse).toLocaleString('ko-KR'))).toBeInTheDocument()
  })
})
