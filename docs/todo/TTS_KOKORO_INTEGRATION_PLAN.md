# TTS Integration Plan (Kokoro Quantized ONNX)

## Goal
Integrate local, stable Kokoro TTS using quantized ONNX with persistent runtime process, exposed via the existing TTS panel and aligned with current app contracts/events architecture.

## Source Baseline Reviewed
From `copy/`:
- Quantized model: `copy/public/voice/model_quantized.onnx`
- Voice bins: `copy/public/voice/af_heart.bin`, `copy/public/voice/af.bin`
- Persistent daemon script: `copy/src-tauri/resources/scripts/voice/tts_kokoro_persistent.py`
- Runtime prep scripts: `copy/scripts/prepare_kokoro_runtime.py`, `copy/scripts/verify_kokoro_runtime_archive.py`
- Runtime bootstrap + asset deployment: `copy/src-tauri/src/lib.rs`
- TTS orchestration + engine checks/self-test: `copy/src-tauri/src/commands/voice.rs`, `copy/src-tauri/src/audio/tts.rs`

## Architecture Fit (Current App)
- Frontend TTS panel = controls/status only.
- IPC commands = DTO translation.
- New TTS service = orchestration/lifecycle.
- Python subprocess management + audio synthesis side effects = tool module.
- Full structured event lifecycle via `app:event`.

## Scope (Phase 1)
1. Local Kokoro TTS path only (primary).
2. Persistent daemon process for low-latency repeated synthesis.
3. Runtime/bootstrap verification events.
4. TTS panel controls: engine status, voice selector, speak test, stop.
5. Return WAV bytes to frontend for playback.

Out of scope for Phase 1:
- Piper integration.
- External cloud TTS routing.
- Advanced prosody editor.

## Lean Reliability Decisions
1. Keep Kokoro in persistent Python daemon (matches proven path in `copy`).
2. Bundle per-platform Python runtime archives (no system Python dependency).
3. Bundle only quantized model (`model_quantized.onnx`) + one default voice (`af_heart.bin`) initially.
4. Add optional fallback to `af.bin` if selected voice missing.

## Assets to Pull from `copy`
- `copy/public/voice/model_quantized.onnx`
- `copy/public/voice/af_heart.bin`
- `copy/public/voice/af.bin`
- `copy/src-tauri/resources/scripts/voice/tts_kokoro_persistent.py`
- `copy/scripts/prepare_kokoro_runtime.py`
- `copy/scripts/verify_kokoro_runtime_archive.py`

Target locations in current app:
- `app/src-tauri/resources/voice/model_quantized.onnx`
- `app/src-tauri/resources/voice/af_heart.bin` (+ optional `af.bin`)
- `app/src-tauri/resources/scripts/voice/tts_kokoro_persistent.py`
- `app/scripts/prepare_kokoro_runtime.py`
- `app/scripts/verify_kokoro_runtime_archive.py`
- `app/src-tauri/resources/kokoro-runtime/kokoro-runtime-{os}-{arch}.zip`

## Backend Plan

### 1. New Contracts
Add typed commands/payloads:
- `TtsStatusRequest/Response`
- `TtsSpeakRequest/Response` (WAV bytes + metadata)
- `TtsStopRequest/Response`
- `TtsListVoicesRequest/Response`
- `TtsSelfTestRequest/Response`
- `TtsSettingsGet/Set`

### 2. New Service + Modules
- Service: `app/src-tauri/src/app/tts_service.rs`
- Tool module: `tts_kokoro_tool.rs`
- Optional helper module: `tts_runtime_bootstrap.rs`

### 3. Runtime Bootstrap Flow
At startup and on-demand self-test:
1. Ensure `app_data_dir/kokoro` exists.
2. Copy model/voice assets from bundle if missing.
3. Ensure runtime archive exists for current OS/arch.
4. Extract runtime to `app_data_dir/kokoro/runtime/venv` (idempotent + lock-guarded).
5. Verify python import check: `kokoro_onnx`, `onnxruntime`, `numpy`.
6. Persist resolved python path.

### 4. Persistent Daemon Lifecycle
- Lazy-start on first `tts.speak`.
- Reuse process across requests.
- Detect crash via `try_wait`; auto-restart once.
- Kill daemon on app shutdown.

### 5. Event Taxonomy (app:event)
- `tts.runtime.bootstrap.start|progress|complete|error`
- `tts.engine.status.complete|error`
- `tts.request.start|progress|complete|error`
- `tts.daemon.start|complete|error`
- `tts.daemon.restart.progress`

Payload examples:
- `{ engineId, pythonPath, modelPath, voicesPath, ok }`
- `{ requestId, textLength, voice, audioBytes, durationMs }`

### 6. Settings Persistence (SQLite)
Store keys:
- `tts_engine = kokoro`
- `kokoro_model_path = <app_data>/kokoro/model_quantized.onnx`
- `kokoro_voices_path = <app_data>/kokoro/af_heart.bin`
- `kokoro_voice = af_heart`
- `kokoro_python_path = <app_data>/kokoro/runtime/venv/.../python`

## TTS Panel Plan
Use current TTS panel as integration target.

### UI Sections
1. `Engine`
- Kokoro (quantized) status: ready / runtime missing / model missing

2. `Voice`
- Voice dropdown (start with `af_heart`, optional `af`)
- Speed control (safe range only)

3. `Test`
- Text input
- `Speak` and `Stop` actions
- Last synthesis metadata (duration, bytes, sample rate)

4. `Diagnostics`
- Runtime bootstrap result
- Self-test action and status

## Cross-Platform Plan
- Runtime archive per target:
  - Linux x86_64/aarch64
  - macOS x86_64/aarch64
  - Windows x86_64/aarch64
- Keep subprocess flags platform-specific inside tool module only.
- Ensure no-window spawn on Windows.
- Ensure child cleanup on Linux/macOS process exit.

## Reliability Controls
- Mutex-guarded daemon handle to serialize request protocol.
- Length-prefixed protocol sanity limits.
- Strict validation for model/voices/python paths before speak.
- Clear error codes (`TTS_MODEL_MISSING`, `TTS_RUNTIME_IMPORT_FAILED`, `TTS_DAEMON_IO_ERROR`, etc.).
- Self-test command for quick operator diagnosis.

## Test Plan

### Unit
- Runtime path resolution + archive selection.
- Daemon restart behavior.
- Settings defaults and migration safety.

### Integration
- Bootstrap extracts runtime and passes import check.
- Speak returns non-empty WAV bytes.
- Repeated speaks avoid cold-start regression.

### Manual Smoke (all OS)
1. Open TTS panel.
2. Verify runtime ready status.
3. Run self-test.
4. Speak sample text and hear playback.
5. Restart app and verify no re-bootstrap regression when already valid.

## Delivery Phases
1. `P1`: contracts + service skeleton + status/self-test wiring.
2. `P2`: bootstrap + asset deployment + runtime verification.
3. `P3`: persistent daemon speak path + panel controls.
4. `P4`: hardening + recovery + full cross-platform CI validation.

## Acceptance Criteria
- Kokoro quantized TTS works locally on Windows/macOS/Linux.
- Runtime is self-healing and does not require user-installed Python.
- TTS panel shows actionable status/errors and supports test playback.
- All lifecycle/error paths are observable via structured `app:event` logs.
