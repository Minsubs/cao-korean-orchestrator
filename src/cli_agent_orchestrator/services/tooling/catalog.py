"""Curated catalog of popular extensions (server-side static data).

This is a small, hand-maintained registry of real, publicly documented MCP
servers and Anthropic skills. It is **not** a mock and it is **not** derived from
anything a renderer sends: every launch command lives here as a fixed argv
fragment, so a catalog install can only ever run tokens defined in this file.

The one piece of runtime input a catalog install accepts is a filesystem
*path* (the ``filesystem`` server needs a directory to expose). That path is
confined to $HOME and token-validated by the router before it is appended to the
otherwise-static command — see :func:`resolve_install`.

Shape (per :class:`CatalogItem`):

* ``install`` maps each supported ``provider`` to an :class:`InstallSpec`
  (``method`` + static ``argv`` fragment). ``method`` is ``"mcp"`` (add an MCP
  server), ``"skill"`` (install via the generic skills CLI), or ``"manual"``
  (no safe non-interactive command — the UI shows a copyable command instead).
* :func:`list_catalog` augments each item with per-provider *support* (can this
  provider install it, and why not) and *install status* (is it already present
  in that provider's inventory), computed against the live adapters.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Tuple

from cli_agent_orchestrator.services.tooling import runner
from cli_agent_orchestrator.services.tooling.adapters import registry

# Anchor URLs kept as module constants so the item table stays readable.
_MCP_SERVERS_REPO = "https://github.com/modelcontextprotocol/servers/tree/main/src"
_ANTHROPIC_SKILLS_REPO = "https://github.com/anthropics/skills"


class CatalogError(Exception):
    """A catalog install request that cannot be satisfied (router → HTTP 400)."""


@dataclass(frozen=True)
class InstallSpec:
    """How one provider installs one catalog item.

    ``argv`` is the *static* command fragment: for ``method="mcp"`` it is the MCP
    server's launch command (e.g. ``("npx", "-y", "@upstash/context7-mcp")``);
    for ``method="skill"`` it is a single-element ``(skill_name,)``.
    ``requires_params`` names runtime inputs the item needs (only ``"path"`` for
    now, appended after home-confinement).
    """

    method: str
    argv: Tuple[str, ...]
    requires_params: Tuple[str, ...] = ()


@dataclass(frozen=True)
class CatalogItem:
    """One curated extension and its per-provider install specs."""

    id: str
    name: str
    description_ko: str
    kind: str  # 'mcp' | 'plugin' | 'skill' | 'cli'
    category: str
    homepage: str
    providers: Tuple[str, ...]
    install: Mapping[str, InstallSpec]
    requires: Tuple[str, ...] = ()
    popular: bool = True
    new_session_required: bool = False
    warnings: Tuple[str, ...] = ()
    # Per-item override for the reason shown on a ``method="manual"`` entry.
    # Falls back to a generic manual reason when None.
    manual_reason: Optional[str] = None


def _mcp_item(
    item_id: str,
    name: str,
    description_ko: str,
    category: str,
    homepage: str,
    argv: Tuple[str, ...],
    *,
    requires_params: Tuple[str, ...] = (),
    warnings: Tuple[str, ...] = (),
) -> CatalogItem:
    """Build an MCP item installable on both Claude Code and Codex."""
    spec = InstallSpec(method="mcp", argv=argv, requires_params=requires_params)
    return CatalogItem(
        id=item_id,
        name=name,
        description_ko=description_ko,
        kind="mcp",
        category=category,
        homepage=homepage,
        providers=("claude_code", "codex"),
        install={"claude_code": spec, "codex": spec},
        requires=("npx",),
        new_session_required=True,
        warnings=warnings,
    )


def _skill_item(
    item_id: str, name: str, description_ko: str, homepage: str = _ANTHROPIC_SKILLS_REPO
) -> CatalogItem:
    """Build an Anthropic-skills item installable via the generic skills CLI."""
    return CatalogItem(
        id=item_id,
        name=name,
        description_ko=description_ko,
        kind="skill",
        category="문서 작성",
        homepage=homepage,
        providers=("generic_skills",),
        install={"generic_skills": InstallSpec(method="skill", argv=(item_id,))},
        new_session_required=False,
    )


_ITEMS: Tuple[CatalogItem, ...] = (
    _mcp_item(
        "context7",
        "Context7",
        "라이브러리와 프레임워크의 최신 공식 문서를 실시간으로 가져와 코드 예제의 정확도를 높여줘요.",
        "문서",
        "https://github.com/upstash/context7",
        ("npx", "-y", "@upstash/context7-mcp"),
    ),
    _mcp_item(
        "playwright",
        "Playwright",
        "브라우저를 실제로 구동해 웹 페이지를 탐색·조작하고 자동화 작업을 수행해요.",
        "브라우저 자동화",
        "https://github.com/microsoft/playwright-mcp",
        ("npx", "@playwright/mcp@latest"),
    ),
    _mcp_item(
        "sequential-thinking",
        "Sequential Thinking",
        "복잡한 문제를 단계별 사고 과정으로 나눠 체계적으로 추론하도록 도와줘요.",
        "추론",
        f"{_MCP_SERVERS_REPO}/sequentialthinking",
        ("npx", "-y", "@modelcontextprotocol/server-sequential-thinking"),
    ),
    _mcp_item(
        "memory",
        "Memory",
        "지식 그래프 기반으로 대화 사이의 정보를 저장하고 다시 불러와요.",
        "메모리",
        f"{_MCP_SERVERS_REPO}/memory",
        ("npx", "-y", "@modelcontextprotocol/server-memory"),
    ),
    _mcp_item(
        "fetch",
        "Fetch",
        "지정한 URL의 웹 콘텐츠를 가져와 읽기 좋은 형식으로 변환해줘요.",
        "웹",
        f"{_MCP_SERVERS_REPO}/fetch",
        ("npx", "-y", "@modelcontextprotocol/server-fetch"),
    ),
    _mcp_item(
        "filesystem",
        "Filesystem",
        "허용한 로컬 디렉터리의 파일을 안전하게 읽고 쓸 수 있게 해줘요. 접근을 허용할 경로를 지정하세요.",
        "파일시스템",
        f"{_MCP_SERVERS_REPO}/filesystem",
        ("npx", "-y", "@modelcontextprotocol/server-filesystem"),
        requires_params=("path",),
        warnings=("접근을 허용할 디렉터리 경로(홈 디렉터리 내부)를 params.path로 지정해야 해요.",),
    ),
    _mcp_item(
        "github",
        "GitHub",
        "GitHub 저장소·이슈·풀 리퀘스트를 조회하고 다룰 수 있게 해줘요.",
        "개발",
        f"{_MCP_SERVERS_REPO}/github",
        ("npx", "-y", "@modelcontextprotocol/server-github"),
        warnings=(
            "이 서버는 GITHUB_PERSONAL_ACCESS_TOKEN 환경변수가 필요해요 — "
            "토큰 값은 CAO가 저장하거나 다루지 않으며, 사용자가 직접 환경에 설정해야 해요.",
        ),
    ),
    # The generic ``skills`` CLI itself — the prerequisite the skill items above
    # need. There is no safe non-interactive install (it is a global package
    # install), so this is a ``manual`` entry: the UI shows the command below as
    # a copyable string. The command is an *estimate for display only* — the
    # exact package name must be confirmed against the official docs before
    # running it (설치 전 공식 문서 확인). CAO never executes it.
    CatalogItem(
        id="generic-skills-cli",
        name="Skills CLI",
        description_ko=(
            "스킬을 설치·관리하는 generic 'skills' CLI예요. "
            "위 스킬 항목을 설치하려면 먼저 이 CLI가 필요해요."
        ),
        kind="cli",
        category="스킬",
        homepage=_ANTHROPIC_SKILLS_REPO,
        providers=("generic_skills",),
        install={
            "generic_skills": InstallSpec(
                method="manual",
                # 예시(표기용) — 설치 전 공식 문서에서 정확한 패키지명을 확인하세요.
                argv=("npm", "install", "-g", "@anthropic-ai/skills"),
            )
        },
        new_session_required=False,
        warnings=("표기용 예시 명령이에요 — 설치 전 공식 문서에서 정확한 패키지명을 확인하세요.",),
        manual_reason="자동 설치는 지원하지 않아요 — 명령을 복사해 실행한 뒤 다시 검사하세요",
    ),
    _skill_item("docx", "Word 문서 (docx)", "Word(.docx) 문서를 만들고 편집하는 스킬이에요."),
    _skill_item("pdf", "PDF", "PDF 문서를 읽고 생성·편집하는 스킬이에요."),
    _skill_item(
        "pptx", "PowerPoint (pptx)", "PowerPoint(.pptx) 슬라이드를 만들고 편집하는 스킬이에요."
    ),
    _skill_item("xlsx", "Excel (xlsx)", "Excel(.xlsx) 스프레드시트를 만들고 편집하는 스킬이에요."),
)

_BY_ID: Dict[str, CatalogItem] = {item.id: item for item in _ITEMS}


def get_item(item_id: str) -> Optional[CatalogItem]:
    """Return the catalog item with ``item_id``, or ``None``."""
    return _BY_ID.get(item_id)


# --- listing (item + per-provider support/status) -------------------------


def _provider_snapshot(providers: set[str]) -> Dict[str, Dict[str, Any]]:
    """Detect + capability + installed-name snapshot for each referenced provider.

    Each provider's ``list_installed`` is called at most once and reused across
    every catalog item, so a full listing shells out a bounded number of times.
    """
    snapshot: Dict[str, Dict[str, Any]] = {}
    for provider in providers:
        adapter = registry.get_adapter(provider)
        if adapter is None or not adapter.detect().installed:
            snapshot[provider] = {"installed": False, "caps": None, "names": set()}
            continue
        names = {item["name"] for item in adapter.list_installed() if item.get("name")}
        snapshot[provider] = {
            "installed": True,
            "caps": adapter.capabilities(),
            "names": names,
        }
    return snapshot


def _supported_entry(item: CatalogItem, provider: str, snap: Dict[str, Any]) -> Dict[str, Any]:
    spec = item.install[provider]
    entry: Dict[str, Any] = {
        "method": spec.method,
        "requires_params": list(spec.requires_params),
        "install_status": "unknown",
        "supported": False,
        "reason": None,
    }
    # Manual items have no safe non-interactive install: always surface a
    # copyable command and never auto-install, independent of detection — a
    # kind='cli' bootstrap item is shown *precisely* when its CLI is absent, so
    # this must run before the "not detected" early return below. install_status
    # tracks binary detection (there is no inventory to look a bootstrap up in).
    if spec.method == "manual":
        entry["install_status"] = "installed" if snap["installed"] else "not_installed"
        entry["command"] = " ".join(spec.argv)
        entry["reason"] = item.manual_reason or (
            "자동 설치가 지원되지 않는 항목이에요 — 명령을 복사해 직접 실행하세요"
        )
        return entry
    entry["install_status"] = (
        ("installed" if item.id in snap["names"] else "not_installed")
        if snap["installed"]
        else "unknown"
    )
    if not snap["installed"]:
        entry["reason"] = f"{provider}이(가) 감지되지 않았어요 — 설치 후 다시 검사하세요"
        return entry
    caps = snap["caps"]
    if caps is not None and caps.canInstall:
        entry["supported"] = True
    else:
        entry["reason"] = (
            caps.reasons.get("canInstall") if caps else None
        ) or f"{provider}에서 이 확장을 설치할 수 없어요"
    return entry


def list_catalog() -> List[Dict[str, Any]]:
    """Return every catalog item with per-provider support and install status."""
    referenced = {provider for item in _ITEMS for provider in item.providers}
    snapshot = _provider_snapshot(referenced)

    result: List[Dict[str, Any]] = []
    for item in _ITEMS:
        supported = {
            provider: _supported_entry(item, provider, snapshot[provider])
            for provider in item.providers
        }
        result.append(
            {
                "id": item.id,
                "name": item.name,
                "description_ko": item.description_ko,
                "kind": item.kind,
                "category": item.category,
                "homepage": item.homepage,
                "providers": list(item.providers),
                "requires": list(item.requires),
                "popular": item.popular,
                "new_session_required": item.new_session_required,
                "warnings": list(item.warnings),
                "install": {
                    provider: {"method": spec.method, "argv": list(spec.argv)}
                    for provider, spec in item.install.items()
                },
                "supported": supported,
            }
        )
    return result


# --- install resolution (for plan/execute) --------------------------------


@dataclass(frozen=True)
class ResolvedInstall:
    """A catalog install reduced to what an adapter needs to plan it."""

    item: CatalogItem
    provider: str
    method: str
    name: str  # MCP server name or skill name (used for install + verification)
    command_tokens: List[str] = field(default_factory=list)  # method='mcp' only
    warnings: List[str] = field(default_factory=list)


def resolve_install(
    item_id: str, provider: str, params: Optional[Mapping[str, Any]]
) -> ResolvedInstall:
    """Resolve ``catalog:<id>`` + provider (+ params) into a concrete install.

    Raises:
        CatalogError: Unknown item, provider that does not support it, a manual
            item, or an invalid/missing/escaping ``params.path``. The router maps
            this to HTTP 400.
    """
    item = get_item(item_id)
    if item is None:
        raise CatalogError(f"알 수 없는 카탈로그 항목이에요: {item_id!r}")
    if provider not in item.install:
        raise CatalogError(f"{provider}은(는) '{item.name}' 확장을 지원하지 않아요")

    spec = item.install[provider]
    warnings = list(item.warnings)

    if spec.method == "manual":
        raise CatalogError(
            f"'{item.name}'은(는) 자동 설치를 지원하지 않아요 — 명령을 복사해 직접 실행하세요"
        )

    if spec.method == "skill":
        return ResolvedInstall(
            item=item, provider=provider, method="skill", name=spec.argv[0], warnings=warnings
        )

    if spec.method == "mcp":
        tokens = list(spec.argv)
        if "path" in spec.requires_params:
            tokens.append(_resolve_path_param(params))
        return ResolvedInstall(
            item=item,
            provider=provider,
            method="mcp",
            name=item.id,
            command_tokens=tokens,
            warnings=warnings,
        )

    raise CatalogError(f"지원하지 않는 설치 방식이에요: {spec.method!r}")


def _resolve_path_param(params: Optional[Mapping[str, Any]]) -> str:
    """Validate + home-confine a required ``params.path`` (raises CatalogError)."""
    path = params.get("path") if params else None
    if not isinstance(path, str) or not path.strip():
        raise CatalogError("이 항목은 params.path(접근을 허용할 디렉터리)가 필요해요")
    try:
        resolved = runner.resolve_within_home(path)
    except ValueError:
        raise CatalogError("params.path가 홈 디렉터리를 벗어났어요") from None
    if not runner.is_valid_token(resolved):
        raise CatalogError("params.path에 명령 인자로 쓸 수 없는 문자가 있어요")
    return resolved
