# Flow Panel Build TODO (Execution Backlog)

## Sprint 1: Ralph Loop v1 Core
1. Create backend "supported node" registry and expose via Tauri command.
2. Update Flow panel node library to consume registry instead of hardcoded broad list.
3. Add run preflight command and block run start on hard failures.
4. Add commands: `workflow_run_cancel`, `workflow_run_pause`, `workflow_run_resume`.
5. Add run-control buttons in Flow panel header.
6. Extend node-run schema with attempt and retry metadata.
7. Add retry policy editor in node inspector for side-effecting nodes.
8. Implement bounded retry execution in runtime loop.
9. Add timeline pane: attempts, durations, error class, timestamps.
10. Add first-party template: `Coding Ralph Loop` and make it default recommended template.

## Sprint 2: Delegation + Durability
1. Add `agent.spawn` node contract (role, prompt, model, tool scope, limits).
2. Persist parent/child run lineage in A2A workflow run tables.
3. Add checkpoint writes at node boundaries and on pause.
4. Add resume path using latest checkpoint.
5. Add output schema validation between stage handoffs.

## Sprint 3: Scale to Infinite Workflows
1. Build template compiler and validator.
2. Add custom-template scaffolder from blank workflow.
3. Add policy presets by domain (coding/business/diligence/assistant/automation).
4. Add replay test fixtures for workflows and expected traces.
5. Add import compatibility tests for old workflow definitions.

## QA Checklist (for each sprint)
1. Linux/macOS/Windows run success for default template.
2. Run cancel/pause/resume verified with long-running nodes.
3. Retry path does not duplicate side effects when idempotency key is present.
4. Timeline reflects true node state transitions.
5. Restart/resume produces deterministic continuation.
