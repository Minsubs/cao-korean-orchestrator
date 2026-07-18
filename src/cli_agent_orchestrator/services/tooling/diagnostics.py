"""Derived diagnostics for the Tooling screen.

Each check reuses an existing read-only collector and emits zero or more
structured findings; an empty list means "nothing to report". Checks:

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
        # Missing providers are optional choices, not defects. They stay visible
        # in the environment inventory but do not create diagnostic noise.
        if provider["installed"] and provider["version_error"]:
            diagnostics.append(
                {
                    "severity": "warning",
                    "code": "version_probe_failed",
                    "title": f"{display} 버전을 확인하지 못했어요",
                    "cause": provider["version_error"],
                    "impact": "버전에 따른 호환성 검사를 사용할 수 없어요.",
                    "recommendation": f"터미널에서 '{binary} --version'이 정상 실행되는지 확인하세요.",
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
        duplicated_in = list(profile.get("duplicated_in") or [])
        source = profile.get("source")
        if source == "local":
            duplicated_in = [
                item for item in duplicated_in if item not in {"installed", "built-in"}
            ]
        elif source == "installed":
            duplicated_in = [item for item in duplicated_in if item != "built-in"]
        if not duplicated_in:
            continue
        name = profile["name"]
        diagnostics.append(
            {
                "severity": "warning",
                "code": "profile_duplicate",
                "title": f"에이전트 프로필 '{name}'이 여러 위치에 있어요",
                "cause": f"다른 위치: {', '.join(duplicated_in)}",
                "impact": f"'{source}' 위치의 프로필이 우선 적용돼요.",
                "recommendation": "의도하지 않은 중복 폴더를 제거하거나 비활성화하세요.",
                "provider": None,
                "path": None,
            }
        )
    return diagnostics


def collect_diagnostics() -> List[Dict[str, Any]]:
    """Return all diagnostics; an empty list means nothing to report."""
    return _provider_diagnostics() + _skill_diagnostics() + _profile_diagnostics()
