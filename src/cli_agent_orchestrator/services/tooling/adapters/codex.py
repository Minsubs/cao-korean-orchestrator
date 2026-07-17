"""Codex (``codex``) provider adapter — MCP management with a read-only fallback.

Two modes, selected by probing ``codex mcp --help``:

* **Managed** — when the help advertises non-interactive ``add`` / ``remove``
  (and ``list``), those become the write/read path exactly like Claude Code.
  Listing prefers ``codex mcp list --json`` (structured, no health check).
* **Read-only** — when ``codex mcp`` is absent or lacks non-interactive
  management, the adapter degrades to *listing only* by scanning the
  ``[mcp_servers.<name>]`` table headers of ``~/.codex/config.toml``. Install /
  remove are then reported unsupported with an actionable reason (open the
  config / copy the command) rather than silently failing.

The config scan reads only the server *names* from the table headers — a
conservative, dependency-free approach (no TOML parser) matching the rest of the
tooling's line-oriented parsing. Reads go through the read-only :mod:`probe`
runner or the filesystem; mutations are only planned.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, cast

from cli_agent_orchestrator.services.tooling import cache, probe
from cli_agent_orchestrator.services.tooling.adapters import _mcp_common
from cli_agent_orchestrator.services.tooling.adapters.base import (
    AdapterEnv,
    ExecutionPlan,
    ExtensionAdapter,
    ProviderCapabilities,
    unsupported_capabilities,
)

_BINARY = "codex"

_LIST_TIMEOUT_SECONDS = 10.0

_MCP_HELP_CACHE_KEY = "adapter:codex:mcp_help"
_LIST_CACHE_KEY = "adapter:codex:mcp_list"

# ``~/.codex/config.toml`` table header for a server: ``[mcp_servers.<name>]``
# (a bare or quoted first segment; deeper tables like ``.env`` are subtables of
# the same server and must not be counted as separate servers).
_CONFIG_TABLE_RE = re.compile(r'(?m)^\[mcp_servers\.(?:"([^"]+)"|([^\].]+))')

_NOT_INSTALLED_REASON = "codex 실행 파일이 감지되지 않았어요 — 설치 후 다시 검사하세요"
_READ_ONLY_REASON = (
    "codex에 비대화형 MCP 관리 명령이 없어요 — 설정 파일 열기/명령 복사를 이용하세요"
)
_NO_UPDATE_REASON = (
    "MCP 서버는 codex CLI에서 개별 업데이트를 지원하지 않아요 (제거 후 다시 추가하세요)"
)
_NO_SEARCH_REASON = "codex CLI는 MCP 서버 검색을 제공하지 않아요"


def _config_path() -> Path:
    return Path.home() / ".codex" / "config.toml"


def _parse_config_server_names(text: str) -> List[str]:
    """Extract MCP server names from ``config.toml`` table headers.

    Returns names in file order with duplicates removed. Only the first segment
    of each ``[mcp_servers.<name>]`` header is read, so a server's nested
    ``.env`` / ``.transport`` subtables collapse to the one server name; quoted
    names (``[mcp_servers."my-server"]``) are unquoted.
    """
    names: List[str] = []
    for quoted, bare in _CONFIG_TABLE_RE.findall(text):
        name = quoted or bare
        if name and name not in names:
            names.append(name)
    return names


class CodexAdapter(ExtensionAdapter):
    """Drives ``codex`` for MCP management, degrading to config-file listing."""

    id = "codex"
    display_name = "Codex"

    # -- detection ---------------------------------------------------------

    def detect(self) -> AdapterEnv:
        """Locate ``codex`` with ``which`` only (no execution)."""
        path = shutil.which(_BINARY)
        return AdapterEnv(installed=path is not None, path=path, version=None)

    # -- help probe --------------------------------------------------------

    def _mcp_subcommands(self) -> Optional[set[str]]:
        return _mcp_common.probe_subcommands(
            [_BINARY, "mcp", "--help"], _mcp_common.MCP_SUBCOMMANDS, _MCP_HELP_CACHE_KEY
        )

    def _managed(self) -> bool:
        """Non-interactive management confirmed (``add`` + ``remove`` in help)."""
        subs = self._mcp_subcommands()
        return bool(subs and "add" in subs and "remove" in subs)

    # -- capabilities ------------------------------------------------------

    def capabilities(self) -> ProviderCapabilities:
        """Full MCP management when confirmed; otherwise list-only (read-only)."""
        if not self.detect().installed:
            return unsupported_capabilities(_NOT_INSTALLED_REASON)

        subs = self._mcp_subcommands()
        managed = bool(subs and "add" in subs and "remove" in subs)
        reasons: Dict[str, str] = {
            "canUpdate": _NO_UPDATE_REASON,
            "canUpdateAll": _NO_UPDATE_REASON,
            "canSearch": _NO_SEARCH_REASON,
        }
        if managed:
            can_install = True
            can_remove = True
        else:
            can_install = False
            can_remove = False
            reasons["canInstall"] = _READ_ONLY_REASON
            reasons["canRemove"] = _READ_ONLY_REASON

        # Listing always works: `codex mcp list` when managed, else config.toml.
        return ProviderCapabilities(
            canList=True,
            canSearch=False,
            canInstall=can_install,
            canRemove=can_remove,
            canUpdate=False,
            canUpdateAll=False,
            requiresNewSession=True,
            requiresRestart=False,
            reasons=reasons,
        )

    # -- listing -----------------------------------------------------------

    def list_installed(self) -> List[Dict[str, Any]]:
        """List configured MCP servers (CLI JSON when managed, else config.toml)."""
        return self._list(use_cache=True)

    def _list(self, *, use_cache: bool) -> List[Dict[str, Any]]:
        if not self.detect().installed:
            return []
        store = cache.get_cache()
        if use_cache:
            cached = store.get(_LIST_CACHE_KEY)
            if cached is not None:
                return cast(List[Dict[str, Any]], cached)

        items = self._list_via_cli() if self._managed() else None
        if items is None:
            items = self._list_via_config()
        store.set(_LIST_CACHE_KEY, items)
        return items

    def _list_via_cli(self) -> Optional[List[Dict[str, Any]]]:
        """Parse ``codex mcp list --json``; ``None`` if it could not be read."""
        result = probe.run([_BINARY, "mcp", "list", "--json"], timeout=_LIST_TIMEOUT_SECONDS)
        if result.returncode != 0:
            return None
        try:
            parsed = json.loads(result.stdout)
        except (ValueError, TypeError):
            return None
        if not isinstance(parsed, list):
            return None
        items: List[Dict[str, Any]] = []
        for entry in parsed:
            if isinstance(entry, dict) and isinstance(entry.get("name"), str):
                items.append({"name": entry["name"], "raw": entry["name"]})
        return items

    def _list_via_config(self) -> List[Dict[str, Any]]:
        """Parse ``~/.codex/config.toml`` ``mcp_servers`` tables (read-only)."""
        try:
            text = _config_path().read_text(encoding="utf-8", errors="replace")
        except OSError:
            return []
        return [{"name": name, "raw": name} for name in _parse_config_server_names(text)]

    def _installed_names(self, *, use_cache: bool = True) -> set[str]:
        return {item["name"] for item in self._list(use_cache=use_cache) if item.get("name")}

    # -- planning ----------------------------------------------------------

    def plan(self, action: str, target: Optional[str], scope: Optional[str]) -> ExecutionPlan:
        """Plan a ``remove`` (by name). ``install`` needs a catalog command."""
        if action == "remove":
            if not target:
                raise ValueError("action 'remove' requires a target")
            argv = _mcp_common.mcp_remove_argv(_BINARY, target)
            return ExecutionPlan(
                argv=argv,
                cwd=str(Path.home()),
                description=f"Remove MCP server {target} via `{' '.join(argv)}`",
                verify_description=f"Confirm {target} is absent from `codex mcp list`",
            )
        if action == "install":
            raise ValueError(
                "installing an MCP server requires a launch command; use a catalog item"
            )
        raise ValueError(f"unsupported action for codex: {action!r}")

    def plan_mcp_add(self, name: str, command_tokens: List[str]) -> ExecutionPlan:
        """Plan ``codex mcp add <name> -- <command…>`` from static catalog tokens."""
        if not name:
            raise ValueError("an MCP server install requires a name")
        if not command_tokens:
            raise ValueError("an MCP server install requires a launch command")
        argv = _mcp_common.mcp_add_argv(_BINARY, name, command_tokens)
        return ExecutionPlan(
            argv=argv,
            cwd=str(Path.home()),
            description=f"Add MCP server {name} via `{' '.join(argv)}`",
            verify_description=f"Confirm {name} is present in `codex mcp list`",
        )

    # -- verification ------------------------------------------------------

    def verify(self, action: str, target: Optional[str]) -> Tuple[bool, str]:
        """Re-list (bypassing the cache) to confirm the add/remove effect."""
        if not target:
            return False, f"action {action!r} requires a target to verify"
        present = target in self._installed_names(use_cache=False)
        if action == "install":
            return present, f"{target} is {'present in' if present else 'absent from'} MCP servers"
        if action == "remove":
            return (not present), (
                f"{target} is {'still present in' if present else 'absent from'} MCP servers"
            )
        return False, f"unknown action: {action!r}"
