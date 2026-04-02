# API Refactor Plan: Single-Folder Tool Architecture

## Context Reviewed
This plan is grounded in current repo architecture and implementation constraints:

- Layering rules and guardrails:
  - `docs/ARCHITECTURE.md`
  - `docs/GUARDRAILS.md`
  - `docs/AI_WORK_COMPLIANCE_CHECKLIST.md`
- Contract and event compatibility rules:
  - `docs/IPC_EVENTS.md`
  - `docs/CONTRACT_VERSION.md`
- Current coupling points in app code:
  - Frontend orchestration in `frontend/src/main.ts`
  - Hardcoded workspace tool view map in `frontend/src/tools/workspaceViewRegistry.ts`
  - Hardcoded tool exports/registry in `frontend/src/tools/index.ts`, `frontend/src/tools/registry.ts`
  - Hardcoded backend commands in `src-tauri/src/main.rs`, `src-tauri/src/ipc/*.rs`
  - Existing but underused generic tool trait/registry in `src-tauri/src/tools/tool.rs`, `src-tauri/src/tools/registry.rs`

## Problem Statement
Today each new tool requires edits across multiple global files (frontend root state, UI event wiring, IPC client, Rust commands, app context wiring). This blocks “single folder import/export” because the host app is not plugin-oriented.

## Target Outcome
A tool can be added, upgraded, imported, exported, and removed by touching **one tool folder** plus one declarative registration entry (or zero for dynamic discovery), while keeping host app code generic.

## Progress Snapshot (2026-04-02)
- Completed:
  - Flow, Files, and WebSearch frontend behavior extracted into tool-local modules (`actions`, `bindings`, and runtime/state helpers).
  - Workspace view routing is generic and now reads from a `toolViews` map rather than hardcoded per-tool slots.
  - Added host dispatcher for workspace input/click/change/submit/keydown/dblclick handling.
  - Added host-side tool view builder that composes `webSearch`, `files`, `flow`, `tasks`, `memory`, and `skills` from tool-local renderers.
  - Added tool-local placeholder renderers for `tasks`, `memory`, and `skills` so non-terminal tools are host-driven.
  - `main.ts` now delegates per-tool HTML composition to host/tool modules (terminal still intentionally direct).
  - Replaced static tool manifest registry imports with dynamic manifest discovery via `import.meta.glob("./*/manifest.ts")` and a preferred ordering fallback.
  - Added host runtime module for non-terminal workspace tools (`flow`, `files`, `webSearch`) so `main.ts` uses runtime methods instead of local tool wrappers.
  - Added backend generic invoke entrypoint `cmd_tool_invoke` (compatibility phase) with adapters for:
    - `flow`: `start`, `stop`, `status`, `list-runs`, `rerun-validation`
    - `files`: `list-directory`
    - `webSearch`/`web`: `search`
  - Added frontend contracts and IPC client method for generic invoke (`ToolInvokeRequest/Response`, `toolInvoke(...)`).
  - Switched tool action modules to use generic invoke path:
    - `frontend/src/tools/flow/actions.ts`
    - `frontend/src/tools/files/actions.ts`
    - `frontend/src/tools/webSearch/actions.ts`
  - Mock IPC generic invoke now routes supported actions to existing mock handlers for behavior parity.
  - Flow run refresh in `main.ts` now uses generic invoke (`flow.list-runs`) instead of tool-specific IPC.
  - Extracted generic invoke routing logic from `src-tauri/src/main.rs` into:
    - `src-tauri/src/ipc/tool_runtime.rs`
    - and registered module via `src-tauri/src/ipc/mod.rs`.
  - Moved flow refresh scheduling helper out of `main.ts` into:
    - `frontend/src/tools/host/flowRefresh.ts`
  - Legacy Tauri commands now call the same generic invoke route (compatibility wrappers), including:
    - `cmd_web_search`
    - `cmd_files_list_directory`
    - `cmd_flow_start|stop|status|list_runs|rerun_validation`
  - Extracted flow event + refresh trigger glue out of `main.ts` into:
    - `frontend/src/tools/host/flowEvents.ts`
  - Split backend generic tool invoke logic into per-tool adapters under:
    - `src-tauri/src/tools/invoke/flow.rs`
    - `src-tauri/src/tools/invoke/files.rs`
    - `src-tauri/src/tools/invoke/web_search.rs`
    - wired via `src-tauri/src/tools/invoke/mod.rs` and consumed from `src-tauri/src/ipc/tool_runtime.rs`.
  - Moved shared legacy-wrapper helper out of `main.rs` into `ipc/tool_runtime.rs` (`invoke_legacy_tool_command`), further reducing `main.rs` to command wiring.
  - Removed unused frontend static tool barrel (`frontend/src/tools/index.ts`) after switching registry to manifest discovery.
  - Removed leftover flow run normalization wrapper in `main.ts`; flow refresh now uses `normalizeFlowRunView` directly via host helper.
  - Replaced central tool/action `match` dispatch in `src-tauri/src/ipc/tool_runtime.rs` with registry-driven adapter lookup.
  - Added backend invoke registry primitives:
    - `src-tauri/src/tools/invoke/registry.rs`
    - `src-tauri/src/tools/invoke/mod.rs::build_registry()`
  - Updated per-tool adapters to self-register actions (`flow`, `files`, `webSearch`/`web`) for generic invoke routing.
  - Updated Tauri frontend client methods (`filesListDirectory`, `flow*`, `webSearch`) to route through `toolInvoke`, keeping one command path client-side.
  - Added backend unit tests for invoke registry/decoder:
    - dispatch success registration
    - alias registration support
    - unsupported action miss (`None`)
    - payload decode success/error shape handling
  - Removed direct `cmd_flow_*`, `cmd_files_list_directory`, and `cmd_web_search` command usage from `TauriChatIpcClient`; generic `toolInvoke` is now the only path for those tool calls.
  - Shrank `ChatIpcClient` public surface by removing direct `flow*`, `filesListDirectory`, and `webSearch` methods.
  - Marked backend legacy command wrappers in `src-tauri/src/main.rs` as compatibility-only with explicit canonical `cmd_tool_invoke` mapping comments.

## Legacy Command Deprecation Window
- Current status:
  - Legacy commands remain available as wrappers for compatibility:
    - `cmd_web_search`
    - `cmd_files_list_directory`
    - `cmd_flow_start`
    - `cmd_flow_stop`
    - `cmd_flow_status`
    - `cmd_flow_list_runs`
    - `cmd_flow_rerun_validation`
- Canonical command:
  - `cmd_tool_invoke`
- Planned policy:
  - Do not remove wrappers before **June 1, 2026**.
  - Remove only after one full release cycle with zero internal usage and explicit release-note notice.
- Usage telemetry:
  - Each wrapper call emits an `app:event` with:
    - `action`: `cmd.legacy_wrapper.used`
    - `subsystem`: `ipc`
    - `stage`: `progress`
    - `payload`: `{ legacyCommand, toolId, action, count }`
  - `count` is an in-memory per-process counter per legacy command.
- Deferred by decision:
  - Keep `terminal` on its current path for now.
- Still open:
  - Replace static tool manifest imports (`tools/index.ts`, `tools/registry.ts`) with generated/dynamic manifest loading.
  - Move remaining non-terminal tool lifecycle wiring out of `main.ts` into host runtime/store interfaces end-to-end.
  - Implement backend generic invoke/runtime (`cmd_tool_invoke`) and migrate tool-specific IPC behind adapters.

---

## Design Principles
1. Host is generic; tool logic is local.
2. Tool contracts are explicit and versioned.
3. Tool state management is owned by tool modules, not `main.ts`.
4. Tool backend invocation uses one generic command surface.
5. Tool packages declare capabilities for safety.
6. Compatibility path exists during migration (no flag day).

---

## Proposed Tool Package Standard (`tool-package-v1`)

Each tool lives under a single root folder:

```text
frontend/src/tools/<toolId>/
  manifest.json
  index.ts
  view.tsx
  styles.css
  state.ts
  reducer.ts
  actions.ts
  bindings.ts
  contracts.ts
  README.md
  migrations/
```

Optional backend module (still namespaced by tool):

```text
src-tauri/src/tool_runtime/tools/<toolId>/
  mod.rs
  service.rs
  contracts.rs
  tests.rs
```

### `manifest.json` required fields
- `id`, `version`, `title`, `description`, `category`, `icon`
- `entry.frontend` (module path)
- `entry.backend` (optional backend handler id)
- `capabilities` (e.g. `fs.read`, `process.exec`, `network.http`, `git.write`)
- `events` (subscribed and emitted action prefixes)
- `apiVersion` (tool package API contract version)

---

## Host API (Frontend) Refactor

## 1) Introduce Tool Host Interfaces
Create a frontend tool host contract so `main.ts` no longer contains tool-specific state/actions.

New file: `frontend/src/tools/host/types.ts`

Core interfaces:
- `ToolFrontendModule`
  - `init(ctx): ToolInstance`
- `ToolInstance`
  - `getInitialState(): unknown`
  - `renderBody(state, hostCtx): string`
  - `renderActions(state, hostCtx): string`
  - `onEvent(state, appEvent): state`
  - `onAction(state, action, payload, hostCtx): Promise<state>`
  - `onInput(state, domEvent, hostCtx): state`

## 2) Create Generic Tool Runtime Store
New file: `frontend/src/tools/host/store.ts`

Host-owned map:
- `toolStates: Record<toolId, unknown>`
- `activeToolId`

This replaces per-tool root fields currently in `frontend/src/main.ts`.

## 3) Replace Hardcoded Workspace View Map
Refactor `frontend/src/tools/workspaceViewRegistry.ts`:
- resolve workspace tab -> `toolId`
- ask host for `renderActions/renderBody`
- no static `flowUiHtml/webUiHtml/filesUiHtml` fields

## 4) Replace Hardcoded Tool Registry Exports
Refactor:
- `frontend/src/tools/index.ts`
- `frontend/src/tools/registry.ts`

Goal:
- dynamic loading from manifests (build-time glob or generated manifest index)
- no manual import per tool

---

## Host API (Backend) Refactor

## 5) Add Generic Tool Invoke IPC
Leverage existing generic contracts already present in `src-tauri/src/contracts.rs`:
- `ToolInvokeRequest`
- `ToolInvokeResponse`

Implement:
- `cmd_tool_invoke`
- optional `cmd_tool_query_state`

Files:
- `src-tauri/src/main.rs`
- `src-tauri/src/ipc/mod.rs`
- new `src-tauri/src/ipc/tool_runtime.rs`

## 6) Introduce Backend Tool Runtime Registry
Reuse and expand:
- `src-tauri/src/tools/registry.rs`
- `src-tauri/src/tools/tool.rs`

Move tool-specific backend behavior (Flow, Files, WebSearch) into tool modules registered by `tool_id` and `action`.

## 7) Decouple AppContext from Tool-Specific Services
Current `AppContext` has direct fields like `flow`, `files` (`src-tauri/src/app/mod.rs`).
Refactor to:
- `tool_runtime: Arc<ToolRuntimeService>`
- keep legacy services during migration behind adapter tools.

---

## Import/Export Architecture

## 8) Tool Package Import/Export Commands
Add generic commands:
- `cmd_tool_package_export { toolId } -> { archiveName, bytes/base64, manifest }`
- `cmd_tool_package_import { archive, trustPolicy } -> { toolId, version, installed }`
- `cmd_tool_package_list`
- `cmd_tool_package_remove`

Initial scope can be frontend-only package import, then backend modules in second phase.

## 9) Package Validation Pipeline
On import, validate:
1. schema (`manifest.json` shape)
2. `apiVersion` compatibility
3. capability allowlist / policy
4. signature/checksum (phase 2)
5. conflicts (`toolId`, version downgrade/upgrade)

## 10) Tool Enablement and Policy
Extend current workspace registry (`src-tauri/src/workspace_tools/mod.rs`) to persist:
- enabled
- installed source (`builtin|imported`)
- installed version
- capability grants

---

## Migration Plan (Reliability-First)

## Phase 0: Prep (No behavior changes)
- Add `tool-package-v1` schema and host interfaces.
- Add adapters so existing tools still run unchanged.
- Add `cmd_tool_invoke` path while keeping existing tool-specific commands.

Exit criteria:
- app behavior unchanged
- all checks/tests pass

## Phase 1: Migrate Flow (pilot)
- Move Flow frontend orchestration out of `main.ts` into `frontend/src/tools/flow/*` host module files (`state/reducer/actions/bindings`).
- Route Flow actions via host action dispatch.
- Backend: add Flow tool adapter to tool runtime registry. Keep `cmd_flow_*` as compatibility shim calling generic invoke internally.

Exit criteria:
- no Flow-specific business state in root `main.ts`
- Flow start/stop/status/rerun works via generic path

## Phase 2: Migrate Files + WebSearch
- Repeat the same extraction pattern.
- Remove hardcoded UI special-casing in `workspaceViewRegistry.ts`.

Exit criteria:
- workspace tool rendering generic for migrated tools

## Phase 3: Migrate Remaining Non-Terminal Tools
- Migrate `tasks`, `memory`, and `skills` to the same host/runtime pattern.
- Keep `terminal` on current implementation during this refactor.

Exit criteria:
- all non-terminal workspace tools are host/runtime-driven
- `main.ts` contains no tool-specific business logic for non-terminal tools

## Phase 4: Remove Legacy Specific IPC
- Remove `cmd_flow_*`, `cmd_files_*`, etc. once clients are migrated.
- bump contract version and update docs (`docs/IPC_EVENTS.md`, `docs/CONTRACT_VERSION.md`).

## Phase 5: Import/Export Packaging
- implement package export/import/list/remove
- install path and manifest cache
- capability gating UI

---

## Concrete File-Level Execution Plan

## Frontend
1. Add host framework
- `frontend/src/tools/host/types.ts`
- `frontend/src/tools/host/runtime.ts`
- `frontend/src/tools/host/store.ts`
- `frontend/src/tools/host/manifestLoader.ts`

2. Refactor root wiring
- `frontend/src/main.ts`: replace tool-specific state/action branches with host delegations
- `frontend/src/tools/workspaceViewRegistry.ts`: generic rendering
- `frontend/src/layout/workspacePane.ts`: pass generic tool context only

3. Flow pilot extraction
- Split current `frontend/src/tools/flow/index.tsx` into:
  - `view.tsx`
  - `state.ts`
  - `reducer.ts`
  - `actions.ts`
  - `bindings.ts`
  - keep `index.ts` as module entry

## Backend
1. Add generic invoke handler
- `src-tauri/src/ipc/tool_runtime.rs`
- `src-tauri/src/main.rs` command registration

2. Add tool runtime service
- `src-tauri/src/tool_runtime/mod.rs`
- `src-tauri/src/tool_runtime/registry.rs`

3. Flow backend adapter
- `src-tauri/src/tool_runtime/tools/flow/*`
- Keep old `src-tauri/src/ipc/flow.rs` as adapter until removal

4. Workspace tool metadata extension
- `src-tauri/src/workspace_tools/mod.rs`

---

## Compatibility and Risk Controls

## Compatibility Strategy
- Keep old command names during migration; internally bridge to new runtime.
- Add contract aliases where enum/status names changed.
- Feature flag: `tool-runtime-v1` for progressive rollout.

## Failure/Rollback Strategy
- If a migrated tool fails, fallback to legacy command path via runtime switch.
- Keep package install transactional: unpack to temp, validate, then atomically move into install dir.
- Keep signed manifest cache to recover from partial imports.

## Observability Requirements
For each tool action, emit:
- `tool.runtime.invoke.start|progress|complete|error`
- include `toolId`, `action`, `correlationId`, `durationMs`, `result/error`

No secret payload leakage (per `docs/GUARDRAILS.md`).

---

## Test Plan

## Unit
- tool host reducer/action tests (per tool)
- manifest/schema validation tests
- backend registry dispatch tests
- capability gating tests

## Integration
- `cmd_tool_invoke` -> tool backend path roundtrip
- Flow migrated module parity vs old behavior
- import/export package install/uninstall cycle

## Regression
- Existing smoke tests plus new tool-runtime smoke:
  - list tools
  - start flow run
  - receive flow events
  - export flow package
  - import package clone under test id

---

## Definition of Done
1. Adding a frontend-only tool requires changes only under one folder + manifest registration.
2. Adding a full frontend+backend tool requires one folder per side and zero `main.ts` business logic edits.
3. Tool import/export works with schema validation and capability checks.
4. Legacy tool-specific IPC paths removed or permanently adapter-only.
5. Docs updated:
- `docs/ARCHITECTURE.md`
- `docs/IPC_EVENTS.md`
- `docs/CONTRACT_VERSION.md`
- new `docs/TOOL_PACKAGE_SPEC.md`

---

## Recommended First Increment (1-2 days)
1. Add frontend tool host interfaces + runtime store.
2. Move Flow state/reducer/actions out of `main.ts` (frontend only) without changing backend commands yet.
3. Prove import/export readiness by packaging Flow frontend folder as zip and reloading from manifest index.

This gives immediate reduction in `main.ts` growth and validates the architecture before backend command unification.
