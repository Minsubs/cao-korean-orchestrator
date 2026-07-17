"""Tests for the self-contained env-migration router (Phase 6b).

Mirrors ``test/api/test_ui_features_router.py`` and ``test/tooling/test_router.py``:
mounts ONLY ``env_router`` on a throwaway FastAPI app (never imports
``api/main.py``). ``$HOME`` is redirected to a ``tmp_path`` so every scan / write
is hermetic and home-confined.

Coverage: inventory (existing-only, present flag, kind classification, no
content), the instruction matrix (global + project, sha256/headline, per-item
out-of-home error), convert (agent->profile mapping + lossy, command<->prompt,
instruction, path vs content input, out-of-home 400, secret masking), the write
path (create / 409 / overwrite+backup / size cap / out-of-home / filename
allow-list), and a standalone scope-gate guard over the mutating routes.
"""

import hashlib
import json
from pathlib import Path

import frontmatter
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cli_agent_orchestrator.api import env_router


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(env_router.router)
    return TestClient(app)


@pytest.fixture
def fake_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    return home


def _write(path: Path, content: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# --- 1: inventory ---------------------------------------------------------


def test_inventory_unsupported_cli_400(client: TestClient, fake_home: Path) -> None:
    resp = client.get("/env/inventory", params={"cli": "bogus"})
    assert resp.status_code == 400


def test_inventory_absent_cli_reports_present_false(client: TestClient, fake_home: Path) -> None:
    # Empty home: no ~/.claude, ~/.codex, ~/.gemini.
    resp = client.get("/env/inventory", params={"cli": "claude_code"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["cli"] == "claude_code"
    assert body["present"] is False
    assert body["items"] == []
    assert body["counts"]["total"] == 0


def test_inventory_reports_existing_only_and_classifies_kinds(
    client: TestClient, fake_home: Path
) -> None:
    _write(fake_home / ".claude" / "CLAUDE.md", "# global rules\n")
    _write(fake_home / ".claude" / "settings.json", "{}\n")
    _write(fake_home / ".claude" / "commands" / "deploy.md", "deploy\n")
    _write(fake_home / ".claude" / "skills" / "myskill" / "SKILL.md", "skill\n")
    _write(fake_home / ".claude" / "agents" / "reviewer.md", "agent\n")

    resp = client.get("/env/inventory", params={"cli": "claude_code"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["present"] is True
    kinds = {item["rel_path"]: item["kind"] for item in body["items"]}
    assert kinds[".claude/CLAUDE.md"] == "instruction"
    assert kinds[".claude/settings.json"] == "settings"
    assert kinds[".claude/commands/deploy.md"] == "command"
    assert kinds[".claude/skills/myskill/SKILL.md"] == "skill"
    assert kinds[".claude/agents/reviewer.md"] == "agent"
    # A path that does not exist is never fabricated.
    assert all("nonexistent" not in item["rel_path"] for item in body["items"])
    assert body["counts"]["command"] == 1
    assert body["counts"]["skill"] == 1


def test_inventory_items_carry_metadata_not_content(client: TestClient, fake_home: Path) -> None:
    secret_body = "# rules\nthis is the FILE BODY that must never appear\n"
    _write(fake_home / ".claude" / "CLAUDE.md", secret_body)

    resp = client.get("/env/inventory", params={"cli": "claude_code"})
    assert resp.status_code == 200
    # No file content leaks into the metadata listing.
    assert "FILE BODY" not in resp.text
    item = next(i for i in resp.json()["items"] if i["rel_path"] == ".claude/CLAUDE.md")
    assert set(item) == {"rel_path", "kind", "size", "mtime"}
    assert item["size"] == len(secret_body.encode("utf-8"))
    assert isinstance(item["mtime"], str)


def test_inventory_claude_json_reports_mcp_key_presence_only(
    client: TestClient, fake_home: Path
) -> None:
    _write(
        fake_home / ".claude.json",
        json.dumps({"mcpServers": {"cao": {"command": "x", "env": {"TOKEN": "sk-secret123"}}}}),
    )
    resp = client.get("/env/inventory", params={"cli": "claude_code"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["present"] is True  # ~/.claude.json alone marks the env present
    mcp = next(i for i in body["items"] if i["kind"] == "mcp_config")
    assert mcp["rel_path"] == ".claude.json"
    assert mcp["mcp_servers_present"] is True
    # The mcpServers *content* (and any secret inside) is never returned.
    assert "sk-secret123" not in resp.text


def test_inventory_codex_kinds(client: TestClient, fake_home: Path) -> None:
    _write(fake_home / ".codex" / "config.toml", "model='x'\n")
    _write(fake_home / ".codex" / "AGENTS.md", "# agents\n")
    _write(fake_home / ".codex" / "prompts" / "summarize.md", "summarize\n")
    body = client.get("/env/inventory", params={"cli": "codex"}).json()
    assert body["present"] is True
    kinds = {i["rel_path"]: i["kind"] for i in body["items"]}
    assert kinds[".codex/config.toml"] == "settings"
    assert kinds[".codex/AGENTS.md"] == "instruction"
    assert kinds[".codex/prompts/summarize.md"] == "prompt"


def test_inventory_antigravity_verified_mcp_path_and_note(
    client: TestClient, fake_home: Path
) -> None:
    _write(
        fake_home / ".gemini" / "config" / "mcp_config.json",
        json.dumps({"mcpServers": {}}),
    )
    body = client.get("/env/inventory", params={"cli": "antigravity"}).json()
    assert body["present"] is True
    assert body["note"]  # explains the verified-path-only scope
    mcp = next(i for i in body["items"] if i["kind"] == "mcp_config")
    assert mcp["rel_path"] == ".gemini/config/mcp_config.json"


def test_inventory_all_returns_every_cli(client: TestClient, fake_home: Path) -> None:
    body = client.get("/env/inventory", params={"cli": "all"}).json()
    clis = {entry["cli"] for entry in body["clis"]}
    assert clis == {"claude_code", "codex", "antigravity"}


# --- 2: instruction matrix ------------------------------------------------


def test_instructions_global_matrix_reports_existence(client: TestClient, fake_home: Path) -> None:
    _write(fake_home / ".claude" / "CLAUDE.md", "# global\n")
    body = client.get("/env/instructions").json()
    global_entry = next(e for e in body["entries"] if e["scope"] == "global")
    by_name = {f["name"]: f for f in global_entry["files"]}
    assert by_name[".claude/CLAUDE.md"]["exists"] is True
    assert by_name[".codex/AGENTS.md"]["exists"] is False


def test_instructions_project_matrix_sha256_and_headline(
    client: TestClient, fake_home: Path
) -> None:
    project = fake_home / "proj"
    content = "# Project Rules\nDetails follow here\n"
    _write(project / "CLAUDE.md", content)
    _write(project / ".claude" / "commands" / "a.md", "a\n")
    _write(project / ".claude" / "commands" / "b.md", "b\n")

    body = client.get("/env/instructions", params={"paths": str(project)}).json()
    project_entry = next(e for e in body["entries"] if e.get("base_path", "").endswith("proj"))
    by_name = {f["name"]: f for f in project_entry["files"]}

    claude_md = by_name["CLAUDE.md"]
    assert claude_md["exists"] is True
    assert claude_md["sha256"] == hashlib.sha256(content.encode("utf-8")).hexdigest()
    assert claude_md["headline"] == "# Project Rules"
    assert by_name["AGENTS.md"]["exists"] is False
    commands = by_name[".claude/commands"]
    assert commands["exists"] is True
    assert commands["command_count"] == 2


def test_instructions_headline_is_secret_masked(client: TestClient, fake_home: Path) -> None:
    project = fake_home / "proj"
    _write(project / "CLAUDE.md", "authorization: Bearer sk-supersecretvalue\nmore\n")
    body = client.get("/env/instructions", params={"paths": str(project)}).json()
    project_entry = next(e for e in body["entries"] if e.get("base_path", "").endswith("proj"))
    claude_md = next(f for f in project_entry["files"] if f["name"] == "CLAUDE.md")
    assert "sk-supersecretvalue" not in claude_md["headline"]
    assert "***" in claude_md["headline"]


def test_instructions_out_of_home_path_is_per_item_error(
    client: TestClient, fake_home: Path
) -> None:
    body = client.get("/env/instructions", params={"paths": "/etc"}).json()
    # The request as a whole is fine (200); only the offending entry carries error.
    entry = next(e for e in body["entries"] if e["scope"] == "project")
    assert "error" in entry
    assert "files" not in entry
    # The global entry is still present and healthy.
    assert any(e["scope"] == "global" for e in body["entries"])


# --- 3: convert (preview) -------------------------------------------------


def test_convert_claude_agent_to_cao_profile_maps_fields_and_lossy(
    client: TestClient, fake_home: Path
) -> None:
    agent_md = (
        "---\n"
        "name: my-reviewer\n"
        "description: Reviews code carefully\n"
        "tools: Read, Grep, Bash, TodoWrite\n"
        "model: opus\n"
        "color: blue\n"
        "---\n"
        "You are a code reviewer. Be thorough.\n"
    )
    resp = client.post(
        "/env/convert",
        json={"source_kind": "claude_agent", "target_kind": "cao_profile", "content": agent_md},
    )
    assert resp.status_code == 200
    body = resp.json()
    post = frontmatter.loads(body["converted"])
    assert post["name"] == "my-reviewer"
    assert post["description"] == "Reviews code carefully"
    assert post["provider"] == "claude_code"
    assert post["model"] == "opus"
    # Read->fs_read, Grep->fs_list, Bash->execute_bash (in source order); TodoWrite unmapped.
    assert post["allowedTools"] == ["fs_read", "fs_list", "execute_bash"]
    assert "code reviewer" in post.content
    # TodoWrite and the dropped `color` key are both reported lossy.
    assert any("TodoWrite" in f for f in body["lossy_fields"])
    assert any("color" in f for f in body["lossy_fields"])
    # cao-mcp-server guidance is a warning, and the block is NOT auto-added.
    assert any("cao-mcp-server" in w for w in body["warnings"])
    assert "mcpServers" not in body["converted"]


def test_convert_agent_without_tools_widens_to_star(client: TestClient, fake_home: Path) -> None:
    agent_md = "---\nname: a\ndescription: d\n---\nbody\n"
    body = client.post(
        "/env/convert",
        json={"source_kind": "claude_agent", "target_kind": "cao_profile", "content": agent_md},
    ).json()
    post = frontmatter.loads(body["converted"])
    assert post["allowedTools"] == ["*"]
    assert any("*" in w for w in body["warnings"])


def test_convert_command_to_prompt_preserves_description_and_body(
    client: TestClient, fake_home: Path
) -> None:
    command_md = "---\ndescription: Deploy the app\n---\nRun the deploy steps.\n"
    body = client.post(
        "/env/convert",
        json={
            "source_kind": "claude_command",
            "target_kind": "codex_prompt",
            "content": command_md,
        },
    ).json()
    post = frontmatter.loads(body["converted"])
    assert post["description"] == "Deploy the app"
    assert "Run the deploy steps." in post.content
    # A plain description+body command converts with no loss and no warnings.
    assert body["warnings"] == []
    assert body["lossy_fields"] == []


def test_convert_command_extra_frontmatter_is_lossy(client: TestClient, fake_home: Path) -> None:
    command_md = "---\ndescription: d\nargument-hint: <path>\nallowed-tools: Bash\n---\nbody\n"
    body = client.post(
        "/env/convert",
        json={
            "source_kind": "claude_command",
            "target_kind": "codex_prompt",
            "content": command_md,
        },
    ).json()
    assert any("argument-hint" in f for f in body["lossy_fields"])
    assert any("allowed-tools" in f for f in body["lossy_fields"])


def test_convert_prompt_to_command_direction(client: TestClient, fake_home: Path) -> None:
    prompt_md = "Summarize the current diff.\n"
    body = client.post(
        "/env/convert",
        json={
            "source_kind": "codex_prompt",
            "target_kind": "claude_command",
            "content": prompt_md,
        },
    ).json()
    assert "Summarize the current diff." in body["converted"]
    assert body["lossy_fields"] == []


def test_convert_instruction_from_path_derives_counterpart(
    client: TestClient, fake_home: Path
) -> None:
    project = fake_home / "proj"
    _write(project / "CLAUDE.md", "# Rules\nBe kind.\n")
    body = client.post(
        "/env/convert",
        json={
            "source_kind": "instruction",
            "target_kind": "counterpart_instruction",
            "path": str(project / "CLAUDE.md"),
        },
    ).json()
    assert "CLAUDE.md" in body["converted"]  # provenance header names the source
    assert "Be kind." in body["converted"]  # body copied verbatim
    assert any("AGENTS.md" in w for w in body["warnings"])  # counterpart hinted


def test_convert_instruction_from_content(client: TestClient, fake_home: Path) -> None:
    body = client.post(
        "/env/convert",
        json={
            "source_kind": "instruction",
            "target_kind": "counterpart_instruction",
            "content": "# Generic\nhello\n",
        },
    ).json()
    assert "hello" in body["converted"]
    assert body["warnings"]  # honesty note present


def test_convert_masks_secrets_in_output(client: TestClient, fake_home: Path) -> None:
    body = client.post(
        "/env/convert",
        json={
            "source_kind": "codex_prompt",
            "target_kind": "claude_command",
            "content": "Deploy with token: ghp_ABC123SECRETVALUE now.\n",
        },
    ).json()
    assert "ghp_ABC123SECRETVALUE" not in body["converted"]
    assert "***" in body["converted"]


def test_convert_out_of_home_path_400(client: TestClient, fake_home: Path) -> None:
    resp = client.post(
        "/env/convert",
        json={
            "source_kind": "instruction",
            "target_kind": "counterpart_instruction",
            "path": "/etc/hosts",
        },
    )
    assert resp.status_code == 400


def test_convert_missing_input_400(client: TestClient, fake_home: Path) -> None:
    resp = client.post(
        "/env/convert",
        json={"source_kind": "instruction", "target_kind": "counterpart_instruction"},
    )
    assert resp.status_code == 400


def test_convert_unsupported_pair_400(client: TestClient, fake_home: Path) -> None:
    resp = client.post(
        "/env/convert",
        json={"source_kind": "claude_agent", "target_kind": "codex_prompt", "content": "x"},
    )
    assert resp.status_code == 400


# --- 4: instruction write (the only mutation) -----------------------------


def test_write_creates_new_file(client: TestClient, fake_home: Path) -> None:
    target = fake_home / "proj" / "CLAUDE.md"
    resp = client.post(
        "/env/instructions/write",
        json={"path": str(target), "content": "# hello\n"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] is True
    assert body["backup_path"] is None
    assert target.read_text(encoding="utf-8") == "# hello\n"


def test_write_conflict_without_overwrite_409(client: TestClient, fake_home: Path) -> None:
    target = fake_home / "proj" / "AGENTS.md"
    _write(target, "old\n")
    resp = client.post(
        "/env/instructions/write",
        json={"path": str(target), "content": "new\n", "overwrite": False},
    )
    assert resp.status_code == 409
    # The existing file is untouched by a refused write.
    assert target.read_text(encoding="utf-8") == "old\n"


def test_write_overwrite_makes_backup(client: TestClient, fake_home: Path) -> None:
    target = fake_home / "proj" / "CLAUDE.md"
    _write(target, "old content\n")
    resp = client.post(
        "/env/instructions/write",
        json={"path": str(target), "content": "new content\n", "overwrite": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] is False
    assert body["backup_path"] is not None
    backup = Path(body["backup_path"])
    assert backup.exists()
    assert backup.read_text(encoding="utf-8") == "old content\n"
    assert target.read_text(encoding="utf-8") == "new content\n"
    assert backup.name.startswith("CLAUDE.md.bak.")


def test_write_content_over_cap_400(client: TestClient, fake_home: Path) -> None:
    target = fake_home / "proj" / "CLAUDE.md"
    huge = "x" * (256 * 1024 + 1)
    resp = client.post(
        "/env/instructions/write",
        json={"path": str(target), "content": huge},
    )
    assert resp.status_code == 400
    assert not target.exists()


def test_write_out_of_home_400(client: TestClient, fake_home: Path) -> None:
    resp = client.post(
        "/env/instructions/write",
        json={"path": "/tmp/evil.md", "content": "x"},
    )
    assert resp.status_code == 400


def test_write_disallowed_filename_400(client: TestClient, fake_home: Path) -> None:
    target = fake_home / "proj" / "settings.json"
    resp = client.post(
        "/env/instructions/write",
        json={"path": str(target), "content": "{}"},
    )
    assert resp.status_code == 400
    assert not target.exists()


def test_write_allows_arbitrary_md_name(client: TestClient, fake_home: Path) -> None:
    target = fake_home / "proj" / "notes.md"
    resp = client.post(
        "/env/instructions/write",
        json={"path": str(target), "content": "# notes\n"},
    )
    assert resp.status_code == 200
    assert target.exists()


def test_write_input_is_not_masked(client: TestClient, fake_home: Path) -> None:
    # The write path persists caller-owned content verbatim (masking would
    # corrupt an intentional token); masking is only applied on *reads*/convert.
    target = fake_home / "proj" / "CLAUDE.md"
    content = "token: ghp_intentionalvalue123\n"
    client.post("/env/instructions/write", json={"path": str(target), "content": content})
    assert target.read_text(encoding="utf-8") == content


# --- scope-gate guard (standalone; complements repo test_scope_coverage) --


def _has_scope_dependency(route) -> bool:
    stack = list(getattr(route.dependant, "dependencies", []))
    while stack:
        dep = stack.pop()
        call = getattr(dep, "call", None)
        if call is not None and "require_any_scope" in getattr(call, "__qualname__", ""):
            return True
        stack.extend(getattr(dep, "dependencies", []))
    return False


def test_mutating_env_routes_are_scope_gated() -> None:
    mutating = {"POST", "PUT", "PATCH", "DELETE"}
    checked = 0
    for route in env_router.router.routes:
        methods = getattr(route, "methods", None)
        if methods and (methods & mutating):
            checked += 1
            path = getattr(route, "path", "?")
            assert _has_scope_dependency(route), f"{path} missing require_any_scope"
    assert checked == 2  # /env/convert and /env/instructions/write
