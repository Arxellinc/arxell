# Key Process Traces

Detailed traces of the most critical code paths in ARX.

---

## Trace 1: Chat Message with Streaming Response

**User action:** User types a message and presses Enter.

```
[Frontend - ChatInput component]
  │
  ├── invoke("cmd_chat_stream", { message, conversation_id, model_config })
  │
[Rust - commands/chat.rs :: cmd_chat_stream]
  │
  ├── Acquire AppState
  ├── Load conversation history from arx.db
  │   └── SELECT messages WHERE conversation_id = ?
  │
  ├── Determine routing:
  │   ├── Local model? → build URL from AppState.local_server.url
  │   └── API model?  → load API key from settings DB
  │
  ├── Build request payload (OpenAI-compatible format)
  │   ├── system prompt
  │   ├── message history
  │   └── tool definitions (if tools enabled)
  │
  ├── POST to provider (reqwest streaming)
  │   └── while let Some(chunk) = stream.next().await
  │         ├── Parse SSE chunk
  │         ├── emit("chat:delta", { delta, generation_id })  → Frontend receives token
  │         └── accumulate full response
  │
  ├── Check cancel flag (chat_cancel AtomicBool) each iteration
  │   └── If set → break stream, emit("chat:cancelled")
  │
  ├── On stream end:
  │   ├── Persist assistant message to arx.db
  │   └── emit("chat:message", { full_message })
  │
[Frontend]
  ├── Receives chat:delta events → appends to message buffer
  ├── Receives chat:message → finalizes message in store
  └── Re-renders message list
```

**Timing profile:**
- DB read: < 5ms (typical)
- First token latency: 100ms–2000ms (depends on model/provider)
- Streaming: continuous until stop
- DB write: < 10ms

**Failure modes:**
1. Provider returns error → error emitted, shown to user ✓
2. User cancels → atomic flag set, stream broken ✓
3. Network timeout → reqwest timeout fires; error emitted ✓
4. Local server not running → connection refused; error surfaces as generic "failed" ✗ (not specific enough)
5. DB write fails after streaming → message lost, no retry ✗

---

## Trace 2: Agent Turn (arx-rs / agent crate)

**Entry:** `Agent::run_collect(query, images, cancel)`

```
Agent::run_collect
  │
  ├── Build user Message (text or text+images)
  ├── session.append_message(user_message)
  │
  └── loop turn 1..max_turns:
        │
        ├── Check cancel watch channel
        │
        ├── run_single_turn(provider, session.messages(), tools, system_prompt, turn, cancel)
        │   │
        │   ├── provider.stream(messages, system_prompt, tool_defs)
        │   │   └── Retry loop: [attempt 1, 2s wait, attempt 2, 4s wait, attempt 3, 8s wait, fail]
        │   │
        │   ├── Consume StreamParts:
        │   │   ├── Think → emit ThinkingStart/Delta/End
        │   │   ├── Text  → emit TextStart/Delta/End
        │   │   ├── ToolCallStart/Delta → buffer tool call args
        │   │   └── Done  → record stop_reason
        │   │
        │   ├── Parse all tool calls (JSON parse of accumulated args string)
        │   │
        │   └── Execute tools sequentially:           ← SEQUENTIAL (optimization opportunity)
        │         for p in pending_tools:
        │           result = tool.execute(args, cancel).await
        │           emit ToolResult event
        │
        ├── session.append_message(assistant_message)
        ├── session.append_message(tool_results)
        │
        ├── check_compaction():
        │   ├── Measure last_usage.input_tokens vs context_window
        │   └── If overflow:
        │         generate_summary(all_messages, provider, system_prompt)  ← BLOCKS INFERENCE
        │         session.append_compaction(summary)
        │
        └── if stop_reason != ToolUse → break
  │
  └── emit AgentEnd { stop_reason, total_turns, total_usage }
```

**Key observations:**
1. Tools are sequential — `for p in pending` runs one at a time. For file reads and bash calls that could parallelize, this wastes time
2. Compaction calls the same provider — so a compaction summary generation blocks all other inference on a local single-instance model
3. `run_collect` returns `Vec<Event>` — the entire event log. The Tauri UI layer cannot stream these in real time; it must run a parallel streaming path
4. Session message accumulation is unbounded until compaction triggers; a poorly configured `context_window` threshold will cause OOM on large conversations

---

## Trace 3: Local LLM Server Startup

**User action:** User selects a local GGUF model.

```
[Frontend - LLM settings / cmd_model_load]
  │
  ├── invoke("cmd_model_load", { model_path, n_gpu_layers, ctx_size, ... })
  │
[Rust - commands/model.rs]
  │
  ├── Check if existing server matches requested params
  │   ├── If match AND server alive → return existing URL (fast path)
  │   └── If mismatch or dead → unload and reload
  │
  ├── Acquire local_server Mutex
  ├── Drop existing LocalServerHandle (kills the process via Drop impl)
  │
  ├── engine_installer::start_server(model_path, params)
  │   │
  │   ├── Determine engine binary:
  │   │   ├── Read LLAMA_CPP_BACKEND from env (set at build time)
  │   │   └── Locate binary in app resources
  │   │
  │   ├── Spawn subprocess: llama-server --model ... --port ... --ngl ...
  │   │
  │   ├── Poll health endpoint (GET /health) with timeout
  │   │   └── Retry every 200ms for up to 60 seconds
  │   │
  │   └── Return LocalServerHandle { child, pid, url, ... }
  │
  ├── Write state file (PID persistence for adoption on restart)
  │
  └── Update AppState.local_server
```

**Timing profile:**
- Small quantized model (3B Q4): 2–5 seconds to first healthy response
- Large model (70B Q4 on consumer GPU): 10–60 seconds
- Model already in VRAM (adoption): < 1 second

**Failure modes:**
1. Binary not found → error returned ✓
2. GPU OOM → llama-server crashes immediately; health poll times out after 60 seconds ✗ (slow failure)
3. Port already in use → server fails to bind; detected via health timeout ✗ (not specific)
4. Model file corrupt → server crashes; detected via health timeout ✗ (not specific)

**Improvement opportunity:** Parse llama-server stderr for early error messages rather than waiting for the full health timeout. This would turn 60-second timeouts into 2-second failures with a specific error.

---

## Trace 4: Voice Pipeline (STT Path)

```
[User presses mic button]
  │
  ├── invoke("cmd_voice_start")
  │
[Rust - commands/voice.rs → audio/capture.rs]
  │
  ├── Start CPAL audio capture (default input device, 16kHz mono)
  │
  ├── Audio capture loop:
  │   └── while capturing:
  │         raw_samples → audio_buffer (Mutex<Vec<f32>>)
  │         run Silero VAD on chunk (tract-onnx inference)
  │         ├── VAD: no speech → discard samples
  │         └── VAD: speech detected → accumulate speech buffer
  │               └── on speech end (silence detected):
  │                     Send speech buffer to STT
  │
  ├── STT dispatch:
  │   ├── whisper-rs path (Linux/macOS default):
  │   │   whisper_rs_ctx.full(speech_buffer)  → transcription
  │   └── Python daemon path (Windows or fallback):
  │       HTTP POST to localhost:PORT/transcribe
  │
  └── On transcription:
        emit("voice:transcript", { text })
        → Frontend receives → populates chat input
```

**Issues:**
- The `audio_buffer: Mutex<Vec<f32>>` in AppState is a naive accumulation buffer with no ring-buffer semantics. If the consumer (VAD) is slower than capture, the buffer grows unboundedly
- VAD runs synchronously in the capture loop callback — on slow CPUs this can cause audio dropouts
- The `whisper-rs` path blocks an OS thread during inference (no async wrapper)
- On Windows, whisper-rs is not available (compilation issue with MSVC/clang-cl); falls back to Python daemon, which requires a working Python + whisper install
- Device hot-plug (user switches headset) is detected but the reconciliation may leave the capture loop running on the old device briefly

---

## Trace 5: A2A Workflow Run

**Current state (as-built):**

```
[Frontend - FlowPanel]
  │
  ├── invoke("cmd_a2a_workflow_run", { workflow_id, input })
  │
[Rust - commands/a2a_workflow.rs]
  │
  ├── acquire_run_permit(workflow_id)
  │   └── Check global (max 4) and per-workflow (max 2) concurrency limits
  │
  ├── Load workflow definition from a2a.db
  │
  ├── Create WorkflowRun record in a2a.db (status: running)
  │
  ├── spawn tokio::task:
  │   └── Execute workflow nodes...
  │       (CURRENT GAP: actual node execution logic is not in a2a_workflow.rs)
  │       (Execution appears to be delegated back to frontend or tool_gateway)
  │
  ├── emit("a2a:workflow_changed", { kind: "run_started", workflow_id, run_id })
  │
  └── Return run_id to frontend

[Frontend]
  ├── Listen for a2a:workflow_changed events
  └── Poll run status via invoke("cmd_a2a_workflow_get_run", { run_id })
```

**Critical gap:** The workflow engine stores and tracks runs but does not currently execute autonomous agent turns. The "execution" relies on the frontend orchestrating calls. This is the central piece that needs to be built for true REPL loops.

---

## Trace 6: Startup Sequence (Detailed)

```
lib.rs::run()
  │
  ├── [T+0ms]   init_logging()
  ├── [T+5ms]   determine app_data_dir
  ├── [T+10ms]  init arx.db (CREATE TABLE IF NOT EXISTS ...)
  ├── [T+15ms]  init a2a.db
  │
  ├── [T+50ms]  deploy_whisper_models()
  │             Read bundled whisper model from resources/
  │             Write to app_data_dir/whisper/ if not present
  │             → On first run: ~500ms for a small model
  │
  ├── [T+600ms] bootstrap_kokoro_runtime()
  │             Extract kokoro-runtime ZIP → app_data_dir/kokoro/
  │             Validate Python imports
  │             → On first run: 5–30 seconds
  │             → Subsequent runs: ~100ms (files already extracted)
  │
  ├── [T+?s]    adopt_or_cleanup_llama_server()
  │             Read state file
  │             If PID alive: adopt (fast)
  │             If PID dead: cleanup state file
  │
  ├── [T+?s]    spawn system usage emitter thread (background, ~1Hz)
  │
  ├── [T+?s]    Register Tauri command handlers
  │
  └── [T+?s]    Show main window
                → USER SEES BLANK WINDOW until this point
```

**Key problem:** The user sees nothing until the entire startup sequence completes. Steps 3–5 (model deployment, Kokoro bootstrap) can take 5–30 seconds on first run, during which the window is blank or unresponsive.

**Fix strategy (no code today):**
1. Show the window immediately after DB init
2. Emit startup progress events from async background tasks
3. The frontend shows a loading screen driven by those events
4. Heavy tasks (Kokoro bootstrap) run concurrently with the window being shown
