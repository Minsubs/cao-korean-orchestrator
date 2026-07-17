import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ToolingView } from '../features/tooling/ToolingView'
import type {
  CatalogProviderSupport,
  CatalogItem,
  ToolingAdapter,
  ToolingDiagnostic,
  ToolingEnvironment,
  ToolingExecutionPlan,
  ToolingExtension,
  ToolingOperation,
  ToolingProvider,
} from '../api.tooling'

// Phase 5b — 탐색 탭(카탈로그 브라우즈+설치) + 설치됨 탭 확장(provider-native
// mcp 항목). Companion to test/tooling.test.tsx (3b read path) and
// test/tooling-updates.test.tsx (4b write path): this file covers only what's
// new in 5b. The install flow itself (plan→Preview→execute→Queue) is the
// *same* plumbing 4b already tests end-to-end — here we only confirm a
// catalog install feeds into it correctly, not re-litigate the flow itself.

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error',
    json: () => Promise.resolve(data),
  }
}

function bodyOf(call: [string, RequestInit?] | undefined): Record<string, unknown> {
  const init = call?.[1]
  return JSON.parse((init?.body as string) ?? '{}')
}

const ENVIRONMENT: ToolingEnvironment = {
  os: 'macOS',
  os_version: '15.5',
  arch: 'arm64',
  shell: '/bin/zsh',
  is_wsl: false,
  server_version: 'v2.3.0',
  python_version: '3.11.4',
  checked_at: '2026-07-17T10:00:00Z',
}
const PROVIDERS: ToolingProvider[] = []
const DIAGNOSTICS: ToolingDiagnostic[] = []

const CODEX_READONLY_REASON = '비대화형 관리 명령이 없어요 — 설정 파일 열기/명령 복사를 이용하세요'

const ADAPTERS: ToolingAdapter[] = [
  {
    id: 'claude_code',
    display_name: 'Claude Code',
    detected: { installed: true, path: '/opt/homebrew/bin/claude', version: '2.1.211' },
    capabilities: {
      canList: true,
      canInstall: true,
      canRemove: true,
      canUpdate: true,
      canUpdateAll: false,
      requiresNewSession: true,
      requiresRestart: false,
      reasons: {},
    },
  },
  {
    id: 'codex',
    display_name: 'Codex CLI',
    detected: { installed: true, path: '/opt/homebrew/bin/codex', version: '1.0.0' },
    capabilities: {
      canList: true,
      canInstall: false,
      canRemove: false,
      canUpdate: false,
      canUpdateAll: false,
      requiresNewSession: false,
      requiresRestart: false,
      reasons: { canInstall: CODEX_READONLY_REASON, canRemove: CODEX_READONLY_REASON, canUpdate: CODEX_READONLY_REASON },
    },
  },
]

// ── 설치됨 탭 확장 fixtures — provider-native mcp 항목 + 기존 plugin 항목 ────
const EXTENSIONS: ToolingExtension[] = [
  {
    id: 'ext-context7-mcp',
    kind: 'mcp',
    name: 'context7',
    description: 'Claude Code에 연결된 context7 MCP 서버',
    scope: 'user',
    source_path: null,
    provider: 'claude_code',
    enabled: true,
  },
  {
    id: 'ext-codex-mcp',
    kind: 'mcp',
    name: 'some-codex-server',
    description: 'Codex에 연결된 MCP 서버',
    scope: 'user',
    source_path: null,
    provider: 'codex',
    enabled: true,
  },
  {
    id: 'ext-plugin',
    kind: 'plugin',
    name: 'frontend-design',
    description: '프런트엔드 플러그인',
    scope: 'user',
    source_path: '/Users/dev/.claude/plugins/frontend-design',
    provider: 'claude_code',
    enabled: true,
  },
]

// ── 탐색 탭 fixtures — 인기 확장 카탈로그 (Phase 5a 실응답 형태) ─────────────
const cliSupport = (
  install_status: CatalogProviderSupport['install_status'] = 'not_installed',
): CatalogProviderSupport => ({
  method: 'cli',
  requires_params: [],
  install_status,
  supported: true,
  reason: null,
})

const CATALOG: CatalogItem[] = [
  {
    id: 'context7',
    name: 'context7',
    description_ko: '최신 라이브러리 문서를 실시간으로 가져오는 MCP 서버예요',
    kind: 'mcp',
    category: '개발 도구',
    providers: ['claude_code', 'codex'],
    homepage: 'https://example.com/context7',
    requires: ['npx'],
    popular: true,
    new_session_required: true,
    warnings: [],
    install: {
      claude_code: { method: 'cli', argv: ['claude', 'mcp', 'add', 'context7'] },
      codex: { method: 'cli', argv: ['codex', 'mcp', 'add', 'context7'] },
    },
    supported: { claude_code: cliSupport(), codex: cliSupport() },
  },
  {
    id: 'filesystem',
    name: 'filesystem',
    description_ko: '지정한 폴더 안에서 파일을 읽고 쓰는 MCP 서버예요',
    kind: 'mcp',
    category: '파일',
    providers: ['claude_code'],
    homepage: null,
    requires: ['npx'],
    popular: false,
    new_session_required: false,
    warnings: [],
    install: { claude_code: { method: 'cli', argv: ['claude', 'mcp', 'add', 'filesystem'] } },
    supported: { claude_code: { ...cliSupport(), requires_params: ['path'] } },
  },
  {
    id: 'code-review-pack',
    name: 'code-review-pack',
    description_ko: '리뷰 체크리스트와 보안 스캔 Skill을 묶은 플러그인이에요',
    kind: 'plugin',
    category: '품질',
    providers: ['claude_code'],
    homepage: 'https://example.com/code-review-pack',
    requires: [],
    popular: true,
    new_session_required: false,
    warnings: [],
    install: {
      claude_code: {
        method: 'manual',
        argv: ['/plugin', 'marketplace', 'add', 'anthropics/claude-plugins'],
      },
    },
    supported: {
      claude_code: {
        method: 'manual',
        requires_params: [],
        install_status: 'not_installed',
        supported: false,
        reason: 'Interactive Plugin Browser에서만 가능 — Terminal에서 여세요',
        command: '/plugin marketplace add anthropics/claude-plugins',
      },
    },
  },
  {
    id: 'docx',
    name: 'docx',
    description_ko: 'Word 문서를 만들고 편집하는 Skill이에요',
    kind: 'skill',
    category: '문서',
    providers: ['claude_code'],
    homepage: null,
    requires: [],
    popular: false,
    new_session_required: true,
    warnings: [],
    install: { claude_code: { method: 'cli', argv: ['skills', 'add', 'docx'] } },
    supported: { claude_code: cliSupport('installed') },
  },
]

const CONTEXT7_PLAN: ToolingExecutionPlan = {
  description: 'context7 MCP 서버를 Claude Code에 추가해요',
  argv: ['claude', 'mcp', 'add', 'context7', '--', 'npx', '-y', '@upstash/context7-mcp'],
  cwd: '/Users/dev',
  verify_description: '설치 후 claude mcp list에 context7이 나타나는지 확인해요',
  warnings: ['새 세션부터 적용돼요'],
}

const FILESYSTEM_PLAN: ToolingExecutionPlan = {
  description: 'filesystem MCP 서버를 Claude Code에 추가해요',
  argv: ['claude', 'mcp', 'add', 'filesystem', '--', 'npx', '@modelcontextprotocol/server-filesystem', 'Documents/mcp-fs'],
  cwd: '/Users/dev',
  verify_description: '설치 후 claude mcp list에 filesystem이 나타나는지 확인해요',
  warnings: [],
}

describe('ToolingView — Phase 5b 탐색 탭 + 설치됨 탭 확장', () => {
  let adapters: ToolingAdapter[]
  let extensions: ToolingExtension[]
  let catalog: CatalogItem[]
  let catalogShouldFail: boolean
  let operations: ToolingOperation[]
  let planResponse: ToolingExecutionPlan
  let nextOperationId: number
  let clipboardWriteText: ReturnType<typeof vi.fn>

  const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url === '/tooling/environment') return jsonResponse(ENVIRONMENT)
    if (url === '/tooling/providers') return jsonResponse(PROVIDERS)
    if (url === '/tooling/extensions') return jsonResponse(extensions)
    if (url === '/tooling/diagnostics') return jsonResponse(DIAGNOSTICS)
    if (url === '/tooling/adapters') return jsonResponse(adapters)
    if (url === '/tooling/catalog') {
      if (catalogShouldFail) return jsonResponse({ detail: 'not found' }, 404)
      return jsonResponse(catalog)
    }

    if (url === '/tooling/plan' && method === 'POST') return jsonResponse(planResponse)

    if (url === '/tooling/execute' && method === 'POST') {
      const body = bodyOf([url, init])
      const id = `op-${nextOperationId++}`
      const op: ToolingOperation = {
        id,
        action: body.action as ToolingOperation['action'],
        provider: body.provider as string,
        target: (body.target as string) ?? null,
        scope: (body.scope as string) ?? null,
        status: 'running',
        created_at: '2026-07-17T14:00:00Z',
        started_at: '2026-07-17T14:00:01Z',
        finished_at: null,
        exit_code: null,
        error: null,
        verified: null,
      }
      operations = [...operations, op]
      return jsonResponse({ operation_id: id })
    }

    if (url === '/tooling/operations' && method === 'GET') return jsonResponse(operations)

    const cancelMatch = url.match(/^\/tooling\/operations\/([^/]+)\/cancel$/)
    if (cancelMatch && method === 'POST') {
      operations = operations.map(o => (o.id === cancelMatch[1] ? { ...o, status: 'cancelled' as const } : o))
      return jsonResponse({ cancelled: true })
    }

    const detailMatch = url.match(/^\/tooling\/operations\/([^/]+)$/)
    if (detailMatch) {
      const op = operations.find(o => o.id === detailMatch[1])
      if (!op) return jsonResponse({ detail: 'not found' }, 404)
      return jsonResponse({ ...op, log: [] })
    }

    return jsonResponse({ detail: 'unhandled in test' }, 404)
  })

  beforeEach(() => {
    adapters = ADAPTERS.map(a => ({ ...a, capabilities: { ...a.capabilities, reasons: { ...a.capabilities.reasons } } }))
    extensions = EXTENSIONS.map(e => ({ ...e }))
    catalog = CATALOG.map(item => ({ ...item, supported: { ...item.supported } }))
    catalogShouldFail = false
    operations = []
    planResponse = { ...CONTEXT7_PLAN }
    nextOperationId = 1
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)

    clipboardWriteText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWriteText }, configurable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openDiscoverTab() {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /탐색/ }))
    await screen.findByRole('option', { name: /context7/ })
  }

  // ── 카탈로그 렌더 ────────────────────────────────────────────────────────
  it('renders catalog rows with name, 인기 badge, kind/category chips, and 1-line description', async () => {
    await openDiscoverTab()

    const context7Row = screen.getByRole('option', { name: /context7/ })
    expect(within(context7Row).getByText('인기')).toBeInTheDocument()
    expect(within(context7Row).getByText('MCP')).toBeInTheDocument()
    expect(within(context7Row).getByText('개발 도구')).toBeInTheDocument()
    expect(within(context7Row).getByText(/최신 라이브러리 문서를/)).toBeInTheDocument()

    const filesystemRow = screen.getByRole('option', { name: /filesystem/ })
    expect(within(filesystemRow).queryByText('인기')).not.toBeInTheDocument()
  })

  // ── kind='cli' 부트스트랩 항목 (Phase 6c) ───────────────────────────────
  // Mirrors the landed backend's real "generic-skills-cli" catalog item
  // (services/tooling/catalog.py): kind='cli', method='manual', shown
  // *whether or not* its own CLI is currently detected. Uses a locally
  // overridden `catalog` fixture (not the shared CATALOG constant every
  // other test in this file uses) so this stays fully isolated.
  it('renders a kind=cli bootstrap item — CLI chip, no install/설치 불가 button, visible reason + copyable command while undetected', async () => {
    catalog = [
      {
        id: 'generic-skills-cli',
        name: 'Skills CLI',
        description_ko: '스킬을 설치·관리하는 generic skills CLI예요.',
        kind: 'cli',
        category: '스킬',
        providers: ['generic_skills'],
        homepage: 'https://github.com/anthropics/skills',
        requires: [],
        popular: false,
        new_session_required: false,
        warnings: ['표기용 예시 명령이에요 — 설치 전 공식 문서에서 정확한 패키지명을 확인하세요.'],
        install: { generic_skills: { method: 'manual', argv: ['npm', 'install', '-g', '@anthropic-ai/skills'] } },
        supported: {
          generic_skills: {
            method: 'manual',
            requires_params: [],
            install_status: 'not_installed',
            supported: false,
            reason: '자동 설치는 지원하지 않아요 — 명령을 복사해 실행한 뒤 다시 검사하세요',
            command: 'npm install -g @anthropic-ai/skills',
          },
        },
      },
    ]
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /탐색/ }))

    const row = await screen.findByRole('option', { name: /Skills CLI/ })
    expect(within(row).getByText('CLI')).toBeInTheDocument()

    fireEvent.click(row)
    const detail = screen.getByRole('region', { name: '선택한 항목 상세' })
    expect(within(detail).getByText('CLI')).toBeInTheDocument()
    expect(within(detail).getByText('수동 설치')).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: '설치 불가' })).not.toBeInTheDocument()
    expect(within(detail).getByText('자동 설치는 지원하지 않아요 — 명령을 복사해 실행한 뒤 다시 검사하세요')).toBeInTheDocument()
    expect(within(detail).getByText('npm install -g @anthropic-ai/skills')).toBeInTheDocument()
    expect(within(detail).getByRole('button', { name: '명령 복사' })).toBeInTheDocument()
  })

  // ── 설치 상태 ────────────────────────────────────────────────────────────
  it('shows per-provider install status — installed hides the install button, not-installed shows it', async () => {
    await openDiscoverTab()
    const detail = screen.getByRole('region', { name: '선택한 항목 상세' })

    fireEvent.click(screen.getByRole('option', { name: /docx/ }))
    expect(within(detail).getByText('설치됨')).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: /Claude Code에 설치/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: /context7/ }))
    expect(within(detail).getByRole('button', { name: 'Claude Code에 설치' })).toBeInTheDocument()
    expect(within(detail).getByRole('button', { name: 'Codex CLI에 설치' })).toBeInTheDocument()
  })

  // ── new_session_required 칩 ─────────────────────────────────────────────
  it('shows the "새 세션부터 적용돼요" chip for an already-installed provider when new_session_required', async () => {
    await openDiscoverTab()
    fireEvent.click(screen.getByRole('option', { name: /docx/ }))
    const detail = screen.getByRole('region', { name: '선택한 항목 상세' })
    expect(within(detail).getByText('새 세션부터 적용돼요')).toBeInTheDocument()
  })

  // ── kind 필터 칩 ─────────────────────────────────────────────────────────
  it('filters by kind chip', async () => {
    await openDiscoverTab()
    expect(screen.getByRole('option', { name: /code-review-pack/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^MCP/ }))
    expect(screen.queryByRole('option', { name: /context7/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /filesystem/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /code-review-pack/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /docx/ })).toBeInTheDocument()
  })

  // ── provider 필터 칩 ─────────────────────────────────────────────────────
  it('filters by provider chip', async () => {
    await openDiscoverTab()

    // Scoped to the filter group itself — an unscoped query would also match
    // the detail panel's "Claude Code에 설치" button, which starts with the
    // same text.
    const providerGroup = screen.getByRole('group', { name: 'Provider 필터' })
    // Turning off Claude Code leaves only items that also list codex —
    // only context7 supports both.
    fireEvent.click(within(providerGroup).getByRole('button', { name: /^Claude Code/ }))
    expect(screen.getByRole('option', { name: /context7/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /filesystem/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /code-review-pack/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /docx/ })).not.toBeInTheDocument()
  })

  // ── 검색 ─────────────────────────────────────────────────────────────────
  it('filters by debounced search text', async () => {
    await openDiscoverTab()
    fireEvent.change(screen.getByLabelText('카탈로그 검색'), { target: { value: 'filesystem' } })
    await waitFor(() => expect(screen.queryByRole('option', { name: /context7/ })).not.toBeInTheDocument())
    expect(screen.getByRole('option', { name: /filesystem/ })).toBeInTheDocument()
  })

  // ── method=manual → 설치 버튼 대신 "수동 설치" 라벨 + 눈에 보이는 reason +
  // 명령 복사 (Phase 6c: phase6c-tabs-front-spec.md §C — a manual item never
  // gets a fake "설치 불가" button; the reason text and command are both
  // visible, not hidden behind a hover tooltip) ───────────────────────────
  it('shows a "수동 설치" label (no install/설치 불가 button), a visible reason, and offers 명령 복사 for method=manual', async () => {
    await openDiscoverTab()
    fireEvent.click(screen.getByRole('option', { name: /code-review-pack/ }))

    expect(screen.getByText('수동 설치')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '설치 불가' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Claude Code에 설치' })).not.toBeInTheDocument()

    // The reason is now plain visible text, not just a button's title tooltip.
    expect(screen.getByText('Interactive Plugin Browser에서만 가능 — Terminal에서 여세요')).toBeInTheDocument()
    expect(screen.getByText('/plugin marketplace add anthropics/claude-plugins')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '명령 복사' })).toBeInTheDocument()
  })

  it('copies the manual command to the clipboard and flips the button to 복사됨', async () => {
    await openDiscoverTab()
    fireEvent.click(screen.getByRole('option', { name: /code-review-pack/ }))

    fireEvent.click(screen.getByRole('button', { name: '명령 복사' }))
    expect(clipboardWriteText).toHaveBeenCalledWith('/plugin marketplace add anthropics/claude-plugins')
    expect(await screen.findByRole('button', { name: '복사됨' })).toBeInTheDocument()
  })

  it('shows an honest fallback message when the clipboard write fails', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('denied'))
    await openDiscoverTab()
    fireEvent.click(screen.getByRole('option', { name: /code-review-pack/ }))

    fireEvent.click(screen.getByRole('button', { name: '명령 복사' }))
    expect(await screen.findByText('복사하지 못했어요 — 위 명령을 직접 선택해서 복사하세요')).toBeInTheDocument()
    // Never fakes success when the copy actually failed.
    expect(screen.queryByRole('button', { name: '복사됨' })).not.toBeInTheDocument()
  })

  // ── needs_params 검증 ────────────────────────────────────────────────────
  it('requires a validated path before installing when needs_params includes path', async () => {
    await openDiscoverTab()
    fireEvent.click(screen.getByRole('option', { name: /filesystem/ }))

    const pathInput = screen.getByLabelText('설치 경로')
    const installBtn = screen.getByRole('button', { name: 'Claude Code에 설치' })
    expect(installBtn).toBeDisabled() // empty path

    fireEvent.change(pathInput, { target: { value: '../etc' } })
    expect(installBtn).toBeDisabled() // traversal rejected client-side

    fireEvent.change(pathInput, { target: { value: 'Documents/mcp-fs' } })
    expect(installBtn).not.toBeDisabled()

    planResponse = { ...FILESYSTEM_PLAN }
    fireEvent.click(installBtn)

    const dialog = await screen.findByRole('dialog', { name: '실행 전 확인' })
    expect(within(dialog).getByText(FILESYSTEM_PLAN.description)).toBeInTheDocument()

    const planCall = mockFetch.mock.calls.find(c => c[0] === '/tooling/plan')
    expect(bodyOf(planCall)).toEqual({
      action: 'install',
      provider: 'claude_code',
      target: 'catalog:filesystem',
      params: { path: 'Documents/mcp-fs' },
    })
  })

  // ── plan → Preview(argv) → execute → Queue, 카탈로그 재검증 ──────────────
  it(
    'installs from the catalog via plan → Preview(argv) → execute → moves to the Updates tab Queue, then re-fetches the catalog',
    async () => {
      await openDiscoverTab()
      fireEvent.click(screen.getByRole('option', { name: /context7/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Claude Code에 설치' }))

      const dialog = await screen.findByRole('dialog', { name: '실행 전 확인' })
      expect(within(dialog).getByText(CONTEXT7_PLAN.argv.join(' '))).toBeInTheDocument()
      expect(within(dialog).getByText(CONTEXT7_PLAN.warnings[0])).toBeInTheDocument()

      const planCall = mockFetch.mock.calls.find(c => c[0] === '/tooling/plan')
      expect(bodyOf(planCall)).toEqual({ action: 'install', provider: 'claude_code', target: 'catalog:context7' })

      const catalogCallsBefore = mockFetch.mock.calls.filter(c => c[0] === '/tooling/catalog').length

      fireEvent.click(screen.getByRole('button', { name: '실행하기' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '실행 전 확인' })).not.toBeInTheDocument())

      // Successful execute always routes to the Updates tab's Operation Queue
      // (Phase 4b behavior, reused unchanged for a catalog-sourced install).
      expect(await screen.findByRole('tab', { name: /업데이트/ })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('catalog:context7')).toBeInTheDocument()

      operations = operations.map(o => ({ ...o, status: 'succeeded' as const, finished_at: '2026-07-17T14:00:05Z', exit_code: 0, verified: true }))
      await waitFor(() => expect(screen.getByText('성공')).toBeInTheDocument(), { timeout: 4000 })

      await waitFor(() => {
        const after = mockFetch.mock.calls.filter(c => c[0] === '/tooling/catalog').length
        expect(after).toBeGreaterThan(catalogCallsBefore)
      })
    },
    8000,
  )

  // ── API 실패 상태 ────────────────────────────────────────────────────────
  it('shows an honest per-tab error state when /tooling/catalog fails, without affecting other tabs, and recovers on retry', async () => {
    catalogShouldFail = true
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /탐색/ }))

    expect(await screen.findByText('카탈로그를 불러오지 못했어요')).toBeInTheDocument()
    // No fixture data leaks into the error state.
    expect(screen.queryByText('context7')).not.toBeInTheDocument()

    // Other tabs are unaffected by the catalog failure.
    fireEvent.click(screen.getByRole('tab', { name: /설치됨/ }))
    expect(await screen.findByRole('option', { name: /frontend-design/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /탐색/ }))
    catalogShouldFail = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('option', { name: /context7/ })).toBeInTheDocument()
  })

  // ── 설치됨 탭 확장: kind=mcp가 실제 provider 어댑터 capability로 게이트됨 ──
  it('설치됨 탭: kind=mcp gets active buttons when its matching provider adapter supports it', async () => {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /설치됨/ }))
    fireEvent.click(await screen.findByRole('option', { name: /context7/ }))

    const updateBtn = screen.getByRole('button', { name: '업데이트' })
    const removeBtn = screen.getByRole('button', { name: '삭제' })
    expect(updateBtn).not.toBeDisabled()
    expect(removeBtn).not.toBeDisabled()

    fireEvent.click(updateBtn)
    const planCall = mockFetch.mock.calls.find(c => c[0] === '/tooling/plan')
    expect(bodyOf(planCall)).toEqual({ action: 'update', provider: 'claude_code', target: 'context7' })
  })

  it('설치됨 탭: kind=mcp shows the real adapter reason (not a Phase placeholder) when its provider only supports read-only', async () => {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /설치됨/ }))
    fireEvent.click(await screen.findByRole('option', { name: /some-codex-server/ }))

    const removeBtn = screen.getByRole('button', { name: '삭제' })
    expect(removeBtn).toBeDisabled()
    expect(removeBtn).toHaveAttribute('title', CODEX_READONLY_REASON)
    // The real per-adapter reason, not the "이 유형의 관리는 Phase 5에서
    // 제공돼요" placeholder still used for plugin/profile kinds below.
    expect(screen.queryByText('이 유형의 관리는 Phase 5에서 제공돼요')).not.toBeInTheDocument()
  })

  it('설치됨 탭: kind=plugin still shows the Phase 5 placeholder (regression — no over-generalization to non-mcp kinds)', async () => {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /설치됨/ }))
    fireEvent.click(await screen.findByRole('option', { name: /frontend-design/ }))

    const updateBtn = screen.getByRole('button', { name: '업데이트' })
    expect(updateBtn).toBeDisabled()
    expect(updateBtn).toHaveAttribute('title', '이 유형의 관리는 Phase 5에서 제공돼요')
    expect(screen.getByText('이 유형의 관리는 Phase 5에서 제공돼요')).toBeInTheDocument()
  })

  it('설치됨 탭: MCP is a selectable Type filter alongside Skill/Plugin/Profile', async () => {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /설치됨/ }))
    await screen.findByRole('option', { name: /context7/ })

    fireEvent.click(screen.getByRole('checkbox', { name: /^MCP/ }))
    expect(screen.queryByRole('option', { name: /context7/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /some-codex-server/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /frontend-design/ })).toBeInTheDocument()
  })
})
