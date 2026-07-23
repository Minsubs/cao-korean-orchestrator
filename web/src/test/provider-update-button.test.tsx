import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OverviewPane, ProviderRow } from '../features/tooling/OverviewPane'
import type { ToolingEnvironment, ToolingProvider } from '../api.tooling'

const provider: ToolingProvider = {
  name: 'codex', display_name: 'Codex', binary: 'codex', installed: true,
  path: '/usr/bin/codex', version: '0.144.6', version_raw: '0.144.6', version_error: null, checked_at: '',
} as any

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

describe('OverviewPane update wiring', () => {
  // Locks the actual request payload shape OverviewPane sends -- the exact
  // class of gap that caused the original bug: canUpdate/'update' overloaded
  // the per-MCP-server update action, which requires a target and 400s
  // without one. This asserts the real mapping end-to-end (not just
  // ProviderRow's onUpdate('codex') callback above), so an accidental revert
  // back to `action: 'update'` fails here in CI instead of only as a live 400.
  it('sends { action: "update_all", provider } to onRequestAction when 업데이트 is clicked', () => {
    const onRequestAction = vi.fn()
    render(
      <OverviewPane
        environment={ENVIRONMENT}
        providers={[provider]}
        extensionCount={0}
        diagnosticsWarnCount={0}
        scannedAt={null}
        rescanning={false}
        rescanError={null}
        onRescan={() => {}}
        onRequestAction={onRequestAction}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /업데이트/ }))
    expect(onRequestAction).toHaveBeenCalledTimes(1)
    expect(onRequestAction).toHaveBeenCalledWith({ action: 'update_all', provider: 'codex' })
  })
})
