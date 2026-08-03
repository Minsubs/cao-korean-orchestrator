"""CLI provider install-status and version probing.

The provider *list* is derived from :class:`ProviderType` so a newly added
provider appears automatically. This module only supplies presentation metadata
(display name + binary name) and performs a read-only ``--version`` probe:

* ``path`` comes from :func:`cache.cached_which` (``shutil.which`` behind a TTL
  cache, so a repeated miss does not re-walk the PATH).
* When installed, the version is read via a bounded argv probe (shell disabled,
  5-second timeout). The first numeric token on the first non-empty output line
  is the version; the raw line is preserved as ``version_raw``.
* When not installed, the probe is skipped entirely.

Nothing here installs or downloads anything. Results are TTL-cached.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, cast

from cli_agent_orchestrator.models.provider import ProviderType
from cli_agent_orchestrator.services.tooling import cache, probe

# Wall-clock ceiling for a single ``<binary> --version`` probe.
PROBE_TIMEOUT_SECONDS = 5.0

# First numeric token: one or more digits optionally followed by dots/digits,
# e.g. matches ``2.1.211`` in ``claude 2.1.211 (build 5)``.
_VERSION_RE = re.compile(r"\d+[.\d]*")

_CACHE_KEY = "providers"

# Presentation metadata keyed by ProviderType value. The list of providers is
# NOT hardcoded here — it is derived from ProviderType in _collect(); this table
# only maps a known provider to its display name and on-PATH binary. Binary
# names mirror the existing ``GET /agents/providers`` mapping in api/main.py.
_PROVIDER_METADATA: Dict[str, Dict[str, str]] = {
    ProviderType.KIRO_CLI.value: {"display_name": "Kiro CLI", "binary": "kiro-cli"},
    ProviderType.CLAUDE_CODE.value: {"display_name": "Claude Code", "binary": "claude"},
    ProviderType.CODEX.value: {"display_name": "Codex", "binary": "codex"},
    ProviderType.KIMI_CLI.value: {"display_name": "Kimi CLI", "binary": "kimi"},
    ProviderType.COPILOT_CLI.value: {"display_name": "Copilot CLI", "binary": "copilot"},
    ProviderType.OPENCODE_CLI.value: {"display_name": "OpenCode CLI", "binary": "opencode"},
    ProviderType.HERMES.value: {"display_name": "Hermes", "binary": "hermes"},
    ProviderType.CURSOR_CLI.value: {"display_name": "Cursor CLI", "binary": "agent"},
    ProviderType.ANTIGRAVITY_CLI.value: {"display_name": "Antigravity CLI", "binary": "agy"},
}


def _fallback_metadata(name: str) -> Dict[str, str]:
    """Derive presentation metadata for a provider missing from the table.

    Keeps a brand-new ``ProviderType`` member visible (rather than dropped)
    until it is given explicit metadata.
    """
    return {"display_name": name.replace("_", " ").title(), "binary": name.split("_")[0]}


def _first_nonempty_line(text: str) -> str | None:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def _extract_version(result: probe.ProbeResult) -> tuple[str | None, str | None, str | None]:
    """Map a probe result to ``(version, version_raw, version_error)``."""
    if result.timed_out:
        return None, None, f"version probe timed out after {PROBE_TIMEOUT_SECONDS:g}s"
    if result.returncode is None:
        return None, None, (result.stderr.strip() or "version probe failed")[:200]

    line = _first_nonempty_line(result.stdout) or _first_nonempty_line(result.stderr)
    if line is None:
        return None, None, f"version probe exited {result.returncode} with no output"

    match = _VERSION_RE.search(line)
    if match is None:
        return None, line, f"could not parse a version from: {line[:120]}"
    return match.group(0), line, None


def _probe_provider(name: str, display_name: str, binary: str) -> Dict[str, Any]:
    path = cache.cached_which(binary)
    installed = path is not None

    version_value: str | None = None
    version_raw: str | None = None
    version_error: str | None = None
    if path is not None:
        # Probe the already-resolved absolute path rather than the bare binary
        # name, so the subprocess's own execvp does not walk the (WSL-bloated)
        # PATH a second time.
        result = probe.run([path, "--version"], timeout=PROBE_TIMEOUT_SECONDS)
        version_value, version_raw, version_error = _extract_version(result)

    return {
        "name": name,
        "display_name": display_name,
        "binary": binary,
        "installed": installed,
        "path": path,
        "version": version_value,
        "version_raw": version_raw,
        "version_error": version_error,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def _collect() -> List[Dict[str, Any]]:
    providers: List[Dict[str, Any]] = []
    for provider in ProviderType:
        meta = _PROVIDER_METADATA.get(provider.value) or _fallback_metadata(provider.value)
        providers.append(_probe_provider(provider.value, meta["display_name"], meta["binary"]))
    return providers


def list_providers(*, use_cache: bool = True) -> List[Dict[str, Any]]:
    """Return per-provider install status and version, TTL-cached by default.

    Args:
        use_cache: When ``False``, bypass and refresh the cached value (used by
            ``POST /tooling/scan``).
    """
    store = cache.get_cache()
    if use_cache:
        cached = store.get(_CACHE_KEY)
        if cached is not None:
            return cast(List[Dict[str, Any]], cached)
    result = _collect()
    store.set(_CACHE_KEY, result)
    return result
