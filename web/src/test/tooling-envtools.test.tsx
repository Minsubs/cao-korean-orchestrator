import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolingView } from '../features/tooling/ToolingView'
import type { CatalogItem, ToolingAdapter, ToolingDiagnostic, ToolingEnvironment, ToolingExtension, ToolingProvider } from '../api.tooling'
import type { EnvInstructionEntry, EnvInventoryAll } from '../api.env'
import { CONVERT_PAIRS } from '../features/tooling/envtools'

// Phase 6b Task 2 — 환경·지침 탭의 첫 섹션(CLI 인벤토리). Companion to
// test/tooling-sources.test.tsx (Phase 6c 소스 탭): mirrors its
// mockFetch-covers-all-URLs approach and adds only the /env/inventory branch.
// The backend (env_router.py) is a separate parallel session's work — a
// forced 500 here exercises the same honest per-tab error+retry stance
// already established for sources/catalog.
//
// Phase 6b Task 3 adds the second, independent section on the same tab: the
// AGENTS.md/CLAUDE.md instruction matrix (/env/instructions). Same stance —
// its own mockFetch branch, its own loading/error isolation from the
// inventory section above it.
//
// Phase 6b Task 4 adds a third, independent section: a format-conversion
// preview (POST /env/convert). Preview-only — it never writes. It owns its
// own local state (selected pair/content/result/error), so unlike the two
// sections above it, there's nothing to eager-load from ToolingView.

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 500 ? 'Internal Server Error' : 'Error',
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
const ADAPTERS: ToolingAdapter[] = []
const CATALOG: CatalogItem[] = []

const INVENTORY: EnvInventoryAll = {
  clis: [
    {
      cli: 'claude_code',
      present: true,
      items: [{ rel_path: 'CLAUDE.md', kind: 'instruction', size: 12, mtime: null }],
      counts: { total: 1, instruction: 1 },
      note: null,
    },
    { cli: 'codex', present: false, items: [], counts: { total: 0 }, note: null },
    {
      cli: 'antigravity',
      present: true,
      items: [],
      counts: { total: 0 },
      note: '~/.gemini/config/mcp_config.json만 확인해요',
    },
  ],
}

// Phase 6b Task 3 fixtures — sample matrix taken verbatim from the task brief:
// entries[0] is always the global scope; an existing file carries an
// already-masked `headline`, a missing file carries neither size/mtime/sha256
// nor headline.
const GLOBAL_INSTRUCTIONS: EnvInstructionEntry = {
  scope: 'global',
  base_path: '$HOME',
  files: [
    { name: '.claude/CLAUDE.md', exists: true, size: 20, mtime: null, sha256: 'abc', headline: '# 내 지침' },
    { name: '.codex/AGENTS.md', exists: false, size: null, mtime: null, sha256: null, headline: null },
  ],
}

const PROJECT_PATH = '/home/tester/myproject'
const PROJECT_INSTRUCTIONS: EnvInstructionEntry = {
  scope: 'project',
  base_path: PROJECT_PATH,
  files: [
    { name: 'AGENTS.md', exists: true, size: 512, mtime: '2026-07-01T00:00:00Z', sha256: 'def', headline: '프로젝트 지침 헤드라인' },
    { name: '.claude/commands', exists: true, size: null, mtime: null, sha256: null, headline: null, is_dir: true, command_count: 4 },
  ],
}

// A path outside $HOME — the backend returns HTTP 200 with `error` set and no
// `files` (see the brief's exact contract note).
const OUTSIDE_PATH = '/etc/passwd'
const OUTSIDE_INSTRUCTIONS: EnvInstructionEntry = {
  scope: 'project',
  base_path: OUTSIDE_PATH,
  error: '홈 디렉터리 밖 경로는 다룰 수 없어요',
}

// Phase 6b Task 4 fixture — the convert endpoint is preview-only (never
// writes) and, per the brief, this MVP always exercises it via `content`
// (not `path`) to keep it that way.
const CONVERT_RESULT = { converted: '# 변환됨\n본문', warnings: ['일부 필드 유실'], lossy_fields: ['tools'] }

describe('ToolingView — Phase 6b 환경·지침 탭 (CLI 인벤토리)', () => {
  let inventoryShouldFail: boolean
  let instructionsShouldFail: boolean
  let instructionsCalls: number
  let inventoryCalls: number
  let convertShouldFail: boolean
  let convertCalls: number

  const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/tooling/environment') return jsonResponse(ENVIRONMENT)
    if (url === '/tooling/providers') return jsonResponse(PROVIDERS)
    if (url === '/tooling/extensions') return jsonResponse(EXTENSIONS)
    if (url === '/tooling/diagnostics') return jsonResponse(DIAGNOSTICS)
    if (url === '/tooling/adapters') return jsonResponse(ADAPTERS)
    if (url === '/tooling/catalog') return jsonResponse(CATALOG)
    if (url.startsWith('/env/inventory')) {
      inventoryCalls++
      if (inventoryShouldFail) return jsonResponse({ detail: 'boom' }, 500)
      return jsonResponse(INVENTORY)
    }
    if (url.startsWith('/env/instructions')) {
      instructionsCalls++
      if (instructionsShouldFail) return jsonResponse({ detail: 'boom' }, 500)
      const paths = (new URL(url, 'http://localhost').searchParams.get('paths') ?? '')
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
      const entries: EnvInstructionEntry[] = [GLOBAL_INSTRUCTIONS]
      for (const p of paths) {
        if (p === PROJECT_PATH) entries.push(PROJECT_INSTRUCTIONS)
        else if (p === OUTSIDE_PATH) entries.push(OUTSIDE_INSTRUCTIONS)
        else entries.push({ scope: 'project', base_path: p, files: [] })
      }
      return jsonResponse({ entries })
    }
    if (url === '/env/convert') {
      convertCalls++
      if (convertShouldFail) return jsonResponse({ detail: '지원하지 않는 변환이에요' }, 400)
      const body = JSON.parse(String(opts?.body ?? '{}'))
      expect(body.content).toBeTruthy()
      return jsonResponse(CONVERT_RESULT)
    }
    return jsonResponse({ detail: 'unhandled in test' }, 404)
  })

  beforeEach(() => {
    inventoryShouldFail = false
    inventoryCalls = 0
    instructionsShouldFail = false
    instructionsCalls = 0
    convertShouldFail = false
    convertCalls = 0
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openEnvToolsTab() {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /환경·지침/ }))
  }

  it('renders a CLI inventory card per CLI with its items', async () => {
    await openEnvToolsTab()

    expect(await screen.findByText('CLAUDE.md')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Claude Code/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Codex$/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Antigravity/ })).toBeInTheDocument()
    expect(screen.getByText('~/.gemini/config/mcp_config.json만 확인해요')).toBeInTheDocument()
  })

  it('shows an honest per-tab error state when /env/inventory fails, without affecting other tabs, and recovers on retry', async () => {
    inventoryShouldFail = true
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /환경·지침/ }))

    expect(await screen.findByText('Tooling API에 연결할 수 없어요')).toBeInTheDocument()
    expect(screen.queryByText('CLAUDE.md')).not.toBeInTheDocument()

    // Other tabs are unaffected by the inventory failure.
    fireEvent.click(screen.getByRole('tab', { name: /^개요/ }))
    expect(await screen.findByRole('heading', { name: /도구 및 확장/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /환경·지침/ }))
    inventoryShouldFail = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('CLAUDE.md')).toBeInTheDocument()
  })

  // Phase 6b Task 3 — 지침 매트릭스 section, added below the CLI inventory
  // section on the same tab.

  it('renders the global instruction scope with a per-file exists state and the masked headline', async () => {
    await openEnvToolsTab()

    const existingRow = (await screen.findByText('.claude/CLAUDE.md')).closest('li')
    expect(existingRow).not.toBeNull()
    expect(existingRow).toHaveTextContent('있음')
    expect(existingRow).toHaveTextContent('# 내 지침')

    const missingRow = screen.getByText('.codex/AGENTS.md').closest('li')
    expect(missingRow).not.toBeNull()
    expect(missingRow).toHaveTextContent('없음')
    expect(missingRow).not.toHaveTextContent('# 내 지침')
  })

  it('shows a per-section error state for the instruction matrix without blanking the CLI inventory section above it, and recovers on retry', async () => {
    instructionsShouldFail = true
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /환경·지침/ }))

    // The inventory section (independent load) still renders fine.
    expect(await screen.findByText('CLAUDE.md')).toBeInTheDocument()
    // The instruction matrix shows its own error block instead of files.
    expect(screen.queryByText('.claude/CLAUDE.md')).not.toBeInTheDocument()
    expect(screen.getByText('Tooling API에 연결할 수 없어요')).toBeInTheDocument()

    instructionsShouldFail = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('.claude/CLAUDE.md')).toBeInTheDocument()
  })

  it('lets the user add a project path, renders its returned entry (incl. an is_dir command count), and surfaces an outside-$HOME error row', async () => {
    await openEnvToolsTab()
    await screen.findByText('.claude/CLAUDE.md')

    const input = screen.getByPlaceholderText(/절대 경로/)
    fireEvent.change(input, { target: { value: PROJECT_PATH } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('AGENTS.md')).toBeInTheDocument()
    const commandsRow = screen.getByText('.claude/commands').closest('li')
    expect(commandsRow).toHaveTextContent('4개 명령')
    // The added path shows up both as a removable chip and in the new entry's header.
    expect(screen.getAllByText(PROJECT_PATH).length).toBeGreaterThanOrEqual(2)

    fireEvent.change(input, { target: { value: OUTSIDE_PATH } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('홈 디렉터리 밖 경로는 다룰 수 없어요')).toBeInTheDocument()
  })

  // Phase 6b Task 4 — 변환 미리보기 section, added below the instruction
  // matrix on the same tab. Preview-only: it consumes envApi.convert and
  // renders the result, never writes anything.

  it('lets the user pick a conversion pair, paste content, preview it, and see the converted text, warnings, and lossy-field chips', async () => {
    await openEnvToolsTab()
    await screen.findByText('.claude/CLAUDE.md')

    const pairIndex = CONVERT_PAIRS.findIndex(p => p.target_kind === 'claude_command')
    expect(pairIndex).toBeGreaterThanOrEqual(0)

    const select = screen.getByLabelText('변환 종류')
    fireEvent.change(select, { target: { value: String(pairIndex) } })

    const textarea = screen.getByLabelText('변환할 원본 내용')
    fireEvent.change(textarea, { target: { value: '# 원본 프롬프트' } })

    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))

    const converted = await screen.findByText(/# 변환됨/)
    expect(converted.tagName.toLowerCase()).toBe('pre')
    expect(converted).toHaveTextContent('본문')
    expect(screen.getByText('일부 필드 유실')).toBeInTheDocument()
    expect(screen.getByText('tools')).toBeInTheDocument()

    expect(convertCalls).toBe(1)
  })

  it('shows an inline error for an unsupported conversion (400) without crashing the pane or triggering the global tab error', async () => {
    convertShouldFail = true
    await openEnvToolsTab()
    await screen.findByText('.claude/CLAUDE.md')

    const textarea = screen.getByLabelText('변환할 원본 내용')
    fireEvent.change(textarea, { target: { value: '# 원본' } })
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))

    expect(await screen.findByText('지원하지 않는 변환이에요')).toBeInTheDocument()
    // The rest of the tab is unaffected — this is an inline error, not the
    // shared "connection failed" tab-wide error state.
    expect(screen.getByText('CLAUDE.md')).toBeInTheDocument()
    expect(screen.queryByText('Tooling API에 연결할 수 없어요')).not.toBeInTheDocument()
  })
})
