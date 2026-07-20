"""Full 3-AI cross-provider orchestration matrix: codex x claude_code x antigravity_cli.

Runs every (supervisor -> worker) ordered pair over the three providers (3x3 = 9
cases), reusing fixed_orchestrator_check's strict Case/run_case: a case passes
only when the worker is linked to its caller, its callback is delivered, both
generations settle, and the supervisor emits its post-callback final marker.

Prereqs: source cao-server on 127.0.0.1:9889 with CAO_HOME on ext4; codex/claude/
agy installed and signed in; these profiles resolvable by the server:
  codex:           codex_orchestrator_sol / codex_qa_terra
  claude_code:     claude_orchestrator_sonnet / claude_scout_haiku
  antigravity_cli: antigravity_orchestrator_agy / antigravity_qa_agy

Run::

    PYTHONPATH=src uv run --no-sync python scripts/dev/matrix_check.py [only]

`only` (optional) is a comma-separated list of case names to run a subset, e.g.
    python scripts/dev/matrix_check.py CX-to-AG,AG-to-CL
"""

from __future__ import annotations

import sys

from fixed_orchestrator_check import Case, CheckFailure, request, run_case

# provider-key -> (provider, orchestrator_profile, worker_profile)
PROVIDERS = {
    "CX": ("codex", "codex_orchestrator_sol", "codex_qa_terra"),
    "CL": ("claude_code", "claude_orchestrator_sonnet", "claude_scout_haiku"),
    "AG": ("antigravity_cli", "antigravity_orchestrator_agy", "antigravity_qa_agy"),
}


def build_cases() -> tuple[Case, ...]:
    cases = []
    for sup_key, (sup_provider, sup_profile, _) in PROVIDERS.items():
        for wk_key, (wk_provider, _, wk_worker) in PROVIDERS.items():
            cases.append(
                Case(
                    name=f"{sup_key}-to-{wk_key}",
                    supervisor_provider=sup_provider,
                    supervisor_profile=sup_profile,
                    worker_provider=wk_provider,
                    worker_profile=wk_worker,
                    callback_marker=f"MTX_{sup_key}_{wk_key}_CB_OK",
                    final_marker=f"MTX_{sup_key}_{wk_key}_FIN_OK",
                )
            )
    return tuple(cases)


CASES = build_cases()


def main() -> int:
    only = set()
    if len(sys.argv) > 1:
        only = {name.strip() for name in sys.argv[1].split(",") if name.strip()}

    health = request("GET", "/health").json()
    if health.get("status") != "ok":
        raise CheckFailure(f"server is not healthy: {health}")

    selected = [c for c in CASES if not only or c.name in only]
    print(f"Running {len(selected)}/{len(CASES)} matrix cases", flush=True)

    passed, failed = [], []
    for case in selected:
        try:
            run_case(case)
            passed.append(case.name)
        except CheckFailure as exc:
            # Record and keep going so one bad pair does not hide the rest.
            print(f"  CASE-FAIL {case.name}: {exc}", flush=True)
            failed.append((case.name, str(exc)))

    print("\n==== MATRIX SUMMARY ====", flush=True)
    for name in (c.name for c in selected):
        mark = "PASS" if name in passed else "FAIL"
        print(f"  {mark} {name}", flush=True)
    print(f"\n{len(passed)}/{len(selected)} passed", flush=True)
    if failed:
        print("FAILURES:", flush=True)
        for name, err in failed:
            print(f"  {name}: {err}", flush=True)
        return 1
    print("ALL PASS: full 3-AI cross-provider matrix completed every callback loop", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
