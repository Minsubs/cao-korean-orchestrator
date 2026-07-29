"""Claude Code (``claude``) provider adapter — non-interactive MCP management.

Capabilities are decided by *probing the installed CLI*, never assumed:

* **Detection** is ``which('claude')`` plus a cached ``claude --version`` read.
* **MCP capabilities** come from ``claude mcp --help``: a management action is
  advertised only if its subcommand (``list`` / ``add`` / ``remove``) actually
  appears in the help. ``add``/``remove`` are the write path; ``list`` backs
  both the inventory and post-run verification.
* **Plugins** are probed separately (``claude plugin --help``). When a
  non-interactive ``install`` + ``marketplace`` pair is present it is reported
  as manageable; otherwise ``reasons['plugin']`` explains that plugins are
  driven from the interactive Plugin Browser. Plugin *installs* are surfaced to
  the UI through the catalog (as a copyable command), not auto-executed here.
* **Marketplaces** (:meth:`marketplace_list`, Phase 6c) are listed via ``claude
  plugin marketplace list --json`` through the write-path :mod:`runner` (masked,
  allowlisted, 64 KiB-capped). The parse is conservative: an unrecognized shape
  reports ``supported=False`` with a reason instead of a guessed list.
* **New session** — a freshly added MCP server only takes effect in a new
  Claude session, so ``requiresNewSession`` is always ``True``.

Reads use the read-only :mod:`probe` runner; the mutating ``add``/``remove`` are
only *planned* here and executed by the write-path :mod:`runner`. ``claude mcp
list`` health-checks configured servers, so its result is TTL-cached to keep a
polling UI from re-checking on every request.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, cast

from cli_agent_orchestrator.services.tooling import cache, probe, runner
from cli_agent_orchestrator.services.tooling.adapters import _mcp_common
from cli_agent_orchestrator.services.tooling.adapters.base import (
    AdapterEnv,
    ExecutionPlan,
    ExtensionAdapter,
    ProviderCapabilities,
    unsupported_capabilities,
)

_BINARY = "claude"

# Fixed npm package for the target-exempt ``install_cli`` action. This is a
# server-side constant, never derived from the request — the client sends only
# ``{action: "install_cli", provider: "claude_code"}`` and the ``target`` field
# (if any) is ignored by :meth:`ClaudeCodeAdapter.plan`.
_CLI_PACKAGE = "@anthropic-ai/claude-code"

_VERSION_TIMEOUT_SECONDS = 5.0
_LIST_TIMEOUT_SECONDS = 20.0  # `claude mcp list` health-checks each server.
_MARKETPLACE_TIMEOUT_SECONDS = 15.0

_VERSION_CACHE_KEY = "adapter:claude_code:version"
_MCP_HELP_CACHE_KEY = "adapter:claude_code:mcp_help"
_PLUGIN_HELP_CACHE_KEY = "adapter:claude_code:plugin_help"
_LIST_CACHE_KEY = "adapter:claude_code:mcp_list"
_MARKETPLACE_CACHE_KEY = "adapter:claude_code:marketplace_list"

# Plugin subcommands whose presence signals non-interactive manageability.
_PLUGIN_SUBCOMMANDS = ("install", "uninstall", "marketplace", "list")

_NOT_INSTALLED_REASON = "claude 실행 파일이 감지되지 않았어요 — 설치 후 다시 검사하세요"
_MCP_HELP_UNREADABLE_REASON = "'claude mcp --help'를 읽지 못해 MCP 기능을 확인할 수 없어요"
_NO_UPDATE_REASON = (
    "MCP 서버는 claude CLI에서 개별 업데이트를 지원하지 않아요 (제거 후 다시 추가하세요)"
)
_NO_SEARCH_REASON = "claude CLI는 MCP 서버 검색을 제공하지 않아요"
_UPDATE_RESTART_WARNING = "CLI 프로세스가 실행 중이면 업데이트 후 재시작이 필요할 수 있어요"
_PLUGIN_INTERACTIVE_REASON = (
    "플러그인은 대화형 Plugin Browser에서만 관리돼요 — Terminal에서 claude를 여세요"
)
_PLUGIN_MANAGEABLE_NOTE = (
    "플러그인은 'claude plugin install' / 'claude plugin marketplace'로 관리할 수 있어요"
)
_MARKETPLACE_MANAGE_HINT = "claude plugin marketplace add <repo>"
_MARKETPLACE_UNRECOGNIZED_REASON = (
    "claude plugin marketplace 목록 출력 형식을 인식하지 못했어요 — CLI에서 직접 확인하세요"
)


def _parse_marketplace_json(text: str) -> Optional[List[Dict[str, Optional[str]]]]:
    """Parse ``claude plugin marketplace list --json`` into ``{name, source}`` items.

    Conservative by design: accepts ONLY a top-level JSON array whose every
    element is an object carrying a non-empty string ``name``. Any other shape
    (not JSON, not a list, an element without a usable name) returns ``None`` so
    the caller can honestly report an unrecognized format instead of fabricating
    a list. An empty array is a valid "no marketplaces configured" result and
    returns ``[]``. ``source`` is carried through when present as a non-empty
    string, else ``None`` (other fields such as ``repo``/``installLocation`` are
    intentionally dropped — they are not needed and may hold local paths).
    """
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, list):
        return None
    items: List[Dict[str, Optional[str]]] = []
    for entry in data:
        if not isinstance(entry, dict):
            return None
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            return None
        source = entry.get("source")
        items.append(
            {
                "name": name.strip(),
                "source": source.strip() if isinstance(source, str) and source.strip() else None,
            }
        )
    return items


class ClaudeCodeAdapter(ExtensionAdapter):
    """Drives ``claude`` for non-interactive MCP server management."""

    id = "claude_code"
    display_name = "Claude Code"

    # -- detection ---------------------------------------------------------

    def detect(self) -> AdapterEnv:
        """Locate ``claude`` (``which``) and read its version (cached probe)."""
        path = shutil.which(_BINARY)
        if path is None:
            return AdapterEnv(installed=False, path=None, version=None)
        return AdapterEnv(installed=True, path=path, version=self._version())

    def _version(self) -> Optional[str]:
        store = cache.get_cache()
        cached = store.get(_VERSION_CACHE_KEY)
        if cached is not None:
            return cast(Optional[str], cached or None)
        result = probe.run([_BINARY, "--version"], timeout=_VERSION_TIMEOUT_SECONDS)
        version: Optional[str] = None
        if not result.timed_out and result.returncode == 0:
            line = next((ln.strip() for ln in result.stdout.splitlines() if ln.strip()), "")
            version = line or None
        store.set(_VERSION_CACHE_KEY, version or "")
        return version

    # -- help probes -------------------------------------------------------

    def _mcp_subcommands(self) -> Optional[set[str]]:
        return _mcp_common.probe_subcommands(
            [_BINARY, "mcp", "--help"], _mcp_common.MCP_SUBCOMMANDS, _MCP_HELP_CACHE_KEY
        )

    def _plugin_subcommands(self) -> Optional[set[str]]:
        return _mcp_common.probe_subcommands(
            [_BINARY, "plugin", "--help"], _PLUGIN_SUBCOMMANDS, _PLUGIN_HELP_CACHE_KEY
        )

    def _plugins_manageable(self) -> bool:
        subs = self._plugin_subcommands()
        return bool(subs and "install" in subs and "marketplace" in subs)

    # -- capabilities ------------------------------------------------------

    def capabilities(self) -> ProviderCapabilities:
        """Report MCP capabilities from ``claude mcp --help``; plugins via reasons.

        ``canInstallCli`` is always ``True`` here, even in the "not installed"
        branch below — bootstrapping the CLI via npm is exactly what that
        branch is for, so it must not be swept into the blanket ``False`` the
        rest of that reply carries.
        """
        if not self.detect().installed:
            return unsupported_capabilities(_NOT_INSTALLED_REASON, canInstallCli=True)

        subs = self._mcp_subcommands()
        reasons: Dict[str, str] = {}

        def _mcp_cap(capability: str, subcommand: str) -> bool:
            if subs is None:
                reasons[capability] = _MCP_HELP_UNREADABLE_REASON
                return False
            if subcommand in subs:
                return True
            reasons[capability] = (
                f"'claude mcp'에 '{subcommand}' 하위 명령이 없어요 (--help에서 확인되지 않음)"
            )
            return False

        can_list = _mcp_cap("canList", "list")
        can_install = _mcp_cap("canInstall", "add")
        can_remove = _mcp_cap("canRemove", "remove")
        reasons["canUpdate"] = _NO_UPDATE_REASON
        reasons["canSearch"] = _NO_SEARCH_REASON
        reasons["plugin"] = (
            _PLUGIN_MANAGEABLE_NOTE if self._plugins_manageable() else _PLUGIN_INTERACTIVE_REASON
        )

        # canUpdateAll here means "update the claude CLI binary itself"
        # (`claude update`) via the target-exempt update_all action,
        # independent of MCP management mode — always available. canUpdate
        # (per-MCP-server update) stays unsupported, same as before this
        # feature.
        return ProviderCapabilities(
            canList=can_list,
            canSearch=False,
            canInstall=can_install,
            canRemove=can_remove,
            canUpdate=False,
            canUpdateAll=True,
            requiresNewSession=True,
            requiresRestart=False,
            canInstallCli=True,
            reasons=reasons,
        )

    # -- listing -----------------------------------------------------------

    def list_installed(self) -> List[Dict[str, Any]]:
        """Parse ``claude mcp list`` into ``{name, raw}`` entries (TTL-cached).

        Each server line is ``<name>: <endpoint> - <status>``; the name is the
        text before the first ``": "``. Lines without that separator (the
        health-check header, blanks) are kept with ``name=None`` so nothing
        parsed is silently dropped, matching the generic adapter's contract.
        """
        return self._list(use_cache=True)

    def _list(self, *, use_cache: bool) -> List[Dict[str, Any]]:
        if not self.detect().installed:
            return []
        store = cache.get_cache()
        if use_cache:
            cached = store.get(_LIST_CACHE_KEY)
            if cached is not None:
                return cast(List[Dict[str, Any]], cached)

        result = probe.run(_mcp_common.mcp_list_argv(_BINARY), timeout=_LIST_TIMEOUT_SECONDS)
        items: List[Dict[str, Any]] = []
        if result.returncode is not None:
            for line in result.stdout.splitlines():
                stripped = line.strip()
                if not stripped:
                    continue
                name = stripped.split(": ", 1)[0].strip() if ": " in stripped else None
                items.append({"name": name or None, "raw": stripped})
        store.set(_LIST_CACHE_KEY, items)
        return items

    def _installed_names(self, *, use_cache: bool = True) -> set[str]:
        return {item["name"] for item in self._list(use_cache=use_cache) if item.get("name")}

    # -- planning ----------------------------------------------------------

    def plan(self, action: str, target: Optional[str], scope: Optional[str]) -> ExecutionPlan:
        """Plan a ``remove`` (by name). ``install`` needs a catalog command.

        ``install_cli`` intentionally ignores ``target`` — the package is the
        fixed :data:`_CLI_PACKAGE` constant, never client-supplied.
        """
        if action == "remove":
            if not target:
                raise ValueError("action 'remove' requires a target")
            argv = _mcp_common.mcp_remove_argv(_BINARY, target)
            return ExecutionPlan(
                argv=argv,
                cwd=str(Path.home()),
                description=f"Remove MCP server {target} via `{' '.join(argv)}`",
                verify_description=f"Confirm {target} is absent from `claude mcp list`",
            )
        if action == "install":
            raise ValueError(
                "installing an MCP server requires a launch command; use a catalog item"
            )
        if action == "update_all":
            return ExecutionPlan(
                argv=[_BINARY, "update"],
                cwd=None,
                description=(
                    f"{_BINARY} CLI를 최신 버전으로 업데이트해요. {_UPDATE_RESTART_WARNING}"
                ),
                verify_description=f"{_BINARY} --version 재확인",
            )
        if action == "install_cli":
            # `target` is ignored on purpose (security): the package is always
            # the fixed `_CLI_PACKAGE` constant, never a client-supplied name.
            return ExecutionPlan(
                argv=["npm", "install", "-g", _CLI_PACKAGE],
                cwd=None,
                description=(
                    f"{_BINARY} CLI를 npm으로 전역 설치해요 (npm 전역 설치 권한이 필요할 수 있어요)"
                ),
                verify_description=f"{_BINARY} --version 확인",
            )
        raise ValueError(f"unsupported action for claude_code: {action!r}")

    def plan_mcp_add(self, name: str, command_tokens: List[str]) -> ExecutionPlan:
        """Plan ``claude mcp add <name> -- <command…>`` from static catalog tokens."""
        if not name:
            raise ValueError("an MCP server install requires a name")
        if not command_tokens:
            raise ValueError("an MCP server install requires a launch command")
        argv = _mcp_common.mcp_add_argv(_BINARY, name, command_tokens)
        return ExecutionPlan(
            argv=argv,
            cwd=str(Path.home()),
            description=f"Add MCP server {name} via `{' '.join(argv)}`",
            verify_description=f"Confirm {name} is present in `claude mcp list`",
        )

    # -- verification ------------------------------------------------------

    def verify(self, action: str, target: Optional[str]) -> Tuple[bool, str]:
        """Re-query ``claude mcp list`` to confirm the add/remove effect."""
        if action == "update_all":
            return True, f"{_BINARY} update completed"
        if action == "install_cli":
            found = shutil.which(_BINARY) is not None
            return found, (
                f"{_BINARY} is now on PATH"
                if found
                else f"{_BINARY} was not found on PATH after install"
            )
        if not target:
            return False, f"action {action!r} requires a target to verify"
        # Bypass the list cache: verify runs before the operation manager's
        # post-run cache.invalidate(), so it must read the freshly mutated state.
        present = target in self._installed_names(use_cache=False)
        if action == "install":
            return present, f"{target} is {'present in' if present else 'absent from'} MCP servers"
        if action == "remove":
            return (not present), (
                f"{target} is {'still present in' if present else 'absent from'} MCP servers"
            )
        return False, f"unknown action: {action!r}"

    # -- plugin marketplaces (Phase 6c) ------------------------------------

    async def marketplace_list(self) -> Dict[str, Any]:
        """List configured plugin marketplaces (``claude plugin marketplace list``).

        READ-natured, but routed through the write-path :mod:`runner` so the
        output is secret-masked and the binary is allowlist-checked (with the
        runner's 64 KiB output cap). Returns a dict with:

        * ``supported`` -- whether a list could be produced;
        * ``items`` -- ``[{"name", "source"}, ...]`` (possibly empty) when
          ``supported``; ``None`` otherwise — never a fabricated list;
        * ``reason`` -- why unsupported (``None`` when supported);
        * ``manage_hint`` -- how to add a marketplace from a terminal.

        ``supported=False`` is returned when ``claude`` is absent, the command
        exits non-zero (e.g. ``--json`` unsupported), or the output cannot be
        confidently parsed. The result is TTL-cached (60 s, in-process) so a
        polling UI does not re-shell on every request.
        """
        store = cache.get_cache()
        cached = store.get(_MARKETPLACE_CACHE_KEY)
        if cached is not None:
            return cast(Dict[str, Any], cached)
        result = await self._compute_marketplace_list()
        store.set(_MARKETPLACE_CACHE_KEY, result)
        return result

    async def _compute_marketplace_list(self) -> Dict[str, Any]:
        if not self.detect().installed:
            return {
                "supported": False,
                "items": None,
                "reason": _NOT_INSTALLED_REASON,
                "manage_hint": _MARKETPLACE_MANAGE_HINT,
            }
        run_result = await runner.run(
            [_BINARY, "plugin", "marketplace", "list", "--json"],
            cwd=str(Path.home()),
            timeout=_MARKETPLACE_TIMEOUT_SECONDS,
        )
        items = _parse_marketplace_json(run_result.stdout) if run_result.returncode == 0 else None
        if items is None:
            return {
                "supported": False,
                "items": None,
                "reason": _MARKETPLACE_UNRECOGNIZED_REASON,
                "manage_hint": _MARKETPLACE_MANAGE_HINT,
            }
        return {
            "supported": True,
            "items": items,
            "reason": None,
            "manage_hint": _MARKETPLACE_MANAGE_HINT,
        }
