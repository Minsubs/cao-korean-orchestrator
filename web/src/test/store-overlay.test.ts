import { describe, expect, it, beforeEach } from 'vitest'
import { useStore } from '../store'

describe('overlay store (ref-counted)', () => {
  beforeEach(() => { while (useStore.getState().overlay.count > 0) useStore.getState().hideOverlay() })
  it('shows with message and increments count', () => {
    useStore.getState().showOverlay('처리 중…', '워커 생성 중')
    const o = useStore.getState().overlay
    expect(o.count).toBe(1); expect(o.message).toBe('처리 중…'); expect(o.sub).toBe('워커 생성 중')
  })
  it('nested show/hide is ref-counted and never goes negative', () => {
    const s = () => useStore.getState()
    s().showOverlay('a'); s().showOverlay('b')
    expect(s().overlay.count).toBe(2)
    s().hideOverlay(); expect(s().overlay.count).toBe(1)
    s().hideOverlay(); s().hideOverlay()
    expect(s().overlay.count).toBe(0)
  })
})
