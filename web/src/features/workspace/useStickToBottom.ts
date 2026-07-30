import { useCallback, useEffect, useRef, useState } from 'react'

// 채팅 자동 스크롤 — 답변이 오면 따라 내려간다.
//
// The thread's scroll container had no scroll management at all: every reply,
// delegation card and progress update landed below the fold and the user had to
// scroll down by hand to read the answer they were waiting for.
//
// Naive "always scroll to bottom on render" is the other failure mode — it yanks
// the view away while someone is reading back through the run. So this sticks to
// the bottom only while the user is *already* at the bottom, and reports
// `atBottom` so the caller can offer a jump affordance when they are not.
//
// The threshold exists because "at the bottom" is never exact: fractional
// scrollHeight, sub-pixel line heights and smooth-scroll easing all leave a few
// pixels behind. 80px is roughly two lines — close enough to read as "at the
// bottom" without catching someone who deliberately scrolled up a paragraph.
export const BOTTOM_THRESHOLD_PX = 80

export function distanceFromBottom(el: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

export function isAtBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return distanceFromBottom(el) <= BOTTOM_THRESHOLD_PX
}

export interface StickToBottom<T extends HTMLElement> {
  /**
   * Attach to the scrolling element. A callback ref rather than a RefObject: it
   * is what `ref=` accepts without a cast, and it gives the hook the exact moment
   * the node arrives, so the scroll listener is bound there instead of in an
   * effect that could miss a remount.
   */
  ref: (node: T | null) => void
  /** False once the user has scrolled up past the threshold. */
  atBottom: boolean
  /** Jump to the newest content (the "맨 아래로" action). */
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

/**
 * @param signature changes whenever visible content changes (item count, the
 *   growing text of the last message, the pending placeholder). This is what
 *   triggers a follow-scroll — deliberately not "every render", so a per-second
 *   clock tick in the caller does not fight the user's scrolling.
 * @param resetKey changes when the conversation itself changes (session switch).
 *   Jumps to the bottom and re-arms following, since a scroll position from the
 *   previous session means nothing in this one.
 */
export function useStickToBottom<T extends HTMLElement>(
  signature: unknown,
  resetKey: unknown,
): StickToBottom<T> {
  const nodeRef = useRef<T | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  // Mirrored so the follow effect can read the latest value without listing
  // `atBottom` as a dependency — that would re-run (and re-scroll) on every
  // scroll event instead of only when content changes.
  const atBottomRef = useRef(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = nodeRef.current
    if (!el) return
    atBottomRef.current = true
    setAtBottom(true)
    el.scrollTo?.({ top: el.scrollHeight, behavior })
    // jsdom and older engines have no scrollTo on elements; assigning scrollTop
    // is the universally supported path and is what the tests observe.
    el.scrollTop = el.scrollHeight
  }, [])

  const onScroll = useCallback((event: Event) => {
    const el = event.currentTarget as T | null
    if (!el) return
    const bottom = isAtBottom(el)
    atBottomRef.current = bottom
    setAtBottom(bottom)
  }, [])

  const ref = useCallback(
    (node: T | null) => {
      if (nodeRef.current) nodeRef.current.removeEventListener('scroll', onScroll)
      nodeRef.current = node
      if (node) node.addEventListener('scroll', onScroll, { passive: true })
    },
    [onScroll],
  )

  // Conversation changed — start at the newest message.
  useEffect(() => {
    scrollToBottom('auto')
  }, [resetKey, scrollToBottom])

  // Content grew — follow it only if the user was already at the bottom.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom('auto')
  }, [signature, scrollToBottom])

  return { ref, atBottom, scrollToBottom }
}
