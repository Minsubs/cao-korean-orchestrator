// Builds the agent profile .md (frontmatter + system prompt body) that the
// "에이전트 추가" modal offers for download. See api.profiles.ts's docstring
// on installAgentProfile for why this is a client-side download rather than
// a direct install call: the real /agents/profiles/install endpoint only
// accepts an https:// URL or a bare name that already resolves to a file on
// the server (agent-dirs/local-store/built-in) — never inline content — so a
// brand-new profile has to reach disk via `cao install <file> --provider …`
// run by the user, same as the CLI's own documented file-path flow
// (cli/commands/install.py).
import { BUILTIN_PRESETS, builtinRoleFor } from './roleData'

/** Mirrors install_service.py's `_PROFILE_NAME_RE` — profile names become filesystem path segments. */
export const PROFILE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface ProfileTemplateInput {
  name: string
  uiRole: string
  specialtyName: string
  description: string
  provider: string
  model: string
}

/** Role-specific system-prompt behavior bullets, one set per UI role (7 total). Tone/format mirrors the shipped agent-profiles/*.md bodies. */
const ROLE_BODY_BULLETS: Record<string, string[]> = {
  Supervisor: [
    '요청을 분석해 계획을 세우고, 가장 적합한 워커에게 위임하고, 종속 관계를 조율해요.',
    'CAO handoff는 차단성 의존 작업에, assign은 독립 작업에 사용해요.',
    '같은 작업을 비교 목적 없이 중복 위임하지 않아요. 완료 선언 전에 관측 가능한 검증을 요구해요.',
    '기존 사용자 작업을 보존하고, 파괴적이거나 외부에 영향을 주는 작업은 승인을 먼저 받아요.',
  ],
  Architect: [
    '제약 조건·데이터 흐름·인터페이스·실패 모드·마이그레이션·롤백·검증 방법을 분석해요.',
    '요구사항을 만족하는 가장 작은 설계와 기존 프로젝트 컨벤션을 우선해요.',
    '구현 파일은 편집하지 않아요. 정확한 대상 파일·인터페이스·수용 기준·미해결 리스크를 반환해요.',
    '제품·안전 관련 미결정 사항은 임의로 정하지 말고 오케스트레이터에게 에스컬레이션해요.',
  ],
  Developer: [
    '요청된 변경을 현재 저장소에서 가장 작고 정확한 diff로 구현해요.',
    '관련 프로젝트 지침과 이전 작업 산출물을 먼저 읽어요.',
    '관련 없는 사용자 변경과 기존 아키텍처를 보존해요.',
    '적절한 경우 회귀 테스트를 추가하거나 갱신하고, 실제로 실행한 검증만 보고해요.',
    '승인 없이 배포·게시·강제 푸시·영구 삭제·인증 변경을 하지 않아요.',
  ],
  Reviewer: [
    '실제 diff와 주변 코드를 정확성·보안·회귀·데이터 손실·검증 누락 관점에서 검토해요.',
    '심각도 순으로 실행 가능한 지적을 먼저 제시하고, 차단 이슈와 비차단 개선을 구분해요.',
    '주장된 테스트를 근거와 대조해서 검증하고, 실행하지 않은 검사를 통과했다고 말하지 않아요.',
    '차단 이슈가 없으면 명시적으로 그렇다고 말하고, 남은 리스크나 미검증 범위를 나열해요.',
    '읽기 전용을 유지해요 — 수정은 직접 하지 않아요.',
  ],
  QA: [
    '할당된 변경에 대해 의미 있는 최소 검사 집합을 정하고 실행해요.',
    '정상 경로, 관련 실패/경계 경로, 회귀 방지를 실용적인 범위에서 검증해요.',
    '실패를 진단하고 제품 결함과 환경/인증 문제를 구분해요.',
    '테스트 전용의 명확히 범위가 좁은 변경이 아니면 소스 파일을 수정하지 않아요.',
    '실행한 정확한 명령·종료 결과·검증하지 못한 범위를 보고해요.',
  ],
  Scout: [
    '오케스트레이터나 구현자가 진행하는 데 필요한 최소한의 관련 파일과 사실을 찾아요.',
    '파일을 열기 전에 먼저 검색하고, 넓은 범위의 저장소 스캔은 피해요.',
    '절대 경로·주요 심볼·가능하면 줄 번호와 함께 간결한 결과를 반환해요.',
    '확인된 증거와 추론을 구분해요.',
    '파일을 수정하거나 작업을 아키텍처 범위로 확장하지 않아요 — 복잡하거나 모호한 결정은 에스컬레이션해요.',
  ],
  Docs: [
    '확인된 저장소 근거로부터 간결한 핸드오프·체인지로그·구조화된 요약·문서 업데이트를 작성해요.',
    '기존 문서 구조와 용어를 보존해요.',
    '완료·테스트 결과·날짜·담당자·결정 사항을 지어내지 않아요.',
    '명시적으로 지정되었거나 범위가 분명한 문서 파일만 편집해요 — 그렇지 않으면 초안을 오케스트레이터에게 반환해요.',
    '파괴적인 명령을 실행하거나 외부 상태를 바꾸지 않아요.',
  ],
}

/** Quote a YAML scalar defensively (frontmatter values here may contain `:`/`#`/quotes from free-text description). Exported for reuse by EditProfileModal.tsx's own (smaller) frontmatter reassembly. */
export function yamlScalar(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** allowedTools entries starting with "@" are quoted in every shipped template (e.g. "@builtin"); bare tool names (fs_*, execute_bash) are not. */
function yamlToolItem(tool: string): string {
  return tool.startsWith('@') ? yamlScalar(tool) : tool
}

export interface BuiltProfile {
  markdown: string
  filename: string
  installCommand: string
}

export function buildProfileMarkdown(input: ProfileTemplateInput): BuiltProfile {
  const builtin = builtinRoleFor(input.uiRole)
  const preset = BUILTIN_PRESETS[builtin]
  const isClaude = input.provider === 'claude_code'
  const isCodex = input.provider === 'codex'

  const fm: string[] = ['---']
  fm.push(`name: ${input.name}`)
  fm.push(`description: ${yamlScalar(input.description)}`)
  fm.push(`provider: ${input.provider}`)
  fm.push(`model: ${yamlScalar(input.model)}`)
  fm.push(`uiRole: ${yamlScalar(input.uiRole)}`)
  fm.push(`specialty: ${yamlScalar(input.specialtyName)}`)
  fm.push(
    `# UI 역할 "${input.uiRole}" -> CAO 빌트인 역할 "${builtin}" 매핑 (CAO는 supervisor/developer/reviewer 3종만 빌트인 역할로 지원하며, allowedTools 프리셋은 이 빌트인 역할 기준으로 정해져요)`,
  )
  fm.push(`role: ${builtin}`)
  if (isClaude) fm.push(`permissionMode: ${preset.permissionMode}`)
  if (isCodex) {
    fm.push(`codexApprovalPolicy: ${preset.codexApprovalPolicy}`)
    fm.push(`codexSandbox: ${preset.codexSandbox}`)
  }
  fm.push('allowedTools:')
  preset.allowedTools.forEach(tool => fm.push(`  - ${yamlToolItem(tool)}`))
  fm.push('mcpServers:')
  fm.push('  cao-mcp-server:')
  fm.push('    type: stdio')
  fm.push('    command: cao-mcp-server')
  fm.push('    args: []')
  fm.push('---')

  const bullets = ROLE_BODY_BULLETS[input.uiRole] ?? ROLE_BODY_BULLETS.Developer
  const body: string[] = []
  body.push(`# ${input.name.toUpperCase()} ${input.uiRole.toUpperCase()}`)
  body.push('')
  body.push(
    `You are ${input.name}, the ${input.specialtyName} specialist (${input.uiRole}). ${input.description}`,
  )
  body.push('')
  bullets.forEach(b => body.push(`- ${b}`))
  body.push('')
  body.push(
    'For `[CAO Handoff]`, finish the task and stop; CAO returns your output automatically. For non-blocking assignment, send the result to the supplied callback terminal.',
  )

  const markdown = `${fm.join('\n')}\n\n${body.join('\n')}\n`
  const filename = `${input.name}.md`
  const installCommand = `cao install ./${filename} --provider ${input.provider}`

  return { markdown, filename, installCommand }
}
