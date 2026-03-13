# Agent Safeguards and Safety Model

## Safety philosophy (current implementation)
- Keep execution local-first and user-observable.
- Expose state/logging so actions are reviewable.
- Apply explicit command/path controls where risky operations occur.

## Hard/strong limits in code
- Terminal path guard (`cmd_terminal_resolve_path`, `cmd_terminal_exec` with `root_guard`).
- Terminal command blocklist UI defaults (`rm`, `rmdir`, `del` blocked by default in TerminalToolPanel).
- Archive extraction includes zip-slip mitigation in engine installer.
- Tool gateway (`cmd_tool_invoke`) enforces deny-by-default action routing for migrated tool actions.
- `code.workspace.*` gateway actions enforce mode-aware root scope checks for file read/write/list/create/delete.
- `help.workspace.*` gateway actions are restricted to paths under `help/`.

## Soft/user-configurable limits
- Terminal guard toggles (path guard and command guard).
- Per-command allow/deny toggles in terminal panel.
- Voice and prefill behavior tuning in VAD/voice settings.

## Confirmation/approval points
- Terminal blocked command/path attempts trigger in-panel modal prompt with allow/block options.
- Destructive file operations in sidebar/project flows use confirmation dialogs where implemented.

## Sandboxing and scope
- App runs as Tauri desktop app; command execution and file operations are in host context.
- Workspace scope is enforced for migrated gateway-backed actions in sandbox mode (requires `rootGuard`).
- Some legacy direct command paths remain and should continue migration into gateway policy.

## Audit trail
- Backend emits `log:*` events captured in terminal panel.
- Chat streaming, voice, diagnostics, model install/load progress emit events.
- Tool gateway emits allow/deny audit logs to backend log stream (`[tool-gateway allow]`, `[tool-gateway deny]`).
- No dedicated immutable audit export pipeline is present in source.

## Error behavior
- Many command handlers return `Result<_, String>` to frontend.
- Some failures emit event-level errors (`chat:error`, `voice:error`, `local:error`).
- No transactional rollback framework for multi-step actions.

## Permissions model and Tauri capability
- `src-tauri/capabilities/default.json` grants:
  - core defaults,
  - broad webview/window creation controls,
  - dialog/fs/shell defaults.
- CSP is `null` in `tauri.conf.json`.

## Known gaps
- Sensitive data (API keys) stored in plain SQLite settings.
- Terminal backend still executes shell command strings, but migrated terminal tool access now routes through gateway mode policy (`sandbox/shell/root`).
- Legacy direct workspace command invocation paths still exist outside migrated code/help flows.

## User guidance to minimize risk
- Keep path guard enabled.
- Keep destructive command toggles blocked unless needed.
- Use project-scoped workspaces and review agent actions/logs frequently.
- Prefer least-privilege API keys and local endpoints.
