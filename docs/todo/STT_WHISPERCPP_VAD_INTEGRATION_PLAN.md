# STT + VAD Integration Plan (Whisper.cpp + Silero VAD)

## Goal
Ship a lean, reliable, fully local STT pipeline using Whisper.cpp (quantized `ggml-base-q8_0.bin`) with robust VAD, integrated into the existing STT panel and current app architecture.

## Source Baseline Reviewed
From `copy/`:
- Model: `copy/public/whisper/ggml-base-q8_0.bin`
- VAD model: `copy/src-tauri/resources/silero_vad.onnx`
- Voice capture/VAD logic: `copy/src-tauri/src/audio/capture.rs`, `copy/src-tauri/src/audio/vad.rs`
- Whisper.cpp path (persistent context): `copy/src-tauri/src/audio/stt.rs`, `copy/src-tauri/src/commands/voice.rs`
- DB defaults/migrations for STT+VAD: `copy/src-tauri/src/db/mod.rs`

## Architecture Fit (Current App)
Must follow `app/docs/ARCHITECTURE.md` + `GUARDRAILS.md`:
- Frontend panel only renders controls/status.
- IPC layer remains translation-only.
- New STT service handles orchestration/state.
- Platform/audio side effects isolated to tool modules.
- All operations emit structured `app:event` events with preserved `correlationId`.

## Scope (Phase 1)
1. "Voice-mode" toggle button on top of chat UI panel, apture in STT panel.
2. Local STT using Whisper.cpp (`whisper-rs`) with `ggml-base-q8_0.bin`.
3. Silero ONNX VAD with amplitude fallback.
4. Final transcript + optional partial transcript events.
5. Persist STT/VAD settings in SQLite (same DB family already used by app).
6. 
 

## Lean Reliability Decisions
1. Primary engine: `whisper-rs` (Whisper.cpp) only.
2. No Python STT daemon initially (reduces runtime/dependency risk).
3. Single bundled model target first: `ggml-base-q8_0.bin`.
4. VAD fallback chain: `Silero ONNX -> amplitude threshold`.

## Assets to Pull from `copy`
- `copy/public/whisper/ggml-base-q8_0.bin`
- `copy/src-tauri/resources/silero_vad.onnx`

Target locations in current app:
- `app/src-tauri/resources/whisper/ggml-base-q8_0.bin`
- `app/src-tauri/resources/silero_vad.onnx`

## Backend Plan

### 1. New Contracts
Add typed request/response payloads (camelCase) for:
- `SttStatusRequest/Response`
- `SttStartRequest/Response`
- `SttStopRequest/Response`
- `SttTranscribeOnceRequest/Response` (for manual test button)
- `SttSettingsGet/Set`

### 2. New Service + Modules
- Service: `app/src-tauri/src/app/stt_service.rs`
- Tool modules (side effects):
  - `audio_capture_tool.rs`
  - `vad_tool.rs`
  - `whisper_tool.rs`

### 3. Runtime State Machine
`idle -> listening -> speech_detected -> transcribing -> idle`
- Transitions emit start/progress/complete/error events.
- Stop command is idempotent.
- Capture thread and transcription tasks honor shared run flag + cancellation.

### 4. Event Taxonomy (app:event)
Use structured actions similar to llama runtime patterns:
- `stt.runtime.status`
- `stt.capture.start|progress|complete|error`
- `stt.vad.start|progress|complete|error`
- `stt.transcribe.start|progress|complete|error`
- `stt.transcript.partial` (progress)
- `stt.transcript.final` (complete)

Payload examples:
- `{ state, sampleRate, inputDevice, engineId }`
- `{ speechProb, rms, vadMode }`
- `{ text, isPartial, durationMs }`

### 5. Settings Persistence (SQLite)
Store keys (with defaults):
- `stt_engine = whisper_cpp`
- `whisper_model_path = <app_data>/whisper/ggml-base-q8_0.bin`
- `whisper_language = en`
- `vad_mode = auto`
- `vad_threshold = 0.35`
- `vad_min_silence_ms = 1100`
- `vad_speech_pad_pre_ms = 320`
- `vad_min_speech_ms = 50`
- `vad_max_speech_s = 30.0`
- `vad_amplitude_threshold = 0.005`

### 6. Startup Asset Deployment
On startup:
- Ensure `app_data_dir/whisper` exists.
- Copy bundled `ggml-base-q8_0.bin` if missing.
- Ensure `silero_vad.onnx` resolvable from resources.
- Emit verification event with file existence/size.

## STT Panel Plan
Use existing STT panel as target surface.

### UI Sections
1. `Engine`
- Whisper.cpp (local)
- Status: ready/missing model/error

2. `Input`
- Selected microphone
- Device refresh + selector

3. `Runtime`
- `Start Listening` / `Stop`
- Live state badge: Idle/Listening/Transcribing
- Optional amplitude meter

4. `Transcript`
- Partial line
- Final line / last N lines
- Copy button

5. `VAD` (at panel bottom, per request)
- Mode: Auto / ONNX / Amplitude
- Threshold + silence sliders
- Reset defaults

## Cross-Platform Plan
- Audio capture: `cpal` (Linux/macOS/Windows)
- Whisper inference: `whisper-rs`
- VAD ONNX: `tract-onnx` (CPU)
- No platform branching in service layer; only tool modules.

## Reliability Controls
- One active capture session max.
- Panic-safe teardown of stream/thread.
- Bound queue sizes and chunk sizes.
- Ignore known hallucination tokens on near-silence.
- Timeout guards for stalled transcription operations.
- Structured error codes (`STT_MODEL_MISSING`, `STT_DEVICE_UNAVAILABLE`, etc.).

## Test Plan

### Unit
- VAD chunk size + state reset.
- Whisper model path validation.
- State machine transitions.

### Integration
- Start/stop idempotency.
- Partial + final transcript event flow.
- Correlation ID propagation through all STT events.

### Manual Smoke (all OS)
1. Open STT panel.
2. Verify engine status ready.
3. Start listening, speak short sentence.
4. Observe partial then final transcript.
5. Stop and restart capture.
6. Verify logs show structured lifecycle events.

## Delivery Phases
1. `P1`: Contracts + service skeleton + status command + panel wiring.
2. `P2`: Capture + VAD + final transcript.
3. `P3`: Partial transcripts + settings persistence + diagnostics.
4. `P4`: Hardening (timeouts, error codes, stress tests).

## Acceptance Criteria
- STT works locally on Windows/macOS/Linux without Python.
- Model auto-deployed from bundled resource when missing.
- VAD controls in STT panel change runtime behavior.
- No silent failures; all failures observable in `app:event` and console.
