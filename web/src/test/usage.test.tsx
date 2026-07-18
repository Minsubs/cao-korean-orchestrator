import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageAccount, UsageAccountsResponse } from '../api.usage'
import { UsageButton } from '../features/usage/UsageButton'
import { formatTokenCount, windowLabel } from '../features/usage/formatTokens'

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

describe('UsageButton', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the highest measured percent badge and renders account details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(response([account('claude_code', null), account('codex', 27)]))),
    )

    render(<UsageButton />)

    expect(await screen.findByText('27%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI 사용량' }))
    expect(screen.getByRole('dialog', { name: 'AI 계정 사용량' })).toBeInTheDocument()
    expect(screen.getByText('prolite')).toBeInTheDocument()
    expect(screen.getByText('주간 한도 27.0% 사용')).toBeInTheDocument()
    expect(screen.getByText(/3일 후 리셋/)).toBeInTheDocument()
    expect(screen.getByText('1.2M')).toBeInTheDocument()
    expect(screen.getAllByText('실측 데이터 안내')).toHaveLength(2)
  })

  it('settles the initial request under React StrictMode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([account('codex', 27)]))))

    render(
      <StrictMode>
        <UsageButton />
      </StrictMode>,
    )

    expect(await screen.findByText('27%')).toBeInTheDocument()
  })

  it('uses the warning token for a badge at or above eighty percent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([account('codex', 80)]))))

    render(<UsageButton />)

    expect(await screen.findByText('80%')).toHaveClass('text-[var(--warning)]')
  })

  it('omits the summary badge when no measured primary limit exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([account('codex', null)]))))

    render(<UsageButton />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 사용량' }))
    await screen.findByText('Codex')

    expect(screen.getByRole('button', { name: 'AI 사용량' })).not.toHaveTextContent('%')
  })

  it('does not render absent accounts and shows the honest empty state', async () => {
    const absent = { ...account('codex', null), present: false }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(response([absent]))))

    render(<UsageButton />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 사용량' }))

    expect(await screen.findByText(/표시할 사용량 데이터가 없어요/)).toBeInTheDocument()
    expect(screen.queryByText('Codex')).not.toBeInTheDocument()
  })

  it('changes the request query after Claude limit opt-in', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(response([account('claude_code', null)])))
    vi.stubGlobal('fetch', fetchMock)
    render(<UsageButton />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 사용량' }))
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
    render(<UsageButton />)
    await waitFor(() => expect(localCalls).toBe(1))
    await act(async () => Promise.resolve())
    fireEvent.click(screen.getByRole('button', { name: 'AI 사용량' }))
    await screen.findByText('Claude Code')
    await waitFor(() => expect(localCalls).toBe(2))
    fireEvent.click(screen.getByRole('switch', { name: '한도 실측 조회' }))
    expect(await screen.findByText('80%')).toBeInTheDocument()

    resolveStale?.()
    await act(async () => Promise.resolve())

    expect(screen.getByText('80%')).toBeInTheDocument()
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

    render(<UsageButton />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 사용량' }))

    expect(await screen.findByText('5시간 한도 12.3% 사용')).toBeInTheDocument()
    expect(screen.getByText('주간 한도 63.0% 사용')).toBeInTheDocument()
    expect(screen.getByText('Anthropic OAuth 사용량 API 실측')).toBeInTheDocument()
  })

  it('shows a connection error instead of fabricated data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))

    render(<UsageButton />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 사용량' }))

    expect(await screen.findByText('사용량 API에 연결할 수 없어요')).toBeInTheDocument()
    expect(screen.queryByText(/한도 \d/)).not.toBeInTheDocument()
  })

  it('clears the sixty-second refresh timer when unmounted', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => jsonResponse(response([account('codex', 27)])))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<UsageButton />)
    await act(async () => Promise.resolve())
    fireEvent.click(screen.getByRole('button', { name: 'AI 사용량' }))
    await act(async () => Promise.resolve())
    const callsBeforeUnmount = fetchMock.mock.calls.length
    view.unmount()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmount)
  })
})
