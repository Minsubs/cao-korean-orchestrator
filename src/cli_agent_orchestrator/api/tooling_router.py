"""Tooling API router.

Self-contained ``APIRouter`` with a ``/tooling`` prefix, mounted by
``api/main.py`` via ``app.include_router(tooling_router.router)``.

Phase 3a exposes read-only collectors. Phase 4a adds the write path: inspecting
provider adapters, planning an action (read-only preview), executing it as an
async operation, and polling/cancelling operations. Every mutating route
(``execute``, ``cancel``) is scope-gated (WRITE/ADMIN); ``plan`` is a read-only
POST gated to any authenticated scope. ``execute`` re-runs the exact same
validation ``plan`` does, so a renderer can never route a free-form string into
an argv.

Endpoints:
    GET  /tooling/environment            -- host OS / arch / shell / WSL / versions
    GET  /tooling/providers              -- CLI provider install status + version
    GET  /tooling/extensions             -- CAO-owned skills / plugins / agent profiles
    GET  /tooling/diagnostics            -- derived warnings/info
    POST /tooling/scan                   -- invalidate caches and re-collect [WRITE]
    GET  /tooling/adapters               -- provider adapters: detection + capabilities
    GET  /tooling/catalog                -- curated extension catalog + support/status
    GET  /tooling/sources                -- aggregated source inventory [any scope]
    GET  /tooling/models                 -- per-provider model catalog (probe/known)
    POST /tooling/plan                   -- preview an action's argv/cwd/verify [any scope]
    POST /tooling/execute                -- run an action as an operation [WRITE]
    GET  /tooling/operations             -- recent operations (no log body)
    GET  /tooling/operations/{id}        -- one operation, with its masked log
    POST /tooling/operations/{id}/cancel -- request cancellation [WRITE]
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from cli_agent_orchestrator.security.auth import (
    SCOPE_ADMIN,
    SCOPE_READ,
    SCOPE_WRITE,
    require_any_scope,
)
from cli_agent_orchestrator.services.tooling import (
    cache,
    catalog,
    diagnostics,
    environment,
    extensions,
    models,
    operations,
    providers,
    runner,
    sources,
)
from cli_agent_orchestrator.services.tooling.adapters import registry
from cli_agent_orchestrator.services.tooling.adapters.base import ExecutionPlan, ExtensionAdapter

router = APIRouter(prefix="/tooling", tags=["tooling"])

# Target format accepted by plan/execute. Narrower than the runner's argv-token
# class (no ``%+=:,``) — a skill target is a name/path/url-ish string. The
# runner re-validates every token, so this is the first of two gates.
_TARGET_RE = re.compile(r"^[A-Za-z0-9@/._-]{1,200}$")

# Catalog-install sentinel. A ``target`` of ``catalog:<id>`` routes to the
# curated catalog instead of a free-form name. The colon is intentionally kept
# OUT of ``_TARGET_RE`` (which stays a tight name/path class); a catalog target
# is recognized by this exact prefix and its ``<id>`` is validated by the
# narrow, closed-set ``_CATALOG_ID_RE`` below AND must resolve to a real catalog
# entry — the argv is then built entirely from that static entry, never from the
# request. This is safer than widening ``_TARGET_RE`` to allow colons.
_CATALOG_PREFIX = "catalog:"
_CATALOG_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

# Wall-clock ceiling for a single executed operation.
_EXECUTE_TIMEOUT_SECONDS = 300.0

# Which capability flag gates each action.
_ACTION_CAPABILITY = {
    "install": "canInstall",
    "remove": "canRemove",
    "update": "canUpdate",
    "update_all": "canUpdateAll",
}


class PlanRequest(BaseModel):
    """Body for ``POST /tooling/plan`` and ``POST /tooling/execute``.

    ``target`` is either a free-form name (validated by :data:`_TARGET_RE`) or a
    ``catalog:<id>`` sentinel routing to the curated catalog. ``params`` carries
    per-item runtime inputs — currently only ``{"path": ...}`` for the
    filesystem MCP server, which is home-confined before use.
    """

    action: str
    provider: str
    target: Optional[str] = None
    scope: Optional[str] = None
    params: Optional[Dict[str, Any]] = None


@dataclass
class _Resolved:
    """A validated plan plus the bound verification for its execute path."""

    adapter: ExtensionAdapter
    plan: ExecutionPlan
    verify: Callable[[], Tuple[bool, str]]
    warnings: List[str] = field(default_factory=list)


def _resolve_and_validate(body: PlanRequest) -> _Resolved:
    """Validate a plan/execute request into a runner-ready :class:`_Resolved`.

    Raises ``HTTPException(400)`` on an unregistered provider, an unsupported or
    capability-disabled action, a malformed/missing target, or an invalid
    catalog request. ``execute`` calls this too, so the same argv-safety gate
    runs on both paths (a renderer cannot smuggle a free-form string past
    ``plan`` into ``execute``, nor a catalog install past its static argv).
    """
    adapter = registry.get_adapter(body.provider)
    if adapter is None:
        raise HTTPException(status_code=400, detail=f"unknown provider: {body.provider!r}")

    if body.action not in operations.VALID_ACTIONS:
        raise HTTPException(status_code=400, detail=f"unsupported action: {body.action!r}")

    if body.target is not None and body.target.startswith(_CATALOG_PREFIX):
        return _resolve_catalog(adapter, body)
    return _resolve_generic(adapter, body)


def _resolve_generic(adapter: ExtensionAdapter, body: PlanRequest) -> _Resolved:
    """Resolve a free-form ``(action, target)`` request (the Phase 4a path)."""
    if body.action != "update_all":
        if not body.target:
            raise HTTPException(status_code=400, detail=f"action {body.action!r} requires a target")
        if not _TARGET_RE.match(body.target):
            raise HTTPException(status_code=400, detail="target contains disallowed characters")

    _require_capability(adapter, body.action)

    try:
        plan = adapter.plan(body.action, body.target, body.scope)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    action, target = body.action, body.target
    return _Resolved(
        adapter=adapter,
        plan=plan,
        verify=lambda: adapter.verify(action, target),
        warnings=_derive_warnings(adapter, plan, body.scope),
    )


def _resolve_catalog(adapter: ExtensionAdapter, body: PlanRequest) -> _Resolved:
    """Resolve a ``catalog:<id>`` install into a static, adapter-built plan."""
    if body.action != "install":
        raise HTTPException(status_code=400, detail="카탈로그 항목은 install 액션만 지원해요")
    catalog_id = body.target[len(_CATALOG_PREFIX) :] if body.target else ""
    if not _CATALOG_ID_RE.match(catalog_id):
        raise HTTPException(status_code=400, detail="잘못된 카탈로그 id 형식이에요")

    try:
        resolved = catalog.resolve_install(catalog_id, body.provider, body.params)
    except catalog.CatalogError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _require_capability(adapter, "install")

    try:
        if resolved.method == "mcp":
            plan = adapter.plan_mcp_add(resolved.name, resolved.command_tokens)
        else:  # "skill" — reuse the generic install path with the resolved name
            plan = adapter.plan("install", resolved.name, body.scope)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    name = resolved.name
    return _Resolved(
        adapter=adapter,
        plan=plan,
        verify=lambda: adapter.verify("install", name),
        warnings=[*resolved.warnings, *_derive_warnings(adapter, plan, body.scope)],
    )


def _require_capability(adapter: ExtensionAdapter, action: str) -> None:
    """Raise 400 if ``adapter`` cannot perform ``action`` (with its reason)."""
    caps = adapter.capabilities()
    capability = _ACTION_CAPABILITY[action]
    if not getattr(caps, capability):
        reason = caps.reasons.get(capability, f"{action} is not supported")
        raise HTTPException(status_code=400, detail=reason)


def _derive_warnings(
    adapter: ExtensionAdapter, plan: ExecutionPlan, scope: Optional[str]
) -> List[str]:
    """Compute non-fatal warnings the confirm dialog should surface."""
    warnings: List[str] = []
    if scope == "global" and "--global" not in plan.argv:
        warnings.append(
            "global scope is not supported by this tool (no --global flag detected); "
            "proceeding with the default scope"
        )
    caps = adapter.capabilities()
    if caps.requiresRestart:
        warnings.append("a restart may be required for this change to take effect")
    if caps.requiresNewSession:
        warnings.append("a new session may be required for this change to take effect")
    return warnings


@router.get("/environment")
async def get_environment() -> Dict[str, Any]:
    """Return host environment facts (TTL-cached)."""
    return environment.detect_environment()


@router.get("/providers")
async def get_providers() -> List[Dict[str, Any]]:
    """Return per-provider install status and version (TTL-cached)."""
    return providers.list_providers()


@router.get("/extensions")
async def get_extensions() -> List[Dict[str, Any]]:
    """Return the combined CAO-owned extension inventory."""
    return extensions.list_extensions()


@router.get("/diagnostics")
async def get_diagnostics() -> List[Dict[str, Any]]:
    """Return derived diagnostics (empty list when nothing to report)."""
    return diagnostics.collect_diagnostics()


@router.post("/scan")
async def scan_tooling(
    _scopes: List[str] = Depends(require_any_scope(SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, str]:
    """Invalidate caches, force a fresh collection, and return the scan time."""
    return {"scanned_at": cache.rescan()}


@router.get("/adapters")
async def get_adapters() -> List[Dict[str, Any]]:
    """Return each provider adapter's detection result and capabilities."""
    result: List[Dict[str, Any]] = []
    for adapter in registry.get_adapters().values():
        env = adapter.detect()
        caps = adapter.capabilities()
        result.append(
            {
                "id": adapter.id,
                "display_name": adapter.display_name,
                "detected": {
                    "installed": env.installed,
                    "path": env.path,
                    "version": env.version,
                },
                "capabilities": asdict(caps),
            }
        )
    return result


@router.get("/catalog")
async def get_catalog() -> List[Dict[str, Any]]:
    """Return the curated extension catalog with per-provider support/status."""
    return catalog.list_catalog()


@router.get("/sources")
async def get_sources(
    _scopes: List[str] = Depends(require_any_scope(SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    """Return aggregated source inventory (directories, catalog, marketplaces)."""
    return await sources.collect_sources()


@router.get("/models")
async def get_models() -> List[Dict[str, Any]]:
    """Return the per-provider model catalog (agy probed; claude/codex known)."""
    return models.list_models()


@router.post("/plan")
async def plan_action(
    body: PlanRequest,
    _scopes: List[str] = Depends(require_any_scope(SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    """Preview the argv/cwd an action would run (read-only; no state change)."""
    resolved = _resolve_and_validate(body)
    plan = resolved.plan
    return {
        "description": plan.description,
        "argv": plan.argv,
        "cwd": plan.cwd,
        "verify_description": plan.verify_description,
        "warnings": resolved.warnings,
    }


@router.post("/execute")
async def execute_action(
    body: PlanRequest,
    _scopes: List[str] = Depends(require_any_scope(SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, str]:
    """Validate (again) and run the action as an async operation."""
    resolved = _resolve_and_validate(body)
    plan = resolved.plan
    op = operations.new_operation(
        action=body.action, provider=body.provider, target=body.target, scope=body.scope
    )

    async def work(operation: operations.Operation) -> None:
        result = await runner.run(
            plan.argv,
            cwd=plan.cwd,
            timeout=_EXECUTE_TIMEOUT_SECONDS,
            on_line=operation.append_log,
        )
        operation.exit_code = result.returncode
        if result.timed_out:
            operation.status = operations.STATUS_FAILED
            operation.error = "command timed out"
            return
        if result.returncode != 0:
            operation.status = operations.STATUS_FAILED
            operation.error = (result.stderr.strip() or f"command exited {result.returncode}")[:500]
            return
        operation.status = operations.STATUS_VERIFYING
        # verify() shells out (read-only); run it off the event loop so it does
        # not stall other concurrent operations. The closure is bound to the
        # resolved target (a catalog install verifies its resolved MCP/skill
        # name, not the raw ``catalog:<id>`` target).
        ok, detail = await asyncio.to_thread(resolved.verify)
        operation.verified = ok
        if ok:
            operation.status = operations.STATUS_SUCCEEDED
        else:
            operation.status = operations.STATUS_FAILED
            operation.error = f"verification failed: {detail}"

    operations.get_manager().submit(op, work)
    return {"operation_id": op.id}


@router.get("/operations")
async def list_operations() -> List[Dict[str, Any]]:
    """Return recent operations (newest first), without their log bodies."""
    return [op.to_dict() for op in operations.get_manager().list()]


@router.get("/operations/{operation_id}")
async def get_operation(operation_id: str) -> Dict[str, Any]:
    """Return one operation, including its full masked log."""
    op = operations.get_manager().get(operation_id)
    if op is None:
        raise HTTPException(status_code=404, detail=f"unknown operation: {operation_id!r}")
    return op.to_dict(include_log=True)


@router.post("/operations/{operation_id}/cancel")
async def cancel_operation(
    operation_id: str,
    _scopes: List[str] = Depends(require_any_scope(SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, str]:
    """Request cancellation of a running operation."""
    manager = operations.get_manager()
    if manager.get(operation_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown operation: {operation_id!r}")
    if not manager.cancel(operation_id):
        raise HTTPException(status_code=409, detail="operation is already finished")
    return {"operation_id": operation_id, "status": "cancelling"}
