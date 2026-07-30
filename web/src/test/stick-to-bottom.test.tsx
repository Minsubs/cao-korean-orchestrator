import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { useCallback } from 'react'
import { BOTTOM_THRESHOLD_PX, isAtBottom, useStickToBottom } from '../features/workspace/useStickToBottom'

// 채팅 자동 스크롤. The thread had no scroll management at all — a reply landed
// below the fold and the user had to scroll down by hand to read the answer they
// were waiting for.
//
// Both halves of the contract matter equally: follow new content when the user is
// at the bottom, and DON'T when they have scrolled up to read the run back. A
// test for only the first half would pass an implementation that yanks the view
// away mid-read, which is the usual way this gets over-corrected.
//
// jsdom does no layout: scrollHeight/clientHeight are always 0 and the
// `scrollTop` setter is a no-op, so a write from the hook would be invisible.
// `attachScroller` installs an instance-level scrollTop backed by a real
// variable, plus the geometry under test — the minimum needed for the hook's
// arithmetic to mean anything here.

interface Geometry {
  scrollHeight: number
  clientHeight: number
}

function attachScroller(el: HTMLElement, geometry: Geometry) {
  if ((el as { __scrollPatched?: boolean }).__scrollPatched) return
  ;(el as { __scrollPatched?: boolean }).__scrollPatched = true
  let top = 0
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value
    },
  })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => geometry.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => geometry.clientHeight })
}

/** Mirrors Thread.tsx: signature changes per reply, resetKey is the session. */
function Probe({
  signature,
  session = 'sess-a',
  geometry,
  expose,
}: {
  signature: unknown
  session?: string
  geometry: Geometry
  expose?: (api: ReturnType<typeof useStickToBottom<HTMLDivElement>>) => void
}) {
  const stick = useStickToBottom<HTMLDivElement>(signature, session)
  expose?.(stick)
  // Patch before handing the node to the hook, so the geometry is in place when
  // the hook binds its listener and its first effect reads scrollHeight — a read
  // of 0 would look like "already at the bottom" for the wrong reason.
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) attachScroller(node, geometry)
      stick.ref(node)
    },
    [stick.ref, geometry],
  )
  return (
    <div ref={attach} data-testid="scroller">
      <span data-testid="at-bottom">{String(stick.atBottom)}</span>
    </div>
  )
}

describe('isAtBottom', () => {
  it('treats a few pixels of slack as the bottom', () => {
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })).toBe(true)
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 - BOTTOM_THRESHOLD_PX })).toBe(true)
  })

  it('is false once the user has scrolled up past the threshold', () => {
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 - BOTTOM_THRESHOLD_PX - 1 })).toBe(false)
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })).toBe(false)
  })
})

describe('useStickToBottom', () => {
  it('starts at the newest message', () => {
    const geometry = { scrollHeight: 1000, clientHeight: 400 }
    const view = render(<Probe signature={1} geometry={geometry} />)
    expect(view.getByTestId('scroller').scrollTop).toBe(1000)
  })

  it('follows a reply while the user is at the bottom', () => {
    const geometry = { scrollHeight: 1000, clientHeight: 400 }
    const view = render(<Probe signature={1} geometry={geometry} />)
    const el = view.getByTestId('scroller')

    geometry.scrollHeight = 2000
    view.rerender(<Probe signature={2} geometry={geometry} />)
    expect(el.scrollTop).toBe(2000)
  })

  it('leaves the view alone when the user has scrolled up', () => {
    const geometry = { scrollHeight: 1000, clientHeight: 400 }
    const view = render(<Probe signature={1} geometry={geometry} />)
    const el = view.getByTestId('scroller')

    act(() => {
      el.scrollTop = 100
      el.dispatchEvent(new Event('scroll'))
    })
    expect(view.getByTestId('at-bottom').textContent).toBe('false')

    geometry.scrollHeight = 2000
    view.rerender(<Probe signature={2} geometry={geometry} />)
    expect(el.scrollTop).toBe(100)
  })

  it('re-arms following after a jump back to the bottom', () => {
    const geometry = { scrollHeight: 1000, clientHeight: 400 }
    let api: ReturnType<typeof useStickToBottom<HTMLDivElement>> | null = null
    const view = render(<Probe signature={1} geometry={geometry} expose={a => (api = a)} />)
    const el = view.getByTestId('scroller')

    act(() => {
      el.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
    })
    act(() => api!.scrollToBottom())
    expect(el.scrollTop).toBe(1000)
    expect(view.getByTestId('at-bottom').textContent).toBe('true')

    geometry.scrollHeight = 2000
    view.rerender(<Probe signature={2} geometry={geometry} expose={a => (api = a)} />)
    expect(el.scrollTop).toBe(2000)
  })

  it('jumps to the bottom on a session switch even if the old view was scrolled up', () => {
    const geometry = { scrollHeight: 1000, clientHeight: 400 }
    const view = render(<Probe signature="same" session="sess-a" geometry={geometry} />)
    const el = view.getByTestId('scroller')

    act(() => {
      el.scrollTop = 50
      el.dispatchEvent(new Event('scroll'))
    })

    // Signature deliberately unchanged: switching conversations must scroll on
    // its own, not depend on the new session happening to have a different
    // message count.
    view.rerender(<Probe signature="same" session="sess-b" geometry={geometry} />)
    expect(el.scrollTop).toBe(1000)
  })
})
