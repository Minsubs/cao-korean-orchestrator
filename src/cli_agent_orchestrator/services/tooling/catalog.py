"""Curated extension catalog with live provider support and install status."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, cast

from cli_agent_orchestrator.services.tooling import cache, runner
from cli_agent_orchestrator.services.tooling.adapters import registry
from cli_agent_orchestrator.services.tooling.catalog_items import CATALOG_ITEMS
from cli_agent_orchestrator.services.tooling.catalog_models import CatalogItem, InstallSpec

_CACHE_KEY = "catalog"


class CatalogError(Exception):
    """A catalog install request that cannot be satisfied (router to HTTP 400)."""


# Kept as a private compatibility surface for focused catalog tests.
_ITEMS = CATALOG_ITEMS
_BY_ID: Dict[str, CatalogItem] = {item.id: item for item in _ITEMS}


def get_item(item_id: str) -> Optional[CatalogItem]:
    """Return the catalog item with ``item_id``, or ``None``."""
    return _BY_ID.get(item_id)


def _provider_snapshot(providers: set[str]) -> Dict[str, Dict[str, Any]]:
    """Detect each provider once and cache capabilities plus installed names."""
    snapshot: Dict[str, Dict[str, Any]] = {}
    for provider in providers:
        adapter = registry.get_adapter(provider)
        if adapter is None or not adapter.detect().installed:
            snapshot[provider] = {"installed": False, "caps": None, "names": set()}
            continue
        names = {item["name"] for item in adapter.list_installed() if item.get("name")}
        snapshot[provider] = {
            "installed": True,
            "caps": adapter.capabilities(),
            "names": names,
        }
    return snapshot


def _supported_entry(item: CatalogItem, provider: str, snap: Dict[str, Any]) -> Dict[str, Any]:
    spec = item.install[provider]
    entry: Dict[str, Any] = {
        "method": spec.method,
        "requires_params": list(spec.requires_params),
        "install_status": "unknown",
        "supported": False,
        "reason": None,
    }
    if spec.method == "manual":
        entry["install_status"] = (
            ("installed" if snap["installed"] else "not_installed")
            if item.id == "generic-skills-cli"
            else "unknown"
        )
        entry["command"] = " ".join(spec.argv)
        entry["reason"] = item.manual_reason or (
            "자동 설치가 지원되지 않는 항목이에요 — 명령을 복사해 직접 실행하세요"
        )
        return entry
    entry["install_status"] = (
        ("installed" if item.id in snap["names"] else "not_installed")
        if snap["installed"]
        else "unknown"
    )
    if not snap["installed"]:
        entry["reason"] = f"{provider}이(가) 감지되지 않았어요 — 설치 후 다시 검사하세요"
        return entry
    caps = snap["caps"]
    if caps is not None and caps.canInstall:
        entry["supported"] = True
    else:
        entry["reason"] = (
            caps.reasons.get("canInstall") if caps else None
        ) or f"{provider}에서 이 확장을 설치할 수 없어요"
    return entry


def _collect() -> List[Dict[str, Any]]:
    referenced = {provider for item in _ITEMS for provider in item.providers}
    snapshot = _provider_snapshot(referenced)
    result: List[Dict[str, Any]] = []
    for item in _ITEMS:
        supported = {
            provider: _supported_entry(item, provider, snapshot[provider])
            for provider in item.providers
        }
        result.append(
            {
                "id": item.id,
                "name": item.name,
                "description_ko": item.description_ko,
                "kind": item.kind,
                "category": item.category,
                "homepage": item.homepage,
                "providers": list(item.providers),
                "requires": list(item.requires),
                "popular": item.popular,
                "new_session_required": item.new_session_required,
                "warnings": list(item.warnings),
                "install": {
                    provider: {"method": spec.method, "argv": list(spec.argv)}
                    for provider, spec in item.install.items()
                },
                "supported": supported,
            }
        )
    return result


def list_catalog(*, use_cache: bool = True) -> List[Dict[str, Any]]:
    """Return every catalog item with per-provider support and install status,
    TTL-cached by default.

    Args:
        use_cache: When ``False``, bypass and refresh the cached value.
    """
    store = cache.get_cache()
    if use_cache:
        cached = store.get(_CACHE_KEY)
        if cached is not None:
            return cast(List[Dict[str, Any]], cached)
    result = _collect()
    store.set(_CACHE_KEY, result)
    return result


@dataclass(frozen=True, slots=True)
class ResolvedInstall:
    """A catalog install reduced to what an adapter needs to plan it."""

    item: CatalogItem
    provider: str
    method: str
    name: str
    command_tokens: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def resolve_install(
    item_id: str, provider: str, params: Optional[Mapping[str, Any]]
) -> ResolvedInstall:
    """Resolve a catalog entry into the static adapter plan inputs."""
    item = get_item(item_id)
    if item is None:
        raise CatalogError(f"알 수 없는 카탈로그 항목이에요: {item_id!r}")
    if provider not in item.install:
        raise CatalogError(f"{provider}은(는) '{item.name}' 확장을 지원하지 않아요")

    spec = item.install[provider]
    warnings = list(item.warnings)
    if spec.method == "manual":
        raise CatalogError(
            f"'{item.name}'은(는) 자동 설치를 지원하지 않아요 — 명령을 복사해 직접 실행하세요"
        )
    if spec.method == "skill":
        return ResolvedInstall(
            item=item,
            provider=provider,
            method="skill",
            name=item.id,
            command_tokens=list(spec.argv),
            warnings=warnings,
        )
    if spec.method == "mcp":
        tokens = list(spec.argv)
        if "path" in spec.requires_params:
            tokens.append(_resolve_path_param(params))
        return ResolvedInstall(
            item=item,
            provider=provider,
            method="mcp",
            name=item.id,
            command_tokens=tokens,
            warnings=warnings,
        )
    raise CatalogError(f"지원하지 않는 설치 방식이에요: {spec.method!r}")


def _resolve_path_param(params: Optional[Mapping[str, Any]]) -> str:
    """Validate and home-confine a required ``params.path``."""
    path = params.get("path") if params else None
    if not isinstance(path, str) or not path.strip():
        raise CatalogError("이 항목은 params.path(접근을 허용할 디렉터리)가 필요해요")
    try:
        resolved = runner.resolve_within_home(path)
    except ValueError:
        raise CatalogError("params.path가 홈 디렉터리를 벗어났어요") from None
    if not runner.is_valid_token(resolved):
        raise CatalogError("params.path에 명령 인자로 쓸 수 없는 문자가 있어요")
    return resolved


__all__ = [
    "CatalogError",
    "CatalogItem",
    "InstallSpec",
    "ResolvedInstall",
    "get_item",
    "list_catalog",
    "resolve_install",
]
