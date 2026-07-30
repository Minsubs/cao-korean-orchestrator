import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CustomSelect } from '../components/CustomSelect'

// User-reported: the 대상 field in the 새 작업 modal stayed dark in light mode.
// CustomSelect was written with hardcoded gray-900/gray-700/gray-300 classes, so
// it ignored the theme entirely while the rest of the modal followed the design
// tokens. This pins the trigger, the open panel and the option rows to tokens.
//
// Asserted on className rather than computed colour because jsdom does not apply
// the Tailwind stylesheet — the class list is the actual contract here, and it is
// the same approach notification-center-ui.test.tsx already uses for this
// (`.toHaveClass('bg-[var(--surface)]')` / `.not.toHaveClass('bg-gray-900')`).

const OPTIONS = [
  { value: 'a', label: '첫 항목', sublabel: '설명 A' },
  { value: 'b', label: '둘째 항목' },
  { value: 'c', label: '못 고르는 항목', disabled: true },
]

/** Any hardcoded Tailwind palette colour is a theme bug in this codebase. */
const HARDCODED = /(^|\s)(bg|text|border|shadow)-(gray|slate|zinc|neutral|stone|emerald|black|white)(-|\/|\s|$)/

function assertNoHardcodedColours(el: Element, where: string) {
  const offenders: string[] = []
  const walk = (node: Element) => {
    const cls = node.getAttribute('class')
    if (cls && HARDCODED.test(cls)) offenders.push(`${node.tagName.toLowerCase()}: ${cls}`)
    for (const child of Array.from(node.children)) walk(child)
  }
  walk(el)
  expect(offenders, `hardcoded palette colours in ${where}`).toEqual([])
}

describe('CustomSelect follows the theme tokens', () => {
  it('renders the closed trigger from tokens, not a hardcoded dark palette', () => {
    const { container } = render(
      <CustomSelect value="" options={OPTIONS} onChange={() => {}} placeholder="선택하세요" />,
    )
    const trigger = screen.getByRole('button', { name: /선택하세요/ })
    expect(trigger.className).toContain('var(--surface)')
    expect(trigger.className).not.toContain('bg-gray-900')
    assertNoHardcodedColours(container.firstElementChild!, 'closed CustomSelect')
  })

  it('renders the open panel and its rows from tokens', () => {
    const { container } = render(
      <CustomSelect value="a" options={OPTIONS} onChange={() => {}} placeholder="선택하세요" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /첫 항목/ }))

    expect(screen.getByText('둘째 항목')).toBeInTheDocument()
    expect(screen.getByText('설명 A')).toBeInTheDocument()
    assertNoHardcodedColours(container.firstElementChild!, 'open CustomSelect')
  })

  it('renders the empty state from tokens', () => {
    const { container } = render(<CustomSelect value="" options={[]} onChange={() => {}} placeholder="비어 있음" />)
    fireEvent.click(screen.getByRole('button', { name: /비어 있음/ }))

    expect(screen.getByText('선택할 수 있는 항목이 없습니다')).toBeInTheDocument()
    assertNoHardcodedColours(container.firstElementChild!, 'empty CustomSelect')
  })

  it('still selects and still refuses a disabled option', () => {
    const picked: string[] = []
    render(
      <CustomSelect value="" options={OPTIONS} onChange={v => picked.push(v)} placeholder="선택하세요" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /선택하세요/ }))

    fireEvent.click(screen.getByText('못 고르는 항목'))
    expect(picked).toEqual([])

    fireEvent.click(screen.getByText('둘째 항목'))
    expect(picked).toEqual(['b'])
  })
})
