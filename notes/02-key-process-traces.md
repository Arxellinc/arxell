# Key Process Traces (Plain English + Technical)

## 1. Chat Turn (Primary Agent)

### Plain English
1. User sends a prompt.
2. The app stores the user message in SQLite.
3. It chooses API or local model source.
4. Streaming response chunks are emitted to the UI.
5. Final assistant content is stored in SQLite.
6. If enabled, cache prefill warmup runs for next-turn latency.

### Technical path
- Frontend: chat panel/store -> `cmd_chat_stream`.
- Backend: `src-tauri/src/commands/chat.rs`.
- Event path: `chat:chunk` and `chat:error`.
- Persistence: `messages` table update + conversation timestamp update.

## 2. Voice Loop (Capture -> STT -> Chat -> TTS)

### Plain English
1. Voice start enables capture loop.
2. VAD segments speech into utterances.
3. STT transcribes utterances (persistent daemon path supported).
4. Transcript is sent to chat.
5. Agent response may speak with barge-in handling.

### Technical path
- Frontend: `useVoiceEvents` listens to `voice:*` events.
- Backend start/stop: `cmd_voice_start` / `cmd_voice_stop`.
- Audio capture + VAD loop: `audio/capture.rs`.
- STT daemon and process lifecycle: `audio/stt.rs`.

## 3. Flow Run (Current A2A Workflow Runtime)

### Plain English
1. User starts workflow run from Flow panel.
2. Backend creates a run record in `a2a.db`.
3. Runtime validates DAG ordering and executes nodes in topo order.
4. Each node emits trace events and writes node-run records.
5. Run status becomes `succeeded`, `failed`, or `timed_out`.

### Technical path
- Frontend: `FlowPanel` -> `a2aWorkflowRunStart`.
- Backend command: `cmd_a2a_workflow_run_start`.
- Engine: `execute_workflow_run` + `execute_node`.
- Events: `a2a:run_trace_chunk`, `a2a:workflow_changed`.
- Persistence: `a2a_workflow_runs`, `a2a_workflow_node_runs`, observability events.

## 4. Agent/Project Delegation Surface (Event-Sourced)

### Plain English
1. Process is created.
2. Agent runs and tasks are registered.
3. Status transitions and dependency edges are recorded as events.
4. UI can inspect process detail and event history.

### Technical path
- Commands: `cmd_a2a_process_*`, `cmd_a2a_agent_card_*`.
- Runtime: `A2ARuntime` in `a2a/runtime.rs`.
- Storage: event append and derived views in A2A store.

## 5. Tool Invocation Guardrail Path

### Plain English
1. Tool invocation request includes `tool_id`, `action`, `mode`, payload.
2. Policy matrix checks whether action and mode are allowed.
3. Optional root/sandbox guards enforce path/process constraints.
4. Action is executed and audited.

### Technical path
- Entry: `cmd_tool_invoke`.
- Policy table: `TOOL_POLICIES` in `commands/tool_gateway.rs`.
- Guard checks: mode allowance + root guard for sandbox writes.

## Trace-Based Observations for Ralph Loops
- Core execution trace infrastructure already exists and is reusable.
- Missing piece is durable long-duration orchestration semantics:
  - resume tokens/checkpoints,
  - queue/scheduler separation,
  - heartbeat/lease for worker ownership,
  - stronger retry/idempotency model.
