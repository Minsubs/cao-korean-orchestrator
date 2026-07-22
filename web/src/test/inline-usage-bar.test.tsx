import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InlineUsageBar } from '../features/usage/InlineUsageBar'
import type { UsageAccount } from '../api.usage'

const acc = (provider: string, usedPercent: number | null): UsageAccount => ({
  provider, present: true, source: 'x', today: null, week: null, by_model_today: [],
  rate_limits: usedPercent === null ? null
    : { plan: null, primary: { used_percent: usedPercent, window_minutes: 300, resets_at: 0 }, secondary: null, captured_at: '' },
  last_activity: null, note: '',
})

describe('InlineUsageBar', () => {
  it('renders a percent bar for a provider with rate_limits', () => {
    render(<InlineUsageBar provider="antigravity_cli" accounts={[acc('antigravity_cli', 60)]} />)
    expect(screen.getByText(/60/)).toBeInTheDocument()
  })
  it('shows a no-data hint when the provider has no rate_limits', () => {
    render(<InlineUsageBar provider="antigravity_cli" accounts={[acc('antigravity_cli', null)]} />)
    expect(screen.getByText(/사용량 데이터 없음|데이터 없음/)).toBeInTheDocument()
  })
})
