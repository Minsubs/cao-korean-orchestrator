# Phase 6c-백엔드 스펙 — 소스(Sources) 집계 엔드포인트

목적: 도구및확장 "소스" 탭이 소비할 단일 읽기 API. 스킬/명령/프롬프트가 **어느 디렉터리·마켓플레이스·카탈로그에서 오는지** 실데이터로 보여준다. 추측/빈껍데기 금지.

## 소유권
- 신규: `src/cli_agent_orchestrator/services/tooling/sources.py`, `test/tooling/test_sources.py` (+ 필요시 test/api에 라우트 테스트)
- 수정 허용(최소): `src/cli_agent_orchestrator/api/tooling_router.py`(GET /tooling/sources 라우트 1개 추가), `services/tooling/adapters/claude_code.py`(marketplace 목록 메서드 1개 추가), `services/tooling/__init__.py`(export 필요시)
- import만: runner(실행 유틸), extensions._skill_store_dirs 또는 동등 로직 재사용, catalog, env_migration.inventory(가능하면)
- 금지: web/**, api/main.py, providers/**, 다른 adapters, 커밋

## 엔드포인트 — GET /tooling/sources  (READ|WRITE|ADMIN)
응답:
```json
{
  "directory_sources": [
    {"path": "~/.aws/cli-agent-orchestrator/skills", "scope": "store", "kind": "skills", "count": 3, "exists": true},
    {"path": "~/.claude/commands", "cli": "claude_code", "kind": "commands", "count": 5, "exists": true},
    {"path": "~/.claude/skills", "cli": "claude_code", "kind": "skills", "count": 2, "exists": true},
    {"path": "~/.claude/agents", "cli": "claude_code", "kind": "agents", "count": 1, "exists": true},
    {"path": "~/.codex/prompts", "cli": "codex", "kind": "prompts", "count": 4, "exists": false}
  ],
  "catalog": {"count": 12, "kinds": {"skill": 6, "mcp": 4, "cli": 2}, "origin": "builtin-curated",
              "note": "네트워크 조회 없는 내장 큐레이션 목록이에요"},
  "marketplaces": {
    "claude_code": {"supported": true, "items": [{"name": "anthropics/skills", "source": "github"}], "reason": null,
                     "manage_hint": "claude plugin marketplace add <repo>"}
  }
}
```
- `directory_sources`: CAO 스킬 스토어 디렉터리들(extensions의 _skill_store_dirs와 동일 소스, scope store/user) + CLI 홈 디렉터리들(claude commands/skills/agents, codex prompts — env_migration.inventory 재사용 가능하면 재사용, 아니면 동일 규칙 직접 스캔). **실존 디렉터리는 count, 미존재는 exists:false로 정직 표기**(항목 자체는 내려도 됨 — 프런트가 "없음" 표시). path는 홈은 `~` 축약 표기.
- `catalog`: services/tooling/catalog의 항목 집계(개수/種류 분포)만 — 목록 자체는 기존 /tooling/catalog가 담당.
- `marketplaces.claude_code`: **신규 adapter 메서드** — runner로 `claude plugin marketplace list` 실행(READ 성격, allowlist에 claude 있음, 64KB 캡·마스킹 기존 규약 준수).
  - 출력 파싱은 보수적으로: 먼저 `--json` 시도 → JSON이면 name/source 추출. 실패 시 텍스트 라인 파싱을 시도하되 **확신 없으면 supported:false + reason("출력 형식을 인식하지 못했어요 — CLI에서 직접 확인하세요") + items:null**. 절대 추측 파싱으로 가짜 목록 만들지 말 것.
  - claude 미설치 → supported:false, reason 기존 미설치 문구 재사용.
  - codex 등 마켓플레이스 개념 없는 CLI는 키 자체를 생략(가짜 빈 항목 금지).
- 캐시: 마켓플레이스 조회만 TTL 60s(같은 프로세스 내) — 디렉터리 스캔은 즉시.

## 테스트
- 디렉터리 소스: tmp_path 홈 모킹으로 존재/미존재/카운트
- 카탈로그 집계 kinds 합계
- 마켓플레이스: runner mock으로 ①json 성공 ②텍스트 미인식→supported:false ③claude 미설치 ④64KB 캡
- 라우트: 스코프 게이트(READ 계열) 확인, 자체 include 스타일(기존 test/tooling, test/api 패턴)

## 게이트
black/isort --check(신규·수정 파일), mypy(동일), `PYTHONPATH=src uv run --no-sync pytest test/ -q --no-cov -m 'not e2e' --ignore=test/e2e --ignore=test/providers/test_kiro_cli_integration.py` 회귀 0.
**주의: 반드시 `uv run --no-sync`** — 맨 uv run은 .venv를 재동기화해 hidden 플래그로 MCP 바이너리를 깨뜨린다(실증됨). uv sync 절대 금지.

## 보고(간결): 응답 예시 1개(실제 서버 형태), marketplace 파서가 처리하는/거부하는 출력 예, 게이트 결과
