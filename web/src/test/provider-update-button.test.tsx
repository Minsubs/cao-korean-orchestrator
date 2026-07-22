import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProviderRow } from '../features/tooling/OverviewPane'
import type { ToolingProvider } from '../api.tooling'

const provider: ToolingProvider = {
  name: 'codex', display_name: 'Codex', binary: 'codex', installed: true,
  path: '/usr/bin/codex', version: '0.144.6', version_raw: '0.144.6', version_error: null, checked_at: '',
} as any

describe('ProviderRow update button', () => {
  it('calls onUpdate with the provider when clicked (installed only)', () => {
    const onUpdate = vi.fn()
    render(<ProviderRow provider={provider} withBorder={false} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: /업데이트/ }))
    expect(onUpdate).toHaveBeenCalledWith('codex')
  })
  it('hides the update button for a not-installed provider', () => {
    render(<ProviderRow provider={{ ...provider, installed: false }} withBorder={false} onUpdate={() => {}} />)
    expect(screen.queryByRole('button', { name: /업데이트/ })).toBeNull()
  })
})
