# App Foundation

This directory contains a clean architecture foundation for the new desktop AI app.

## Structure
- `docs/ARCHITECTURE.md`: strict layering and boundary rules.
- `docs/GUARDRAILS.md`: implementation and safety guardrails.
- `docs/AI_WORK_COMPLIANCE_CHECKLIST.md`: required checklist for future AI-assisted changes.
- `docs/IPC_EVENTS.md`: command/event contracts for streaming chat.
- `docs/CONTRACT_VERSION.md`: pinned contract version and compatibility rules.
- `docs/SMOKE_TEST.md`: automated and manual smoke-test flow.
- `docs/TAURI_INTEGRATION.md`: Tauri runtime bridge setup notes.
- `src-tauri/`: Rust foundation for IPC -> service -> registry -> tools + memory.
- `frontend/`: Plain TypeScript + custom CSS chat shell with troubleshooting event console.

## Why this foundation exists
- No direct reuse of prior failed code paths.
- Explicit subsystem ownership.
- Strong event instrumentation for troubleshooting.
- Minimal dependency baseline.

## Current vertical slice
- Frontend chat shell emits typed request.
- Frontend hydrates persisted messages via typed history request.
- IPC handler forwards request to service.
- Service invokes tool only through registry.
- Structured events emitted through all stages.
- Streaming actions emitted: `chat.stream.start/chunk/complete`.
- UI runtime badge shows active IPC mode: `tauri` or `mock`.
- Conversation messages persist to JSONL via isolated persistence repository.

## Validation performed
- `cargo check` passes in `src-tauri`.
- `cargo check --features tauri-runtime` passes in `src-tauri`.
- `./scripts/smoke-chat-foundation.sh` validates stream trace markers in demo mode.

## Run Full UI
- `./scripts/start-full-ui.sh` starts frontend (`frontend`) + desktop runtime (`src-tauri`) together.

## Icon Allowlist Sync
- Add new icon imports in `frontend/src/icons/index.ts`.
- Run `npm run icons:sync-ignore` from `frontend/` to refresh the `.gitignore` icon allowlist.

## Next implementation order
1. Expand registry with isolated tools one-by-one.
2. Integrate memory extraction/retrieval through dedicated memory service.
3. Replace demo tokenization with real model stream source.
4. Add minimal UI E2E smoke in CI for `runtime: tauri` mode.
5. Add storage migration path from JSONL to SQLite-backed repository.
