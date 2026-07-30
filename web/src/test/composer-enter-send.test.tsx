import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Composer } from '../features/workspace/Composer'

// User-reported: Enter inserted a newline instead of sending, even though the
// placeholder promises "Shift+Enter 줄바꿈" — i.e. it advertises Enter as send.
// Only ⌘/Ctrl+Enter sent, so the label and the behaviour disagreed.
//
// The IME cases are the important ones here: this is a Korean-first UI, and
// while a Hangul syllable is being composed Enter is the key that *commits* the
// composition. Sending on that keystroke would fire off half-typed text on
// virtually every Korean sentence, so it is guarded explicitly.

function props(over: Partial<ComponentProps<typeof Composer>> = {}): ComponentProps<typeof Composer> {
  return {
    sessionName: 'sess',
    target: null,
    targets: [],
    onChangeTarget: () => {},
    onSend: vi.fn(),
    sending: false,
    streamStatus: 'connected',
    ...over,
  } as ComponentProps<typeof Composer>
}

function typeInto(value: string) {
  const textarea = screen.getByLabelText('메시지 입력')
  fireEvent.change(textarea, { target: { value } })
  return textarea
}

describe('Composer Enter behaviour matches its own label', () => {
  it('sends on a plain Enter', () => {
    const onSend = vi.fn()
    render(<Composer {...props({ onSend })} />)
    const textarea = typeInto('보낼 내용')

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0]).toBe('보낼 내용')
  })

  it('does not send on Shift+Enter — that is the newline', () => {
    const onSend = vi.fn()
    render(<Composer {...props({ onSend })} />)
    const textarea = typeInto('첫 줄')

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('still sends on ⌘/Ctrl+Enter', () => {
    const onSend = vi.fn()
    const { unmount } = render(<Composer {...props({ onSend })} />)
    fireEvent.keyDown(typeInto('메타'), { key: 'Enter', metaKey: true })
    expect(onSend).toHaveBeenCalledTimes(1)
    unmount()

    const onSend2 = vi.fn()
    render(<Composer {...props({ onSend: onSend2 })} />)
    fireEvent.keyDown(typeInto('컨트롤'), { key: 'Enter', ctrlKey: true })
    expect(onSend2).toHaveBeenCalledTimes(1)
  })

  it('does not send while a Hangul syllable is still being composed (isComposing)', () => {
    const onSend = vi.fn()
    render(<Composer {...props({ onSend })} />)
    const textarea = typeInto('한글')

    // Enter that commits an in-flight IME composition.
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not send on the IME commit keycode (229) either', () => {
    const onSend = vi.fn()
    render(<Composer {...props({ onSend })} />)
    const textarea = typeInto('한글')

    // Some IMEs report the composition-commit keystroke as keyCode 229 without
    // setting isComposing on the keydown.
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends the composed text once composition has ended', () => {
    const onSend = vi.fn()
    render(<Composer {...props({ onSend })} />)
    const textarea = typeInto('한글 입력 끝')

    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0]).toBe('한글 입력 끝')
  })

  it('does not send an empty or whitespace-only message', () => {
    const onSend = vi.fn()
    render(<Composer {...props({ onSend })} />)
    const textarea = typeInto('   ')

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('tells the user both keys in the hint', () => {
    render(<Composer {...props()} />)
    const hint = screen.getByText(/전송/)
    expect(hint.textContent).toMatch(/⏎ 전송/)
    expect(hint.textContent).toMatch(/Shift/)
  })
})
