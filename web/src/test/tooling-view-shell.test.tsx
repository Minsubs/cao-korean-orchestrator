import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ToolingView } from '../features/tooling/ToolingView'

// Regression test for the WSL "Tooling page takes forever to appear" complaint:
// the whole view used to gate on a single `loading` flag covering ALL of
// environment/providers/extensions/diagnostics, so a slow cold CLI probe kept
// the header and tabs themselves from rendering at all — see
// ToolingView.tsx's per-pane loading/error props for the fix (shell renders
// immediately; only the active tab's content area shows a skeleton while its
// data is still in flight).
describe('ToolingView shell (instant render)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the header and tablist immediately, before any core probe resolves', () => {
    // Never-resolving fetch simulates a stuck/slow WSL cold CLI probe — the
    // four core reads (environment/providers/extensions/diagnostics) all stay
    // pending for the lifetime of this test, so `loading` never flips false.
    const pendingFetch = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', pendingFetch)

    render(<ToolingView />)

    // These must already be present synchronously after the initial render —
    // no `findBy`/await needed, since nothing has (or ever will, in this
    // test) resolved yet.
    expect(screen.getByRole('heading', { name: /도구 및 확장/ })).toBeInTheDocument()
    const tablist = screen.getByRole('tablist', { name: '도구 및 확장 하위 탭' })
    expect(within(tablist).getAllByRole('tab').length).toBeGreaterThan(0)

    // The body shows the busy skeleton in place of the active tab's content
    // (rather than blank/no-content) while the section is still loading.
    expect(screen.getByLabelText('도구 및 확장 불러오는 중')).toBeInTheDocument()
  })
})
