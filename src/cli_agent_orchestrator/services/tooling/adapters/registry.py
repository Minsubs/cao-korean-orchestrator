"""Adapter registry — the single lookup point for provider adapters.

Phase 4a registered only the generic ``skills`` adapter; Phase 5a adds the three
provider-native adapters (Claude Code, Codex, Antigravity). Adapters are
stateless singletons (all per-run state lives in the module-level TTL cache), so
a single shared instance is reused across requests.
"""

from __future__ import annotations

from typing import Dict, Optional

from cli_agent_orchestrator.services.tooling.adapters.antigravity import AntigravityAdapter
from cli_agent_orchestrator.services.tooling.adapters.base import ExtensionAdapter
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling.adapters.codex import CodexAdapter
from cli_agent_orchestrator.services.tooling.adapters.copilot_cli import CopilotCliAdapter
from cli_agent_orchestrator.services.tooling.adapters.generic_skills import (
    GenericSkillsAdapter,
)
from cli_agent_orchestrator.services.tooling.adapters.kiro_cli import KiroCliAdapter
from cli_agent_orchestrator.services.tooling.adapters.opencode_cli import OpenCodeCliAdapter

_ADAPTERS: Dict[str, ExtensionAdapter] = {
    "generic_skills": GenericSkillsAdapter(),
    "claude_code": ClaudeCodeAdapter(),
    "codex": CodexAdapter(),
    "antigravity_cli": AntigravityAdapter(),
    "kiro_cli": KiroCliAdapter(),
    "copilot_cli": CopilotCliAdapter(),
    "opencode_cli": OpenCodeCliAdapter(),
}


def get_adapters() -> Dict[str, ExtensionAdapter]:
    """Return a copy of the ``{provider_id: adapter}`` registry."""
    return dict(_ADAPTERS)


def get_adapter(provider: str) -> Optional[ExtensionAdapter]:
    """Return the adapter for ``provider``, or ``None`` if unregistered."""
    return _ADAPTERS.get(provider)
