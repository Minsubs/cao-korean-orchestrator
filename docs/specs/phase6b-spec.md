# Phase 6b 백엔드 스펙 — CLI 환경 마이그레이션 + 지침(AGENTS.md/CLAUDE.md) 관리

목적: 기존에 claude/codex/agy CLI를 쓰던 사람의 작업환경을 CAO로 들여오고(마이그레이션), 사람마다 다른 정책·규칙 파일(AGENTS.md, CLAUDE.md 등)을 한눈에 보고 변환·관리하게 한다. 이번 발주는 **백엔드 전부** — 프런트는 다음 배치.

## 소유권 (병렬 안전)
- 신규: `src/cli_agent_orchestrator/api/env_router.py` (자기완결 APIRouter prefix="/env" — **main.py include는 통합 시 메인이**), `src/cli_agent_orchestrator/services/env_migration/` 패키지(inventory.py, instructions.py, convert.py), test/** 신규 파일
- import만 허용(수정 금지): services/tooling/runner.resolve_within_home, utils/agent_profiles의 frontmatter 파서, security.auth(require_any_scope, SCOPE_*)
- 금지: api/main.py, web/**, providers/**, services/tooling/** 수정, agent_store/**, 기존 테스트 수정(불가피하면 보고에 사유), 커밋

## 원칙 (전 스펙 공통 + 이 도메인 특화)
- 모든 경로는 홈 confinement(resolve_within_home 재사용). 홈 밖/미존재는 4xx 또는 항목 생략 — 절대 traceback 노출 금지
- **실존 파일만 보고**: 경로를 추측해 빈 껍데기 항목을 만들지 말 것. CLI가 미설치/디렉터리 없음이면 `present:false`
- inventory/matrix 응답에 **파일 내용 포함 금지**(메타데이터만) — 내용은 명시적 상세/변환 요청에서만, 그리고 secret 마스킹(sk-…, ghp_…, Bearer …, key=value 토큰류 → ***) 적용
- 쓰기는 단 1개 엔드포인트로 최소화, 덮어쓰기 시 백업 생성. 나머지는 읽기/순수 변환(preview)만

## 엔드포인트

### 1) GET /env/inventory?cli=claude_code|codex|antigravity|all  (READ|WRITE|ADMIN)
기존 CLI 작업환경 스캔(읽기 전용, 홈 한정). 대상 디렉터리(실존 확인 후):
- claude_code: `~/.claude/` — CLAUDE.md, settings.json, commands/*.md, skills/*/(SKILL.md), agents/*.md; `~/.claude.json`(존재 시 — mcpServers 키 유무만 보고, 내용 미반환)
- codex: `~/.codex/` — config.toml, AGENTS.md, prompts/*.md
- antigravity: 실제 설정 경로를 provider 코드/문서에서 확인해 실존 시만 보고(불확실하면 present:false + note "경로 미확인" — 추측 금지)
응답: `{cli, present, items:[{rel_path, kind: instruction|settings|command|skill|agent|mcp_config|prompt, size, mtime}], counts}` — rel_path는 홈 기준 상대경로.

### 2) GET /env/instructions?paths=/abs/p1,/abs/p2  (READ|WRITE|ADMIN)
지침 파일 매트릭스. 글로벌(`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) + 요청된 각 프로젝트 경로(홈 한정, 프런트가 로컬 프로젝트 목록을 넘김)에 대해 CLAUDE.md / AGENTS.md / .claude/commands 존재 여부.
항목: `{scope: global|project, base_path, files:[{name, exists, size, mtime, sha256, headline}]}` — headline은 첫 비어있지 않은 줄 80자(내용 노출 최소화), sha256은 드리프트 비교용(같은 프로젝트의 CLAUDE.md vs AGENTS.md, 글로벌 vs 프로젝트를 프런트가 비교). 홈 밖 경로는 해당 항목만 `error:"홈 디렉터리 밖 경로는 다룰 수 없어요"`로 표시(전체 400 금지).

### 3) POST /env/convert  (WRITE|ADMIN — 순수 변환·무기록이지만 mutating 메서드 규약상 게이트)
`{source_kind: claude_agent|claude_command|codex_prompt|instruction, target_kind: cao_profile|claude_command|codex_prompt|counterpart_instruction, path?: string, content?: string}` — path(홈 한정)나 content 중 하나. 응답 `{converted: string, warnings: string[], lossy_fields: string[]}` — **파일 기록 없음(preview)**.
변환 규칙(결정적, 네트워크 금지):
- claude_agent(.claude/agents/*.md frontmatter name/description/tools/model) → cao_profile: name/description/model 매핑 + `provider: claude_code`, tools→allowedTools는 매핑 가능한 것만( 나머지는 lossy_fields에 명시), 본문 유지. mcpServers는 cao-mcp-server 기본 블록 추가하지 **말** 것(워커 여부를 모름) — warning으로 "오케스트레이션 참여가 필요하면 cao-mcp-server 블록을 추가하세요" 안내
- claude_command ↔ codex_prompt: frontmatter description 보존, 본문 그대로, 대상 형식 관례에 맞게(차이 없으면 그대로 + warning 없음)
- instruction(CLAUDE.md↔AGENTS.md): 본문 복사 + 헤더 줄에 원본 출처 주석 1줄. 의미 변환은 하지 않음(정직)
실제 CAO 프로필 설치는 기존 `POST /agents/profiles`를 프런트가 이어 호출(재사용 — 이 라우터에 설치 경로 중복 구현 금지).

### 4) POST /env/instructions/write  (WRITE|ADMIN — 유일한 쓰기)
`{path: string, content: string, overwrite: bool=false}` — 홈 한정, 256KB 캡, 파일명은 CLAUDE.md/AGENTS.md/*.md만 허용. 기존 파일 있고 overwrite=false → 409. overwrite=true → 같은 디렉터리에 `<name>.bak.<UTC타임스탬프>` 백업 생성 후 기록, 응답에 backup_path 포함. 실패 시 원자성(임시파일+rename).

## 테스트 (tmp_path + monkeypatch로 Path.home 모킹, 기존 api 테스트 픽스처 스타일)
- inventory: 실존만 보고 / cli 미설치 present:false / kind 분류 / 내용 미포함
- instructions: 글로벌+프로젝트 매트릭스, sha256/headline, 홈 밖 경로 항목별 에러
- convert: claude_agent→cao_profile 필드 매핑+lossy_fields, command↔prompt, instruction 상호, path/content 양쪽 입력, 홈 밖 path 400
- write: 신규 생성 / 409 / overwrite+백업 / 캡 초과 400 / 홈 밖 400 / 허용 파일명 제한
- 스코프: 저장소 가드 테스트(test_scope_coverage)가 신규 mutating 라우트를 잡으므로 게이트 누락 시 실패함 — 통과 확인
- 라우터 자기완결: 자체 FastAPI 앱에 include해 검증(2d+2e의 test_ui_features_router.py 스타일 참조)

## 게이트
`black --check` / `isort --check-only`(신규 파일), mypy(신규 파일, follow-imports=silent), `PYTHONPATH=src uv run pytest test/ -q --no-cov -m 'not e2e' --ignore=test/e2e --ignore=test/providers/test_kiro_cli_integration.py` 회귀 0 (주의: 워크트리에서 uv sync 후 hidden 플래그 이슈 있음 — sync 하지 말고 PYTHONPATH=src로만 실행)

## 보고 (간결)
- 엔드포인트 4종 요청/응답 예시(프런트 배치가 소비할 계약)
- 변환 규칙 표 + lossy 처리 목록
- antigravity 실경로 확인 결과(찾았으면 근거, 못 찾았으면 미확인 처리 방식)
- 게이트 결과
