// Role × specialty catalog for the "에이전트 추가" modal.
//
// Data and Korean wording are reused from the Phase 5c mockup
// (ms-orchestrator-mockup.html, profile screen v8 — ROLES/SPECS) per the
// phase spec, which explicitly calls for reusing that content rather than
// re-authoring it.
//
// CAO only ships 3 built-in roles server-side (see constants.py
// ROLE_TOOL_DEFAULTS: supervisor/developer/reviewer — verified by reading the
// backend). The UI offers 7 role presets for clearer permission intent to the
// person creating the agent; the 4 that aren't built-in fold onto the nearest
// built-in role for the generated profile's `role:` frontmatter + allowedTools:
//   Architect -> reviewer   (design/read-heavy, no edits)
//   QA        -> developer  (runs commands/tests, edits allowed)
//   Scout     -> reviewer   (read-only discovery)
//   Docs      -> developer  (edits documentation files)
export type BuiltinRole = 'supervisor' | 'developer' | 'reviewer'

export interface RoleDef {
  /** UI role label (7 total) — matches the mockup's ROLES array. */
  name: string
  /** One-line role summary shown on the role card. */
  summary: string
  /** Permission/tool summary shown as help text under the role cards. */
  permission: string
  /** The CAO built-in role this UI role maps onto (see module docstring). */
  builtin: BuiltinRole
}

export const ROLES: RoleDef[] = [
  {
    name: 'Supervisor',
    summary: '계획·위임·결과 통합',
    permission: '오케스트레이션 도구 전체 (handoff·assign·send_message) · 승인 게이트 담당',
    builtin: 'supervisor',
  },
  {
    name: 'Architect',
    summary: '설계·심층 진단',
    permission: '읽기 중심 + 설계 문서 작성 · plan 모드 권장',
    builtin: 'reviewer',
  },
  {
    name: 'Developer',
    summary: '구현과 수정',
    permission: '파일 편집·명령 실행 도구 · acceptEdits 권장',
    builtin: 'developer',
  },
  {
    name: 'Reviewer',
    summary: '리뷰·검토',
    permission: '읽기 전용 — 승인 게이트 · read-only sandbox 권장',
    builtin: 'reviewer',
  },
  {
    name: 'QA',
    summary: '테스트 실행·검증',
    permission: '테스트 실행 중심 · sandbox workspace-write 권장',
    builtin: 'developer',
  },
  {
    name: 'Scout',
    summary: '빠른 탐색·조사',
    permission: '읽기 전용 탐색 — 저비용 모델 권장',
    builtin: 'reviewer',
  },
  {
    name: 'Docs',
    summary: '문서·핸드오프',
    permission: '문서 작성 중심 · 파일 편집 허용',
    builtin: 'developer',
  },
]

export function roleDef(name: string): RoleDef | undefined {
  return ROLES.find(r => r.name === name)
}

export function builtinRoleFor(uiRoleName: string): BuiltinRole {
  return roleDef(uiRoleName)?.builtin ?? 'developer'
}

/**
 * Specialty (전문 분야) catalog per UI role: [name, description]. Specialty is
 * the *content* axis (system prompt focus, suggested skill/working dir) as
 * opposed to role, which is the *permission* axis — same split the mockup
 * documents. The description is shown when selected and seeds the
 * auto-generated profile description.
 */
export const SPECS: Record<string, [string, string][]> = {
  Supervisor: [
    ['범용 오케스트레이션', '요청을 분석해 계획을 세우고, 워커에게 위임하고, 결과를 통합해 보고해요.'],
    ['제품 총괄', '제품 전체 맥락(그룹 루트)에서 우선순위를 정하고 하위 프로젝트에 작업을 분배해요.'],
    ['릴리스 코디네이터', '릴리스 체크리스트·버전·태그·배포 순서를 조율하고 게이트를 관리해요.'],
  ],
  Architect: [
    ['시스템 아키텍처', '모듈 경계·데이터 흐름·기술 선택을 설계하고 트레이드오프를 문서로 남겨요.'],
    ['API 설계', '엔드포인트 계약·버저닝·에러 정책을 설계하고 하위 호환을 지켜요.'],
    ['DB/스키마 설계', '스키마·인덱스·마이그레이션 전략을 설계해요.'],
    ['네이티브/성능 아키텍처', 'C/C++ 모듈 구조·메모리 모델·성능 예산을 설계하고 병목을 진단해요.'],
    ['보안 아키텍처', '인증·권한·비밀 관리·공격 표면을 설계 관점에서 점검해요.'],
  ],
  Developer: [
    ['Web Developer (Frontend)', '웹 프런트엔드(UI·상태·라우팅·접근성)를 구현해요 — web/ 폴더에서 작업을 권장해요.'],
    ['Backend Developer (API 서버)', 'API 서버·비즈니스 로직·DB 연동을 구현하고 계약 테스트를 유지해요.'],
    ['Engine Developer (C/C++ 네이티브 모듈)', 'C/C++ 엔진 모듈을 구현해요 — CMake 빌드·디버깅·메모리 안전성·성능 최적화가 주 업무예요. engine/ 폴더에서 작업을 권장해요.'],
    ['E2E Test Automation Developer', 'E2E 테스트 시나리오와 자동화 파이프라인을 구축하고 안정화(플레이키 제거)를 담당해요.'],
    ['Infra/DevOps Developer', '빌드·배포·CI·컨테이너 구성을 만들고 유지해요.'],
  ],
  Reviewer: [
    ['Code Reviewer', '변경 diff를 정확성·보안·유지보수성 관점에서 검토하고 근거와 함께 승인/반려해요 (읽기 전용).'],
    ['User/UX Reviewer', '사용자 관점에서 흐름·문구·접근성·일관성을 검토해요.'],
    ['Security Reviewer', '취약점·비밀 노출·권한 상승 가능성을 집중 검토해요.'],
    ['Docs Reviewer', '문서가 정확한지, 코드와 일치하는지 검토해요.'],
  ],
  QA: [
    ['회귀 테스트', '기존 기능이 깨지지 않았는지 테스트 스위트를 실행하고 결과를 판정해요.'],
    ['E2E 자동화', '시나리오 기반 자동 테스트를 실행하고 실패를 원인별로 분류해요.'],
    ['성능 테스트', '부하·응답시간·메모리 사용을 측정해 기준과 비교해요.'],
    ['수동 시나리오 검증', '체크리스트 기반 수동 검증을 수행하고 증적을 남겨요.'],
  ],
  Scout: [
    ['코드베이스 탐색', '코드 구조·의존성·관련 파일을 빠르게 찾아 보고해요 (읽기 전용, 저비용 모델 권장).'],
    ['문서/레퍼런스 조사', '문서·이슈·레퍼런스를 조사해 근거 링크와 함께 요약해요.'],
    ['버그 재현', '재현 조건을 좁혀 최소 재현 절차를 만들어요.'],
  ],
  Docs: [
    ['개발 문서', '설계·구현 문서를 작성하고 코드 변경과 동기화해요.'],
    ['사용자 가이드', '사용자 관점의 가이드·FAQ를 작성해요.'],
    ['핸드오프·릴리스 노트', '작업 핸드오프 문서와 릴리스 노트를 정리해요.'],
  ],
}

/** Sentinel value for the "직접 입력…" (custom) option in specialty/model selects. */
export const CUSTOM_OPTION = '__custom__'

/**
 * Built-in-role tool/permission presets. `allowedTools` mirrors
 * constants.py ROLE_TOOL_DEFAULTS exactly (read from the backend source).
 * permissionMode (Claude Code) / codexApprovalPolicy+codexSandbox (Codex) are
 * copied from the matching real agent-profiles/*.md examples for each
 * built-in role bucket, so a generated profile behaves like its shipped
 * siblings instead of silently falling back to Codex's unsandboxed legacy
 * --yolo default (which is what happens if these fields are omitted).
 */
export const BUILTIN_PRESETS: Record<
  BuiltinRole,
  {
    allowedTools: string[]
    permissionMode: 'bypassPermissions' | 'dontAsk'
    codexApprovalPolicy: 'on-request' | 'never'
    codexSandbox: 'read-only' | 'workspace-write'
  }
> = {
  supervisor: {
    allowedTools: ['@cao-mcp-server', 'fs_read', 'fs_list'],
    permissionMode: 'dontAsk',
    codexApprovalPolicy: 'on-request',
    codexSandbox: 'read-only',
  },
  reviewer: {
    allowedTools: ['@builtin', 'fs_read', 'fs_list', '@cao-mcp-server'],
    permissionMode: 'dontAsk',
    codexApprovalPolicy: 'never',
    codexSandbox: 'read-only',
  },
  developer: {
    allowedTools: ['@builtin', 'fs_*', 'execute_bash', 'web_fetch', '@cao-mcp-server'],
    permissionMode: 'bypassPermissions',
    codexApprovalPolicy: 'never',
    codexSandbox: 'workspace-write',
  },
}

/** Cosmetic display labels for known ProviderType slugs (backend has no display_name field on /agents/providers). */
export const PROVIDER_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  antigravity_cli: 'Antigravity',
  kiro_cli: 'Kiro CLI',
  kimi_cli: 'Kimi CLI',
  copilot_cli: 'Copilot CLI',
  opencode_cli: 'OpenCode CLI',
  hermes: 'Hermes',
  cursor_cli: 'Cursor CLI',
}

export function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] ?? name
}
