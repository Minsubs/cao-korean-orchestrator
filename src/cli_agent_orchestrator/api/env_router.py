"""CLI environment migration + instructions API router (Phase 6b).

Self-contained ``APIRouter`` with an ``/env`` prefix. It is NOT mounted here — the
integration owner wires it into ``api/main.py`` via
``app.include_router(env_router.router)``. Keeping it standalone lets the
migration + instructions surfaces ship without touching ``main.py``.

Endpoints:
    GET  /env/inventory?cli=            -- scan an existing CLI work environment (read)
    GET  /env/instructions?paths=       -- instruction-file matrix (read)
    POST /env/convert                   -- deterministic conversion preview (no write)
    POST /env/instructions/write        -- the single write path (backup + atomic)

Scope gating: the two read endpoints admit any authenticated scope
(READ/WRITE/ADMIN); the two mutating endpoints require WRITE or ADMIN. The
repo's ``test_scope_coverage`` guard enumerates the live route table and fails if
a mutating route lacks a ``require_any_scope`` dependency, so the ``/env/convert``
and ``/env/instructions/write`` gates below are load-bearing once integrated.
``POST /env/convert`` performs no state change, but keeping the gate honors the
mutating-verb convention (and the guard).

All filesystem work — and the home-confinement, existing-files-only, and
secret-masking rules — lives in ``services/env_migration``; this module only
translates requests and maps the package's exceptions to HTTP status codes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from cli_agent_orchestrator.security.auth import (
    SCOPE_ADMIN,
    SCOPE_READ,
    SCOPE_WRITE,
    require_any_scope,
)
from cli_agent_orchestrator.services.env_migration import (
    ContentTooLarge,
    InstructionExists,
    InvalidInstructionName,
    MissingConversionInput,
    PathOutsideHome,
    UnsupportedConversion,
)
from cli_agent_orchestrator.services.env_migration import convert as convert_service
from cli_agent_orchestrator.services.env_migration import instructions as instructions_service
from cli_agent_orchestrator.services.env_migration import inventory as inventory_service

router = APIRouter(prefix="/env", tags=["env"])


# --- 1: inventory ---------------------------------------------------------


@router.get("/inventory")
async def get_inventory(
    cli: str = Query(default="all"),
    _scopes: List[str] = Depends(require_any_scope(SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    """Scan an existing CLI work environment (read-only, home-confined).

    ``cli`` is one of ``claude_code`` / ``codex`` / ``antigravity`` (returns a
    single ``{cli, present, items, counts, note}`` object) or ``all`` (returns
    ``{clis: [...]}``). Any other value is a 400. Items are metadata only — no
    file content is ever returned.
    """
    if cli == "all":
        return inventory_service.scan_all()
    try:
        return inventory_service.scan_inventory(cli)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --- 2: instruction matrix ------------------------------------------------


@router.get("/instructions")
async def get_instructions(
    paths: Optional[str] = Query(default=None),
    _scopes: List[str] = Depends(require_any_scope(SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    """Return the instruction-file matrix (global + requested project paths).

    ``paths`` is a comma-separated list of absolute project paths. Each is
    home-confined; a path outside ``$HOME`` yields a per-entry ``error`` rather
    than failing the whole request. The response contains fingerprints
    (``sha256``) and masked ``headline``s only — never full content.
    """
    project_paths = [part for part in (paths or "").split(",") if part.strip()]
    return instructions_service.build_matrix(project_paths)


# --- 3: convert (preview) -------------------------------------------------


class ConvertRequest(BaseModel):
    """Body for ``POST /env/convert``. Supply exactly one of ``path`` / ``content``.

    ``path`` (home-confined) reads a source file; ``content`` passes the source
    text inline (kept out of query strings so it never lands in access logs).
    """

    source_kind: str
    target_kind: str
    path: Optional[str] = None
    content: Optional[str] = None


@router.post("/convert")
async def post_convert(
    request: ConvertRequest,
    _scopes: List[str] = Depends(require_any_scope(SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    """Return a deterministic conversion preview (secret-masked, no file write)."""
    try:
        return convert_service.convert(
            source_kind=request.source_kind,
            target_kind=request.target_kind,
            path=request.path,
            content=request.content,
        )
    except (UnsupportedConversion, MissingConversionInput, PathOutsideHome) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --- 4: instruction write (the only mutation) -----------------------------


class WriteInstructionRequest(BaseModel):
    """Body for ``POST /env/instructions/write``.

    ``path`` is home-confined and its filename must be CLAUDE.md / AGENTS.md /
    ``*.md``. ``content`` is capped at 256 KiB and written verbatim (never masked
    — the caller owns this input). ``overwrite`` gates replacing an existing file
    (and triggers a timestamped backup).
    """

    path: str
    content: str
    overwrite: bool = False


@router.post("/instructions/write")
async def post_instructions_write(
    request: WriteInstructionRequest,
    _scopes: List[str] = Depends(require_any_scope(SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    """Write an instruction file (home-confined, backup on overwrite, atomic)."""
    try:
        return instructions_service.write_instruction(
            path=request.path,
            content=request.content,
            overwrite=request.overwrite,
        )
    except (PathOutsideHome, InvalidInstructionName, ContentTooLarge) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except InstructionExists as exc:
        raise HTTPException(status_code=409, detail=str(exc))
