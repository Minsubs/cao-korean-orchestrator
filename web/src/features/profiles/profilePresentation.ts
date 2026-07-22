import { providerLabel } from './roleData'

export type ProfileLike = {
  name: string
  source: string
  description?: string | null
  provider?: string | null
  model?: string | null
  ui_role?: string | null
  specialty?: string | null
}

type ProfilePresentation = {
  label: string
  description: string
  detail: string
  section: ProfileSectionId
  workerGroup?: WorkerGroupId
  order?: number
}

export const ORCHESTRATOR_PROFILES = {
  codex: 'codex_orchestrator_sol',
  claude_code: 'claude_orchestrator_sonnet',
  antigravity_cli: 'antigravity_orchestrator_agy',
} as const

export type OrchestratorProvider = keyof typeof ORCHESTRATOR_PROFILES

export type ProfileSectionId = 'team' | 'additional' | 'system' | 'examples'
export type WorkerGroupId = 'discovery' | 'implementation' | 'verification'

const PRESENTATION: Record<string, ProfilePresentation> = {
  codex_orchestrator_sol: {
    label: '오케스트레이터',
    description: '작업을 나누고 Codex·Claude 팀의 결과를 종합해요.',
    detail: 'Codex · Sol',
    section: 'team',
    order: 0,
  },
  claude_orchestrator_sonnet: {
    label: '오케스트레이터',
    description: '작업을 나누고 Codex·Claude 팀의 결과를 종합해요.',
    detail: 'Claude · Sonnet',
    section: 'team',
    order: 1,
  },
  antigravity_orchestrator_agy: {
    label: '오케스트레이터',
    description: '작업을 나누고 Codex·Claude·Antigravity 팀의 결과를 종합해요.',
    detail: 'Antigravity · Gemini 3.1 Pro',
    section: 'team',
    order: 2,
  },
  claude_scout_haiku: {
    label: '빠른 탐색가',
    description: '관련 파일과 사실을 빠르게 찾아 작업 범위를 좁혀요.',
    detail: 'Claude · Haiku',
    section: 'team',
    workerGroup: 'discovery',
    order: 2,
  },
  claude_architect_opus: {
    label: '설계 아키텍트',
    description: '복잡한 설계와 위험한 변경의 선택지를 검토해요.',
    detail: 'Claude · Opus',
    section: 'team',
    workerGroup: 'discovery',
    order: 3,
  },
  claude_developer_sonnet: {
    label: '개발자',
    description: '기능 구현, 디버깅, 리팩터링과 테스트 작성을 맡아요.',
    detail: 'Claude · Sonnet',
    section: 'team',
    workerGroup: 'implementation',
    order: 4,
  },
  codex_qa_terra: {
    label: '테스트 담당',
    description: '테스트를 실행하고 회귀와 실패 원인을 확인해요.',
    detail: 'Codex · Terra',
    section: 'team',
    workerGroup: 'verification',
    order: 5,
  },
  codex_reviewer_sol: {
    label: '최종 검토자',
    description: '정확성, 보안, 릴리스 위험을 마지막으로 검토해요.',
    detail: 'Codex · Sol',
    section: 'team',
    workerGroup: 'verification',
    order: 6,
  },
  codex_docs_luna: {
    label: '문서 정리',
    description: '문서, 변경 요약과 다음 작업을 위한 인수인계를 정리해요.',
    detail: 'Codex · Luna',
    section: 'team',
    workerGroup: 'verification',
    order: 7,
  },
  antigravity_qa_agy: {
    label: 'agy 테스트 담당',
    description: '테스트를 실행하고 회귀와 실패 원인을 확인해요.',
    detail: 'Antigravity · Gemini 3.5 Flash',
    section: 'team',
    workerGroup: 'verification',
    order: 8,
  },
  memory_manager: {
    label: '메모리 관리자',
    description: '에이전트에게 필요한 기억과 컨텍스트를 선별해요.',
    detail: 'CAO 시스템',
    section: 'system',
  },
  workflow_scout: {
    label: '워크플로 탐색기',
    description: '사용할 수 있는 CAO 워크플로를 찾아요.',
    detail: 'CAO 시스템',
    section: 'system',
  },
  code_supervisor: {
    label: '코딩 오케스트레이터 예제',
    description: 'CAO에 포함된 범용 오케스트레이터 예제예요.',
    detail: '호환용 예제',
    section: 'examples',
  },
  developer: {
    label: '개발자 예제',
    description: 'CAO에 포함된 범용 개발자 예제예요.',
    detail: '호환용 예제',
    section: 'examples',
  },
  reviewer: {
    label: '검토자 예제',
    description: 'CAO에 포함된 범용 검토자 예제예요.',
    detail: '호환용 예제',
    section: 'examples',
  },
}

export const PROFILE_SECTIONS: Record<ProfileSectionId, { label: string; description: string; order: number }> = {
  team: {
    label: '기본 AI 팀',
    description: '새 작업에서 오케스트레이터가 역할에 맞춰 사용하는 기본 구성입니다.',
    order: 0,
  },
  additional: {
    label: '추가 에이전트',
    description: '직접 설치했거나 다른 도구에서 발견한 프로필입니다.',
    order: 1,
  },
  system: {
    label: 'CAO 시스템 도우미',
    description: '메모리와 워크플로처럼 CAO 내부 기능을 지원합니다.',
    order: 2,
  },
  examples: {
    label: '호환용 예제',
    description: '기존 CAO 명령과 예제를 위한 범용 프로필입니다.',
    order: 3,
  },
}

export const WORKER_GROUPS: Record<WorkerGroupId, { label: string; description: string; order: number }> = {
  discovery: { label: '탐색·설계', description: '범위를 찾고 어려운 결정을 설계해요.', order: 0 },
  implementation: { label: '구현', description: '실제 코드 변경을 맡아요.', order: 1 },
  verification: { label: '검증·문서', description: '결과를 확인하고 기록해요.', order: 2 },
}

export const ADDITIONAL_ROLE_LABELS: Record<string, string> = {
  Supervisor: '오케스트레이션',
  Architect: '설계·아키텍처',
  Developer: '개발·구현',
  Reviewer: '리뷰·리팩터링',
  QA: '품질·테스트',
  Scout: '탐색·분석',
  Docs: '문서',
  Operations: '운영·관측',
  Specialist: '전문 분야',
  기타: '기타',
}

/** Map native Claude agent names to UI groups while keeping every card separate. */
export function inferredProfileRole(profile: Pick<ProfileLike, 'name' | 'source'>): string | null {
  if (profile.source !== 'claude_code') return null
  const name = profile.name.toLowerCase()
  if (name.includes('supervisor') || name.includes('manager')) return 'Supervisor'
  if (name.includes('architect')) return 'Architect'
  if (name.includes('developer') || name === 'python-expert') return 'Developer'
  if (name.includes('review') || name.includes('refactor')) return 'Reviewer'
  if (name.includes('quality') || name.includes('test-runner')) return 'QA'
  if (name.includes('explore') || name.includes('analyst') || name.includes('root-cause')) return 'Scout'
  if (name.includes('writer') || name.includes('docs')) return 'Docs'
  if (name.includes('devops') || name.includes('observability')) return 'Operations'
  return 'Specialist'
}

export function additionalProfileRole(profile: ProfileLike): string {
  return profile.ui_role || inferredProfileRole(profile) || '기타'
}

const SOURCE_LABELS: Record<string, { label: string; description: string }> = {
  local: { label: '내 에이전트', description: '직접 설치하거나 수정한 프로필' },
  custom: { label: '추가 폴더', description: '설정에서 추가한 폴더의 프로필' },
  installed: { label: '실행용 설치본', description: 'Provider 실행을 위해 만들어진 호환 프로필' },
  'built-in': { label: 'CAO 기본 제공', description: 'CAO에 포함된 시스템·예제 프로필' },
  claude_code: { label: 'Claude에서 발견', description: 'Claude Code 프로필 폴더에서 발견' },
  codex: { label: 'Codex에서 발견', description: 'Codex 프로필 폴더에서 발견' },
  kiro: { label: 'Kiro에서 발견', description: 'Kiro 프로필 폴더에서 발견' },
}

export function profileLabel(name: string): string {
  return PRESENTATION[name]?.label ?? name.replace(/[_-]+/g, ' ')
}

export function profileDescription(profile: ProfileLike): string | undefined {
  return PRESENTATION[profile.name]?.description ?? profile.description ?? undefined
}

export function profileDetail(profile: ProfileLike): string {
  const known = PRESENTATION[profile.name]?.detail
  if (known) return known
  const pieces = [profile.ui_role, profile.specialty, profile.provider ? providerLabel(profile.provider) : null, profile.model].filter(Boolean)
  return pieces.length > 0 ? pieces.join(' · ') : '실행 설정은 프로필에서 결정'
}

export function profileSection(profile: ProfileLike): ProfileSectionId {
  return PRESENTATION[profile.name]?.section ?? 'additional'
}

export function profileSectionLabel(profile: ProfileLike): string {
  return PROFILE_SECTIONS[profileSection(profile)].label
}

export function profileOrder(profile: ProfileLike): number {
  return PRESENTATION[profile.name]?.order ?? 1000
}

export function profileSource(source: string): { label: string; description: string } {
  return SOURCE_LABELS[source] ?? {
    label: `${source}에서 발견`,
    description: `${source} 프로필 폴더에서 발견`,
  }
}

export function isOrchestratorProfile(name: string): boolean {
  return Object.values(ORCHESTRATOR_PROFILES).includes(name as (typeof ORCHESTRATOR_PROFILES)[OrchestratorProvider])
}

export function workerGroup(profile: ProfileLike): WorkerGroupId | null {
  return PRESENTATION[profile.name]?.workerGroup ?? null
}

export function defaultTeamWorkers<T extends ProfileLike>(profiles: T[]): T[] {
  return profiles.filter(profile => workerGroup(profile) !== null)
}

/**
 * Packaged team profiles can also have local/provider execution copies with
 * the same internal ID. Those mirrors are expected and should not look like a
 * user error. Keep warnings for genuinely separate custom definitions.
 */
export function profileDuplicateSources(profile: ProfileLike & { duplicated_in?: string[] }): string[] {
  let duplicates = profile.duplicated_in ?? []
  if (profile.source === 'installed') {
    duplicates = duplicates.filter(source => source !== 'built-in')
  }
  if (profileSection(profile) === 'team') {
    duplicates = duplicates.filter(source => source !== 'built-in' && source !== 'installed')
  }
  return duplicates
}
