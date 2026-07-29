import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingOverlay } from '../components/LoadingOverlay'
import { useStore } from '../store'

describe('LoadingOverlay', () => {
  beforeEach(() => { const s = useStore.getState(); while (s.overlay.count > 0) s.hideOverlay() })
  it('renders nothing when count is 0', () => {
    const { container } = render(<LoadingOverlay />)
    expect(container).toBeEmptyDOMElement()
  })
  it('renders huni + message when shown', () => {
    useStore.getState().showOverlay('작업을 준비하고 있어요', '잠시만 기다려주세요')
    render(<LoadingOverlay />)
    expect(screen.getByText('작업을 준비하고 있어요')).toBeInTheDocument()
    expect(screen.getByText('잠시만 기다려주세요')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /huni|로딩/i })).toBeInTheDocument()
  })
})
