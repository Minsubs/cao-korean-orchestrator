import { describe, it, expect, vi, afterEach } from 'vitest'
import { toolingApi } from '../api.tooling'

// Regression coverage for the Tooling ERR_ABORTED bug (see
// features/tooling/ToolingView.tsx and the RCA it links to): fetchJSON's
// abort timeout used to default to 10s, which was too tight for WSL's slow
// cold CLI probes (catalog ~20s+) and self-aborted into `net::ERR_ABORTED`
// before the real backend ever got a chance to respond. These tests assert
// the timeout VALUE passed to `setTimeout` rather than actually waiting it
// out, so they stay fast and deterministic.
describe('toolingApi — read-path abort timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('defaults to a 60s abort timeout for a read GET with no explicit timeoutMs', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    // Never resolves — we only need to inspect the synchronous setTimeout
    // call fetchJSON makes before its first await, not a real response.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    void toolingApi.getEnvironment()

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000)
  })

  it('applies the same 60s default to every core/discover/sources read ToolingView depends on', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    void toolingApi.listProviders()
    void toolingApi.listExtensions()
    void toolingApi.listDiagnostics()
    void toolingApi.listAdapters()
    void toolingApi.listCatalog()
    void toolingApi.getSources()
    void toolingApi.listOperations()

    const timeoutValues = setTimeoutSpy.mock.calls.map(call => call[1])
    expect(timeoutValues).toEqual(new Array(7).fill(60000))
  })

  it('leaves the explicit write-path timeouts (scan/execute, 30s) unchanged — not lowered, not raised', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    void toolingApi.scan()
    void toolingApi.execute({ action: 'install', provider: 'generic_skills', target: 'my-skill' })

    const timeoutValues = setTimeoutSpy.mock.calls.map(call => call[1])
    expect(timeoutValues).toEqual([30000, 30000])
  })
})
