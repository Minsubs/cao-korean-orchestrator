"""Integration tests for GET /fs/list (read-only, home-confined directory scan).

Exercises the real filesystem against a temporary ``$HOME`` (no mocking): happy
path with project markers, hidden-entry exclusion, and the confinement rules
(``..`` traversal, absolute path outside home, and a symlink whose target
escapes home all return 403). Also file/missing status codes.
"""

from pathlib import Path

import pytest


@pytest.fixture
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point ``$HOME`` at a temp dir and build a small project tree under it.

    ``Path.home()`` and ``~`` expansion both resolve via ``$HOME`` on POSIX, so
    setting it fully controls the endpoint's confinement root and path
    expansion — the real code runs against a real, disposable tree.
    """

    monkeypatch.setenv("HOME", str(tmp_path))
    work = tmp_path / "work"
    (work / "proj_py").mkdir(parents=True)
    (work / "proj_py" / "pyproject.toml").write_text("[project]\n")
    (work / "proj_git").mkdir()
    (work / "proj_git" / ".git").mkdir()  # marker directory
    (work / "plain").mkdir()
    (work / ".hidden_dir").mkdir()
    (work / "notes.txt").write_text("hello")
    return tmp_path


class TestHappyPath:
    def test_lists_entries_with_markers(self, client, home: Path) -> None:
        resp = client.get("/fs/list", params={"path": "~/work"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["path"] == str((home / "work").resolve())

        by_name = {e["name"]: e for e in body["entries"]}
        # Hidden entries are excluded from the listing.
        assert ".hidden_dir" not in by_name
        # Sorted, non-hidden entries only.
        assert [e["name"] for e in body["entries"]] == [
            "notes.txt",
            "plain",
            "proj_git",
            "proj_py",
        ]

        assert by_name["notes.txt"]["is_dir"] is False
        assert by_name["notes.txt"]["markers"] == []
        assert by_name["plain"]["is_dir"] is True
        assert by_name["plain"]["markers"] == []
        assert by_name["proj_py"]["markers"] == ["pyproject.toml"]
        # .git is detected as a marker even though it is a hidden entry.
        assert by_name["proj_git"]["markers"] == [".git"]

    def test_tilde_expands_to_home(self, client, home: Path) -> None:
        resp = client.get("/fs/list", params={"path": "~"})
        assert resp.status_code == 200
        assert resp.json()["path"] == str(home.resolve())
        # "work" is the only non-hidden entry directly under home.
        assert [e["name"] for e in resp.json()["entries"]] == ["work"]


class TestConfinement:
    def test_parent_traversal_is_rejected(self, client, home: Path) -> None:
        resp = client.get("/fs/list", params={"path": "~/.."})
        assert resp.status_code == 403

    def test_absolute_path_outside_home_is_rejected(self, client, home: Path) -> None:
        resp = client.get("/fs/list", params={"path": "/etc"})
        assert resp.status_code == 403

    def test_symlink_escaping_home_is_rejected(self, client, home: Path) -> None:
        # A symlink inside home whose target is outside home must be rejected:
        # realpath normalization follows the link before the confinement check.
        outside = home.parent / "outside_target"
        outside.mkdir(exist_ok=True)
        link = home / "work" / "escape"
        link.symlink_to(outside)

        resp = client.get("/fs/list", params={"path": "~/work/escape"})
        assert resp.status_code == 403


class TestStatusCodes:
    def test_file_is_bad_request(self, client, home: Path) -> None:
        resp = client.get("/fs/list", params={"path": "~/work/notes.txt"})
        assert resp.status_code == 400

    def test_missing_path_is_not_found(self, client, home: Path) -> None:
        resp = client.get("/fs/list", params={"path": "~/work/does_not_exist"})
        assert resp.status_code == 404

    def test_missing_query_param_is_unprocessable(self, client, home: Path) -> None:
        resp = client.get("/fs/list")
        assert resp.status_code == 422
