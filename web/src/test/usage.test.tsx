import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageAccount, UsageAccountsResponse } from '../api.usage'
import { HeaderUsageBars } from '../features/usage/HeaderUsageBars'
import { UsageAccountsSection } from '../features/usage/UsageAccountsSection'
import { formatTokenCount, windowLabel } from '../features/usage/formatTokens'

// Contract change (사용자 요청): the header's 사용량 button + popover is gone.
//   - the header now shows an always-visible bar per active AI (HeaderUsageBars)
//   - the detail — account cards, token totals, the Claude 한도 실측 opt-in,
//     새로고침, scanned_at — moved to 설정 › AI 계정 사용량 (UsageAccountsSection)
//
// Every assertion below survived that move; what changed is the component under
// test and the removal of the `fireEvent.click(...)` that used to open the
// popover. The detail behaviours (honest empty state, no fabricated data on a
// failed request, stale-response protection, opt-in query switch) are the same
// contract — they were never about the popover, only rendered inside it.

function account(provider: string, usedPercent: number | null): UsageAccount {
  return {
    provider,
    present: true,
    source: provider === 'codex' ? 'rollouts' : 'transcripts',
    today: { input: 100, output: 200, cache_read: 300, cache_creation: 400, total: provider === 'claude_code' ? 1_200_000 : 1_000 },
    week: { input: 200, output: 400, cache_read: 600, cache_creation: 800, total: 2_000 },
    by_model_today: provider === 'claude_code' ? [{ model: 'claude-sonnet', total: 1_200_000 }] : [],
    rate_limits:
      usedPercent === null
        ? null
        : {
            plan: 'prolite',
            primary: { used_percent: usedPercent, window_minutes: 10080, resets_at: Date.now() / 1000 + 3 * 86400 + 60 },
            secondary: null,
            captured_at: new Date().toISOString(),
          },
    last_activity: new Date().toISOString(),
    note: '실측 데이터 안내',
  }
}

function response(accounts: UsageAccount[]): UsageAccountsResponse {
  return { accounts, scanned_at: new Date().toISOString() }
}

function jsonResponse(data: UsageAccountsResponse) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

describe('usage formatting', () => {
  it('formats token counts and known rate-limit windows', () => {
    expect(formatTokenCount(1_200_000)).toBe('1.2M')
    expect(formatTokenCount(534_000)).toBe('534K')
    expect(windowLabel(10080)).toBe('주간')
    expect(windowLabel(300)).toBe('5시간')
  })
})

describe('HeaderUsageBars', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows one bar per AI with a measured limit, and none for an AI without one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(response([account('claude_code', null), account('codex', 27)]))),
    )

    render(<HeaderUsageBars />)

    expect(await screen.findByText('27%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Codex 한도 사용량' })).toHaveAttribute('aria-valuenow', '27')
    // claude_code has rate_limits: null — an empty track would read as "0% used",
    // which is a fabricated reading, so it contributes no bar at all.
    expect(screen.queryByRole('progressbar', { name: 'Claude Code 한도 사용량' })).not.toBeInTheDocument()
  })

  it('no longer renders the old 사용량 button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([account('codex', 27)]))))
    render(<HeaderUsageBars />)
    await screen.findByText('27%')
    expect(screen.queryByRole('button', { name: 'AI 사용량' })).not.toBeInTheDocument()
  })

  it('settles the initial request under React StrictMode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([account('codex', 27)]))))

    render(
      <StrictMode>
        <HeaderUsageBars />
      </StrictMode>,
    )

    expect(await screen.findByText('27%')).toBeInTheDocument()
  })

  it('uses the warning token at or above eighty percent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([account('codex', 80)]))))

    render(<HeaderUsageBars />)

    expect(await screen.findByText('80%')).toHaveClass('text-[var(--warning)]')
  })

  it('renders nothing at all when no limit is measured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([account('codex', null)]))))

    const view = render(<HeaderUsageBars />)
    await act(async () => Promise.resolve())

    expect(view.container).toBeEmptyDOMElement()
  })

  it('clears the sixty-second refresh timer when unmounted', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => jsonResponse(response([account('codex', 27)])))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<HeaderUsageBars />)
    await act(async () => Promise.resolve())
    const callsBeforeUnmount = fetchMock.mock.calls.length
    view.unmount()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmount)
  })
})

describe('UsageAccountsSection (설정 › AI 계정 사용량)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders account details without needing any click', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(response([account('claude_code', null), account('codex', 27)]))),
    )

    render(<UsageAccountsSection />)

    expect(await screen.findByText('prolite')).toBeInTheDocument()
    expect(screen.getByText('주간 한도 27.0% 사용')).toBeInTheDocument()
    expect(screen.getByText(/3일 후 리셋/)).toBeInTheDocument()
    expect(screen.getByText('1.2M')).toBeInTheDocument()
    expect(screen.getAllByText('실측 데이터 안내')).toHaveLength(2)
  })

  it('keeps 새로고침 reachable now that the popover is gone', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(response([account('codex', 27)])))
    vi.stubGlobal('fetch', fetchMock)
    render(<UsageAccountsSection />)
    await screen.findByText('prolite')
    const before = fetchMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: '사용량 새로고침' }))

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before))
  })

  it('does not render absent accounts and shows the honest empty state', async () => {
    const absent = { ...account('codex', null), present: false }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([absent]))))

    render(<UsageAccountsSection />)

    expect(await screen.findByText(/표시할 사용량 데이터가 없어요/)).toBeInTheDocument()
    expect(screen.queryByText('Codex')).not.toBeInTheDocument()
  })

  it('changes the request query after Claude limit opt-in', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(response([account('claude_code', null)])))
    vi.stubGlobal('fetch', fetchMock)
    render(<UsageAccountsSection />)
    const optInSwitch = await screen.findByRole('switch', { name: '한도 실측 조회' })
    expect(optInSwitch).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/저장된 Claude 로그인 토큰으로 Anthropic 사용량 API를 조회해요/)).toBeInTheDocument()
    fireEvent.click(optInSwitch)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/usage/accounts?claude_limits=true',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    expect(window.localStorage.getItem('cao:usage:claude-limits-optin:v1')).toBe('true')
  })

  it('does not let a stale pre-opt-in request overwrite measured limits', async () => {
    const localOnly = response([account('claude_code', null)])
    const measured = response([account('claude_code', 80)])
    let resolveStale: (() => void) | undefined
    let localCalls = 0
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('claude_limits=true')) return Promise.resolve(jsonResponse(measured))
      localCalls += 1
      if (localCalls === 1) return Promise.resolve(jsonResponse(localOnly))
      return new Promise<ReturnType<typeof jsonResponse>>(resolve => {
        resolveStale = () => resolve(jsonResponse(localOnly))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<UsageAccountsSection />)
    await waitFor(() => expect(localCalls).toBe(1))
    await act(async () => Promise.resolve())
    await screen.findByText('Claude Code')
    fireEvent.click(screen.getByRole('switch', { name: '한도 실측 조회' }))
    expect(await screen.findByText('주간 한도 80.0% 사용')).toBeInTheDocument()

    resolveStale?.()
    await act(async () => Promise.resolve())

    expect(screen.getByText('주간 한도 80.0% 사용')).toBeInTheDocument()
  })

  it('renders Claude five-hour and weekly measured limits with the backend note', async () => {
    const claude = account('claude_code', 12.3)
    claude.rate_limits = {
      plan: 'team',
      primary: { used_percent: 12.3, window_minutes: 300, resets_at: Date.now() / 1000 + 3600 },
      secondary: { used_percent: 63, window_minutes: 10080, resets_at: Date.now() / 1000 + 3 * 86400 },
      captured_at: new Date().toISOString(),
    }
    claude.note = 'Anthropic OAuth 사용량 API 실측'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([claude]))))

    render(<UsageAccountsSection />)

    expect(await screen.findByText('5시간 한도 12.3% 사용')).toBeInTheDocument()
    expect(screen.getByText('주간 한도 63.0% 사용')).toBeInTheDocument()
    expect(screen.getByText('Anthropic OAuth 사용량 API 실측')).toBeInTheDocument()
  })

  it('shows a connection error instead of fabricated data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))

    render(<UsageAccountsSection />)

    expect(await screen.findByText('사용량 API에 연결할 수 없어요')).toBeInTheDocument()
    expect(screen.queryByText(/한도 \d/)).not.toBeInTheDocument()
  })
})
