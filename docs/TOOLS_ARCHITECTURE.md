# Tools Architecture

## Purpose

Tools are the extension points that make workspace features available to users and, where appropriate, to the agent runtime. A tool can be a visible workspace surface, an executable backend capability, or both.

The future `Sheets` tool should be treated as a workspace UI tool first: it needs a spreadsheet view for CSV/XLSX data, local state for open files and grid editing, and backend actions only when file parsing, persistence, or agent-readable operations require Rust-side support.

## Tool Types

There are three related tool paths in the app:

1. Workspace tools
- User-facing panels in the workspace, implemented in `frontend/src/tools`.
- Examples: `files`, `webSearch`, `chart`, `flow`, `tasks`, `memory`, `skills`.
- Registered in the frontend by `frontend/src/tools/registry.ts`.
- Registered in the backend workspace tool list by `src-tauri/src/workspace_tools/mod.rs`.

2. Invoke tools
- Backend action handlers that the frontend calls through the generic `invoke_tool` IPC command.
- Implemented under `src-tauri/src/tools/invoke`.
- Registered by `src-tauri/src/tools/invoke/mod.rs`.
- Used when a workspace tool needs typed backend behavior such as filesystem operations, web search setup, or flow actions.

3. Agent tools
- Tools exposed to the chat agent loop.
- Implemented under `src-tauri/src/agent_tools`.
- Bound to workspace tool enablement in `src-tauri/src/app/chat_service.rs`.
- Used only when the model should be able to call the capability directly.

These paths should stay separate. A workspace UI tool does not automatically become an agent tool, and agent tools should not bypass registry or policy boundaries.

## Layering

The app follows the layering contract in `docs/ARCHITECTURE.md`:

- Frontend renders UI and handles user interaction.
- IPC translates frontend payloads to service or registry requests.
- Application services orchestrate app behavior.
- Registries perform tool dispatch and policy boundaries.
- Tool modules perform side effects and platform-specific work.

Forbidden dependencies remain important for new tools:

- Frontend must not call Rust services or tool internals directly.
- IPC must not call concrete tool modules directly.
- Services must not call concrete tool modules directly when registry dispatch exists.
- Tools must not call other tools directly.

## Workspace Tool Structure

Builtin workspace tools use a folder under `frontend/src/tools/<toolId>/`. Existing tools typically include:

- `manifest.ts`: frontend metadata for discovery.
- `index.tsx`: HTML render functions for the tool body and toolbar/actions.
- `state.ts`: local state shape and defaults, when the tool owns state.
- `bindings.ts`: event handling for click/input/change/key events.
- `actions.ts`: async operations that call IPC or shared runtime helpers, when needed.
- `runtime.ts`: runtime integration for tools with polling, rendering engines, or external libraries.
- `styles.css`: tool-specific styles.

Not every tool needs every file. Static tools such as `memory` and `skills` may only need render and manifest files. Interactive tools such as `files`, `flow`, and `webSearch` use state, bindings, actions, and styles.

## Frontend Discovery

Frontend discovery is manifest-based:

- `frontend/src/tools/registry.ts` eagerly imports `./*/manifest.ts`.
- Each manifest exports a `ToolManifest` with `id`, `version`, `title`, `description`, `category`, `core`, `defaultEnabled`, `source`, and `icon`.
- `TOOL_ORDER` defines the preferred ordering for builtins and appends unknown discovered tools alphabetically.
- `getToolManifest(toolId)` normalizes legacy aliases such as `web` to `webSearch`.

Adding a builtin tool requires a manifest file and, if the tool should appear in a specific position, an update to `PREFERRED_TOOL_ORDER`.

## Backend Workspace Registry

The backend workspace registry lives in `src-tauri/src/workspace_tools/mod.rs`.

It provides the canonical list used by the Tools manager and chat tool enablement. Builtin tools are declared in `WORKSPACE_TOOL_MANIFESTS` with:

- `tool_id`
- `title`
- `description`
- `category`
- `core`
- `default_enabled`

`WorkspaceToolsService` loads those manifests, merges persisted enabled/icon settings from `tools-registry.json`, discovers plugin tools, and returns `WorkspaceToolRecord` values to the frontend.

For a builtin `Sheets` tool, add a `WorkspaceToolManifest` entry with a stable id such as `sheets`, title `Sheets`, category `data`, and an initial description focused on spreadsheet data viewing and editing.

## Workspace Rendering

Workspace rendering is routed through `frontend/src/tools/workspaceViewRegistry.ts` and `frontend/src/tools/host/viewBuilder.ts`.

The flow is:

1. A workspace tab id such as `files-tool` or `chart-tool` is selected.
2. `resolveWorkspaceView` strips the `-tool` suffix and looks for a matching view in `ctx.toolViews`.
3. `buildWorkspaceToolViews` constructs `actionsHtml` and `bodyHtml` entries for implemented builtin tools.
4. If a builtin manifest exists but no rendered view exists, the user sees a placeholder.
5. If a custom/plugin tool has an enabled `entry`, it renders in a sandboxed iframe.

For `Sheets`, add a `sheets` entry to `buildWorkspaceToolViews` once its render functions exist.

## Workspace Events

Workspace event dispatch is centralized in `frontend/src/tools/host/workspaceDispatch.ts`.

Tool bindings should:

- Use tool-specific data attributes, preferably declared near other UI constants.
- Return whether an event was handled.
- Mutate only the frontend state slice they own.
- Trigger rerenders explicitly where the host expects it.
- Route async side effects through dependency functions or action helpers.

For `Sheets`, plan for bindings around opening data files, editing cells, changing sheets/tabs, sorting/filtering, saving, and import/export actions.

## Backend Invoke Flow

Generic backend tool actions use the `ToolInvokeRequest` and `ToolInvokeResponse` contracts in `frontend/src/contracts.ts` and the Rust equivalents in `src-tauri/src/contracts.rs`.

The flow is:

1. Frontend sends `toolId`, `action`, `mode`, `correlationId`, and typed `payload`.
2. `src-tauri/src/ipc/tool_runtime.rs` receives the request through `invoke_tool`.
3. `build_registry()` in `src-tauri/src/tools/invoke/mod.rs` builds an `InvokeRegistry`.
4. The registry looks up `(tool_id, action)`.
5. The handler decodes payload with `decode_payload`, calls the appropriate service, and returns JSON data or an error string.

Use invoke handlers when a tool needs backend-controlled side effects, stable typed contracts, or access to Rust services. For `Sheets`, likely backend actions include reading CSV/XLSX, saving CSV/XLSX, extracting workbook metadata, and producing normalized tabular data for agent workflows.

## Agent Tool Enablement

Agent tools are gated by workspace tool enablement in `src-tauri/src/app/chat_service.rs`.

The binding table maps a workspace tool id to a function that returns one or more agent tools. For example, the `chart` workspace tool enables chart-specific agent behavior.

Do not expose `Sheets` to the agent by default unless there is a clear model-facing capability. A good first agent scope would be read-only summarization or structured queries over an open sheet. Editing files should require explicit user intent and registry-controlled actions.

## Custom And Plugin Tools

`WorkspaceToolsService` also discovers custom/plugin tools from the plugins root. Plugin records are added as `WorkspaceToolRecord` values with `source` of `custom` or `plugin`.

Custom/plugin tools differ from builtins:

- Their metadata comes from plugin manifests rather than frontend builtin manifests.
- Their UI entry is loaded as a sandboxed iframe.
- Capabilities are checked by `ensure_custom_tool_capability`.
- Enabled/icon state is persisted with the same registry snapshot.

Builtin tools such as `Sheets` should prefer native frontend integration instead of iframe loading.

## Contracts And Observability

New tool actions should follow the existing contract rules:

- Keep request and response payloads typed and explicit.
- Preserve `correlationId` from UI through IPC and backend handlers.
- Return structured errors instead of silent failures.
- Avoid leaking file contents or secrets into event payloads.
- Keep platform-specific logic inside Rust tool modules or services, not in shared orchestration.

For spreadsheet data, avoid logging full row contents by default. Prefer counts, file paths after normal path safety checks, sheet names when safe, and operation metadata such as `rowCount`, `columnCount`, or `format`.

## Adding A Builtin Workspace Tool

Use this checklist for a new builtin tool:

1. Create `frontend/src/tools/<toolId>/manifest.ts`.
2. Add render functions in `frontend/src/tools/<toolId>/index.tsx`.
3. Add tool state, bindings, actions, runtime, and styles as needed.
4. Add the tool id to `PREFERRED_TOOL_ORDER` in `frontend/src/tools/registry.ts` if it needs deterministic placement.
5. Add a builtin `WorkspaceToolManifest` in `src-tauri/src/workspace_tools/mod.rs`.
6. Add the rendered view to `buildWorkspaceToolViews` in `frontend/src/tools/host/viewBuilder.ts`.
7. Add event dispatch hooks in `frontend/src/tools/host/workspaceDispatch.ts`.
8. Add backend invoke handlers under `src-tauri/src/tools/invoke/<toolId>.rs` only if backend behavior is needed.
9. Register backend invoke handlers in `src-tauri/src/tools/invoke/mod.rs`.
10. Add agent tool bindings only if the model needs a direct capability.
11. Add tests around registries, payload decoding, and high-risk parsing or persistence behavior.

## Sheets Planning Notes

For `Sheets`, the likely architecture is:

- `toolId`: `sheets`
- Category: `data`
- Frontend role: workbook/grid view, selected sheet, active cell/range, edit buffer, dirty state, import/export controls.
- Backend role: safe file read/write, CSV parsing, XLSX parsing/writing, workbook metadata, large-file limits.
- Agent role: optional later phase for read-only inspection, table summarization, formula/data cleanup suggestions, or explicit edit plans.

Key design decisions before implementation:

- Whether CSV parsing starts in frontend, backend, or both.
- Which XLSX library is acceptable for Rust or TypeScript use.
- Size limits for loaded files and visible grids.
- How edits are represented for undo/redo and save conflict handling.
- Whether `Sheets` opens files through the existing `files` tool state or keeps its own open-workbook state.
