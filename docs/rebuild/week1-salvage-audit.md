# Week 1 Salvage Audit

Date: 2026-03-24  
Owner: Rebuild track

## Classification legend

- `keep`: retain with minimal changes
- `wrap`: retain behavior behind new contract adapter
- `rewrite`: reimplement under new architecture
- `delete`: remove from rebuild scope
- `unknown`: needs deeper investigation

## Subsystem inventory

| Subsystem | Current location | Classification | Platform notes | Side effects / coupling | Isolation testability | Notes |
|---|---|---|---|---|---|---|
| Chat UI | `src/components/Chat/*` | `wrap` | Needs smoke on all OSes | Coupled to current event names | Medium | Preserve UX while moving backend contracts |
| Tauri command/event surface | `src-tauri/src/commands/*` | `rewrite` | High platform impact | Wide cross-module coupling | Low | Move to typed command/event model |
| Message persistence | `src-tauri` DB commands | `wrap` | Mostly portable | Mixed app/infra concerns | Medium | Keep schema first, refactor access path |
| Model provider layer | `src-tauri/src/ai`, `model_manager` | `wrap` | GPU backend differences | Shared state and wide args | Medium | Adapter-first with contract tests |
| Streaming pipeline | `commands/chat.rs`, `ai/client.rs` | `rewrite` | Cancellation behavior differs by platform | UI+runtime coupling | Low | Rebuild around run ownership/cancellation |
| Tool registry/gateway | `commands/tool_gateway.rs` | `rewrite` | OS tool behavior differs | Policy and runtime mixed | Low | Split registry, runner, policy |
| Tool: Browser/web fetch | `commands/browser.rs` | `wrap` | Network policy differs by OS env | Proxy/safety in one module | Medium | Keep behavior; contractize inputs/outputs |
| Tool: Coder runtime | `commands/coder_runtime.rs` | `unknown` | Shell/process behavior differs significantly | Process mgmt + provider logic coupled | Low | Needs deep extraction plan |
| Voice capture/VAD/STT/TTS | `src-tauri/src/audio/*`, `commands/voice.rs` | `wrap` | High OS variance (audio stack) | Runtime state and commands tightly coupled | Medium | Preserve working path then isolate adapters |
| Memory subsystem | mixed command/runtime usage | `rewrite` | Portable core + adapter edges | Retrieval/extraction boundaries unclear | Low | Implement retrieval-first v1 |
| Agent loop | mixed in chat/runtime modules | `rewrite` | Mostly portable core | Planner/tool execution fused | Low | Bounded agent in dedicated crate |
| Logging/telemetry | logs/events across modules | `rewrite` | Portable | Inconsistent correlation IDs | Medium | Standardize trace schema |
| Background tasks | multiple command modules | `rewrite` | Task lifecycle differs by OS load | Unclear ownership | Low | Enforce owner + cancellation model |
| OS integrations (paths/processes) | `src-tauri` commands/lib | `wrap` | Platform-specific | Inline platform branching | Medium | Move behind infra interfaces |
| Config/settings | DB + commands | `wrap` | Portable | Parsing/validation scattered | Medium | Consolidate typed config model |

## Immediate salvage decisions

1. Preserve current frontend shell and chat UX as migration harness.
2. Preserve persistence schema initially; refactor access via interfaces.
3. Treat agent + tools + memory as rewrite tracks with strict contracts.
4. Keep voice pipeline behavior available, but move platform details behind adapters.

## Open risks

1. Existing command signatures are high-arity and cross-cutting; contract extraction can drift.
2. Process/tool orchestration paths are currently tightly coupled to runtime settings.
3. Platform-specific behavior is distributed; regression risk is high during migration.

