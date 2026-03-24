# Smoke Test: Foundation Chat Streaming

## Goal
Validate minimal end-to-end behavior:
1. command path works
2. stream events are emitted
3. correlation id is preserved
4. frontend indicates runtime mode

## Automated (Rust side)
Run:
- `./scripts/smoke-chat-foundation.sh`

Checks performed:
- `cargo check`
- `cargo check --features tauri-runtime`
- `cargo run --quiet` contains:
  - `chat.stream.start`
  - `chat.stream.chunk`
  - `chat.stream.complete`
  - `corr=demo-001`
- conversation log contains both roles:
  - `"role":"user"`
  - `"role":"assistant"`

## Manual (UI side)
1. Start frontend:
- `cd frontend && npm install && npm run dev`

2. Start Tauri app (separate terminal):
- `cd src-tauri && cargo run --features tauri-runtime`

3. In UI:
- Verify badge shows `runtime: tauri`.
- Send message.
- Confirm assistant text appears incrementally.
- Confirm event panel shows streaming actions with same correlation id.

4. Browser-only fallback check:
- Run only frontend dev server in browser.
- Verify badge shows `runtime: mock`.
- Send message and confirm simulated streaming still works.
