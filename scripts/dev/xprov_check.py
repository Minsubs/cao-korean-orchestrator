"""Manual live cross-provider orchestration check: claude_code supervisor → codex worker.

Exercises the REAL agent-driven loop against the running cao-server (:9889):
  1. create session with analysis_supervisor (claude_code)
  2. instruct it to use the `assign` MCP tool with agent_profile=data_analyst_codex
  3. verify a second terminal appears, provider == codex, caller_id == supervisor
  4. wait for worker completion, then for the send_message callback to reach the
     supervisor via the inbox (supervisor goes processing → idle again)
  5. verify the supervisor's final output states the computed result (mean = 5)
  6. delete the session (cleanup — also exercises DELETE /sessions on the live server)

PASS/FAIL is printed per step; exit code 0 only if all steps pass.
"""

import sys
import time
import uuid

import requests

BASE = "http://127.0.0.1:9889"
SESSION = f"e2e-xprov-cc-{uuid.uuid4().hex[:6]}"
TASK = (
    "Use the assign tool to delegate this task to the data_analyst_codex agent: "
    "Compute the mean of the numbers 2, 4, 6, 8 and send the result back via send_message. "
    "After you receive the worker's reply, state the mean explicitly in your answer."
)

def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)

def get_status(tid):
    r = requests.get(f"{BASE}/terminals/{tid}", timeout=10)
    return r.json().get("status", "unknown") if r.status_code == 200 else "unknown"

def wait_status(tid, targets, timeout, label):
    start = time.time()
    last = None
    while time.time() - start < timeout:
        s = get_status(tid)
        if s != last:
            print(f"  [{label}] status={s} @{int(time.time()-start)}s")
            last = s
        if s in targets:
            return s
        time.sleep(4)
    return None

# 1. create supervisor session
r = requests.post(f"{BASE}/sessions", params={
    "provider": "claude_code", "agent_profile": "analysis_supervisor", "session_name": SESSION,
}, timeout=180)
if r.status_code not in (200, 201):
    fail(f"session create {r.status_code}: {r.text[:300]}")
sup = r.json()["id"]
sess = r.json()["session_name"]
print(f"PASS 1: supervisor session {sess} terminal {sup}")

try:
    # 2. wait ready, send task
    if not wait_status(sup, {"idle", "completed"}, 150, "supervisor-init"):
        fail("supervisor not ready in 150s")
    time.sleep(2)
    r = requests.post(f"{BASE}/terminals/{sup}/input", params={"message": TASK}, timeout=30)
    if r.status_code != 200:
        fail(f"send input {r.status_code}: {r.text[:200]}")
    print("PASS 2: task sent to supervisor")

    # 3. worker terminal appears with provider=codex, caller_id=supervisor
    worker = None
    start = time.time()
    while time.time() - start < 240:
        r = requests.get(f"{BASE}/sessions/{sess}/terminals", timeout=10)
        terms = r.json() if r.status_code == 200 else []
        others = [t for t in terms if t["id"] != sup]
        if others:
            worker = others[0]
            break
        time.sleep(5)
    if worker is None:
        fail("no worker terminal within 240s — supervisor did not call assign")
    wid = worker["id"]
    if worker.get("provider") != "codex":
        fail(f"worker provider expected codex, got {worker.get('provider')}")
    # The session-terminals LIST omits caller_id; the detail endpoint
    # (response_model=Terminal) is what send_message's recorded-caller
    # fallback reads — assert against that.
    detail = requests.get(f"{BASE}/terminals/{wid}", timeout=10).json()
    print(f"  worker={wid} provider={worker.get('provider')} caller_id={detail.get('caller_id')}")
    if detail.get("caller_id") != sup:
        fail(f"worker caller_id expected {sup}, got {detail.get('caller_id')}")
    print("PASS 3: codex worker created by assign, caller linked")

    # 4. worker completes, callback returns to supervisor
    if not wait_status(wid, {"completed", "idle"}, 420, "worker"):
        fail("worker did not complete within 420s")
    print("PASS 4a: worker finished its task")

    def dump_inbox(tid, label):
        try:
            r = requests.get(f"{BASE}/terminals/{tid}/inbox/messages", timeout=10)
            rows = r.json() if r.status_code == 200 else r.text[:200]
            print(f"  [inbox:{label}]", rows if isinstance(rows, str) else [
                {k: m.get(k) for k in ("sender_id", "status", "orchestration_type")} for m in rows
            ])
        except Exception as exc:  # forensics only — never abort on this
            print(f"  [inbox:{label}] dump failed: {exc}")

    def dump_output(tid, label):
        try:
            r = requests.get(f"{BASE}/terminals/{tid}/output", params={"mode": "last"}, timeout=30)
            out = (r.json().get("output") or "") if r.status_code == 200 else r.text[:200]
            print(f"  [output:{label}]", " ".join(str(out).split())[:400])
        except Exception as exc:
            print(f"  [output:{label}] dump failed: {exc}")

    # inbox delivery → supervisor processes the reply → idle/completed again
    deadline = time.time() + 300
    saw_processing = False
    final = None
    while time.time() < deadline:
        s = get_status(sup)
        if s == "processing":
            saw_processing = True
        if saw_processing and s in ("idle", "completed"):
            final = s
            break
        time.sleep(4)
    if final is None:
        print("--- forensics (callback missing) ---")
        dump_inbox(sup, "supervisor")
        dump_output(wid, "worker")
        dump_output(sup, "supervisor")
        fail("supervisor never processed the inbox callback (no processing→idle cycle)")
    print(f"PASS 4b: inbox callback delivered; supervisor processed reply (final={final})")
    dump_inbox(sup, "supervisor")

    # 5. supervisor's answer states the mean
    r = requests.get(f"{BASE}/terminals/{sup}/output", params={"mode": "last"}, timeout=30)
    out = (r.json().get("output") or "") if r.status_code == 200 else ""
    print("  supervisor last message snippet:", " ".join(out.split())[:300])
    if "5" not in out:
        fail("supervisor's final message does not state the mean (5)")
    print("PASS 5: supervisor reported the worker's result")
finally:
    # 6. cleanup — delete the whole session (kills both terminals)
    r = requests.delete(f"{BASE}/sessions/{sess}", timeout=60)
    print(f"cleanup: DELETE /sessions/{sess} -> {r.status_code}")

print("ALL PASS: claude_code supervisor → codex worker full loop verified")
