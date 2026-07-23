# Phase 4-B: 모델 카탈로그 정합 + Gemini 3.6 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** codex 모델 카탈로그의 stale 별칭(`gpt-5-codex/gpt-5/o3`)을 실제(`gpt-5.6-sol/terra/luna`)로 고치고, Antigravity 동적 카탈로그가 신모델 `Gemini 3.6 Flash`를 노출함을 확인·고정하며, agy 워커가 실제로 받는 `--model` 포맷을 라이브 검증한 뒤에만 3.6을 채택한다.

**Architecture:** `models.py`의 `_KNOWN_MODELS`는 static 별칭(claude/codex)이고 antigravity는 `agy models` probe(동적)다. codex 상수만 교정하면 카탈로그가 정합된다. antigravity는 코드 변경 없이 이미 3.6을 노출하므로 파서가 현재 하이픈 포맷을 처리함을 테스트로 고정한다. agy 프로필 모델 문자열 변경은 `agy --model`이 받는 포맷을 라이브로 확인한 뒤에만(리스크 게이트) 수행한다.

**Tech Stack:** Python, pytest. 프로필 `.md`. 라이브 검증은 실행 중 CAO 서버 + 로그인된 agy CLI.

## Global Constraints

- 게이트: `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q` + 관련 단위. (프런트 무관 시 web 게이트 생략 가능하나, 프로필 detail 변경 시 `cd web && npx tsc --noEmit && npm test && npm run build`.)
- 모델 목록은 추측 금지 — 실제 CLI/프로필이 쓰는 값만. codex 실제값(audit 확인): `gpt-5.6-sol`(orchestrator/reviewer), `gpt-5.6-terra`(qa), `gpt-5.6-luna`(docs). claude: `opus/sonnet/haiku`(+`fable` 현행).
- `allow_custom=True`는 유지(사용자 임의 입력 허용) — known 목록은 힌트일 뿐.
- agy 프로필 모델 문자열은 `agy --model`로 직접 launch됨(`antigravity_cli.py:296-301`) → 포맷 틀리면 launch 깨짐. **라이브 확인 없이 변경 금지.**

---

### Task 1: codex 카탈로그 stale 교정 + Antigravity 3.6 파싱 고정

**Files:**
- Modify: `src/cli_agent_orchestrator/services/tooling/models.py:32-35` (`_KNOWN_MODELS`)
- Test: `test/tooling/` 하위의 models 테스트(실제 파일명 확인 — 예 `test_models.py`); 없으면 신규 `test/tooling/test_models_catalog.py`

**Interfaces:**
- Produces: `_KNOWN_MODELS["codex"]` = 실제 codex 모델들; `list_models()` codex 항목이 실제값 반환. `_parse_agy_models`는 하이픈 3.6 id를 name으로 파싱.

- [ ] **Step 1: Locate + read the existing models test**

Run: `ls test/tooling/ && grep -rl "_KNOWN_MODELS\|list_models\|_parse_agy_models" test/`
기존 테스트 파일을 열어 스타일 확인. 없으면 신규 파일 생성.

- [ ] **Step 2: Write failing tests**

기존/신규 테스트 파일에 추가:
```python
from cli_agent_orchestrator.services.tooling import models as models_mod


def test_codex_known_models_are_current_not_stale():
    codex = next(m for m in models_mod.list_models() if m["provider"] == "codex")
    names = {m["name"] for m in codex["models"]}
    assert "gpt-5.6-sol" in names
    assert names.isdisjoint({"gpt-5-codex", "gpt-5", "o3"})  # stale aliases gone
    assert codex["allow_custom"] is True


def test_parses_agy_hyphenated_3_6_model_ids():
    parsed = models_mod._parse_agy_models("gemini-3.6-flash-high\ngemini-3.5-flash-high\ngemini-3.1-pro-high\n")
    names = [m["name"] for m in parsed]
    assert "gemini-3.6-flash-high" in names
```

- [ ] **Step 3: Run to verify failure**

Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -k "codex_known or agy_hyphenated" -q`
Expected: `test_codex_known_models_are_current_not_stale` FAIL(현재 stale). `test_parses_agy_hyphenated...` 아마 PASS(파서가 이미 하이픈 처리 — 회귀 가드).

- [ ] **Step 4: Fix `_KNOWN_MODELS`** — `models.py:32-35`

기존:
```python
_KNOWN_MODELS: Dict[str, tuple[str, ...]] = {
    "claude_code": ("opus", "sonnet", "haiku"),
    "codex": ("gpt-5-codex", "gpt-5", "o3"),
}
```
변경:
```python
_KNOWN_MODELS: Dict[str, tuple[str, ...]] = {
    "claude_code": ("opus", "sonnet", "haiku", "fable"),
    "codex": ("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"),
}
```

- [ ] **Step 5: Run to verify pass**

Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q`
Expected: PASS(신규 + 기존 tooling 전부). 기존 테스트가 old codex 별칭을 assert하면 그 테스트도 실제값으로 갱신(단언 약화 아님 — 정확한 실제값으로 수정).

- [ ] **Step 6: Commit**

```bash
git add src/cli_agent_orchestrator/services/tooling/models.py test/tooling/
git commit -m "fix(models): correct stale codex model catalog to gpt-5.6-* + fable alias"
```

---

### Task 2: agy `--model` 포맷 라이브 확인 → Gemini 3.6 Flash 채택(게이트)

**Files (조건부):**
- Modify(확인 통과 시만): `src/cli_agent_orchestrator/agent_store/antigravity_qa_agy.md:5` (+ `examples/cross-provider/antigravity_qa_agy.md` 동기) `model:` → 3.6 Flash 값
- Modify: `web/src/features/profiles/profilePresentation.ts` agy QA `detail` 문자열(모델 변경 시 함께)

**Interfaces:**
- Consumes: Task 1 카탈로그. `~/.antigravity/quota-cache.json`의 display명 `"Gemini 3.6 Flash (High)"`, `agy models`의 `gemini-3.6-flash-high`.

- [ ] **Step 1: 라이브 포맷 확인 (리스크 게이트)**

목표: `agy --model`이 받는 정확한 문자열 포맷 확정. 두 후보: display `"Gemini 3.6 Flash (High)"`(과거 1.0.10~1.1.4에서 동작, quota-cache display명과 일치) vs 하이픈 `gemini-3.6-flash-high`(1.1.5 `agy models` 출력).

방법(택1, 안전 순):
  a. `timeout 15 agy --help` 및 agy의 `--model` 인자 설명/문서에서 포맷 명시 확인.
  b. CAO 서버로 agy QA 워커를 1개 throwaway 세션 생성해 실제 launch가 model-rejection 없이 뜨는지 확인(assign 불필요, 워커 기동만). 기동 로그/상태에 "unknown model"/"invalid" 없으면 해당 포맷 수용으로 판정. 각 후보 포맷으로 프로필 임시값을 바꿔 시도하되, 확인 후 원복.
  c. 위가 불가하면(서버 미기동/미로그인) → **SKIP**: 프로필 모델 변경하지 않고, 카탈로그(Task 1)로 3.6이 이미 선택 가능함만 보고. 리스크 회피.

판정 결과(수용 포맷 A/B, 또는 SKIP)를 report에 명시.

- [ ] **Step 2: (Step 1이 포맷 확정 시만) agy QA 모델을 3.6 Flash로 변경**

확정된 포맷으로 `antigravity_qa_agy.md`(agent_store + examples 사본)의 `model:` 값을 3.6 Flash로 교체(예 display 수용 시 `model: "Gemini 3.6 Flash (High)"`). 두 사본 동기. orchestrator(`antigravity_orchestrator_agy`)는 Gemini 3.1 Pro 유지(사용자 요청은 3.6 Flash = 워커/flash 계열).

`profilePresentation.ts` agy QA `detail`도 `'Antigravity · Gemini 3.6 Flash'`로 갱신.

- [ ] **Step 3: (변경 시) 재-라이브 확인 + 게이트**

바뀐 프로필로 agy QA 워커가 정상 기동함을 재확인(Step 1b 방식). 프런트 detail 변경했으면 `cd web && npx tsc --noEmit && npm test && npm run build`.

- [ ] **Step 4: Commit (변경한 경우만)**

```bash
git add src/cli_agent_orchestrator/agent_store/antigravity_qa_agy.md examples/cross-provider/antigravity_qa_agy.md web/src/features/profiles/profilePresentation.ts
git commit -m "feat(models): adopt Gemini 3.6 Flash for the antigravity QA worker (format live-verified)"
```
SKIP한 경우: 커밋 없이 report에 "3.6은 카탈로그에서 선택 가능(동적), 기본 프로필 모델은 포맷 확인 전까지 3.5 유지"로 종료.

---

## Self-Review

- **Spec coverage:** 4-B codex stale 교정(Task 1) ✅; Gemini 3.6 반영 — 카탈로그 동적 노출 확인(Task 1) + 워커 기본 채택은 포맷 게이트(Task 2) ✅. claude 별칭은 현행(추가 fable)이라 stale 아님.
- **Placeholder scan:** Task 2는 라이브 결과 분기(A/B/SKIP)라 조건부지만 각 분기 행동이 구체적. 모델 문자열은 추측 금지 원칙대로 실측 후 확정.
- **안전:** agy 프로필 변경은 라이브 확인 게이트 뒤에만 — 미확인 시 SKIP으로 launch 깨짐 방지. codex 값은 audit·매트릭스로 실증된 것만.

## 남은 위험
- codex `gpt-5.6-terra/luna`가 OpenAI 공식 id인지 내부 코드네임인지 불확실하나, 3-AI 매트릭스(§0.13)가 이 프로필로 codex 워커를 실제 기동·통과했으므로 CLI가 수용함이 실증됨.
- agy 포맷이 1.1.5에서 하이픈만 받는다면 Task 2는 하이픈 채택; display만 받으면 display. 둘 다 아니면 SKIP.
