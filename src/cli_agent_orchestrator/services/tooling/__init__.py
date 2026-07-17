"""Tooling services.

Phase 3a backs the "Tools & Extensions" screen with purely read-only data
collection: environment detection, CLI provider version probing, CAO-owned
extension listing, and diagnostics. Phase 4a adds the *write path* — planning,
executing, and verifying install/remove/update actions — as strictly additive
modules alongside the read-only ones.

Read-only modules (Phase 3a):
    probe        -- tiny argv-only subprocess runner (shell disabled, bounded).
    cache        -- module-level TTL cache + forced rescan.
    environment  -- OS / arch / shell / WSL / versions.
    providers    -- CLI provider install status + version probe.
    extensions   -- CAO-owned skills, plugins, and agent profiles.
    diagnostics  -- derived warnings/info from the collectors above.

Write-path modules (Phase 4a):
    secret_mask  -- redact credential shapes from command output.
    runner       -- safe-by-construction async command runner (allowlist + argv).
    operations   -- in-memory async operation manager (concurrency + verify).
    adapters     -- provider adapters (plan/capabilities/verify); generic skills.
"""
