import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProviderRow } from '../features/tooling/OverviewPane'
import type { ToolingProvider } from '../api.tooling'

const uninstalled = { name: 'kiro_cli', display_name: 'Kiro CLI', binary: 'kiro-cli', installed: false, path: null, version: null, version_raw: null, version_error: null, checked_at: '' } as any as ToolingProvider

describe('ProviderRow install button', () => {
  it('calls onInstall for a not-installed provider', () => {
    const onInstall = vi.fn()
    render(<ProviderRow provider={uninstalled} withBorder={false} onInstall={onInstall} />)
    fireEvent.click(screen.getByRole('button', { name: /설치/ }))
    expect(onInstall).toHaveBeenCalledWith('kiro_cli')
  })
  it('shows no install button for an installed provider', () => {
    render(<ProviderRow provider={{ ...uninstalled, installed: true, version: '1.0' } as any} withBorder={false} onInstall={() => {}} />)
    expect(screen.queryByRole('button', { name: /^설치$/ })).toBeNull()
  })
})
