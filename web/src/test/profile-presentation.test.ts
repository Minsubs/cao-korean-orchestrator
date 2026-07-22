import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_PROFILES,
  isOrchestratorProfile,
  profileSection,
  workerGroup,
  additionalProfileRole,
} from '../features/profiles/profilePresentation'
import type { ProfileLike } from '../features/profiles/profilePresentation'

const agyOrch: ProfileLike = { name: 'antigravity_orchestrator_agy', source: 'built-in', provider: 'antigravity_cli', ui_role: 'supervisor' }
const agyQa: ProfileLike = { name: 'antigravity_qa_agy', source: 'built-in', provider: 'antigravity_cli', ui_role: 'qa' }

describe('antigravity is a first-class team member', () => {
  it('registers agy as a selectable orchestrator', () => {
    expect(ORCHESTRATOR_PROFILES.antigravity_cli).toBe('antigravity_orchestrator_agy')
    expect(isOrchestratorProfile('antigravity_orchestrator_agy')).toBe(true)
  })
  it('places both agy profiles in the team section (not 기타)', () => {
    expect(profileSection(agyOrch)).toBe('team')
    expect(profileSection(agyQa)).toBe('team')
    expect(additionalProfileRole(agyOrch)).not.toBe('기타')
  })
  it('assigns the agy QA worker to the verification group', () => {
    expect(workerGroup(agyQa)).toBe('verification')
  })
})
