"""Live regression for the fixed Codex/Claude orchestrator team.

This is intentionally stricter than checking that ``assign`` returned or that
the worker received a message. A case passes only when the expected worker is
linked to its caller, its callback is delivered, both generations settle, and
the orchestrator emits its post-callback final marker.

Run while the source ``cao-server`` is listening on port 9889::

    PYTHONPATH=src uv run --no-sync python scripts/dev/fixed_orchestrator_check.py
"""

from __future__ import annotations

import sys
import time
import uuid
from dataclasses import dataclass
from typing import Any

import requests

BASE_URL = "http://127.0.0.1:9889"
POLL_SECONDS = 3


@dataclass(frozen=True)
class Case:
    name: str
    supervisor_provider: str
    supervisor_profile: str
    worker_provider: str
    worker_profile: str
    callback_marker: str
    final_marker: str

    @property
    def task(self) -> str:
        return (
            f"Use the assign MCP tool exactly once with agent_profile={self.worker_profile}. "
            "The assigned worker must not edit files and must send the exact callback "
            f"{self.callback_marker} to you with the send_message MCP tool. "
            "A successful assign receipt or worker creation is not completion. Wait until the "
            "worker callback is delivered, then answer with the exact final marker "
            f"{self.final_marker}. Do not output the final marker before receiving the callback."
        )


CASES = (
    Case(
        name="codex-to-claude-scout",
        supervisor_provider="codex",
        supervisor_profile="codex_orchestrator_sol",
        worker_provider="claude_code",
        worker_profile="claude_scout_haiku",
        callback_marker="CODEX_TO_CLAUDE_CALLBACK_OK",
        final_marker="CODEX_TO_CLAUDE_FINAL_OK",
    ),
    Case(
        name="claude-to-codex-qa",
        supervisor_provider="claude_code",
        supervisor_profile="claude_orchestrator_sonnet",
        worker_provider="codex",
        worker_profile="codex_qa_terra",
        callback_marker="CLAUDE_TO_CODEX_CALLBACK_OK",
        final_marker="CLAUDE_TO_CODEX_FINAL_OK",
    ),
)


class CheckFailure(RuntimeError):
    pass


def request(method: str, path: str, **kwargs: Any) -> requests.Response:
    response = requests.request(
        method, f"{BASE_URL}{path}", timeout=kwargs.pop("timeout", 30), **kwargs
    )
    if response.status_code >= 400:
        raise CheckFailure(f"{method} {path} -> {response.status_code}: {response.text[:400]}")
    return response


def session_terminals(session_name: str) -> list[dict[str, Any]]:
    payload = request("GET", f"/sessions/{session_name}").json()
    return payload.get("terminals", [])


def terminal_in_session(session_name: str, terminal_id: str) -> dict[str, Any] | None:
    return next(
        (item for item in session_terminals(session_name) if item["id"] == terminal_id), None
    )


def wait_until(label: str, timeout: int, predicate):
    started = time.monotonic()
    last_summary = None
    while time.monotonic() - started < timeout:
        matched, summary, value = predicate()
        if summary != last_summary:
            print(f"  [{label}] {summary}", flush=True)
            last_summary = summary
        if matched:
            return value
        time.sleep(POLL_SECONDS)
    raise CheckFailure(f"{label} timed out after {timeout}s; last={last_summary}")


def output(terminal_id: str) -> str:
    payload = request("GET", f"/terminals/{terminal_id}/output", params={"mode": "last"}).json()
    return payload.get("output") or ""


def run_case(case: Case) -> None:
    session_label = f"fixed-{case.name[:13]}-{uuid.uuid4().hex[:6]}"
    actual_session = None
    print(f"\nCASE {case.name}", flush=True)
    try:
        created = request(
            "POST",
            "/sessions",
            timeout=180,
            params={
                "provider": case.supervisor_provider,
                "agent_profile": case.supervisor_profile,
                "session_name": session_label,
            },
        ).json()
        supervisor_id = created["id"]
        actual_session = created["session_name"]
        print(f"  supervisor={supervisor_id} session={actual_session}", flush=True)

        wait_until(
            "supervisor-ready",
            180,
            lambda: (
                (term := terminal_in_session(actual_session, supervisor_id)) is not None
                and term.get("status") in {"idle", "completed"}
                and (term.get("input_generation") or 0) > 0
                and term.get("input_generation") == term.get("ready_generation"),
                (
                    "missing"
                    if term is None
                    else f"status={term.get('status')} gen={term.get('input_generation')}/{term.get('ready_generation')}"
                ),
                term,
            ),
        )

        inbox_before = request("GET", f"/terminals/{supervisor_id}/inbox/messages").json()
        prior_message_id = max((message["id"] for message in inbox_before), default=0)
        request("POST", f"/terminals/{supervisor_id}/input", params={"message": case.task})

        def find_worker():
            candidates = [
                terminal
                for terminal in session_terminals(actual_session)
                if terminal["id"] != supervisor_id
                and terminal.get("agent_profile") == case.worker_profile
            ]
            summary = "none" if not candidates else ",".join(item["id"] for item in candidates)
            return bool(candidates), f"workers={summary}", candidates[0] if candidates else None

        worker = wait_until("worker-created", 300, find_worker)
        worker_id = worker["id"]
        detail = request("GET", f"/terminals/{worker_id}").json()
        if detail.get("provider") != case.worker_provider:
            raise CheckFailure(
                f"worker provider {detail.get('provider')!r}, expected {case.worker_provider!r}"
            )
        if detail.get("caller_id") != supervisor_id:
            raise CheckFailure(
                f"worker caller_id {detail.get('caller_id')!r}, expected {supervisor_id!r}"
            )
        print(
            f"  worker={worker_id} provider={detail['provider']} caller={detail['caller_id']}",
            flush=True,
        )

        worker_settled = wait_until(
            "worker-settled",
            480,
            lambda: (
                (term := terminal_in_session(actual_session, worker_id)) is not None
                and term.get("status") in {"idle", "completed"}
                and (term.get("input_generation") or 0) > 0
                and term.get("input_generation") == term.get("ready_generation"),
                (
                    "missing"
                    if term is None
                    else f"status={term.get('status')} gen={term.get('input_generation')}/{term.get('ready_generation')}"
                ),
                term,
            ),
        )

        def find_callback():
            messages = request("GET", f"/terminals/{supervisor_id}/inbox/messages").json()
            matches = [
                message
                for message in messages
                if message["id"] > prior_message_id
                and message.get("sender_id") == worker_id
                and message.get("status") == "delivered"
                and case.callback_marker in (message.get("message") or "")
            ]
            summary = "none" if not matches else f"message={matches[-1]['id']} delivered"
            return bool(matches), summary, matches[-1] if matches else None

        callback = wait_until("callback-delivered", 360, find_callback)

        def find_final():
            term = terminal_in_session(actual_session, supervisor_id)
            latest_output = output(supervisor_id)
            settled = (
                term is not None
                and term.get("status") in {"idle", "completed"}
                and (term.get("input_generation") or 0) >= 2
                and term.get("input_generation") == term.get("ready_generation")
            )
            has_final = case.final_marker in latest_output
            summary = (
                "missing"
                if term is None
                else f"status={term.get('status')} gen={term.get('input_generation')}/{term.get('ready_generation')} final={has_final}"
            )
            return settled and has_final, summary, (term, latest_output)

        supervisor_settled, final_output = wait_until("supervisor-final", 360, find_final)
        print(
            "  PASS "
            f"worker_gen={worker_settled['input_generation']}/{worker_settled['ready_generation']} "
            f"callback={callback['id']} "
            f"supervisor_gen={supervisor_settled['input_generation']}/{supervisor_settled['ready_generation']} "
            f"final={case.final_marker}",
            flush=True,
        )
    finally:
        if actual_session:
            response = requests.delete(f"{BASE_URL}/sessions/{actual_session}", timeout=60)
            print(f"  cleanup={response.status_code} {actual_session}", flush=True)


def main() -> int:
    health = request("GET", "/health").json()
    if health.get("status") != "ok":
        raise CheckFailure(f"server is not healthy: {health}")
    for case in CASES:
        run_case(case)
    print("\nALL PASS: fixed Codex/Claude orchestrators completed both callback loops", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CheckFailure as exc:
        print(f"\nFAIL: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
