# Pi Coding Harness

Arxell uses the [Pi coding harness](https://pi.dev/) in two modes:

- **Pi workspace tool:** interactive TUI sessions run in Arxell terminals and use the user's normal Pi profile.
- **Looper and approved chat delegation:** isolated, ephemeral `pi --mode rpc` processes run from Rust and complete only after `agent_settled`.

## Supported Runtime

The first public integration uses a system-installed Pi runtime. Arxell supports Pi versions `>=0.81.0` and `<0.82.0`.

Install the supported package:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.81.1
```

Arxell checks an explicit path, `ARXELL_PI_EXECUTABLE`, its managed-runtime location, `PATH`, and standard npm, pnpm, Yarn, and Bun install directories. The Pi setup dialog can recheck an explicit executable path. This avoids depending solely on the environment inherited by a graphical app bundle.

Pi requires Node.js. On Windows, install Git for Windows because Pi requires Bash. Set `PI_SHELL_PATH` when Bash is installed in a nonstandard location.

## Authentication And Models

Interactive Pi sessions use Pi's normal authentication and model selection. Automated Looper runs use the model selected in Arxell. Arxell retrieves API credentials in Rust at process startup and passes them only through the child-process environment; generated Pi model metadata references the environment variable and never contains the raw key.

Local models use Arxell's OpenAI-compatible local endpoint when a `local:` model is selected.

## Sessions

Interactive sessions remain user controlled and may use Pi's normal persisted session behavior. Automated RPC sessions are ephemeral (`--no-session`) and do not write Pi conversation files. Arxell persists only bounded Looper state and safe run metadata.

## Trust, Policy, And Privacy

Automated runs:

- disable Pi install telemetry and version checks;
- disable automatic extension discovery;
- load only Arxell's bundled policy extension;
- canonicalize the approved project directory;
- constrain standard file tools to that directory;
- block sensitive paths such as `.git`, `.pi`, `.ssh`, environment files, credentials, and private keys;
- require approval for recognizable destructive commands and fail closed when approval is unavailable or expires;
- omit tool arguments, raw tool output, stderr, secrets, and complete file contents from policy events.

The policy extension is defense in depth, not an operating-system sandbox. Pi runs with the permissions of the Arxell process.

## Overrides And Diagnostics

- `ARXELL_PI_EXECUTABLE`: explicit Pi executable or wrapper.
- `PI_SHELL_PATH`: explicit Bash executable, primarily for Windows.
- `PI_TELEMETRY=0` and `PI_SKIP_VERSION_CHECK=1` are set by Arxell-launched processes.

Runtime errors distinguish missing Pi, invalid executable paths, unsupported versions, and missing Windows Bash. Use the setup dialog's recheck action after correcting the reported issue.
