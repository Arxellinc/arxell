# Guardrails for Modular Tools

## Purpose
This document defines the operational guardrails for the modular tool system. It is intended for both human developers and in-app agents that may create, modify, or install tools.

Primary goals:
- Keep the system extensible without weakening safety.
- Make tool behavior predictable and auditable.
- Separate core workbench responsibilities from tool responsibilities.

## Non-Negotiable Boundaries
- Console is core observability only.
- Console is not a tool.
- Console never executes commands.
- Console only displays logs/events (frontend and backend).
- Privileged actions must go through a backend tool gateway.
- No tool may call sensitive backend commands directly.
- Tool permissions are deny-by-default.

## Architecture Boundaries

### Core Workbench (not a tool)
Core workbench owns:
- File/editor shell
- Tabs/diff/preview orchestration
- Project context resolution
- Console (logs-only)
- Tool host slot (where tools render)

Core workbench does not own:
- Tool-specific business logic
- Tool-specific persistence rules
- Tool-specific privilege checks

### Tool Modules
Each tool must be isolated in its own directory and contain:
- `manifest.ts` (metadata + declared capabilities)
- `panel/*` (UI)
- `state/*` (tool-local state)
- optional docs/assets

Tools should not import internals of other tools.

## Capability and Mode Model

### Modes
- `sandbox`: strict policy enforcement.
- `shell`: broader user-level execution where allowed.
- `root`: explicit elevated operations with per-action confirmation.

Mode rules:
- Default mode is `sandbox`.
- `root` is never implicit.
- Mode is scoped per tool/session and should auto-reset.

### Capability Declaration
Tool manifests must declare capabilities explicitly, e.g.:
- backend actions/commands
- filesystem scopes
- network host scopes
- process execution requirements

No declaration means no access.

## Backend Gateway Rules
All privileged actions must use one gateway contract:
- Input includes: `toolId`, `action`, `mode`, `payload`.
- Gateway validates schema and policy before dispatch.
- Gateway records audit logs for allow/deny decisions.

Required checks:
1. Tool is known and enabled.
2. Action is declared by that tool.
3. Requested mode is allowed for that tool.
4. Payload passes validation.
5. Scope checks pass (fs/net/process).

## Filesystem Guardrails
- Prefer workspace-relative access for coding/design workflows.
- Tool-private writable state should live under app data, e.g. `app_data/tools/<toolId>/`.
- Never allow unrestricted path operations by default.
- Path traversal and out-of-scope writes must be denied at backend boundary.

## Terminal Guardrails
- Terminal execution is a tool capability, not a core capability.
- UI toggles are advisory UX only; backend policy is authoritative.
- Dangerous operations require explicit policy + confirmation.
- `root` execution must always be user-consented per action.

## Installable / Agent-Created Tool Guardrails
- Install is explicit user action.
- Manifest must pass validation before activation.
- Incompatible or undeclared capabilities are rejected.
- New tools start disabled until permissions are approved.
- Agent-generated tools must follow the same manifest and policy rules as human-authored tools.

## Persistence Guardrails
Every tool must declare persistence type:
- `ephemeral`: in-memory only.
- `workspace_scoped`: persisted in project workspace.
- `app_scoped`: persisted in app data.

Default is `ephemeral` unless explicitly specified.

## Audit and Observability
- Log all privileged gateway decisions with:
  - timestamp
  - tool id
  - action
  - mode
  - allow/deny
  - reason
- Console may display these logs, but cannot alter policy.

## Developer Checklist
Before merging a new tool:
1. Tool directory is isolated and self-contained.
2. Manifest exists and is complete.
3. Capabilities are minimal and specific.
4. Backend actions route through gateway only.
5. Out-of-scope access is denied in backend tests.
6. Mode behavior (`sandbox/shell/root`) is validated.
7. Console remains logs-only and unaffected.

## Agent Checklist
Before creating or modifying a tool:
1. Create/update `manifest.ts` first.
2. Request only minimum capabilities needed.
3. Keep state local to the tool unless explicitly shared.
4. Route privileged actions via gateway contract.
5. Do not add direct calls to sensitive backend commands.
6. Document what the tool stores and where.

## Migration Notes
Current codebase notes for migration planning:
- Toolbar and panel mappings are currently static in multiple files.
- Some panels depend on global stores and should be decoupled gradually.
- Workspace commands currently accept raw paths and need backend scope enforcement.

This document is the policy source for the modular tool migration.
