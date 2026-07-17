"""Derived diagnostics for the Tooling screen.

Each check reuses an existing read-only collector and emits zero or more
structured findings; an empty list means "nothing to report". Checks:

* provider binary missing              -> info    (``provider_missing``)
* provider version probe failed        -> warning (``version_probe_failed``)
* skill folder fails to parse/validate -> warning (``skill_parse_error``)
* agent profile name defined twice     -> warning (``profile_duplicate``)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from cli_agent_orchestrator import constants
from cli_agent_orchestrator.services import settings_service
from cli_agent_orchestrator.services.tooling.providers import list_providers
from cli_agent_orchestrator.utils.agent_profiles import list_agent_profiles
from cli_agent_orchestrator.utils.skills import validate_skill_folder


def _provider_diagnostics() -> List[Dict[str, Any]]:
    diagnostics: List[Dict[str, Any]] = []
    # Reuses the TTL-cached provider results — no extra CLI probing here.
    for provider in list_providers():
        name = provider["name"]
        display = provider["display_name"]
        binary = provider["binary"]
        if not provider["installed"]:
            diagnostics.append(
                {
                    "severity": "info",
                    "code": "provider_missing",
                    "title": f"{display} is not installed",
                    "cause": f"No '{binary}' binary was found on PATH.",
                    "impact": f"Sessions using the {display} provider cannot start.",
                    "recommendation": f"Install {display} and ensure '{binary}' is on PATH.",
                    "provider": name,
                    "path": None,
                }
            )
        elif provider["version_error"]:
            diagnostics.append(
                {
                    "severity": "warning",
                    "code": "version_probe_failed",
                    "title": f"Could not determine {display} version",
                    "cause": provider["version_error"],
                    "impact": "Version-dependent compatibility checks are unavailable.",
                    "recommendation": f"Verify that '{binary} --version' runs correctly.",
                    "provider": name,
                    "path": provider["path"],
                }
            )
    return diagnostics


def _skill_diagnostics() -> List[Dict[str, Any]]:
    diagnostics: List[Dict[str, Any]] = []
    directories = [constants.SKILLS_DIR] + [
        Path(extra) for extra in settings_service.get_extra_skill_dirs()
    ]
    checked: set[str] = set()
    for directory in directories:
        if not directory.is_dir():
            continue
        for entry in sorted(directory.iterdir(), key=lambda path: path.name):
            if not entry.is_dir() or not (entry / "SKILL.md").is_file():
                continue
            resolved = str(entry.resolve())
            if resolved in checked:
                continue
            checked.add(resolved)
            try:
                validate_skill_folder(entry)
            except Exception as exc:
                diagnostics.append(
                    {
                        "severity": "warning",
                        "code": "skill_parse_error",
                        "title": f"Skill '{entry.name}' failed to load",
                        "cause": str(exc),
                        "impact": "The skill is skipped and not offered to agents.",
                        "recommendation": "Fix the SKILL.md metadata for this folder.",
                        "provider": None,
                        "path": str(entry),
                    }
                )
    return diagnostics


def _profile_diagnostics() -> List[Dict[str, Any]]:
    diagnostics: List[Dict[str, Any]] = []
    for profile in list_agent_profiles():
        duplicated_in = profile.get("duplicated_in") or []
        if not duplicated_in:
            continue
        name = profile["name"]
        source = profile.get("source")
        diagnostics.append(
            {
                "severity": "warning",
                "code": "profile_duplicate",
                "title": f"Agent profile '{name}' is defined in multiple locations",
                "cause": f"'{name}' also exists in: {', '.join(duplicated_in)}.",
                "impact": f"The copy from '{source}' wins; the others are shadowed.",
                "recommendation": "Remove or disable the duplicate directories to resolve ambiguity.",
                "provider": None,
                "path": None,
            }
        )
    return diagnostics


def collect_diagnostics() -> List[Dict[str, Any]]:
    """Return all diagnostics; an empty list means nothing to report."""
    return _provider_diagnostics() + _skill_diagnostics() + _profile_diagnostics()
