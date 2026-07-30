import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_ROLE, composerTargetLabel, roleBadgeFor } from '../features/workspace/roleLabel'

// Two live-verification defects, one root cause: a role word was appended to a
// display name without checking whether the name already was that word.
//   - the supervisor AgentCard printed 오케스트레이터오케스트레이터
//   - the composer's 받는 대상 button printed `codex_orchestrator_sol · 오케스트레이터`
// The second one also leaked a raw profile id into user-facing copy, which is
// what profileLabel() exists to prevent.

describe('roleBadgeFor', () => {
  it('drops the badge when it would repeat the name', () => {
    expect(roleBadgeFor('오케스트레이터', ORCHESTRATOR_ROLE)).toBeNull()
  })

  it('keeps the badge for a custom orchestrator profile with a different name', () => {
    expect(roleBadgeFor('릴리즈 지휘', ORCHESTRATOR_ROLE)).toBe(ORCHESTRATOR_ROLE)
  })

  it('ignores surrounding whitespace when comparing', () => {
    expect(roleBadgeFor(' 오케스트레이터 ', ORCHESTRATOR_ROLE)).toBeNull()
  })

  it('renders nothing for a worker card (no role passed)', () => {
    expect(roleBadgeFor('개발자', null)).toBeNull()
    expect(roleBadgeFor('개발자', undefined)).toBeNull()
  })
})

describe('composerTargetLabel', () => {
  it('shows the supervisor role once, never the profile id', () => {
    const label = composerTargetLabel('codex_orchestrator_sol', '75c0c44a', true)
    expect(label).toBe('오케스트레이터')
    expect(label).not.toContain('codex_orchestrator_sol')
  })

  it('keeps the role suffix when the orchestrator profile reads differently', () => {
    // An unknown profile falls back to profileLabel()'s underscore→space form,
    // so the 오케스트레이터 mark is what identifies it as the fixed role.
    expect(composerTargetLabel('release_captain', 't1', true)).toBe('release captain · 오케스트레이터')
  })

  it('labels a worker by its role name alone', () => {
    expect(composerTargetLabel('claude_developer_sonnet', 'abcdef12', false)).toBe('개발자')
  })

  it('falls back to the short terminal id when a terminal has no profile', () => {
    expect(composerTargetLabel(null, 'abcdef1234', false)).toBe('abcdef12')
  })
})
