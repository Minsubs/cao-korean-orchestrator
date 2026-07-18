"""Data contracts shared by the static tooling catalog and its resolver."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional, Tuple


@dataclass(frozen=True, slots=True)
class InstallSpec:
    """Static command fragment used to install an item for one provider."""

    method: str
    argv: Tuple[str, ...]
    requires_params: Tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CatalogItem:
    """One curated extension and its per-provider install specs."""

    id: str
    name: str
    description_ko: str
    kind: str
    category: str
    homepage: str
    providers: Tuple[str, ...]
    install: Mapping[str, InstallSpec]
    requires: Tuple[str, ...] = ()
    popular: bool = True
    new_session_required: bool = False
    warnings: Tuple[str, ...] = ()
    manual_reason: Optional[str] = None
