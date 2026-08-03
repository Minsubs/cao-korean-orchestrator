import { describe, it, expect } from 'vitest'
import { contentSecurityPolicy, withCspHeader } from '../src/csp'

function directive(name: string): string {
  const found = contentSecurityPolicy()
    .split('; ')
    .find(part => part.startsWith(name + ' '))
  return found ?? ''
}

describe('contentSecurityPolicy', () => {
  it('allows no inline script and no eval — the rule Electron warns about', () => {
    expect(directive('script-src')).toBe("script-src 'self'")
  })

  it('permits inline styles, which element-level styling needs', () => {
    // The terminal and graph views set styles on elements directly; a nonce
    // cannot cover style attributes.
    expect(directive('style-src')).toContain("'unsafe-inline'")
  })

  it('lets the UI reach its own server over http and websockets', () => {
    // SSE and WebSocket traffic to loopback is what drives the whole UI.
    const connect = directive('connect-src')
    expect(connect).toContain('http://127.0.0.1:*')
    expect(connect).toContain('ws://127.0.0.1:*')
  })

  it('allows data/blob images for the data-URI favicon and captures', () => {
    expect(directive('img-src')).toContain('data:')
    expect(directive('img-src')).toContain('blob:')
  })

  it('shuts the doors nothing here needs', () => {
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive('form-action')).toBe("form-action 'none'")
  })
})

describe('withCspHeader', () => {
  it('keeps unrelated headers', () => {
    const merged = withCspHeader({ 'Content-Type': ['text/html'] })
    expect(merged['Content-Type']).toEqual(['text/html'])
  })

  it('replaces an existing policy rather than adding a second one', () => {
    // Two policies intersect, so a server that grew its own header later would
    // silently tighten ours into something nobody tested.
    const merged = withCspHeader({ 'content-security-policy': ["default-src 'none'"] })
    const keys = Object.keys(merged).filter(k => k.toLowerCase() === 'content-security-policy')

    expect(keys).toHaveLength(1)
    expect((merged['Content-Security-Policy'] as string[])[0]).toContain("script-src 'self'")
  })
})
