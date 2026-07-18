import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ToolingView } from '../features/tooling/ToolingView'
import type {
  ToolingAdapter,
  ToolingDiagnostic,
  ToolingEnvironment,
  ToolingExecutionPlan,
  ToolingExtension,
  ToolingOperation,
  ToolingProvider,
} from '../api.tooling'

// Phase 4b — write path: Operation Queue, Preview modal, Updates tab.
// Companion to test/tooling.test.tsx (Phase 3b read path), kept in its own
// file per the phase4b spec's `tooling*.test.tsx` ownership pattern.

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 400 ? 'Bad Request' : 'Not Found',
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

const NOT_INSTALLED_REASON = 'skills 실행 파일이 감지되지 않았어요 — 설치 후 다시 검사하세요'

const ADAPTER_UNINSTALLED: ToolingAdapter = {
  id: 'generic_skills',
  display_name: 'Generic Skills',
  detected: { installed: false, path: null, version: null },
  capabilities: {
    canList: false,
    canInstall: false,
    canRemove: false,
    canUpdate: false,
    canUpdateAll: false,
    requiresNewSession: false,
    requiresRestart: false,
    reasons: {
      canList: NOT_INSTALLED_REASON,
      canInstall: NOT_INSTALLED_REASON,
      canRemove: NOT_INSTALLED_REASON,
      canUpdate: NOT_INSTALLED_REASON,
      canUpdateAll: NOT_INSTALLED_REASON,
    },
  },
}

const ADAPTER_INSTALLED: ToolingAdapter = {
  id: 'generic_skills',
  display_name: 'Generic Skills',
  detected: { installed: true, path: '/opt/homebrew/bin/skills', version: '1.4.0' },
  capabilities: {
    canList: true,
    canInstall: true,
    canRemove: true,
    canUpdate: true,
    canUpdateAll: true,
    requiresNewSession: false,
    requiresRestart: false,
    reasons: {},
  },
}

const BASE_EXTENSIONS: ToolingExtension[] = [
  {
    id: 'ext-pdf',
    kind: 'skill',
    name: 'pdf-tools',
    description: 'PDF 처리 skill',
    scope: 'user',
    source_path: '/Users/dev/.claude/skills/pdf-tools',
    provider: 'claude_code',
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

const INSTALL_PLAN: ToolingExecutionPlan = {
  description: 'new-skill skill을 추가해요',
  argv: ['skills', 'add', 'new-skill'],
  cwd: '/Users/dev',
  verify_description: '설치 후 skills list에 new-skill이 나타나는지 확인해요',
  warnings: ['새 세션부터 적용돼요'],
}

describe('ToolingView — Phase 4b write path (업데이트 탭)', () => {
  let adapters: ToolingAdapter[]
  let extensions: ToolingExtension[]
  let operations: ToolingOperation[]
  let operationLogs: Record<string, string[]>
  let planResponse: ToolingExecutionPlan
  let nextOperationId: number

  const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url === '/tooling/environment') return jsonResponse(ENVIRONMENT)
    if (url === '/tooling/providers') return jsonResponse(PROVIDERS)
    if (url === '/tooling/extensions') return jsonResponse(extensions)
    if (url === '/tooling/diagnostics') return jsonResponse(DIAGNOSTICS)
    if (url === '/tooling/adapters') return jsonResponse(adapters)

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
      return jsonResponse({ ...op, log: operationLogs[op.id] ?? [] })
    }

    return jsonResponse({ detail: 'unhandled in test' }, 404)
  })

  beforeEach(() => {
    adapters = [ADAPTER_INSTALLED]
    extensions = BASE_EXTENSIONS.map(e => ({ ...e }))
    operations = []
    operationLogs = {}
    planResponse = { ...INSTALL_PLAN }
    nextOperationId = 1
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openUpdatesTab() {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /업데이트/ }))
    // "Skill 관리" is a section heading unique to UpdatesPane — unlike the
    // adapter card's "Generic Skills" heading, it can't collide with an
    // Operation Queue row's provider label (which resolves to the same
    // adapter display_name whenever an operation is already present).
    await screen.findByText('Skill 관리')
  }

  // ── 어댑터 카드 + capability gating ──────────────────────────────────────
  it('disables every Skill 관리 control with the adapter reason when generic_skills is not installed', async () => {
    adapters = [ADAPTER_UNINSTALLED]
    await openUpdatesTab()

    expect(screen.getByText('미설치')).toBeInTheDocument()

    const addBtn = screen.getByRole('button', { name: '추가' })
    expect(addBtn).toBeDisabled()
    expect(addBtn).toHaveAttribute('title', NOT_INSTALLED_REASON)

    const updateAllBtn = screen.getByRole('button', { name: '전체 최신 상태 확인' })
    expect(updateAllBtn).toBeDisabled()
    expect(updateAllBtn).toHaveAttribute('title', NOT_INSTALLED_REASON)

    const skillUpdateBtn = screen.getByRole('button', { name: '최신화' })
    expect(skillUpdateBtn).toBeDisabled()
    expect(skillUpdateBtn).toHaveAttribute('title', NOT_INSTALLED_REASON)
  })

  it('enables Skill 관리 controls once generic_skills is installed', async () => {
    await openUpdatesTab()

    expect(screen.getByRole('button', { name: '전체 최신 상태 확인' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '최신화' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '삭제' })).not.toBeDisabled()
  })

  // ── target 입력 검증 ──────────────────────────────────────────────────────
  it('rejects an invalid target format client-side and re-enables 추가 for a valid one', async () => {
    await openUpdatesTab()

    const input = screen.getByLabelText('추가할 Skill 이름')
    const addBtn = screen.getByRole('button', { name: '추가' })
    expect(addBtn).toBeDisabled() // empty target

    fireEvent.change(input, { target: { value: 'bad name!' } })
    expect(addBtn).toBeDisabled()
    expect(screen.getByText('영문/숫자와 @ / . _ - 만 사용할 수 있어요')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'new-skill' } })
    expect(addBtn).not.toBeDisabled()
  })

  // ── plan → Preview 모달(argv 표시) → execute → Queue → polling → 재검증 ──
  it(
    'runs plan → Preview(argv) → execute → Queue(실행 중) → polling(성공) → re-fetches extensions/diagnostics',
    async () => {
      await openUpdatesTab()

      fireEvent.change(screen.getByLabelText('추가할 Skill 이름'), { target: { value: 'new-skill' } })
      fireEvent.click(screen.getByRole('button', { name: '추가' }))

      const dialog = await screen.findByRole('dialog', { name: '실행 전 확인' })
      expect(within(dialog).getByText(INSTALL_PLAN.description)).toBeInTheDocument()
      expect(within(dialog).getByText(INSTALL_PLAN.argv.join(' '))).toBeInTheDocument()
      expect(within(dialog).getByText(INSTALL_PLAN.cwd)).toBeInTheDocument()
      expect(within(dialog).getByText(INSTALL_PLAN.verify_description)).toBeInTheDocument()
      expect(within(dialog).getByText(INSTALL_PLAN.warnings[0])).toBeInTheDocument()

      const planCall = mockFetch.mock.calls.find(c => c[0] === '/tooling/plan')
      expect(bodyOf(planCall)).toEqual({ action: 'install', provider: 'generic_skills', target: 'new-skill' })

      const extensionsCallsBefore = mockFetch.mock.calls.filter(c => c[0] === '/tooling/extensions').length

      fireEvent.click(screen.getByRole('button', { name: '실행하기' }))

      await waitFor(() => expect(screen.queryByRole('dialog', { name: '실행 전 확인' })).not.toBeInTheDocument())
      expect(await screen.findByText('실행 중')).toBeInTheDocument()
      expect(screen.getByText('new-skill')).toBeInTheDocument()

      // Simulate the backend having finished the op by the next poll tick.
      operations = operations.map(o => ({ ...o, status: 'succeeded' as const, finished_at: '2026-07-17T14:00:05Z', exit_code: 0, verified: true }))

      await waitFor(() => expect(screen.getByText('성공')).toBeInTheDocument(), { timeout: 4000 })
      expect(screen.getByText('exit 0')).toBeInTheDocument()
      expect(screen.getByText('검증됨')).toBeInTheDocument()

      await waitFor(() => {
        const after = mockFetch.mock.calls.filter(c => c[0] === '/tooling/extensions').length
        expect(after).toBeGreaterThan(extensionsCallsBefore)
      })
    },
    8000,
  )

  it('최신화/삭제 on an installed skill row plans with the skill name as target', async () => {
    await openUpdatesTab()

    fireEvent.click(screen.getByRole('button', { name: '최신화' }))
    expect(await screen.findByRole('dialog', { name: '실행 전 확인' })).toBeInTheDocument()

    const planCall = mockFetch.mock.calls.find(c => c[0] === '/tooling/plan')
    expect(bodyOf(planCall)).toEqual({ action: 'update', provider: 'generic_skills', target: 'pdf-tools' })
  })

  it('shows a completed update-all as latest-state confirmation instead of another pending update', async () => {
    operations = [
      {
        id: 'op-update-all',
        action: 'update_all',
        provider: 'generic_skills',
        target: null,
        scope: null,
        status: 'succeeded',
        created_at: '2026-07-17T14:00:00Z',
        started_at: '2026-07-17T14:00:01Z',
        finished_at: '2026-07-17T14:00:03Z',
        exit_code: 0,
        error: null,
        verified: true,
      },
    ]

    await openUpdatesTab()

    expect(screen.getByText(/\uCD5C\uC2E0 \uC0C1\uD0DC \uD655\uC778\uB428/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 확인' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '전체 최신 상태 확인' })).not.toBeInTheDocument()
  })

  // ── cancel ───────────────────────────────────────────────────────────────
  it('cancels a running operation and reflects the cancelled status', async () => {
    operations = [
      {
        id: 'op-run',
        action: 'update',
        provider: 'generic_skills',
        target: 'pdf-tools',
        scope: null,
        status: 'running',
        created_at: '2026-07-17T14:00:00Z',
        started_at: '2026-07-17T14:00:01Z',
        finished_at: null,
        exit_code: null,
        error: null,
        verified: null,
      },
    ]
    await openUpdatesTab()

    expect(await screen.findByText('실행 중')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(await screen.findByText('취소됨')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('/tooling/operations/op-run/cancel', expect.objectContaining({ method: 'POST' }))
  })

  // ── failed → 다시 시도 (재-plan) ──────────────────────────────────────────
  it('re-plans the same request when retrying a failed operation', async () => {
    operations = [
      {
        id: 'op-fail',
        action: 'update',
        provider: 'generic_skills',
        target: 'pdf-tools',
        scope: null,
        status: 'failed',
        created_at: '2026-07-17T14:00:00Z',
        started_at: '2026-07-17T14:00:01Z',
        finished_at: '2026-07-17T14:00:02Z',
        exit_code: 1,
        error: '버전 불일치',
        verified: false,
      },
    ]
    planResponse = {
      description: 'pdf-tools skill을 다시 업데이트해요',
      argv: ['skills', 'update', 'pdf-tools'],
      cwd: '/Users/dev',
      verify_description: '설치 후 버전을 다시 확인해요',
      warnings: [],
    }
    await openUpdatesTab()

    expect(await screen.findByText('실패')).toBeInTheDocument()
    expect(screen.getByText('버전 불일치')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    const dialog = await screen.findByRole('dialog', { name: '실행 전 확인' })
    expect(within(dialog).getByText('pdf-tools skill을 다시 업데이트해요')).toBeInTheDocument()

    const planCall = mockFetch.mock.calls.find(c => c[0] === '/tooling/plan')
    const body = bodyOf(planCall)
    expect(body.action).toBe('update')
    expect(body.provider).toBe('generic_skills')
    expect(body.target).toBe('pdf-tools')
  })

  // ── 로그 접기 ────────────────────────────────────────────────────────────
  it('expands the log via <details> and renders the (already-masked) log lines from the operation detail endpoint', async () => {
    operations = [
      {
        id: 'op-log',
        action: 'update',
        provider: 'generic_skills',
        target: 'pdf-tools',
        scope: null,
        status: 'succeeded',
        created_at: '2026-07-17T14:00:00Z',
        started_at: '2026-07-17T14:00:01Z',
        finished_at: '2026-07-17T14:00:03Z',
        exit_code: 0,
        error: null,
        verified: true,
      },
    ]
    operationLogs['op-log'] = ['설치 시작', 'API_KEY=***', '완료']
    await openUpdatesTab()

    expect(await screen.findByText('성공')).toBeInTheDocument()
    fireEvent.click(screen.getByText('로그'))

    expect(await screen.findByText(/API_KEY=\*\*\*/)).toBeInTheDocument()
    expect(mockFetch.mock.calls.some(c => c[0] === '/tooling/operations/op-log')).toBe(true)
  })

  // ── 설치됨 탭 상세 연결 ───────────────────────────────────────────────────
  it('설치됨 탭: kind=skill gets active buttons; other kinds show the Phase 5 reason', async () => {
    render(<ToolingView />)
    fireEvent.click(await screen.findByRole('tab', { name: /설치됨/ }))

    fireEvent.click(await screen.findByRole('option', { name: /pdf-tools/ }))
    expect(screen.getByRole('button', { name: '최신화' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '삭제' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('option', { name: /frontend-design/ }))
    const pluginUpdateBtn = screen.getByRole('button', { name: '업데이트' })
    expect(pluginUpdateBtn).toBeDisabled()
    expect(pluginUpdateBtn).toHaveAttribute('title', '이 유형의 관리는 Phase 5에서 제공돼요')
    expect(screen.getByText('이 유형의 관리는 Phase 5에서 제공돼요')).toBeInTheDocument()
  })

  // ── 탭 배지/스피너 ───────────────────────────────────────────────────────
  it('shows an in-progress badge on the 업데이트 tab label even while a different sub-tab is active', async () => {
    operations = [
      {
        id: 'op-running',
        action: 'install',
        provider: 'generic_skills',
        target: 'pdf-tools',
        scope: null,
        status: 'running',
        created_at: '2026-07-17T14:00:00Z',
        started_at: '2026-07-17T14:00:01Z',
        finished_at: null,
        exit_code: null,
        error: null,
        verified: null,
      },
    ]
    render(<ToolingView />)
    // Default tab is 개요 — never navigate to 업데이트 in this test.
    await screen.findByRole('heading', { name: /도구 및 확장/ })

    const updatesTab = await screen.findByRole('tab', { name: /업데이트/ })
    expect(await within(updatesTab).findByText('1')).toBeInTheDocument()
  })
})
