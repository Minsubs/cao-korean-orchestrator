# Personal CAO Setup

This repository keeps the personal CAO customization used for the Hanwha and
Alarm projects. It tracks the upstream AWS Labs project separately so upstream
changes can still be fetched and reviewed.

## Included customization

- Korean web UI with user-facing `오케스트레이터` terminology
- Per-session orchestrator chat with filtered, persistent history
- In-app and browser completion, approval, and error notifications
- Live terminal-status restoration after a `cao-server` restart
- Explicit Claude Code and Codex permission policies by agent role
- Seven model-specific agent profiles under `agent-profiles/`

## Install the checkout

```bash
uv tool install --force --reinstall --refresh .
```

Install the personal agent profiles:

```bash
for profile in agent-profiles/*.md; do
  cao install "$profile"
done
```

Start the local server:

```bash
cao-server --host 127.0.0.1 --port 9889
```

Then open <http://127.0.0.1:9889/>.

## Agent roster

| Profile | Model | Responsibility |
| --- | --- | --- |
| `codex_orchestrator_sol` | Codex Sol | Orchestration and final routing |
| `claude_architect_opus` | Claude Opus | Architecture and deep diagnosis |
| `claude_developer_sonnet` | Claude Sonnet | Implementation and debugging |
| `claude_scout_haiku` | Claude Haiku | Fast read-only exploration |
| `codex_reviewer_sol` | Codex Sol | Final correctness and security review |
| `codex_qa_terra` | Codex Terra | Tests and routine verification |
| `codex_docs_luna` | Codex Luna | Documentation and handoffs |

## Sync upstream

```bash
git fetch upstream
git log --oneline --left-right HEAD...upstream/main
```

Review upstream changes before merging or rebasing because this checkout
contains provider, status-monitoring, and web UI customizations.
