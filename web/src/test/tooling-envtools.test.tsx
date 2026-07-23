import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolingView } from '../features/tooling/ToolingView'
import type { CatalogItem, ToolingAdapter, ToolingDiagnostic, ToolingEnvironment, ToolingExtension, ToolingProvider } from '../api.tooling'
import type { EnvInventoryAll } from '../api.env'

// Phase 6b Task 2 — 환경·지침 탭의 첫 섹션(CLI 인벤토리). Companion to
// test/tooling-sources.test.tsx (Phase 6c 소스 탭): mirrors its
// mockFetch-covers-all-URLs approach and adds only the /env/inventory branch.
// The backend (env_router.py) is a separate parallel session's work — a
// forced 500 here exercises the same honest per-tab error+retry stance
// already established for sources/catalog.

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

describe('ToolingView — Phase 6b 환경·지침 탭 (CLI 인벤토리)', () => {
  let inventoryShouldFail: boolean
  let inventoryCalls: number

  const mockFetch = vi.fn(async (url: string) => {
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
    return jsonResponse({ detail: 'unhandled in test' }, 404)
  })

  beforeEach(() => {
    inventoryShouldFail = false
    inventoryCalls = 0
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
})
