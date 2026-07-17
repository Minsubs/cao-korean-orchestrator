"""Deterministic, no-network conversion previews (Phase 6b).

Converts between the ecosystems' artifact shapes and returns a **preview only**
— nothing is ever written here. Every returned ``converted`` string is run
through the shared secret mask, so this surface can never emit an unredacted
credential even when a source file carries one. Actual installation is the
frontend's job (it POSTs the preview to ``POST /agents/profiles``); this module
deliberately does not duplicate that install path.

Supported conversions (any other pair raises :class:`UnsupportedConversion`):

* ``claude_agent`` -> ``cao_profile``
* ``claude_command`` <-> ``codex_prompt``
* ``instruction`` -> ``counterpart_instruction`` (CLAUDE.md <-> AGENTS.md)

Each returns ``{"converted", "warnings", "lossy_fields"}``. ``lossy_fields`` names
information that could not be carried across (unmappable tools, dropped
frontmatter keys); ``warnings`` carries advisory notes that are not data loss.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import frontmatter

from cli_agent_orchestrator.services.env_migration import (
    MissingConversionInput,
    PathOutsideHome,
    UnsupportedConversion,
)
from cli_agent_orchestrator.services.tooling.runner import resolve_within_home
from cli_agent_orchestrator.services.tooling.secret_mask import mask
from cli_agent_orchestrator.utils.tool_mapping import TOOL_MAPPING

SOURCE_KINDS = frozenset({"claude_agent", "claude_command", "codex_prompt", "instruction"})
TARGET_KINDS = frozenset(
    {"cao_profile", "claude_command", "codex_prompt", "counterpart_instruction"}
)

# Frontmatter keys a Claude subagent carries that map onto a CAO profile.
_AGENT_KNOWN_KEYS = {"name", "description", "tools", "model"}

_CAO_MCP_HINT = (
    "오케스트레이션(handoff/assign) 참여가 필요하면 프로필에 cao-mcp-server mcpServers 블록을 "
    "추가하세요 — 워커 여부를 알 수 없어 자동으로 넣지 않았어요."
)
_INSTRUCTION_HINT = (
    "본문만 그대로 복사했고 의미 변환은 하지 않았어요 — 대상 CLI 관례에 맞는지 검토하세요."
)


def _reverse_claude_tool_map() -> Dict[str, str]:
    """Build a ``native Claude tool -> CAO tool`` map from the shared mapping.

    The ``fs_*`` aggregate is skipped so each native tool resolves to its single
    specific CAO category (e.g. ``Read`` -> ``fs_read``, not the aggregate).
    """
    reverse: Dict[str, str] = {}
    for cao_tool, natives in TOOL_MAPPING["claude_code"].items():
        if cao_tool == "fs_*":
            continue
        for native in natives:
            reverse.setdefault(native, cao_tool)
    return reverse


def _coerce_tools(raw: object) -> List[str]:
    """Normalise a Claude ``tools`` frontmatter value to a list of tool names.

    Accepts the comma-separated string form (``Read, Write``) and the YAML list
    form; anything else yields an empty list.
    """
    if isinstance(raw, str):
        return [part.strip() for part in raw.split(",") if part.strip()]
    if isinstance(raw, list):
        return [str(part).strip() for part in raw if str(part).strip()]
    return []


def _convert_agent_to_profile(text: str) -> Tuple[str, List[str], List[str]]:
    """Convert a Claude subagent ``.md`` into a CAO profile ``.md`` (preview)."""
    post = frontmatter.loads(text)
    meta = post.metadata
    warnings: List[str] = []
    lossy: List[str] = []

    out_meta: Dict[str, object] = {
        "name": str(meta.get("name") or "converted-agent"),
        "description": str(meta.get("description") or ""),
        "provider": "claude_code",
    }
    model = meta.get("model")
    if isinstance(model, str) and model:
        out_meta["model"] = model

    reverse = _reverse_claude_tool_map()
    if "tools" in meta:
        tools = _coerce_tools(meta.get("tools"))
        allowed: Dict[str, None] = {}  # ordered set of CAO tool names
        for tool in tools:
            cao_tool = reverse.get(tool)
            if cao_tool is None:
                lossy.append(f"tool '{tool}' (매핑되는 CAO 도구가 없어요)")
            else:
                allowed.setdefault(cao_tool, None)
        out_meta["allowedTools"] = list(allowed)
    else:
        # No tools field in a Claude subagent means "inherit every tool"; the
        # faithful CAO equivalent is unrestricted, surfaced as a warning so the
        # widening is never silent.
        out_meta["allowedTools"] = ["*"]
        warnings.append(
            "원본 에이전트에 tools 필드가 없어 모든 도구 허용(*)으로 변환했어요 — 필요하면 좁히세요."
        )

    # Any other frontmatter key (e.g. ``color``) is genuinely dropped.
    for key in meta:
        if key not in _AGENT_KNOWN_KEYS:
            lossy.append(f"frontmatter '{key}' (CAO 프로필에 대응 필드가 없어 제외)")

    warnings.append(_CAO_MCP_HINT)

    converted = frontmatter.dumps(frontmatter.Post(post.content, **out_meta))
    return converted, warnings, lossy


def _convert_command_prompt(text: str) -> Tuple[str, List[str], List[str]]:
    """Convert between a Claude command and a Codex prompt (symmetric preview).

    Both are markdown with an optional frontmatter ``description``. The
    description and body are preserved verbatim; any other frontmatter key has no
    counterpart in the target format and is reported as lossy. A source that is
    just ``description`` + body converts with no warnings and no loss.
    """
    post = frontmatter.loads(text)
    meta = post.metadata
    lossy: List[str] = []

    kept: Dict[str, object] = {}
    description = meta.get("description")
    if isinstance(description, str) and description:
        kept["description"] = description

    for key in meta:
        if key != "description":
            lossy.append(f"frontmatter '{key}' (대상 형식에 대응 필드가 없어 제외)")

    if kept:
        converted = frontmatter.dumps(frontmatter.Post(post.content, **kept))
    else:
        # No frontmatter worth emitting: keep the body as-is (identity copy).
        converted = post.content
    return converted, [], lossy


def _convert_instruction(text: str, source_name: Optional[str]) -> Tuple[str, List[str], List[str]]:
    """Copy an instruction body into its counterpart with a provenance header.

    No semantic translation is performed (honest by design). When the source
    filename is known (a ``path`` was supplied), the provenance line and the
    implied counterpart are derived from it.
    """
    counterpart = None
    if source_name == "CLAUDE.md":
        counterpart = "AGENTS.md"
    elif source_name == "AGENTS.md":
        counterpart = "CLAUDE.md"

    origin = source_name or "원본 지침 파일"
    provenance = f"<!-- CAO 변환: {origin}의 본문을 그대로 복사했어요 (의미 변환 없음) -->"
    converted = f"{provenance}\n\n{text}"

    warnings = [_INSTRUCTION_HINT]
    if counterpart is not None:
        warnings.append(f"대상 파일명은 보통 {counterpart} 예요.")
    return converted, warnings, []


def _load_source(path: Optional[str], content: Optional[str]) -> Tuple[str, Optional[str]]:
    """Resolve the source text and (when from a path) its filename.

    ``path`` takes precedence when both are given. A path is home-confined and
    read here; ``content`` is used verbatim. Raises when neither is supplied.
    """
    if path:
        try:
            resolved = resolve_within_home(path)
        except ValueError as exc:
            raise PathOutsideHome("홈 디렉터리 밖 경로는 다룰 수 없어요") from exc
        resolved_path = Path(resolved)
        text = resolved_path.read_text(encoding="utf-8", errors="replace")
        return text, resolved_path.name
    if content is not None:
        return content, None
    raise MissingConversionInput("path 또는 content 중 하나는 필요해요.")


def convert(
    source_kind: str,
    target_kind: str,
    path: Optional[str] = None,
    content: Optional[str] = None,
) -> Dict[str, object]:
    """Produce a conversion preview. Never writes to disk.

    Raises:
        UnsupportedConversion: unknown kind or an unsupported (source, target) pair.
        MissingConversionInput: neither ``path`` nor ``content`` supplied.
        PathOutsideHome: a supplied ``path`` resolved outside ``$HOME``.
    """
    if source_kind not in SOURCE_KINDS or target_kind not in TARGET_KINDS:
        raise UnsupportedConversion(f"unknown kind: {source_kind!r} -> {target_kind!r}")

    text, source_name = _load_source(path, content)
    pair = (source_kind, target_kind)

    if pair == ("claude_agent", "cao_profile"):
        converted, warnings, lossy = _convert_agent_to_profile(text)
    elif pair in {("claude_command", "codex_prompt"), ("codex_prompt", "claude_command")}:
        converted, warnings, lossy = _convert_command_prompt(text)
    elif pair == ("instruction", "counterpart_instruction"):
        converted, warnings, lossy = _convert_instruction(text, source_name)
    else:
        raise UnsupportedConversion(f"지원하지 않는 변환이에요: {source_kind!r} -> {target_kind!r}")

    return {"converted": mask(converted), "warnings": warnings, "lossy_fields": lossy}
