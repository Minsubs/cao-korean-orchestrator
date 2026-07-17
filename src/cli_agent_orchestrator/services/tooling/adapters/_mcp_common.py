"""Shared machinery for provider CLIs that manage MCP servers non-interactively.

Claude Code and Codex expose the same conservative shape — ``<bin> mcp list``,
``<bin> mcp add <name> -- <command…>``, ``<bin> mcp remove <name>`` — so the
capability probing and the argv construction live here once. Each adapter keeps
its own detection, list parsing (Claude's health-checked text vs Codex's JSON /
config.toml fallback), and any provider-specific extras (Claude plugins).

Everything here is read-only or pure argv construction:

* :func:`probe_subcommands` runs ``<bin> <parent> --help`` through the read-only
  :mod:`probe` runner at most once per TTL window (cached) and reports which of
  a known subcommand set the help advertises. ``None`` means the help could not
  be read (binary absent, non-zero exit, or timeout) — distinct from "read, but
  the subcommand is missing" (an empty/partial set).
* :func:`mcp_add_argv` / :func:`mcp_remove_argv` / :func:`mcp_list_argv` build
  the runner-ready argv. The add command's launch tokens come from the static
  catalog, never from a renderer string; the runner re-validates every token.
"""

from __future__ import annotations

import re
from typing import List, Optional, cast

from cli_agent_orchestrator.services.tooling import cache, probe

# Wall-clock ceiling for a ``--help`` probe.
HELP_TIMEOUT_SECONDS = 5.0

# The MCP subcommands whose presence we probe for in ``<bin> mcp --help``.
MCP_SUBCOMMANDS = ("list", "add", "remove", "get")


def probe_subcommands(
    argv_help: List[str],
    known: tuple[str, ...],
    cache_key: str,
    *,
    timeout: float = HELP_TIMEOUT_SECONDS,
) -> Optional[set[str]]:
    """Return the ``known`` subcommands advertised by ``argv_help``, TTL-cached.

    Args:
        argv_help: The help command, e.g. ``["claude", "mcp", "--help"]``.
        known: Subcommand tokens to look for (matched as whole words).
        cache_key: TTL cache key for the parsed result.
        timeout: Wall-clock ceiling for the probe.

    Returns:
        A set of the ``known`` tokens found in the help text, or ``None`` when
        the help could not be read (so a caller can tell "unsupported" from
        "unknown"). Both the ``None`` and the found-set outcomes are cached.
    """
    store = cache.get_cache()
    cached = store.get(cache_key)
    if cached is not None:
        # ``frozenset`` sentinel distinguishes a cached "unreadable" (stored as
        # the string "") from a cached empty/partial result.
        if cached == "":
            return None
        return set(cast("frozenset[str]", cached))

    result = probe.run(argv_help, timeout=timeout)
    if result.timed_out or result.returncode is None or result.returncode != 0:
        store.set(cache_key, "")
        return None
    text = f"{result.stdout}\n{result.stderr}"
    if not text.strip():
        store.set(cache_key, "")
        return None

    lowered = text.lower()
    found = {sub for sub in known if re.search(rf"\b{re.escape(sub)}\b", lowered)}
    store.set(cache_key, frozenset(found))
    return found


def mcp_list_argv(binary: str) -> List[str]:
    """Build the argv to list configured MCP servers."""
    return [binary, "mcp", "list"]


def mcp_add_argv(binary: str, name: str, command_tokens: List[str]) -> List[str]:
    """Build the argv to add a stdio MCP server named ``name``.

    Shape: ``<bin> mcp add <name> -- <command…>``. The ``--`` sentinel separates
    the server name from its launch command so nothing in ``command_tokens`` is
    parsed as a flag to ``mcp add`` itself.
    """
    return [binary, "mcp", "add", name, "--", *command_tokens]


def mcp_remove_argv(binary: str, name: str) -> List[str]:
    """Build the argv to remove the MCP server named ``name``."""
    return [binary, "mcp", "remove", name]
