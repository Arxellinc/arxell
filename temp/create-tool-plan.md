# Create Tool: Implementation Checklist

## Objective
Ship a new workspace tool named `Create Tool` that scaffolds and registers new custom tools from inside the app with guardrails, lean architecture, and style parity.

## Constraints
- Keep feature-specific code under: `frontend/src/tools/createTool/`
- Minimize host/runtime changes to only required registration plumbing.
- Reuse existing tool architecture patterns (string renderers + bindings + state slice).
- No external dependencies for V1.
- Default-safe behavior for write scope and capabilities.

## Deliverables
- New tool: `Create Tool` visible in workspace with icon.
- Usable scaffolder UI (metadata + template + guardrails + preview + create).
- File generation and registration flow.
- Validation and safety checks.
- Basic tests and typecheck passing.

---

## Phase 1: Tool Shell (UI + Wiring)

### 1.1 Add Tool Module
- [ ] Create folder: `frontend/src/tools/createTool/`
- [ ] Add files:
  - [ ] `index.tsx`
  - [ ] `state.ts`
  - [ ] `actions.ts`
  - [ ] `bindings.ts`
  - [ ] `styles.css`

### 1.2 Define Data Attributes and UI IDs
- [ ] Update `frontend/src/tools/ui/constants.ts`
  - [ ] Add `CREATE_TOOL_DATA_ATTR`
  - [ ] Add optional `CREATE_TOOL_UI_ID`

### 1.3 Register in Workspace View Routing
- [ ] Update `frontend/src/tools/workspaceViewRegistry.ts`
  - [ ] Add `createTool` tool metadata
  - [ ] Set title: `Create Tool`
  - [ ] Set icon key

### 1.4 Host Wiring
- [ ] Update `frontend/src/tools/host/viewBuilder.ts`
  - [ ] Extend input type with create-tool state
  - [ ] Render `renderCreateToolActions` / `renderCreateToolBody`
- [ ] Update `frontend/src/tools/host/workspaceDispatch.ts`
  - [ ] Route click/input/change events to create-tool bindings
  - [ ] Add selectors to `WORKSPACE_TOOL_TARGET_SELECTOR`
- [ ] Update runtime/state in `frontend/src/main.ts`
  - [ ] Add create-tool slice defaults
  - [ ] Pass state into viewBuilder

### 1.5 Icon
- [ ] Choose icon from `icons-all`
- [ ] Copy icon asset into `frontend/src/icons/`
- [ ] Register icon key where icon map is defined

Acceptance (Phase 1):
- [ ] `Create Tool` tab appears with icon.
- [ ] Empty-state body renders and reacts to button clicks.

---

## Phase 2: State + Template System

### 2.1 Define State Model (`createTool/state.ts`)
- [ ] `toolName`, `toolId`, `description`
- [ ] `iconKey`, `category`
- [ ] `templateId`
- [ ] Guardrails toggles:
  - [ ] `allowLocalStorage`
  - [ ] `allowIpc`
  - [ ] `allowExternalNetwork` (default false)
  - [ ] `readOnlyMode`
- [ ] `filesPreview: Record<string,string>`
- [ ] `validationErrors: string[]`
- [ ] `statusMessage: string | null`
- [ ] `busy: boolean`

### 2.2 Add Template Catalog (`createTool/actions.ts`)
- [ ] Define template IDs:
  - [ ] `basic-view`
  - [ ] `list-detail`
  - [ ] `form-tool`
  - [ ] `event-viewer`
  - [ ] `agent-utility`
- [ ] Implement deterministic template expansion functions returning file map

### 2.3 Render UI (`createTool/index.tsx`)
- [ ] Left pane: metadata + template + guardrails
- [ ] Right pane: file preview tabs/list + code preview
- [ ] Footer actions:
  - [ ] `Generate Preview`
  - [ ] `Validate`
  - [ ] `Create Files`
  - [ ] `Register Tool`
  - [ ] `Open in Files`

### 2.4 Bindings (`createTool/bindings.ts`)
- [ ] Handle form input changes
- [ ] Handle action buttons
- [ ] Keep handlers deterministic and side-effect boundaries clear

Acceptance (Phase 2):
- [ ] User can fill form and generate deterministic scaffold preview.
- [ ] Template swap updates preview correctly.

---

## Phase 3: Validation + Guardrails

### 3.1 Identifier and Naming Validation
- [ ] `toolId` required, slug-safe (`[a-z0-9-]+`), not reserved
- [ ] `toolName` required
- [ ] Duplicate tool ID check against registry

### 3.2 Path Safety
- [ ] Enforce output root exactly: `frontend/src/tools/<toolId>/`
- [ ] Reject `..`, absolute paths, hidden traversal patterns

### 3.3 Capability Guardrails
- [ ] `allowExternalNetwork` requires explicit confirm toggle
- [ ] `allowIpc` injects typed IPC placeholders only
- [ ] `readOnlyMode` template excludes mutating actions

### 3.4 Validation Output
- [ ] Show blocking vs non-blocking issues
- [ ] Disable `Create Files` while blocking errors exist

Acceptance (Phase 3):
- [ ] Invalid IDs/paths are blocked.
- [ ] Risky toggles require explicit opt-in.

---

## Phase 4: Scaffolding + Registration

### 4.1 File Write Strategy
- [ ] Implement scaffold write via existing app file APIs or IPC command (minimal addition)
- [ ] Atomic behavior target:
  - [ ] Validate first
  - [ ] Write files
  - [ ] Return per-file result

### 4.2 Registration Strategy
- [ ] Update workspace registry source to include new tool entry
- [ ] Add display name, icon, description, default order/category

### 4.3 Post-Create Actions
- [ ] Show created file list
- [ ] Provide `Open in Files` action
- [ ] Provide `Open Tool` action

Acceptance (Phase 4):
- [ ] End-to-end create + register succeeds with one flow.
- [ ] New tool appears after refresh/reload.

---

## Phase 5: Agent-Compatible Tool Spec

### 5.1 JSON Spec Contract
- [ ] Define spec shape for agent/user paste:
```json
{
  "toolName": "My Tool",
  "toolId": "my-tool",
  "description": "...",
  "iconKey": "...",
  "templateId": "form-tool",
  "guardrails": {
    "allowLocalStorage": true,
    "allowIpc": false,
    "allowExternalNetwork": false,
    "readOnlyMode": false
  }
}
```
- [ ] Add import/apply spec action
- [ ] Validate and map spec into UI state

### 5.2 Result Payload
- [ ] Emit deterministic result object:
  - [ ] `createdFiles[]`
  - [ ] `registeredToolId`
  - [ ] `warnings[]`
  - [ ] `errors[]`

Acceptance (Phase 5):
- [ ] Agent can populate spec and execute flow without manual editing.

---

## Phase 6: Style Parity and UX Polish

### 6.1 Styling
- [ ] Match existing tool typography, spacing, borders, hover, focus states
- [ ] Ensure dark/light mode support
- [ ] Keep CSS local to `createTool/styles.css`

### 6.2 Usability
- [ ] Clear inline validation messages
- [ ] Disable states for unsafe/incomplete actions
- [ ] Small docs/help panel for expected scaffold layout

Acceptance (Phase 6):
- [ ] UI visually consistent with Files/Tasks/Flow tools.

---

## File-by-File Change Map

### New
- `frontend/src/tools/createTool/index.tsx`
- `frontend/src/tools/createTool/state.ts`
- `frontend/src/tools/createTool/actions.ts`
- `frontend/src/tools/createTool/bindings.ts`
- `frontend/src/tools/createTool/styles.css`

### Existing (minimal edits)
- `frontend/src/tools/ui/constants.ts`
- `frontend/src/tools/workspaceViewRegistry.ts`
- `frontend/src/tools/host/viewBuilder.ts`
- `frontend/src/tools/host/workspaceDispatch.ts`
- `frontend/src/main.ts`
- icon map file (where existing icons are registered)

---

## Test Checklist

### Unit
- [ ] ID validator
- [ ] Path guardrail validator
- [ ] Template expansion snapshots
- [ ] Spec import validation

### Integration
- [ ] Create tool from each template
- [ ] Duplicate ID blocked
- [ ] Guardrail block scenarios
- [ ] Registration success + app reload visibility

### Manual Smoke
- [ ] Create `basic-view` tool and open it
- [ ] Create with `allowIpc=true` and verify generated IPC placeholder
- [ ] Create with invalid ID and verify block message
- [ ] Open created files in Files tool and edit/save

### CI/Local Checks
- [ ] `cd frontend && npm run check`
- [ ] App restart and visual verification

---

## Rollout Plan
1. Ship Phase 1-2 behind optional internal flag if needed.
2. Enable creation for local safe templates first.
3. Add registration + agent spec after validation hardening.
4. Stabilize with smoke scenarios and finalize docs.

---

## Definition of Done
- [ ] `Create Tool` can scaffold, validate, and register a new custom tool from within the app.
- [ ] Guardrails prevent writes outside allowed scope.
- [ ] Generated tool compiles and renders via existing workspace architecture.
- [ ] Style and behavior are consistent with current app tools.
- [ ] Typecheck passes and manual smoke flows succeed.
