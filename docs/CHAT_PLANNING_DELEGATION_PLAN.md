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

- [ ] Define the user-visible states: `normal`, `discovery`, `awaiting_plan_approval`, `delegated_execution`, `blocked`, `completed`, `failed`.
- [ ] Define the chat message UI for clarification cards.
- [ ] Define the chat message UI for plan approval cards.
- [ ] Define the chat message UI for delegated run status cards.
- [ ] Decide whether plan/revision actions are rendered as inline chat buttons or composer-adjacent actions.
- [ ] Add copy rules for concise questions with defaults and 2-6 options.
- [ ] Add UX rule: every clarification question must allow custom text.
- [ ] Add UX rule: every PRD must visibly show `project_folder`.
- [ ] Add UX rule: approval button is disabled until `project_folder` is present.

## Phase 2: Shared Contracts

- [ ] Add `ChatWorkflowMode`.
- [ ] Add `ClarificationQuestion`.
- [ ] Add `ClarificationOption`.
- [ ] Add `ClarificationAnswer`.
- [ ] Add `PlanArtifact`.
- [ ] Add `PlanApprovalRequest`.
- [ ] Add `DelegationStartRequest`.
- [ ] Add `DelegationStatusCard`.
- [ ] Add `PlanDelta` for scope changes during execution.
- [ ] Mirror contracts in Rust `src-tauri/src/contracts.rs`.
- [ ] Mirror contracts in TypeScript `frontend/src/contracts.ts`.

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
}
```

## Phase 3: Chat Service State Machine

- [ ] Add conversation-level workflow state in the chat service.
- [ ] Persist active workflow state with the conversation.
- [ ] Add preflight function before agent tool selection.
- [ ] Block tool binding when mode is `discovery` or `awaiting_plan_approval`.
- [ ] Add deterministic route decision metadata for observability.
- [ ] Add planner prompt template for discovery questions.
- [ ] Add planner prompt template for PRD generation.
- [ ] Add plan revision handling.
- [ ] Add approval handling.
- [ ] Add cancellation/stop handling for active delegation.
- [ ] Add fallback when the selected model cannot emit structured planning data.

## Phase 4: Frontend Chat UI

- [ ] Extend chat message model to support structured assistant payloads.
- [ ] Render clarification questions as selectable cards/chips.
- [ ] Support one-click recommended defaults.
- [ ] Support custom answer text per question.
- [ ] Add `Submit Answers` action.
- [ ] Render PRD/plan artifact with compact summary and expandable details.
- [ ] Add `Approve Plan` action.
- [ ] Add `Revise Plan` action.
- [ ] Render delegated run status with phase, status, and Looper link.
- [ ] Render blocked Looper questions using the same clarification component.
- [ ] Preserve accessibility labels and keyboard support.
- [ ] Keep CSS in global shared components unless truly chat-specific.

## Phase 5: Looper Handoff

- [ ] Add a chat-service method to start Looper through the invoke/service boundary.
- [ ] Start Looper only after approved plan id/hash is present.
- [ ] Set Looper `cwd` from `PlanArtifact.projectFolder`.
- [ ] Set Looper `projectDescription` from the approved brief.
- [ ] Set Looper `phasePrompts` from the approved brief.
- [ ] Default `reviewBeforeExecute` to `false` for chat-approved plans.
- [ ] Keep `reviewBeforeExecute = true` for high-risk plans if a second Looper review is desired.
- [ ] Include explicit instruction that execution must stay inside `projectFolder`.
- [ ] Include explicit instruction to request a `PlanDelta` if scope changes.
- [ ] Store chat conversation id and plan id on the Looper record or correlation metadata.

## Phase 6: Path And Safety Enforcement

- [ ] Validate `projectFolder` exists or can be created.
- [ ] Reject empty, root, home, system, or ambiguous project folders.
- [ ] Normalize and canonicalize `projectFolder`.
- [ ] Add path-boundary checks before starting delegated execution.
- [ ] Add event warnings when requested work exceeds the approved folder.
- [ ] Add stop condition for destructive actions outside the plan.
- [ ] Add "plan delta required" behavior for scope expansion.
- [ ] Ensure logs do not include secrets or large file contents.

## Phase 7: Looper Blocker Integration

- [ ] Subscribe chat orchestration to `looper.planner.review_ready` and blocked-loop events.
- [ ] Map `LooperQuestion` to `ClarificationQuestion`.
- [ ] Render blocked questions in chat.
- [ ] Submit answers through existing `looper submit-questions`.
- [ ] Resume Looper after answers.
- [ ] Record the blocker and answer in the chat transcript.
- [ ] Add timeout/error behavior if Looper cannot resume.

## Phase 8: Validation And Completion

- [ ] On Looper completion, fetch final loop record.
- [ ] Read or summarize changed files and artifacts where appropriate.
- [ ] Compare outputs to `PlanArtifact.acceptanceChecks`.
- [ ] Report pass/fail/partial status in chat.
- [ ] If acceptance checks fail, offer `Revise Plan`, `Continue Execution`, or `Stop`.
- [ ] Add completion event with plan id, loop id, status, and acceptance summary.

## Phase 9: Observability

- [ ] Emit `chat.workflow.preflight`.
- [ ] Emit `chat.workflow.discovery_started`.
- [ ] Emit `chat.workflow.clarification_submitted`.
- [ ] Emit `chat.workflow.plan_created`.
- [ ] Emit `chat.workflow.plan_revised`.
- [ ] Emit `chat.workflow.plan_approved`.
- [ ] Emit `chat.workflow.delegation_started`.
- [ ] Emit `chat.workflow.delegation_blocked`.
- [ ] Emit `chat.workflow.delegation_completed`.
- [ ] Emit `chat.workflow.acceptance_checked`.
- [ ] Add correlation id from chat request through Looper start.

## Phase 10: Testing

- [ ] Unit test routing scorecard.
- [ ] Unit test high-risk forced planning.
- [ ] Unit test direct-execution bypass for small requests.
- [ ] Unit test structured clarification serialization.
- [ ] Unit test plan artifact serialization.
- [ ] Unit test path validation.
- [ ] Unit test Looper start payload generation.
- [ ] Integration test discovery -> answer -> plan -> approve.
- [ ] Integration test approve -> Looper start.
- [ ] Integration test Looper blocked question -> chat answer -> resume.
- [ ] UI smoke test clarification card rendering.
- [ ] UI smoke test approval card rendering.
- [ ] UI smoke test delegated run status rendering.

## Phase 11: Rollout Strategy

- [ ] Hide behind a feature flag: `chatPlanningDelegation`.
- [ ] Add setting for `Auto`, `Always plan large tasks`, and `Direct only`.
- [ ] Default to `Auto`.
- [ ] Add debug display for route decision during development.
- [ ] Start with code/project tasks only.
- [ ] Expand to research/report/spreadsheet tasks after validation.
- [ ] Keep manual Looper tool intact.

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

- [ ] Large ambiguous tasks no longer start tools immediately.
- [ ] Primary chat asks focused prerequisite questions with suggested responses.
- [ ] User can approve or revise a plan before delegation.
- [ ] Approved plan includes a visible, enforced `project_folder`.
- [ ] Looper starts only after approval.
- [ ] Looper receives a complete execution brief.
- [ ] Looper status is visible from chat.
- [ ] Blocked Looper questions return to chat.
- [ ] Final response validates output against acceptance checks.
- [ ] Small clear tasks still work without planning friction.
