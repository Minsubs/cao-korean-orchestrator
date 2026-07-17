import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContextGaugeChip } from '../features/workspace/ContextGaugeChip'

describe('ContextGaugeChip (Phase 2d spec §2d — display-only gauge chip)', () => {
  it('renders nothing for null (no gauge available) — takes up no layout space', () => {
    const { container } = render(<ContextGaugeChip percentLeft={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for undefined, same as null', () => {
    const { container } = render(<ContextGaugeChip percentLeft={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders "잔여 NN%" for a real value', () => {
    render(<ContextGaugeChip percentLeft={42} />)
    expect(screen.getByText('잔여 42%')).toBeInTheDocument()
  })

  it('renders 0% honestly rather than treating it like null', () => {
    render(<ContextGaugeChip percentLeft={0} />)
    expect(screen.getByText('잔여 0%')).toBeInTheDocument()
  })
})
