import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DelegationHierarchy } from '../features/workspace/DelegationHierarchy'

describe('DelegationHierarchy', () => {
  it('shows the orchestrator at top and role-group boxes below', () => {
    render(<DelegationHierarchy
      orchestrator={{ name: 'codex_orchestrator_sol', provider: 'codex', model: 'gpt-5.6-sol', terminalId: 't0' }}
      agents={[{ name: 'codex_qa_terra', provider: 'codex', model: 'gpt-5.6-terra', terminalId: 't1' }]}
      statuses={{ t1: 'PROCESSING' }} />)
    expect(screen.getByText(/오케스트레이터/)).toBeInTheDocument()
    expect(screen.getByText('검증·문서')).toBeInTheDocument()
  })

  it('highlights the active role group (a member terminal is PROCESSING)', () => {
    render(<DelegationHierarchy
      orchestrator={{ name: 'codex_orchestrator_sol', provider: 'codex', model: 'gpt-5.6-sol', terminalId: 't0' }}
      agents={[{ name: 'codex_qa_terra', provider: 'codex', model: 'gpt-5.6-terra', terminalId: 't1' }]}
      statuses={{ t1: 'PROCESSING' }} />)
    const group = screen.getByText('검증·문서').closest('section')
    expect(group).toHaveClass('border-[var(--warning)]')
  })

  it('leaves an idle role group dashed/neutral (no member terminal is PROCESSING)', () => {
    render(<DelegationHierarchy
      orchestrator={{ name: 'codex_orchestrator_sol', provider: 'codex', model: 'gpt-5.6-sol', terminalId: 't0' }}
      agents={[{ name: 'codex_qa_terra', provider: 'codex', model: 'gpt-5.6-terra', terminalId: 't1' }]}
      statuses={{ t1: 'idle' }} />)
    const group = screen.getByText('검증·문서').closest('section')
    expect(group).not.toHaveClass('border-[var(--warning)]')
    expect(group).toHaveClass('border-dashed')
  })
})
