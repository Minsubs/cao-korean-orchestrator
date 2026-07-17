import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToolingView } from '../features/tooling/ToolingView'
import type {
  CatalogItem,
  ToolingAdapter,
  ToolingDiagnostic,
  ToolingEnvironment,
  ToolingExtension,
  ToolingProvider,
  ToolingSources,
} from '../api.tooling'

// Phase 6c — 소스 탭. Companion to test/tooling.test.tsx (3b read path) and
// test/tooling-discover.test.tsx (5b catalog): this file covers only what's
// new for /tooling/sources. The backend contract is being built in a
// separate, parallel session — at the time this test was written it 404s,
// which is exactly the "API 실패 상태" case exercised below (same honest
// per-tab degradation the catalog/discover tab already established).

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error',
    json: () => Promise.resolve(data),
  }
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
const EXTENSIONS: ToolingExtension[] = []
const DIAGNOSTICS: ToolingDiagnostic[] = []

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
      reasons: {},
    },
  },
]

const CATALOG: CatalogItem[] = [
  {
    id: 'context7',
    name: 'context7',
    description_ko: '최신 라이브러리 문서를 실시간으로 가져오는 MCP 서버예요',
    kind: 'mcp',
    category: '개발 도구',
    providers: ['claude_code'],
    homepage: null,
    requires: ['npx'],
    popular: true,
    new_session_required: true,
    warnings: [],
    install: { claude_code: { method: 'mcp', argv: ['claude', 'mcp', 'add', 'context7'] } },
    supported: { claude_code: { method: 'mcp', requires_params: [], install_status: 'not_installed', supported: true, reason: null } },
  },
]

const SOURCES: ToolingSources = {
  directory_sources: [
    { path: '/Users/dev/.claude/skills', scope: 'user', cli: 'claude_code', kind: 'skill', count: 4, exists: true },
    { path: '/Users/dev/.codex/prompts', cli: 'codex', kind: 'prompt', count: 0, exists: false },
    { path: '/opt/cao/agent-store', scope: 'store', kind: 'agent', count: 7, exists: true },
  ],
  catalog: {
    count: 13,
    kinds: { mcp: 7, skill: 4, plugin: 1, cli: 1 },
    origin: 'services/tooling/catalog.py',
    note: '실제 공개 MCP 서버·Anthropic 스킬만 손으로 큐레이션했어요.',
  },
  marketplaces: {
    claude_code: {
      supported: true,
      items: [{ name: 'anthropics/claude-plugins', source: 'github' }],
      reason: null,
      manage_hint: '/plugin marketplace list',
    },
    antigravity: {
      supported: false,
      items: null,
      reason: '이 provider는 마켓플레이스 개념이 없어요',
    },
  },
}

describe('ToolingView — Phase 6c 소스 탭', () => {
  let sources: ToolingSources
  let sourcesShouldFail: boolean
  let sourcesCalls: number
  let clipboardWriteText: ReturnType<typeof vi.fn>

  const mockFetch = vi.fn(async (url: string) => {
    if (url === '/tooling/environment') return jsonResponse(ENVIRONMENT)
    if (url === '/tooling/providers') return jsonResponse(PROVIDERS)
    if (url === '/tooling/extensions') return jsonResponse(EXTENSIONS)
    if (url === '/tooling/diagnostics') return jsonResponse(DIAGNOSTICS)
    if (url === '/tooling/adapters') return jsonResponse(ADAPTERS)
    if (url === '/tooling/catalog') return jsonResponse(CATALOG)
    if (url === '/tooling/sources') {
      sourcesCalls++
      if (sourcesShouldFail) return jsonResponse({ detail: 'not found' }, 404)
      return jsonResponse(sources)
    }
    return jsonResponse({ detail: 'unhandled in test' }, 404)
  })

  beforeEach(() => {
    sources = { ...SOURCES, marketplaces: { ...SOURCES.marketplaces } }
    sourcesShouldFail = false
    sourcesCalls = 0
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)

    clipboardWriteText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWriteText }, configurable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openSourcesTab() {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /^소스/ }))
    await screen.findByText('/Users/dev/.claude/skills')
  }

  it('renders all three sections — 디렉터리 소스, 큐레이션 카탈로그, 마켓플레이스', async () => {
    await openSourcesTab()

    // 디렉터리 소스
    const dirList = screen.getByRole('list', { name: '디렉터리 소스 목록' })
    expect(within(dirList).getByText('/Users/dev/.claude/skills')).toBeInTheDocument()
    expect(within(dirList).getByText('스킬')).toBeInTheDocument()
    expect(within(dirList).getByText('4개')).toBeInTheDocument()
    expect(within(dirList).getByText('Claude Code')).toBeInTheDocument()

    // 큐레이션 카탈로그
    expect(screen.getByText('13')).toBeInTheDocument()
    expect(screen.getByText(/실제 공개 MCP 서버/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '탐색 탭에서 보기' })).toBeInTheDocument()

    // 마켓플레이스
    expect(screen.getByText('anthropics/claude-plugins')).toBeInTheDocument()
    expect(screen.getByText('이 provider는 마켓플레이스 개념이 없어요')).toBeInTheDocument()
  })

  it('dims a not-yet-existing directory source and labels it honestly ("아직 없어요")', async () => {
    await openSourcesTab()
    const dirList = screen.getByRole('list', { name: '디렉터리 소스 목록' })
    expect(within(dirList).getByText('아직 없어요')).toBeInTheDocument()
    expect(within(dirList).getByText('/Users/dev/.codex/prompts')).toBeInTheDocument()
  })

  it('shows a supported marketplace\'s items (name+source), never fabricating one for the unsupported provider', async () => {
    await openSourcesTab()
    expect(screen.getByText('anthropics/claude-plugins')).toBeInTheDocument()
    expect(screen.getByText('github')).toBeInTheDocument()
    // The unsupported marketplace shows its reason, not an empty/fake item list.
    expect(screen.queryByText('등록된 항목이 없어요')).not.toBeInTheDocument()
  })

  it('offers a copyable manage_hint command with an honest disclaimer, and copies it to the clipboard', async () => {
    await openSourcesTab()
    expect(screen.getByText('여기서 직접 추가/삭제는 아직 지원하지 않아요 — 명령을 복사해 실행하세요')).toBeInTheDocument()
    expect(screen.getByText('/plugin marketplace list')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '명령 복사' }))
    expect(clipboardWriteText).toHaveBeenCalledWith('/plugin marketplace list')
    expect(await screen.findByRole('button', { name: '복사됨' })).toBeInTheDocument()
  })

  it('shows an honest fallback when the clipboard write fails', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('denied'))
    await openSourcesTab()
    fireEvent.click(screen.getByRole('button', { name: '명령 복사' }))
    expect(await screen.findByText('복사하지 못했어요 — 위 명령을 직접 선택해서 복사하세요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '복사됨' })).not.toBeInTheDocument()
  })

  it('"탐색 탭에서 보기" switches ToolingView to the 탐색 tab', async () => {
    await openSourcesTab()
    fireEvent.click(screen.getByRole('button', { name: '탐색 탭에서 보기' }))
    expect(await screen.findByRole('tab', { name: /^탐색/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('option', { name: /context7/ })).toBeInTheDocument()
  })

  it('shows an honest per-tab error state when /tooling/sources fails, without affecting other tabs, and recovers on retry', async () => {
    sourcesShouldFail = true
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /^소스/ }))

    expect(await screen.findByText('Tooling API에 연결할 수 없어요')).toBeInTheDocument()
    expect(screen.queryByText('/Users/dev/.claude/skills')).not.toBeInTheDocument()

    // Other tabs are unaffected by the sources failure.
    fireEvent.click(screen.getByRole('tab', { name: /^개요/ }))
    expect(await screen.findByRole('heading', { name: /도구 및 확장/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /^소스/ }))
    sourcesShouldFail = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('/Users/dev/.claude/skills')).toBeInTheDocument()
  })

  it('re-fetches sources when 새로고침 is clicked', async () => {
    await openSourcesTab()
    const callsBefore = sourcesCalls
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    await screen.findByText('/Users/dev/.claude/skills')
    expect(sourcesCalls).toBeGreaterThan(callsBefore)
  })
})
