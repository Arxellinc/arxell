# Developer Guide

## Dev environment setup
```bash
npm install
npm run tauri dev
```

Backend only checks:
```bash
cd src-tauri
cargo check
cargo test
```

Frontend build:
```bash
npm run build
```

## Build modes
- Dev: `npm run tauri dev`
- Prod bundle: `npm run tauri build`

## Code conventions (observed)
- Rust modules organized by function (commands/db/ai/audio/model_manager).
- Frontend uses functional React + Zustand stores + hooks.
- IPC wrappers in `src/lib/tauri.ts` plus direct invokes in some stores/components.

## Debugging
- Frontend errors: browser devtools + RootErrorBoundary UI output.
- Backend logs: `log:*` events shown in terminal panel.
- Voice diagnostics: `cmd_voice_diagnostics` and diagnostics panel.

## Add a new Tauri command
1. Implement function in `src-tauri/src/commands/<module>.rs` with `#[tauri::command]`.
2. Export module in `src-tauri/src/commands/mod.rs` if needed.
3. Register command in `src-tauri/src/lib.rs` `generate_handler![]`.
4. Add frontend `invoke` wrapper or direct call.
5. Update related types/events/docs.

## Extend agent capabilities
- Add/adjust tool-tag parsing and execution in `src/hooks/useChat.ts`.
- Add backend command(s) for new capabilities.
- Surface controls in relevant panel/store.

## Add a new theme (current state)
- No complete tokenized theming system yet.
- Start by centralizing color/spacing variables in `src/index.css` and replacing per-component hardcoded values.

## Testing
- Rust integration tests exist in `src-tauri/tests/*`.
- They emphasize model/token/context/skill behavior and voice WAV pipeline checks.
- GPU-gated tests require local model fixture and features.

## Known rough edges
- Some IPC wrappers are incomplete relative to all commands.
- Mixed direct `invoke` usage and wrapper usage.
- Broad IPC surface + state complexity can make regressions harder without stronger E2E coverage.
