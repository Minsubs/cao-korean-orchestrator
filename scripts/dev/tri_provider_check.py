"""Tri-provider live orchestration check: codex + claude_code + antigravity_cli.

Extends the strict fixed-team check to cover the Antigravity CLI (``agy``) as
both an orchestrator and a worker, alongside the codex<->claude baseline. Reuses
``fixed_orchestrator_check``'s ``Case``/``run_case`` so the pass criteria are
identical: a case passes only when the expected worker is linked to its caller,
its callback is delivered, both generations settle, and the orchestrator emits
its post-callback final marker.

Prerequisites:
  - source ``cao-server`` listening on 127.0.0.1:9889
  - antigravity profiles installed where the server can resolve them
    (``antigravity_orchestrator_agy``, ``antigravity_qa_agy``)
  - ``agy``, ``codex``, ``claude`` all installed and signed in

Run::

    PYTHONPATH=src uv run --no-sync python scripts/dev/tri_provider_check.py
"""

from __future__ import annotations

import sys

from fixed_orchestrator_check import Case, CheckFailure, request, run_case

CASES = (
    # Baseline: codex orchestrator -> claude worker (proves the claude external
    # CLAUDE.md-import startup-prompt fix end to end).
    Case(
        name="codex-to-claude",
        supervisor_provider="codex",
        supervisor_profile="codex_orchestrator_sol",
        worker_provider="claude_code",
        worker_profile="claude_scout_haiku",
        callback_marker="TRI_CODEX_CLAUDE_CALLBACK_OK",
        final_marker="TRI_CODEX_CLAUDE_FINAL_OK",
    ),
    # Antigravity as orchestrator -> codex worker.
    Case(
        name="agy-to-codex",
        supervisor_provider="antigravity_cli",
        supervisor_profile="antigravity_orchestrator_agy",
        worker_provider="codex",
        worker_profile="codex_qa_terra",
        callback_marker="TRI_AGY_CODEX_CALLBACK_OK",
        final_marker="TRI_AGY_CODEX_FINAL_OK",
    ),
    # Antigravity as worker, driven by a codex orchestrator.
    Case(
        name="codex-to-agy",
        supervisor_provider="codex",
        supervisor_profile="codex_orchestrator_sol",
        worker_provider="antigravity_cli",
        worker_profile="antigravity_qa_agy",
        callback_marker="TRI_CODEX_AGY_CALLBACK_OK",
        final_marker="TRI_CODEX_AGY_FINAL_OK",
    ),
    # Cross-provider example profiles (examples/cross-provider/): the
    # provider-agnostic supervisor example delegating to a codex worker example.
    Case(
        name="crossprov-supervisor-to-codex-analyst",
        supervisor_provider="codex",
        supervisor_profile="cross_provider_supervisor",
        worker_provider="codex",
        worker_profile="data_analyst_codex",
        callback_marker="XPROV_EXAMPLE_CB_OK",
        final_marker="XPROV_EXAMPLE_FIN_OK",
    ),
)


def main() -> int:
    health = request("GET", "/health").json()
    if health.get("status") != "ok":
        raise CheckFailure(f"server is not healthy: {health}")
    for case in CASES:
        run_case(case)
    print("\nALL PASS: codex/claude/antigravity orchestrators completed every callback loop", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CheckFailure as exc:
        print(f"\nFAIL: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
