# AI CLI 설치 기능(npm 기반) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 미설치된 npm 기반 AI CLI(codex/claude/kiro/copilot/opencode)를 UI "설치" 버튼으로 설치한다 — 백엔드가 provider→고정 npm 패키지를 결정해 `npm install -g <pkg>`를 실행하며, 클라이언트는 provider만 지정(패키지명 미수용).

**Architecture:** 기존 tooling operations 프레임워크를 확장한다. 새 target-면제 액션 `install_cli` + capability `canInstallCli`를 추가하고, 각 adapter가 `plan("install_cli")`에서 **하드코딩된 provider별 npm 패키지**로 `ExecutionPlan(argv=["npm","install","-g","<pkg>"])`를 반환한다. `npm`을 runner allowlist에 추가하되 패키지명은 클라 입력이 아닌 서버 상수라 임의 패키지 설치가 불가능하다. UI는 미설치 provider 행에 "설치" 버튼을 붙여 기존 preview→execute→poll 흐름을 재사용한다.

**Tech Stack:** Python(pytest) adapters/router/runner, React/TS(Vitest) tooling UI.

## Global Constraints

- **보안(필수):** 클라이언트는 `{action:'install_cli', provider}`만 보낸다 — **패키지명을 절대 클라에서 받지 않는다.** adapter가 provider별 고정 패키지 상수를 쓴다. runner에 `npm`을 추가하되 argv 토큰 검증을 유지한다. 스코프 패키지(`@openai/codex`)가 runner `_TOKEN_RE`를 통과하는지 확인하고, 통과 못 하면 npm install 인자에 한해 스코프-패키지 형태만 허용하도록 최소 확장(여전히 서버 상수라 안전).
- **실제 설치를 테스트/구현 중 실행 금지** — 모든 테스트는 runner/`npm`을 모킹. 실제 실행은 사용자가 UI preview 확인 후 개시.
- 제외: agy(`curl|bash` 원격 스크립트)·kimi(`brew`) — 이번 범위 아님. 건드리지 않는다.
- 디자인 토큰만; 한국어 UI; 게이트 백엔드 `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q`, 프런트 `cd web && npx tsc --noEmit && npm test && npm run build`.
- `install_cli`는 target-면제(설치엔 대상 아이템 없음) — 라우터의 target-required 체크에서 `update_all`과 함께 면제.
- npm 패키지 매핑(문서 확인값): codex=`@openai/codex`, claude_code=`@anthropic-ai/claude-code`, kiro_cli=`@anthropic-ai/kiro-cli`, copilot_cli=`@github/copilot`, opencode_cli=`opencode-ai`.

---

### Task 1: install_cli 프레임워크 + codex/claude adapter + runner npm

**Files:**
- Modify: `src/cli_agent_orchestrator/services/tooling/operations.py` (`VALID_ACTIONS`)
- Modify: `src/cli_agent_orchestrator/services/tooling/adapters/base.py` (`ProviderCapabilities` +`canInstallCli`)
- Modify: `src/cli_agent_orchestrator/api/tooling_router.py` (`_ACTION_CAPABILITY`, target-exempt list)
- Modify: `src/cli_agent_orchestrator/services/tooling/runner.py` (`ALLOWED_BINARIES` +`npm`; token rule for scoped pkg if needed)
- Modify: `src/cli_agent_orchestrator/services/tooling/adapters/codex.py`, `claude_code.py` (`canInstallCli`, `plan("install_cli")`, `verify`)
- Test: `test/tooling/test_install_cli.py` (신규)

**Interfaces:**
- Produces: action string `"install_cli"`; `ProviderCapabilities.canInstallCli: bool`; each adapter `plan("install_cli", None, None) -> ExecutionPlan(argv=["npm","install","-g","<fixed pkg>"])`.

- [ ] **Step 1: Read the framework** — Read `operations.py`(VALID_ACTIONS), `base.py`(ProviderCapabilities dataclass — note it's frozen; add field with default so existing constructions don't break), `tooling_router.py`(`_ACTION_CAPABILITY` map + the `if body.action != "update_all"` target check ~line 140), `runner.py`(`ALLOWED_BINARIES`, `_TOKEN_RE` — check if `@openai/codex` passes). Confirm exact shapes.

- [ ] **Step 2: Write failing tests** — `test/tooling/test_install_cli.py`

```python
import pytest
from cli_agent_orchestrator.services.tooling.adapters.codex import CodexAdapter
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling import operations, runner


def test_install_cli_is_a_valid_action():
    assert "install_cli" in operations.VALID_ACTIONS


def test_npm_is_allowlisted():
    assert "npm" in runner.ALLOWED_BINARIES


@pytest.mark.parametrize("adapter,pkg", [
    (CodexAdapter(), "@openai/codex"),
    (ClaudeCodeAdapter(), "@anthropic-ai/claude-code"),
])
def test_install_cli_plan_uses_fixed_package(adapter, pkg):
    assert adapter.capabilities().canInstallCli is True
    plan = adapter.plan("install_cli", None, None)
    assert plan.argv == ["npm", "install", "-g", pkg]


@pytest.mark.parametrize("adapter", [CodexAdapter(), ClaudeCodeAdapter()])
def test_install_cli_ignores_client_target(adapter):
    # target from client must NOT influence the package (security)
    plan = adapter.plan("install_cli", "evil-package", None)
    assert "evil-package" not in plan.argv
```

- [ ] **Step 3: Run → FAIL**
Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling/test_install_cli.py -q`

- [ ] **Step 4: Implement framework + codex/claude**
- `operations.py`: add `"install_cli"` to `VALID_ACTIONS` frozenset.
- `base.py`: add `canInstallCli: bool = False` to `ProviderCapabilities` (default False so existing adapters unaffected).
- `tooling_router.py`: add `"install_cli": "canInstallCli"` to `_ACTION_CAPABILITY`; add `install_cli` to the target-exempt condition (e.g. `if body.action not in ("update_all", "install_cli")`).
- `runner.py`: add `"npm"` to `ALLOWED_BINARIES`. Check `_TOKEN_RE`: if `@openai/codex` fails validation, extend the token rule MINIMALLY to accept npm scoped-package tokens (`^@?[A-Za-z0-9._/-]+$` for npm args) — document that packages are server-constants so this doesn't widen attack surface.
- `codex.py`: `_CLI_PACKAGE = "@openai/codex"`; in `capabilities()` set `canInstallCli=True`; in `plan()` add `if action == "install_cli": return ExecutionPlan(description="Codex CLI를 npm으로 설치해요", argv=["npm","install","-g",self._CLI_PACKAGE], cwd=None, verify_description="codex --version 확인", warnings=["npm 전역 설치가 필요해요"])`; `verify("install_cli")` → check `shutil.which("codex")` (or return True; match existing verify pattern). Package is a constant — `target` param IGNORED.
- `claude_code.py`: same with `_CLI_PACKAGE = "@anthropic-ai/claude-code"`, binary `claude`.
(Confirm ExecutionPlan field names from base.py.)

- [ ] **Step 5: Run → PASS + full tooling suite**
Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q`
Expected: PASS (existing + new). Update any test asserting the old VALID_ACTIONS set or capability defaults.

- [ ] **Step 6: Commit**
```bash
git add src/cli_agent_orchestrator/services/tooling/ src/cli_agent_orchestrator/api/tooling_router.py test/tooling/test_install_cli.py
git commit -m "feat(tooling): install_cli action + npm-based CLI install for codex/claude (fixed package, security-scoped)"
```

---

### Task 2: kiro/copilot/opencode 최소 adapter (install_cli 전용)

**Files:**
- Create: `src/cli_agent_orchestrator/services/tooling/adapters/kiro_cli.py`, `copilot_cli.py`, `opencode_cli.py`
- Modify: `src/cli_agent_orchestrator/services/tooling/adapters/registry.py`
- Test: `test/tooling/test_install_cli.py` (append)

**Interfaces:**
- Consumes: `base.ProviderAdapter` ABC, `ExecutionPlan`, `canInstallCli`(Task1).
- Produces: registry has `kiro_cli`/`copilot_cli`/`opencode_cli` adapters; each `plan("install_cli")→["npm","install","-g",<pkg>]`, other actions refused.

- [ ] **Step 1: Read** `base.py`(ProviderAdapter ABC — the abstract methods each adapter must implement: `id`, `capabilities`, `plan`, `verify`, list/etc.) + an existing minimal adapter (antigravity.py is the most minimal — read-only refuse-all except one action) to mirror the shape. + `registry.py`(how adapters register).

- [ ] **Step 2: Write failing tests** — append to `test/tooling/test_install_cli.py`
```python
def test_new_adapters_registered():
    from cli_agent_orchestrator.services.tooling.adapters import registry
    for pid in ("kiro_cli", "copilot_cli", "opencode_cli"):
        assert pid in registry.ADAPTERS

@pytest.mark.parametrize("pid,pkg", [
    ("kiro_cli", "@anthropic-ai/kiro-cli"),
    ("copilot_cli", "@github/copilot"),
    ("opencode_cli", "opencode-ai"),
])
def test_new_adapter_install_cli(pid, pkg):
    from cli_agent_orchestrator.services.tooling.adapters import registry
    adapter = registry.ADAPTERS[pid]
    assert adapter.capabilities().canInstallCli is True
    assert adapter.plan("install_cli", None, None).argv == ["npm", "install", "-g", pkg]
    # other actions refused
    with pytest.raises(ValueError):
        adapter.plan("remove", "x", None)
```

- [ ] **Step 3: Run → FAIL**

- [ ] **Step 4: Implement the 3 adapters** — each mirrors antigravity.py's minimal shape but allows only `install_cli`. Example `kiro_cli.py`:
```python
from typing import Optional
from cli_agent_orchestrator.services.tooling.adapters.base import ProviderAdapter, ProviderCapabilities, ExecutionPlan

_READ_ONLY = "이 CLI는 설치만 지원해요 (확장 관리는 터미널에서)"

class KiroCliAdapter(ProviderAdapter):
    id = "kiro_cli"
    _CLI_PACKAGE = "@anthropic-ai/kiro-cli"
    _BINARY = "kiro"  # confirm actual binary name from providers.py catalog

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(canList=False, canSearch=False, canInstall=False, canRemove=False,
                                    canUpdate=False, canUpdateAll=False, canInstallCli=True,
                                    requiresNewSession=False, requiresRestart=False,
                                    reasons={})
    def plan(self, action, target, scope) -> ExecutionPlan:
        if action == "install_cli":
            return ExecutionPlan(description="Kiro CLI를 npm으로 설치해요",
                                 argv=["npm", "install", "-g", self._CLI_PACKAGE], cwd=None,
                                 verify_description="kiro --version 확인", warnings=["npm 전역 설치가 필요해요"])
        raise ValueError(_READ_ONLY)
    def verify(self, action, target):
        if action == "install_cli":
            return True, "installed"
        return False, _READ_ONLY
    # implement remaining ABC abstract methods minimally (list→[], search→[], etc.) per base.py
```
(Confirm the FULL set of abstract methods in base.py — implement all with safe no-op/empty for these install-only adapters. Confirm `_BINARY` names against `providers.py` catalog: kiro→`kiro-cli`? copilot→`copilot`? opencode→`opencode`?. Match exactly.)
`copilot_cli.py`/`opencode_cli.py`: same with their pkg/binary.
`registry.py`: register the 3 new adapters in `ADAPTERS`.

- [ ] **Step 5: Run → PASS + full tooling suite**
Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q`

- [ ] **Step 6: Commit**
```bash
git add src/cli_agent_orchestrator/services/tooling/adapters/ test/tooling/test_install_cli.py
git commit -m "feat(tooling): minimal install-only adapters for kiro/copilot/opencode"
```

---

### Task 3: 미설치 provider 행에 "설치" 버튼

**Files:**
- Modify: `web/src/features/tooling/OverviewPane.tsx` (`ProviderRow` — install button for `!installed`)
- Modify: `web/src/api.tooling.ts` (`ToolingAction` union +`'install_cli'`)
- Test: `web/src/test/provider-install-button.test.tsx` (신규)

**Interfaces:**
- Consumes: `useToolingOperations` `requestAction({action:'install_cli', provider})` (기존 preview/execute/poll). Task1/2 backend.

- [ ] **Step 1: Read** `OverviewPane.tsx`(`ProviderRow` — Plan C added an `onUpdate` for installed; the `!installed` branch currently shows only a static `InstallPill`), `api.tooling.ts`(`ToolingAction` type), `shared.tsx`(InstallPill).

- [ ] **Step 2: Write failing test** — `web/src/test/provider-install-button.test.tsx`
```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProviderRow } from '../features/tooling/OverviewPane'
import type { ToolingProvider } from '../api.tooling'

const uninstalled = { name: 'kiro_cli', display_name: 'Kiro CLI', binary: 'kiro-cli', installed: false, path: null, version: null, version_raw: null, version_error: null, checked_at: '' } as any as ToolingProvider

describe('ProviderRow install button', () => {
  it('calls onInstall for a not-installed provider', () => {
    const onInstall = vi.fn()
    render(<ProviderRow provider={uninstalled} withBorder={false} onInstall={onInstall} />)
    fireEvent.click(screen.getByRole('button', { name: /설치/ }))
    expect(onInstall).toHaveBeenCalledWith('kiro_cli')
  })
  it('shows no install button for an installed provider', () => {
    render(<ProviderRow provider={{ ...uninstalled, installed: true, version: '1.0' } as any} withBorder={false} onInstall={() => {}} />)
    expect(screen.queryByRole('button', { name: /^설치$/ })).toBeNull()
  })
})
```
(Confirm ProviderRow's existing props from Plan C — it already takes `onUpdate?`. Add `onInstall?: (provider: string) => void`. The installed case shows 업데이트 button [Plan C]; the not-installed case now shows a 설치 button instead of only the static pill.)

- [ ] **Step 3: Run → FAIL**

- [ ] **Step 4: Implement**
- `api.tooling.ts`: add `'install_cli'` to the `ToolingAction` union.
- `OverviewPane.tsx`: `ProviderRow` gets `onInstall?: (provider: string) => void`. In the `!provider.installed` branch, render a "설치" button (token styles, next to/replacing the static InstallPill) → `onClick={() => onInstall?.(provider.name)}`. Parent passes `onInstall={(p) => requestAction({ action: 'install_cli', provider: p })}` (same hook Plan C used for update). Keep the InstallPill status label.

- [ ] **Step 5: Run → PASS**

- [ ] **Step 6: Full gate**
Run: `cd web && npx tsc --noEmit && npm test && npm run build`

- [ ] **Step 7: Commit**
```bash
git add web/src/features/tooling/OverviewPane.tsx web/src/api.tooling.ts web/src/test/provider-install-button.test.tsx
git commit -m "feat(tooling): 설치 button on uninstalled provider rows (install_cli)"
```

---

## Self-Review

- **Spec coverage:** npm 기반 설치(codex/claude Task1 + kiro/copilot/opencode Task2) ✅; UI 설치 버튼 Task3 ✅; 보안(고정 패키지·클라 미수용·npm allowlist) Task1 ✅; agy/kimi 제외 준수 ✅.
- **Placeholder scan:** ABC 추상 메서드 전체·`_BINARY`·`_TOKEN_RE`·ExecutionPlan 필드는 "base.py/providers.py에서 확인" 명시. 패키지명은 문서 확인값 상수. 코드 스텝 구체.
- **Type consistency:** `install_cli` action(Task1) ↔ `ToolingAction` union(Task3) ↔ adapter plan(Task1/2) 일치. `canInstallCli`(base.py) ↔ `_ACTION_CAPABILITY`(router) ↔ adapters 일치. `onInstall(provider:string)`(Task3) ↔ 테스트 일치.

## 보안 리뷰 (필수)
- Task1의 리뷰는 **security-reviewer**로 진행: runner `npm` allowlist + `_TOKEN_RE` 확장 + provider→고정패키지 매핑에 대해 (a) 클라가 임의 패키지/명령을 주입할 수 있는가(불가여야 함 — 패키지는 서버 상수, target 무시), (b) `_TOKEN_RE` 확장이 argv 주입 여지를 넓히는가, (c) `npm i -g`의 postinstall 실행 트러스트 경계가 문서화됐는가 검증.
- Task2/3은 code-reviewer로 충분(신규 adapter 정합·UI 배선).

## 남은 위험
- `_TOKEN_RE`가 스코프 패키지(`@`,`/`)를 막으면 최소 확장 필요 — 확장 시 서버-상수 패키지만 argv에 오므로 안전하나, 리뷰에서 재확인.
- kiro/copilot/opencode의 실제 binary 이름·npm 패키지가 문서와 다르면 verify/probe 실패 — 실행자가 providers.py 카탈로그와 대조.
- 실제 npm 설치 라이브 검증은 미설치 provider가 실제로 설치되는 상태변경이라 사용자 개시 — 본 플랜은 구현+모킹 테스트까지(라이브 설치는 사용자가 버튼으로).
