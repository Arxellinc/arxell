# Chat Planning And Delegation Plan

## Objective

Build a general-purpose `Clarify -> PRD -> Approve -> Delegate -> Validate` workflow for large or ambiguous user requests.

The primary chat agent should remain lean and user-facing. It owns routing, discovery, planning, approval, and progress reporting. Looper/OpenCode should act as the delegated execution runtime after the user approves a constrained execution brief.

## Guiding Principles

- Planning is a platform behavior, not only a prompt or skill.
- The primary chat agent must not start tool-heavy or delegated execution before prerequisite discovery and user approval.
- Looper should receive a ready-to-execute brief with a hard `project_folder` boundary.
- Looper questions are an exception path for blockers, not the primary discovery experience.
- Small, clear tasks should continue to execute directly without extra friction.
- All new contracts should be typed, persisted where necessary, and observable through structured events.

## Current Building Blocks

- Chat already selects enabled agent tools dynamically in `src-tauri/src/app/chat_service.rs`.
- Chat already supports model/tool/skill routing inputs through the existing chat send contract.
- Looper already supports `reviewBeforeExecute`, custom `phasePrompts`, `cwd`, status records, pending questions, and submit-question flow.
- Looper UI already renders planner review questions and plan text.
- The missing layer is chat-side planning state, structured clarification cards, plan approval actions, and a service-owned Looper handoff.

## Target Flow

1. User submits request.
2. Chat service runs a deterministic delegation preflight.
3. If request is small and clear, normal chat/tool flow continues.
4. If request is large, ambiguous, or risky, chat enters discovery mode.
5. Assistant returns focused clarification questions with suggested responses.
6. User answers through chips/cards or freeform text.
7. Assistant generates a PRD/execution brief.
8. User approves or requests revision.
9. On approval, app starts Looper with the approved brief.
10. Chat displays delegated run status and links to the Looper workspace tool.
11. If Looper blocks on a question, chat presents that question in the same guided UI.
12. On completion, primary chat validates results against the approved acceptance checks and reports outcome.

## Routing Policy

### Direct Execution

Use normal chat/tool flow when the task is:

- Clear and low risk.
- Likely under 8 concrete steps.
- Likely under 10 minutes of work.
- One obvious artifact or response.
- One tool family or no tools.
- No destructive, costly, or security-sensitive actions.

### Planning And Delegation

Route to discovery/planning when score is 3 or higher:

- `+1` multi-artifact deliverable.
- `+1` likely more than 8 concrete implementation steps.
- `+1` likely longer than 10-15 minutes.
- `+1` requires external research, verification, or data gathering.
- `+1` requires 2 or more tool families.
- `+1` missing key inputs such as scope, data source, output format, target folder, or quality bar.
- `+1` user asks for "full", "complete", "end-to-end", "autonomous", "research report", "financial analysis", "build", "refactor", or similar.

Always force planning for:

- Destructive filesystem or infrastructure work.
- High-cost API usage.
- Security, credential, deployment, or production-impacting work.
- Broad codebase refactors or migrations.
- Tasks requiring a strict project folder boundary.

## Phase 1: Product And UX Contract

- [x] Define the user-visible states: `normal`, `discovery`, `awaiting_plan_approval`, `delegated_execution`, `blocked`, `completed`, `failed`.
- [x] Define the chat message UI for clarification cards.
- [x] Define the chat message UI for plan approval cards.
- [x] Define the chat message UI for delegated run status cards.
- [x] Decide whether plan/revision actions are rendered as inline chat buttons or composer-adjacent actions.
- [x] Add copy rules for concise questions with defaults and 2-6 options.
- [x] Add UX rule: every clarification question must allow custom text.
- [x] Add UX rule: every PRD must visibly show `project_folder`.
- [x] Add UX rule: approval button is disabled until `project_folder` is present.

### Phase 1 UX Contract

#### User-Visible States

`normal`

- Default state for ordinary chat and direct tool use.
- Composer behaves normally.
- No planning UI is visible.
- Tool routing works as it does today.

`discovery`

- Chat has detected that the task needs prerequisite discovery before execution.
- Assistant message contains one or more clarification cards.
- Tool calls are blocked for this workflow while discovery is active.
- User can answer by selecting suggested options, adding custom text, or sending a normal chat reply.

`awaiting_plan_approval`

- Assistant has generated a plan artifact.
- The plan card is the active decision point.
- Tool calls and delegated execution are blocked until the user chooses `Approve Plan`.
- User may choose `Revise Plan` and provide requested changes.

`delegated_execution`

- Approved plan has been handed to Looper/OpenCode.
- Chat displays a delegated run status card.
- User can continue chatting, but task-scoped changes should become plan deltas if they alter approved scope.

`blocked`

- Delegated execution needs user input, approval, or a scope decision.
- Chat displays blocker questions using the same clarification-card pattern.
- Looper remains paused/blocked until answers are submitted.

`completed`

- Delegated run finished and primary chat has checked results against acceptance criteria.
- Chat shows a completion summary with pass/fail/partial acceptance status.

`failed`

- Discovery, plan generation, handoff, execution, or validation failed.
- Chat shows the failure reason and available actions: revise, retry, stop, or continue manually.

#### Clarification Card

Clarification cards are inline assistant message components. They are not modal dialogs.

Each card contains:

- Short title.
- One direct question.
- 2-6 suggested responses.
- One visually indicated recommended/default option when applicable.
- Optional `Custom` text field.
- Required/optional indicator only when it affects submission.

Rules:

- Use one decision per question.
- Prefer 2-4 questions for the first discovery turn.
- Prefer 2-4 options; allow up to 6 only when the domain genuinely needs it.
- Every question must allow custom text.
- The user can submit partial answers only when unanswered questions are optional.
- Suggested responses should be concise labels with optional one-sentence summaries.
- Do not ask questions whose answer can be inferred safely from the request or app context.

#### Plan Approval Card

The plan card is an inline assistant message component rendered after discovery.

It must show, without expansion:

- Objective.
- `project_folder`.
- Deliverables.
- Acceptance checks.
- Risk tier.
- Delegation target: `Looper` or `None`.

It may show in an expandable details area:

- Scope.
- Non-goals.
- Assumptions.
- Allowed tools/data sources.
- Execution phases.
- Rollback/safety notes.

Actions:

- `Approve Plan`: starts delegated execution or direct planned execution.
- `Revise Plan`: keeps workflow in planning and lets the user request changes.
- `Stop`: cancels the planning workflow and returns chat to `normal`.

Approval rules:

- `Approve Plan` is disabled unless `project_folder` is present and valid-looking.
- `Approve Plan` is disabled unless the plan has at least one deliverable and one acceptance check.
- Approval stores the exact plan id/version/hash used for delegation.
- Any scope-changing user request after approval must create a plan delta instead of silently changing execution scope.

#### Delegated Run Status Card

The delegated run card is an inline assistant message component shown after handoff.

It displays:

- Approved plan title or objective.
- Looper run id.
- Current phase.
- Current status.
- Last checkpoint summary.
- Link/action to open the Looper workspace tool.
- Stop/Pause action when supported.

Status values should map to the existing Looper lifecycle where possible:

- `starting`
- `planner`
- `executor`
- `validator`
- `critic`
- `blocked`
- `completed`
- `failed`

#### Inline Actions Decision

Plan, revision, and delegation actions should render inline inside chat messages, not composer-adjacent.

Rationale:

- The action belongs to a specific assistant artifact.
- Multiple historical plan cards may exist, and only the latest active one should be actionable.
- Inline actions keep approval context visible and reduce accidental approval of the wrong plan.

Composer-adjacent controls should remain limited to global chat behavior such as send, stop response, attach, voice, and model controls.

#### Copy Rules

Clarification prompts:

- Keep question text under 160 characters when practical.
- Use concrete defaults: "default: current project", "default: 12 monthly periods", "default: detailed".
- Avoid abstract options such as "Option A" unless the label itself is domain-specific.
- Use neutral wording; do not imply the recommended option is the only valid choice.

Plan summaries:

- Use the user's terminology for the objective.
- Avoid internal terms such as scorecard, state machine, or tool gating in user-facing plan copy.
- Show constraints plainly, especially folder, data source, and risk constraints.

Execution status:

- Prefer checkpoint facts over generic progress text.
- Keep status updates short enough to scan in the chat transcript.

## Phase 2: Shared Contracts

- [x] Add `ChatWorkflowMode`.
- [x] Add `ClarificationQuestion`.
- [x] Add `ClarificationOption`.
- [x] Add `ClarificationAnswer`.
- [x] Add `PlanArtifact`.
- [x] Add `PlanApprovalRequest`.
- [x] Add `DelegationStartRequest`.
- [x] Add `DelegationStatusCard`.
- [x] Add `PlanDelta` for scope changes during execution.
- [x] Mirror contracts in Rust `src-tauri/src/contracts.rs`.
- [x] Mirror contracts in TypeScript `frontend/src/contracts.ts`.

### Proposed Contract Sketch

```ts
type ChatWorkflowMode =
  | "normal"
  | "discovery"
  | "awaiting_plan_approval"
  | "delegated_execution"
  | "blocked"
  | "completed"
  | "failed";

interface ClarificationQuestion {
  id: string;
  title: string;
  prompt: string;
  options: ClarificationOption[];
  recommendedOptionId?: string;
  allowCustom: boolean;
  required: boolean;
}

interface ClarificationOption {
  id: string;
  label: string;
  summary?: string;
}

interface PlanArtifact {
  id: string;
  version: number;
  objective: string;
  projectFolder: string;
  scope: string[];
  nonGoals: string[];
  assumptions: string[];
  deliverables: string[];
  allowedTools: string[];
  dataPolicy: string;
  acceptanceChecks: string[];
  riskTier: "low" | "medium" | "high";
  delegationMode: "none" | "looper";
  createdAtMs: number;
  sourceConversationId: string;
  planHash: string;
}
```

Implemented contract files:

- `frontend/src/contracts.ts`
- `src-tauri/src/contracts.rs`

Additional implemented supporting types:

- `PlanRiskTier`
- `PlanDelegationMode`
- `DelegationRunStatus`
- `PlanDeltaStatus`

## Phase 3: Chat Service State Machine

- [x] Add conversation-level workflow state in the chat service.
- [x] Persist active workflow state with the conversation.
- [x] Add preflight function before agent tool selection.
- [x] Block tool binding when mode is `discovery` or `awaiting_plan_approval`.
- [x] Add deterministic route decision metadata for observability.
- [x] Add planner prompt template for discovery questions.
- [x] Add planner prompt template for PRD generation.
- [x] Add plan revision handling.
- [x] Add approval handling.
- [x] Add cancellation/stop handling for planning workflows.
- [ ] Add cancellation/stop handling for active delegated Looper runs.
- [x] Add fallback when the selected model cannot emit structured planning data.

Implemented baseline:

- Workflow state is persisted through `ConversationRepository`.
- SQLite persistence uses `chat_workflow_states`.
- File persistence uses a `*.workflow-states.json` sidecar.
- Planning preflight emits `chat.workflow.preflight`.
- Discovery emits `chat.workflow.discovery_started`.
- Plan creation emits `chat.workflow.plan_created`.
- Approval emits `chat.workflow.plan_approved`.
- Revision emits `chat.workflow.plan_revised`.
- Stop/cancel emits `chat.workflow.stopped`.
- Until Phase 4 structured cards exist, discovery and plan approval are rendered as plain assistant text.
- Until Phase 5 Looper handoff exists, approval captures intent and holds tool execution.

## Phase 4: Frontend Chat UI

- [x] Extend chat message model to support structured assistant payloads.
- [x] Render clarification questions as selectable cards/chips.
- [x] Support one-click recommended defaults.
- [x] Support custom answer text per question.
- [x] Add `Submit Answers` action.
- [x] Render PRD/plan artifact with compact summary and expandable details.
- [x] Add `Approve Plan` action.
- [x] Add `Revise Plan` action.
- [x] Render delegated run status with phase, status, and Looper link.
- [ ] Render blocked Looper questions using the same clarification component.
- [x] Preserve accessibility labels and keyboard support.
- [x] Keep CSS in global shared components unless truly chat-specific.

Implemented baseline:

- `ChatStructuredPayload` supports clarification, plan approval, delegation status, and plan delta cards.
- `UiMessage` can carry an optional structured payload.
- Chat response handling preserves structured payloads when present.
- Clarification option clicks update selection locally.
- `Submit Answers`, `Approve Plan`, `Revise Plan`, and `Stop` currently send normal chat messages as a compatibility bridge.
- Dedicated Looper-blocked-question integration remains in Phase 7.

## Phase 5: Looper Handoff

- [x] Add a chat-service method to start Looper through the service boundary.
- [x] Start Looper only after approved plan id/hash is present.
- [x] Set Looper `cwd` from the approved project-folder baseline.
- [x] Set Looper `projectDescription` from the approved brief.
- [x] Set Looper `phasePrompts` from the approved brief.
- [x] Default `reviewBeforeExecute` to `false` for chat-approved plans.
- [ ] Keep `reviewBeforeExecute = true` for high-risk plans if a second Looper review is desired.
- [x] Include explicit instruction that execution must stay inside `projectFolder`.
- [x] Include explicit instruction to request a `PlanDelta` if scope changes.
- [x] Store chat conversation id and plan id on the Looper record or correlation metadata.

Implemented baseline:

- `ChatService` now owns an `Arc<LooperHandler>`.
- Approval starts a Looper build loop with strict phase prompts.
- The Looper loop id is stored in `ChatWorkflowState.activeLoopId`.
- `reviewBeforeExecute` is set to `false` for chat-approved plans.
- High-risk double-review behavior remains pending for rollout/safety tuning.

## Phase 6: Path And Safety Enforcement

- [x] Validate `projectFolder` exists or can be created.
- [x] Reject empty, root, home, system, or ambiguous project folders.
- [x] Normalize and canonicalize `projectFolder`.
- [x] Add path-boundary checks before starting delegated execution.
- [ ] Add event warnings when requested work exceeds the approved folder.
- [ ] Add stop condition for destructive actions outside the plan.
- [x] Add "plan delta required" behavior for scope expansion.
- [x] Ensure logs do not include secrets or large file contents.

Implemented baseline:

- Chat validates the delegated project folder before starting Looper.
- Empty, root, home, and common system directories are rejected.
- Relative folders are resolved against the current process directory and canonicalized.
- Missing folders are created before handoff.
- Scope expansion is currently enforced through Looper phase prompt instructions; runtime event detection remains pending.

## Phase 7: Looper Blocker Integration

- [ ] Subscribe chat orchestration to `looper.planner.review_ready` and blocked-loop events.
- [x] Map `LooperQuestion` to chat-facing blocker text.
- [x] Render blocked questions in chat.
- [x] Submit answers through existing `looper submit-questions`.
- [x] Resume Looper after answers.
- [x] Record the blocker and answer in the chat transcript.
- [ ] Add timeout/error behavior if Looper cannot resume.

Implemented baseline:

- Chat polls the active Looper run when a delegated workflow receives a user message.
- If Looper is blocked, chat switches workflow state to `blocked` and displays pending questions.
- In `blocked` mode, the user's next response is submitted to Looper as freeform answers.
- Looper resumes through the existing `submit_questions` path.
- Event subscription and structured card mapping remain pending refinements.

## Phase 8: Validation And Completion

- [x] On Looper completion, fetch final loop record.
- [x] Read or summarize changed files and artifacts where appropriate.
- [ ] Compare outputs to `PlanArtifact.acceptanceChecks`.
- [x] Report pass/fail/partial status in chat.
- [ ] If acceptance checks fail, offer `Revise Plan`, `Continue Execution`, or `Stop`.
- [x] Add completion event with plan id, loop id, status, and acceptance summary.

Implemented baseline:

- Chat polls the final Looper record when the delegated run reports `completed`.
- Completion summary reads bounded versions of `work_summary.txt`, `validation_report.txt`, `review_result.txt`, and `review_feedback.txt`.
- Artifact excerpts are truncated to avoid large transcript/log dumps.
- Full acceptance-check comparison remains pending until structured `PlanArtifact` generation is wired into backend responses.

## Phase 9: Observability

- [x] Emit `chat.workflow.preflight`.
- [x] Emit `chat.workflow.discovery_started`.
- [x] Emit `chat.workflow.clarification_submitted`.
- [x] Emit `chat.workflow.plan_created`.
- [x] Emit `chat.workflow.plan_revised`.
- [x] Emit `chat.workflow.plan_approved`.
- [x] Emit `chat.workflow.delegation_started`.
- [x] Emit `chat.workflow.delegation_blocked`.
- [x] Emit `chat.workflow.delegation_completed`.
- [x] Emit `chat.workflow.acceptance_checked`.
- [x] Add correlation id from chat request through Looper start.

Implemented baseline:

- Workflow events are emitted from the chat service at every major state transition.
- Chat correlation id is passed into `LooperStartRequest`.
- Event payloads use ids/status/length metadata and avoid raw secret or large artifact contents.

## Phase 10: Testing

- [x] Unit test routing scorecard.
- [x] Unit test high-risk forced planning.
- [x] Unit test direct-execution bypass for small requests.
- [ ] Unit test structured clarification serialization.
- [ ] Unit test plan artifact serialization.
- [x] Unit test path validation.
- [ ] Unit test Looper start payload generation.
- [ ] Integration test discovery -> answer -> plan -> approve.
- [ ] Integration test approve -> Looper start.
- [ ] Integration test Looper blocked question -> chat answer -> resume.
- [ ] UI smoke test clarification card rendering.
- [ ] UI smoke test approval card rendering.
- [ ] UI smoke test delegated run status rendering.

Implemented baseline:

- Added Rust unit coverage for planning preflight routing, high-risk forced planning, direct chat bypass, workflow command parsing, and unsafe folder detection.
- Verified with `cargo test preflight --lib`.

## Phase 11: Rollout Strategy

- [x] Hide behind a feature flag: `chatPlanningDelegation`.
- [ ] Add setting for `Auto`, `Always plan large tasks`, and `Direct only`.
- [x] Default to `Auto`.
- [ ] Add debug display for route decision during development.
- [x] Start with code/project tasks only.
- [x] Expand to research/report/spreadsheet tasks after validation.
- [x] Keep manual Looper tool intact.

Implemented baseline:

- Runtime guard: `ARXELL_CHAT_PLANNING_DELEGATION=0|false|off|disabled` disables the workflow.
- Default behavior is automatic preflight planning.
- Manual Looper workspace tool remains unchanged.
- Settings-panel control and debug route UI remain pending.

## Open Decisions

- [ ] Should plan artifacts be stored in the conversation repo, memory, or a new workflow store?
- [ ] Should approval be a typed IPC action or a special chat message?
- [ ] Should chat launch Looper through invoke registry or a new app-service method?
- [ ] Should high-risk tasks require both chat approval and Looper planner review?
- [ ] Should project folder selection use the Files tool picker, text input, or both?
- [ ] Should completed PRDs be written into the target project folder as `task.md` or remain only in app state?

## Suggested Implementation Order

1. Add contracts and route scorecard.
2. Add chat workflow state and tool-blocking modes.
3. Add clarification card UI.
4. Add plan artifact UI and approval actions.
5. Add Looper handoff from approved plan.
6. Add delegated status card.
7. Add blocker-question bridge.
8. Add validation and completion summary.
9. Add tests and feature flag rollout.

## Done Criteria

- [x] Large ambiguous tasks no longer start tools immediately.
- [x] Primary chat asks focused prerequisite questions with suggested responses.
- [x] User can approve or revise a plan before delegation.
- [x] Approved plan includes a visible, enforced `project_folder`.
- [x] Looper starts only after approval.
- [x] Looper receives a complete execution brief.
- [x] Looper status is visible from chat.
- [x] Blocked Looper questions return to chat.
- [ ] Final response validates output against acceptance checks.
- [x] Small clear tasks still work without planning friction.
