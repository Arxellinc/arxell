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

## Manual (TTS engine reset behavior)
1. Open the `TTS` panel.
2. Set non-empty paths/voice/speed on one engine (for example `Kokoro`).
3. Switch engine to `Piper`, then `Matcha`, then back to `Kokoro`.
4. Verify after each switch:
- stale model/secondary/tokens/data fields from prior engine are cleared
- voice/speed defaults are reset for the selected engine
- only engine-relevant secondary path row is visible:
  - `Kokoro`/`Kitten`: voices path
  - `Matcha`: vocoder path
  - `Piper`: no secondary-path row
