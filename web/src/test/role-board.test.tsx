import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoleBoard } from '../features/workspace/RoleBoard'

describe('RoleBoard', () => {
  it('renders role-group headers with the agents under them', () => {
    render(<RoleBoard
      agents={[
        { name: 'codex_orchestrator_sol', provider: 'codex', model: 'gpt-5.6-sol' },
        { name: 'codex_qa_terra', provider: 'codex', model: 'gpt-5.6-terra' },
      ]}
      statuses={{}} />)
    // codex_orchestrator_sol's own profileLabel is also '오케스트레이터', so the
    // group header (an <h3>) is targeted by role rather than a bare text query.
    expect(screen.getByRole('heading', { name: /오케스트레이터/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /검증·문서/ })).toBeInTheDocument()
    expect(screen.getByText('gpt-5.6-sol')).toBeInTheDocument()  // model badge
  })

  it('shows the unknown/not-run status fallback for agents without a live terminal status', () => {
    render(<RoleBoard
      agents={[{ name: 'codex_orchestrator_sol', provider: 'codex', model: 'gpt-5.6-sol' }]}
      statuses={{}} />)
    expect(screen.getByText('알 수 없음')).toBeInTheDocument()
  })
})
