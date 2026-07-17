"""Adapter contract for provider-specific extension management.

An :class:`ExtensionAdapter` translates a provider-agnostic action
(``install``/``remove``/``update``/``update_all``) into a concrete, validated
:class:`ExecutionPlan` (an argv + cwd the :mod:`runner` will accept), reports
what the underlying tool can actually do (:class:`ProviderCapabilities`), and
verifies the outcome after a run (:meth:`ExtensionAdapter.verify`).

Phase 4a ships one implementation (``generic_skills``). The contract is kept
deliberately small and provider-neutral so Phase 5 can add provider-native
adapters (Claude Code, Codex, …) without touching the runner, the operation
manager, or the router.

Capability field names are camelCase because they are serialized verbatim into
the JSON the frontend consumes; :func:`dataclasses.asdict` yields exactly the
``GET /tooling/adapters`` capability shape.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class ProviderCapabilities:
    """What a provider's tool can do, plus per-capability unsupported reasons.

    ``reasons`` maps a capability key (e.g. ``"canInstall"``) to a
    human-readable explanation of why it is ``False`` — surfaced in the UI so a
    disabled action explains itself instead of silently vanishing.
    """

    canList: bool
    canSearch: bool
    canInstall: bool
    canRemove: bool
    canUpdate: bool
    canUpdateAll: bool
    requiresNewSession: bool
    requiresRestart: bool
    reasons: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ExecutionPlan:
    """A concrete, runner-ready plan for one action.

    ``argv`` is validated by the runner (allowlisted binary, safe tokens);
    ``cwd`` (when set) must resolve inside $HOME. ``description`` and
    ``verify_description`` are human-readable summaries for the confirm dialog.
    """

    argv: List[str]
    cwd: Optional[str]
    description: str
    verify_description: str


@dataclass(frozen=True)
class AdapterEnv:
    """Detection result for a provider's tool: presence, path, and version."""

    installed: bool
    path: Optional[str]
    version: Optional[str]


class ExtensionAdapter(ABC):
    """Abstract provider adapter. Subclasses set ``id`` / ``display_name``."""

    #: Stable machine id used as the ``provider`` key in the API.
    id: str
    #: Human-readable adapter name for the UI.
    display_name: str

    @abstractmethod
    def detect(self) -> AdapterEnv:
        """Report whether the provider's tool is installed (no mutation)."""

    @abstractmethod
    def capabilities(self) -> ProviderCapabilities:
        """Report what the tool can do, with reasons for anything unsupported."""

    @abstractmethod
    def list_installed(self) -> List[Dict[str, Any]]:
        """Return the currently installed extensions (conservatively parsed)."""

    @abstractmethod
    def plan(self, action: str, target: Optional[str], scope: Optional[str]) -> ExecutionPlan:
        """Build a runner-ready :class:`ExecutionPlan` for ``action``.

        Raises:
            ValueError: If ``action`` is unsupported or a required ``target`` is
                missing/invalid.
        """

    @abstractmethod
    def verify(self, action: str, target: Optional[str]) -> Tuple[bool, str]:
        """Re-check state after a run; return ``(ok, human_readable_detail)``."""

    # -- optional catalog surface -----------------------------------------
    #
    # An MCP-add is not expressible through :meth:`plan` because it needs a
    # *server name plus a launch command* (two pieces), not the single ``target``
    # the generic action signature carries. Adapters that manage MCP servers
    # (Phase 5a: Claude Code, Codex) override :meth:`plan_mcp_add`; every other
    # adapter inherits the safe default that refuses. ``command_tokens`` is the
    # server's launch argv, supplied verbatim by the static catalog (never a
    # renderer string) — see :mod:`services.tooling.catalog`.

    def plan_mcp_add(self, name: str, command_tokens: List[str]) -> ExecutionPlan:
        """Plan a catalog MCP-server install (default: unsupported → ValueError)."""
        raise ValueError(f"{self.id} does not support installing MCP servers")


# Capability keys that gate a user-visible action (everything except the
# ``requires*`` session/restart flags).
_ACTION_CAPABILITY_KEYS = (
    "canList",
    "canSearch",
    "canInstall",
    "canRemove",
    "canUpdate",
    "canUpdateAll",
)


def unsupported_capabilities(
    reason: str, *, requiresNewSession: bool = False, requiresRestart: bool = False
) -> ProviderCapabilities:
    """Build an all-``False`` :class:`ProviderCapabilities` with ``reason`` for each.

    The one-liner adapters reach for when the tool is absent (or wholly
    unmanageable): every action capability is ``False`` and carries the same
    actionable ``reason`` so a disabled action explains itself in the UI.
    """
    return ProviderCapabilities(
        canList=False,
        canSearch=False,
        canInstall=False,
        canRemove=False,
        canUpdate=False,
        canUpdateAll=False,
        requiresNewSession=requiresNewSession,
        requiresRestart=requiresRestart,
        reasons={key: reason for key in _ACTION_CAPABILITY_KEYS},
    )
