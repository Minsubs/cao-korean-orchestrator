import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatBubble } from '../features/workspace/Thread'
import type { ChatEntry } from '../features/workspace/types'

describe('원문 보기 toggle', () => {
  it('reveals raw when the entry has a different raw', () => {
    const entry: ChatEntry = { id: 'a1', role: 'assistant', content: '완료했어요.', raw: '• Called x\n\n완료했어요.', ts: 1 }
    render(<ChatBubble entry={entry} />)
    expect(screen.queryByText(/Called x/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '원문 보기' }))
    expect(screen.getByText(/Called x/)).toBeInTheDocument()
  })

  it('shows no toggle when raw equals content', () => {
    const entry: ChatEntry = { id: 'a2', role: 'assistant', content: '동일', raw: '동일', ts: 1 }
    render(<ChatBubble entry={entry} />)
    expect(screen.queryByRole('button', { name: '원문 보기' })).toBeNull()
  })
})
