"""Adapter for a generic ``skills`` CLI on ``$PATH``.

This adapter is deliberately conservative because it targets *whatever* ``skills``
binary happens to be installed, not a version CAO controls:

* **Detection is ``which`` only.** It never executes ``skills`` (nor anything
  like ``npx skills`` that could trigger a download) just to find out if it is
  present. Absent → every capability is ``False`` with an actionable reason.
* **Capabilities are derived from ``skills --help``.** A subcommand is only
  advertised as supported if it actually appears in the help output, and
  ``--global`` scope is only offered when the help mentions that flag. The help
  probe is run at most once per TTL window (cached), never on a mutation path.
* **Listing tolerates unknown output.** ``skills list`` is parsed line-by-line,
  taking the first token as the name; a line whose first token does not look
  like a name is kept as a raw entry rather than dropped, so verification never
  silently ignores output it did not understand.

The ``--help`` and ``list`` reads use the read-only :mod:`probe` runner (argv,
``shell=False``, bounded). Mutations are never run here — they are planned
(:meth:`plan`) and executed by the write-path :mod:`runner`.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, cast

from cli_agent_orchestrator.services.tooling import cache, probe
from cli_agent_orchestrator.services.tooling.adapters.base import (
    AdapterEnv,
    ExecutionPlan,
    ExtensionAdapter,
    ProviderCapabilities,
)

# Wall-clock ceilings for the read-only probes this adapter runs.
_HELP_TIMEOUT_SECONDS = 5.0
_LIST_TIMEOUT_SECONDS = 10.0

# The binary this adapter drives.
_BINARY = "skills"

# Cache key for the parsed ``skills --help`` result (TTL-shared with the rest of
# the tooling collectors).
_HELP_CACHE_KEY = "adapter:generic_skills:help"

# Action -> the ``skills`` subcommand it maps to.
_ACTION_SUBCOMMAND = {
    "install": "add",
    "remove": "remove",
    "update": "update",
    "update_all": "update",
    "list": "list",
    "search": "find",
}

# Subcommands whose presence in ``--help`` we probe for.
_KNOWN_SUBCOMMANDS = ("list", "find", "add", "remove", "update")

# A plausible skill-name shape for conservative ``skills list`` parsing.
_NAME_RE = re.compile(r"^[A-Za-z0-9@._/-]+$")

_NOT_INSTALLED_REASON = (
    "skills 실행 파일이 감지되지 않았어요 — '도구 및 확장'의 탐색 탭에서 "
    "generic-skills-cli 항목의 설치 명령을 복사해 실행한 뒤 다시 검사하세요"
)
_HELP_UNREADABLE_REASON = "'skills --help' 출력을 읽지 못했어요 — 기능을 확인할 수 없습니다"


class GenericSkillsAdapter(ExtensionAdapter):
    """Drives a generic ``skills`` CLI discovered on ``$PATH``."""

    id = "generic_skills"
    display_name = "Skills (generic)"

    # -- detection ---------------------------------------------------------

    def detect(self) -> AdapterEnv:
        """Locate the ``skills`` binary with ``which`` only (no execution)."""
        path = shutil.which(_BINARY)
        # Version intentionally left None: detection must not execute the binary
        # (avoids any download-on-invoke behavior). Populating it is Phase 5.
        return AdapterEnv(installed=path is not None, path=path, version=None)

    # -- help parsing (TTL-cached) ----------------------------------------

    def _help_text(self) -> Optional[str]:
        """Return the cached ``skills --help`` stdout+stderr, or ``None``.

        Runs the help probe at most once per TTL window. ``None`` means the help
        could not be read (binary absent, non-zero exit, or timeout).
        """
        store = cache.get_cache()
        cached = store.get(_HELP_CACHE_KEY)
        if cached is not None:
            return cast(Optional[str], cached if cached != "" else None)

        result = probe.run([_BINARY, "--help"], timeout=_HELP_TIMEOUT_SECONDS)
        text: Optional[str]
        if result.timed_out or result.returncode is None:
            text = None
        else:
            combined = f"{result.stdout}\n{result.stderr}"
            text = combined if combined.strip() else None
        # Cache the empty string as the "unreadable" sentinel so a failed probe
        # is not retried on every request within the TTL window.
        store.set(_HELP_CACHE_KEY, text if text is not None else "")
        return text

    def _subcommands(self) -> set[str]:
        """Return the known subcommands present in ``skills --help``."""
        text = self._help_text()
        if not text:
            return set()
        lowered = text.lower()
        found: set[str] = set()
        for sub in _KNOWN_SUBCOMMANDS:
            if re.search(rf"\b{re.escape(sub)}\b", lowered):
                found.add(sub)
        return found

    def _supports_global(self) -> bool:
        """Return whether ``--global`` appears in ``skills --help``."""
        text = self._help_text()
        return text is not None and "--global" in text

    # -- capabilities ------------------------------------------------------

    def capabilities(self) -> ProviderCapabilities:
        """Report capabilities, gated on detection then on ``--help`` contents."""
        if not self.detect().installed:
            absent_reasons = {
                key: _NOT_INSTALLED_REASON
                for key in (
                    "canList",
                    "canSearch",
                    "canInstall",
                    "canRemove",
                    "canUpdate",
                    "canUpdateAll",
                )
            }
            return ProviderCapabilities(
                canList=False,
                canSearch=False,
                canInstall=False,
                canRemove=False,
                canUpdate=False,
                canUpdateAll=False,
                requiresNewSession=False,
                requiresRestart=False,
                reasons=absent_reasons,
            )

        subs = self._subcommands()
        reasons: Dict[str, str] = {}

        def _cap(capability: str, subcommand: str) -> bool:
            if subcommand in subs:
                return True
            if not subs:
                reasons[capability] = _HELP_UNREADABLE_REASON
            else:
                reasons[capability] = (
                    f"'skills' CLI에 '{subcommand}' 하위 명령이 없어요 (--help에서 확인되지 않음)"
                )
            return False

        return ProviderCapabilities(
            canList=_cap("canList", "list"),
            canSearch=_cap("canSearch", "find"),
            canInstall=_cap("canInstall", "add"),
            canRemove=_cap("canRemove", "remove"),
            canUpdate=_cap("canUpdate", "update"),
            canUpdateAll=_cap("canUpdateAll", "update"),
            requiresNewSession=False,
            requiresRestart=False,
            reasons=reasons,
        )

    # -- listing -----------------------------------------------------------

    def list_installed(self) -> List[Dict[str, Any]]:
        """Parse ``skills list`` output conservatively into name/raw entries.

        Each non-empty line becomes an entry. The first token is taken as the
        name when it looks like a name; otherwise ``name`` is ``None`` and the
        line is preserved as ``raw`` so nothing is silently discarded.
        """
        if not self.detect().installed:
            return []
        result = probe.run([_BINARY, "list"], timeout=_LIST_TIMEOUT_SECONDS)
        if result.returncode is None:
            return []
        items: List[Dict[str, Any]] = []
        for line in result.stdout.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            first = stripped.split()[0]
            name = first if _NAME_RE.match(first) else None
            items.append({"name": name, "raw": stripped})
        return items

    def _installed_names(self) -> set[str]:
        return {item["name"] for item in self.list_installed() if item.get("name") is not None}

    # -- planning ----------------------------------------------------------

    def plan(self, action: str, target: Optional[str], scope: Optional[str]) -> ExecutionPlan:
        """Build a runner-ready plan for ``action`` (raises ValueError on misuse)."""
        subcommand = _ACTION_SUBCOMMAND.get(action)
        if subcommand not in {"add", "remove", "update"}:
            raise ValueError(f"unsupported action: {action!r}")

        if action == "update_all":
            argv = [_BINARY, "update"]
            target_desc = "all installed skills"
        else:
            if not target:
                raise ValueError(f"action {action!r} requires a target")
            argv = [_BINARY, subcommand, target]
            target_desc = target

        if scope == "global" and self._supports_global():
            argv.append("--global")

        cwd = str(Path.home())
        verb = {"add": "Install", "remove": "Remove", "update": "Update"}[subcommand]
        description = f"{verb} {target_desc} via `{' '.join(argv)}`"
        if action == "remove":
            verify_description = f"Confirm {target_desc} is absent from `skills list`"
        elif action == "update_all":
            verify_description = "Re-run `skills list` (per-item verification not supported)"
        else:
            verify_description = f"Confirm {target_desc} is present in `skills list`"
        return ExecutionPlan(
            argv=argv, cwd=cwd, description=description, verify_description=verify_description
        )

    # -- verification ------------------------------------------------------

    def verify(self, action: str, target: Optional[str]) -> Tuple[bool, str]:
        """Re-query ``skills list`` to confirm the action's effect."""
        if action == "update_all":
            return True, "update_all completed; per-item verification not supported"

        if not target:
            return False, f"action {action!r} requires a target to verify"

        names = self._installed_names()
        present = target in names
        if action in {"install", "update"}:
            return present, (
                f"{target} is {'present in' if present else 'absent from'} skills list"
            )
        if action == "remove":
            return (not present), (
                f"{target} is {'still present in' if present else 'absent from'} skills list"
            )
        return False, f"unknown action: {action!r}"
