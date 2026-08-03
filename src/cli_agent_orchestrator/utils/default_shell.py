"""Operator-chosen login shell for newly created terminal windows.

The desktop shell (Phase 7, ``docs/electron-plan.md`` §4) lets the user pick
which shell their agent terminals run in and passes that choice to the server as
``CAO_DEFAULT_SHELL``. tmux otherwise inherits ``default-shell`` from whatever
environment the *server* was started in, which on WSL and on GUI-launched macOS
apps is frequently not the shell the user configured — so ``uv``/``nvm``/
``pyenv`` PATH entries from their rc files are missing and CLI launches fail in
ways that look like the CLI is not installed.

Nothing here changes behaviour unless the variable is set: an unset, empty or
unusable value leaves tmux exactly as it was.
"""

from __future__ import annotations

import logging
import os
import shlex
from pathlib import Path

logger = logging.getLogger(__name__)

ENV_VAR = "CAO_DEFAULT_SHELL"


def resolve_default_window_shell() -> str | None:
    """Return the shell command new windows should run, or ``None``.

    ``None`` means "no opinion" — the caller must then let tmux pick, rather
    than substituting a guess. A configured-but-unusable value is reported and
    ignored for the same reason: an agent terminal that silently runs a
    different shell than the one on screen is worse than one that runs the
    default.

    Returns:
        ``exec <shell> -l`` for a usable absolute path to an executable file,
        else ``None``. The login flag is what makes the user's rc files (and
        therefore their PATH) apply.
    """
    raw = os.environ.get(ENV_VAR, "").strip()
    if not raw:
        return None

    path = Path(raw)
    if not path.is_absolute():
        logger.warning("%s=%r ignored: not an absolute path", ENV_VAR, raw)
        return None
    if not path.is_file():
        logger.warning("%s=%r ignored: no such file", ENV_VAR, raw)
        return None
    if not os.access(path, os.X_OK):
        logger.warning("%s=%r ignored: not executable", ENV_VAR, raw)
        return None

    return f"exec {shlex.quote(str(path))} -l"
