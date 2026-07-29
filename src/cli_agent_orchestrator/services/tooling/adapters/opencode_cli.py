"""OpenCode CLI (``opencode_cli``) provider adapter — npm install only.

OpenCode CLI has no non-interactive extension/MCP management surface this
adapter could drive, so v1 is deliberately install-only: the sole supported
action is the target-exempt ``install_cli`` (a fixed, server-constant npm
package — never a client-supplied name). Every other action — list, search,
install, remove, update, update_all — is refused with an actionable reason.
"""

from __future__ import annotations

import shutil
from typing import Any, Dict, List, Optional, Tuple

from cli_agent_orchestrator.services.tooling.adapters.base import (
    AdapterEnv,
    ExecutionPlan,
    ExtensionAdapter,
    ProviderCapabilities,
    unsupported_capabilities,
)

_BINARY = "opencode"

# Fixed npm package for the target-exempt ``install_cli`` action. This is a
# server-side constant, never derived from the request — the client sends only
# ``{action: "install_cli", provider: "opencode_cli"}`` and the ``target``
# field (if any) is ignored by :meth:`OpenCodeCliAdapter.plan`.
_CLI_PACKAGE = "opencode-ai"

_INSTALL_ONLY_REASON = "opencode_cli는 CLI 설치만 지원해요 — 확장 관리는 터미널에서 하세요"


class OpenCodeCliAdapter(ExtensionAdapter):
    """Install-only ``opencode_cli`` adapter: npm-bootstraps the CLI, nothing else."""

    id = "opencode_cli"
    display_name = "OpenCode CLI"

    # -- detection ---------------------------------------------------------

    def detect(self) -> AdapterEnv:
        """Locate ``opencode`` with ``which`` only (never executes it)."""
        path = shutil.which(_BINARY)
        return AdapterEnv(installed=path is not None, path=path, version=None)

    # -- capabilities ------------------------------------------------------

    def capabilities(self) -> ProviderCapabilities:
        """Every action capability is unsupported except ``install_cli``.

        ``canInstallCli`` stays ``True`` regardless of :meth:`detect` — the
        "not installed" case is exactly when bootstrapping the CLI matters
        most, so it must not be swept into the blanket ``False`` the helper
        otherwise applies.
        """
        return unsupported_capabilities(_INSTALL_ONLY_REASON, canInstallCli=True)

    # -- listing -------------------------------------------------------------

    def list_installed(self) -> List[Dict[str, Any]]:
        """No extension surface is managed here — always empty."""
        return []

    # -- planning / verification (install-only: everything else refuses) ---

    def plan(self, action: str, target: Optional[str], scope: Optional[str]) -> ExecutionPlan:
        """Plan the fixed npm install; refuse every other action.

        ``target`` is ignored on purpose (security): the package is always
        the fixed :data:`_CLI_PACKAGE` constant, never a client-supplied name.
        """
        if action == "install_cli":
            return ExecutionPlan(
                argv=["npm", "install", "-g", _CLI_PACKAGE],
                cwd=None,
                description=(
                    f"{_BINARY} CLI를 npm으로 전역 설치해요 (npm 전역 설치 권한이 필요할 수 있어요)"
                ),
                verify_description=f"{_BINARY} --version 확인",
            )
        raise ValueError(_INSTALL_ONLY_REASON)

    def verify(self, action: str, target: Optional[str]) -> Tuple[bool, str]:
        """Only ``install_cli`` ever mutates anything, so only it verifies."""
        if action == "install_cli":
            found = shutil.which(_BINARY) is not None
            return found, (
                f"{_BINARY} is now on PATH"
                if found
                else f"{_BINARY} was not found on PATH after install"
            )
        return False, _INSTALL_ONLY_REASON
