"""Antigravity (``agy``) provider adapter — read-only MCP listing.

``agy`` exposes no non-interactive ``mcp`` subcommand (its ``mcp`` word is not a
recognized command), so v1 is deliberately **read-only**: it lists MCP servers by
parsing the JSON config at ``~/.gemini/config/mcp_config.json`` and reports every
mutating capability as unsupported with a "manage it in the Terminal" reason.

No ``agy`` output is ever parsed — the CLI renders an ANSI/TUI surface, and
scraping that is explicitly out of scope. Detection is ``which('agy')`` only; the
one place ``agy`` is executed read-only (``agy models``) lives in the separate
models collector, not here.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from cli_agent_orchestrator.services.tooling.adapters.base import (
    AdapterEnv,
    ExecutionPlan,
    ExtensionAdapter,
    ProviderCapabilities,
    unsupported_capabilities,
)

_BINARY = "agy"

# Config the Antigravity CLI reads its MCP servers from.
_CONFIG_RELPATH = (".gemini", "config", "mcp_config.json")

_NOT_INSTALLED_REASON = "agy 실행 파일이 감지되지 않았어요 — 설치 후 다시 검사하세요"
_READ_ONLY_REASON = "agy는 MCP 조회만 지원해요 — 추가/삭제는 Terminal에서 관리하세요"
_UPDATE_RESTART_WARNING = "CLI 프로세스가 실행 중이면 업데이트 후 재시작이 필요할 수 있어요"


def _config_path() -> Path:
    return Path.home().joinpath(*_CONFIG_RELPATH)


def _parse_config_server_names(text: str) -> List[str]:
    """Extract server names from an ``mcp_config.json`` body (conservative).

    Accepts the standard ``{"mcpServers": {<name>: {…}}}`` shape (and the
    ``mcp_servers`` spelling). Anything else — empty file, a list, a dict without
    that key — yields no names rather than a guess.
    """
    stripped = text.strip()
    if not stripped:
        return []
    try:
        data = json.loads(stripped)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, dict):
        return []
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        servers = data.get("mcp_servers")
    if not isinstance(servers, dict):
        return []
    return [name for name in servers if isinstance(name, str)]


class AntigravityAdapter(ExtensionAdapter):
    """Read-only ``agy`` adapter: lists MCP servers from the JSON config."""

    id = "antigravity_cli"
    display_name = "Antigravity CLI"

    # -- detection ---------------------------------------------------------

    def detect(self) -> AdapterEnv:
        """Locate ``agy`` with ``which`` only (never executes it)."""
        path = shutil.which(_BINARY)
        return AdapterEnv(installed=path is not None, path=path, version=None)

    # -- capabilities ------------------------------------------------------

    def capabilities(self) -> ProviderCapabilities:
        """List-only when installed; every mutating capability is unsupported."""
        if not self.detect().installed:
            return unsupported_capabilities(_NOT_INSTALLED_REASON)

        reasons = {
            key: _READ_ONLY_REASON
            for key in ("canSearch", "canInstall", "canRemove", "canUpdateAll")
        }
        # canUpdate here means "update the agy CLI binary itself" (`agy
        # update`) — the one mutation this otherwise read-only adapter allows.
        return ProviderCapabilities(
            canList=True,
            canSearch=False,
            canInstall=False,
            canRemove=False,
            canUpdate=True,
            canUpdateAll=False,
            requiresNewSession=False,
            requiresRestart=False,
            reasons=reasons,
        )

    # -- listing -----------------------------------------------------------

    def list_installed(self) -> List[Dict[str, Any]]:
        """Parse ``~/.gemini/config/mcp_config.json`` into ``{name, raw}`` entries."""
        if not self.detect().installed:
            return []
        try:
            text = _config_path().read_text(encoding="utf-8", errors="replace")
        except OSError:
            return []
        return [{"name": name, "raw": name} for name in _parse_config_server_names(text)]

    # -- planning / verification (read-only: both refuse) ------------------

    def plan(self, action: str, target: Optional[str], scope: Optional[str]) -> ExecutionPlan:
        """Refuse every action except ``update`` — ``agy`` MCP management is Terminal-only."""
        if action == "update":
            return ExecutionPlan(
                argv=[_BINARY, "update"],
                cwd=None,
                description=(
                    f"{_BINARY} CLI를 최신 버전으로 업데이트해요. {_UPDATE_RESTART_WARNING}"
                ),
                verify_description=f"{_BINARY} --version 재확인",
            )
        raise ValueError(_READ_ONLY_REASON)

    def verify(self, action: str, target: Optional[str]) -> Tuple[bool, str]:
        """Nothing is ever mutated here except ``update``, so only it has a verify result."""
        if action == "update":
            return True, f"{_BINARY} update completed"
        return False, _READ_ONLY_REASON
