# arx_rs

Rust port of the minimal Python coding agent in `py/`, designed for embedding into Tauri.

## What is implemented

- Core agent loop with multi-turn tool-use flow
- Streaming event model (`Event`) for UI rendering
- Session persistence (append-only JSONL) with compaction support
- Context loading (`AGENTS.md`/`CLAUDE.md`, skills discovery)
- Tooling: `read`, `edit`, `write`, `ls`, `mkdir`, `move`, `chmod`, `bash`, `grep`, `find`
- Provider abstraction with:
  - `MockProvider` (tests/dev)
  - `OpenAiCompatibleProvider` (chat-completions SSE; provider-agnostic)

## Minimal dependency approach

- Native Rust search for `find`/`grep` via `ignore` + `globset` + `regex`
- No external binary bootstrap (`fd`/`rg`) required
- Async runtime: `tokio`
- Serialization/config: `serde`, `serde_json`, `toml`

## Command model

- General execution remains in `bash` (e.g. `cargo`, `make`, `cmake`, `ctest`, `g++`, `curl`, `ps`, `pkill`, `sleep`, `which`, `head`, `tail`, `cat`, `sed`, `echo`, `npm`, etc.)
- Structured filesystem operations use dedicated tools (`ls`, `mkdir`, `move`, `chmod`) for clearer, safer actions.

## Run

```bash
cd rs
cargo run --bin arx-rs
```

Default endpoint is `http://127.0.0.1:8765` and the runtime targets any OpenAI-compatible chat completions API.

## Test

```bash
cd rs
cargo test
```

## Tauri embedding

Use the library API directly from a Tauri command handler:

```rust
use arx_rs::{Agent, AgentConfig, Session};
use arx_rs::provider::openai_compatible::OpenAiCompatibleProvider;
use arx_rs::provider::ProviderConfig;

let provider = OpenAiCompatibleProvider::new(ProviderConfig {
    api_key: std::env::var("OPENAI_API_KEY").ok(), // optional for local endpoints
    base_url: Some("http://127.0.0.1:8765".into()),
    model: "gpt-4.1".into(),
    max_tokens: 8192,
    temperature: None,
    thinking_level: "medium".into(),
    provider: Some("openai-compatible".into()),
});

let session = Session::in_memory(cwd, Some("openai-compatible".into()), Some("gpt-4.1".into()), "medium".into());
let mut agent = Agent::new(Box::new(provider), arx_rs::tools::default_tools(), session, AgentConfig::default(), None)?;
let events = agent.run_collect(prompt, None, None).await;
```

`events` is your UI contract for a Tauri frontend.

## Conversion plan (implemented)

1. Port shared contracts (`types`, `events`, `config`, `context`)
2. Port persistence (`session`) and compaction logic
3. Port tooling in native Rust
4. Add provider abstraction + mock + OpenAI-compatible implementation
5. Port turn executor and top-level agent loop
6. Add runnable binary and tests for baseline verification
