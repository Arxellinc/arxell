# Pi Coding Harness

Implementation status: complete in Arxell `0.2.11`. Credentialed model runs and interactive platform checks remain part of release acceptance.

Arxell uses the [Pi coding harness](https://pi.dev/) in two modes:

- **Pi workspace tool:** interactive TUI sessions run in Arxell terminals and use the user's normal Pi profile.
- **Looper and approved chat delegation:** isolated, ephemeral `pi --mode rpc` processes run from Rust and complete only after `agent_settled`, provided the final model response succeeded. Failed, aborted, truncated, or retry-exhausted responses fail the phase rather than advancing Looper. Successful automatic retries recover earlier model errors; policy/extension errors remain failures.

## Supported Runtime

Arxell uses an installed Pi runtime without a hard-coded semantic-version ceiling. A candidate must return a parseable version from `pi --version`; Arxell then launches it and reports actual launch/RPC failures rather than telling users to replace an otherwise detected version. This is intentionally version-agnostic, not a guarantee that every future Pi protocol change will work. Pi `0.84.2` and `0.99.1` were manually verified to start in RPC mode, load the bundled policy extension, and answer `get_state`; the `0.99.1` check used a disposable npm installation. This is a startup/protocol smoke test, not a credentialed inference test.

Arxell checks an explicit path, `ARXELL_PI_EXECUTABLE`, `PATH`, standard npm/pnpm/Yarn/Bun locations, and finally its private managed-runtime location. If no Pi is found and Node.js `>=22.19.0`/npm are available (and Bash is present on Windows), opening the Pi workspace automatically installs the current package into its private `~/.arxell/pi-runtime` directory without lifecycle scripts. This leaves a user's global Pi installation untouched. The equivalent manual commands are:

```sh
# macOS/Linux
npm install --prefix "$HOME/.arxell/pi-runtime" --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent

# Windows Command Prompt
npm install --prefix "%USERPROFILE%\.arxell\pi-runtime" --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent
```

If automatic installation cannot run or fails, the setup dialog explains the missing prerequisite and permits retry/recheck. The current Pi package requires Node.js `>=22.19.0`; on Windows, install Git for Windows because Pi requires Bash. Set `PI_SHELL_PATH` when Bash is installed in a nonstandard location.

## Authentication And Models

Interactive Pi sessions use Pi's normal authentication and model selection. Automated Looper runs use the model selected in Arxell. Arxell retrieves API credentials in Rust at process startup and passes them only through the child-process environment; generated Pi model metadata references the environment variable and never contains the raw key.

Local models use Arxell's OpenAI-compatible local endpoint when a `local:` model is selected.

## Sessions

Interactive sessions remain user controlled and may use Pi's normal persisted session behavior. Each workspace tab owns an independent PTY session and can use its own working directory and initial prompt.

Automated RPC sessions are ephemeral (`--no-session`) and do not write Pi conversation files. Arxell persists only bounded Looper state and safe run metadata, including provider/model identifiers and aggregate token usage.

## Trust, Policy, And Privacy

Automated runs:

- disable Pi install telemetry and version checks;
- disable automatic extension discovery;
- load only Arxell's bundled policy extension;
- canonicalize the approved project directory;
- constrain standard file tools to that directory;
- block sensitive paths such as `.git`, `.pi`, `.ssh`, environment files, credentials, and private keys;
- require approval for recognizable destructive commands through an Arxell modal and fail closed when approval is denied, unavailable, mismatched, or expired;
- preserve request and correlation IDs across the approval response;
- omit commands, tool arguments, raw tool output, stderr, secrets, and complete file contents from policy and progress events.

The policy extension is defense in depth, not an operating-system sandbox. Pi runs with the permissions of the Arxell process.

## Overrides And Diagnostics

- `ARXELL_PI_EXECUTABLE`: explicit Pi executable or wrapper.
- `PI_SHELL_PATH`: explicit Bash executable, primarily for Windows.
- `PI_TELEMETRY=0` and `PI_SKIP_VERSION_CHECK=1` are set by Arxell-launched processes.

Runtime errors distinguish missing Pi, invalid executable paths, missing Node/npm, and missing Windows Bash. Pi versions are not rejected solely for being newer or older than a pinned range. Use the setup dialog's recheck action after correcting the reported issue. Looper uses the same version-agnostic readiness result.

## Distribution And Licensing

Pi is not bundled in Arxell `0.2.11`; an existing system package is preferred, and the Pi workspace can install a private copy under `~/.arxell/pi-runtime` when none is found. Arxell bundles its own policy extension and Pi's required MIT attribution in `THIRD_PARTY_NOTICES.md`. Runtime behavior should be revalidated when Pi changes its RPC or extension APIs.
