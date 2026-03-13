# Coder Hybrid Runtime (Bundled + Source-Pinned)

This project uses a hybrid model for the pi coding agent:

- Build pi from pinned source in CI (supply chain control).
- Bundle the built binary with the app per platform (runtime reliability).
- Keep a user override path (`coder_pi_executable`) as a fallback.

## Isolation Design

Coder execution is isolated from the general terminal path:

- Dedicated backend runner: `src-tauri/src/commands/coder_runtime.rs`
- No shell interpolation for coder prompt/version calls.
- Runs as a separate child process with explicit args.
- Applies project root guard and mode checks via tool gateway.

## Runtime Resolution Order

1. `coder_pi_executable` setting (if set)
2. Bundled binary candidate for current OS/arch
3. `pi` from PATH

## Preflight Diagnostics

Before launching the Coder panel, run:

```bash
npm run diagnose:pi
```

This verifies:

- expected bundled path for current OS/arch
- file existence and executable bit
- `pi` availability on PATH and `pi --version`
- global npm install status for `@mariozechner/pi-coding-agent`

If it fails, the app will report `pi missing` until one of these is true:

- bundled binary exists and is executable for your platform
- `pi` is installed and reachable on PATH

For release safety (prevent shipping broken builds), require bundled binary:

```bash
npm run verify:pi:bundle
```

Recommended release command:

```bash
npm run tauri:build:safe
```

This hard-fails when bundled `pi` is missing/non-executable for the current build platform.

## Expected Bundled Resource Layout

Place platform binaries under Tauri resources:

- `coder/linux-x86_64/pi`
- `coder/linux-aarch64/pi`
- `coder/macos-x86_64/pi`
- `coder/macos-aarch64/pi`
- `coder/windows-x86_64/pi.exe`

## Guardrails

- Sandbox mode requires non-empty project root guard.
- Root mode requires explicit confirmation.
- Agent-side `coder_run` also respects persisted coder guard settings:
  - `coder_mode`
  - `coder_path_guard_enabled`
  - `coder_command_guard_enabled`
