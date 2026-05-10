# STT / VAD Migration Plan

Last updated: 2026-05-06

## Objective

Migrate the app to a simpler and higher-quality speech pipeline:

- `whisper.cpp` becomes the only user-facing STT engine.
- Strong VAD remains a first-class capability.
- `sherpa-onnx` is removed from the STT engine selection path.
- Long-term target: replace Sherpa-backed Silero VAD with direct ONNX Runtime inference.

This keeps the user experience strong while reducing architectural duplication and making STT behavior easier to reason about.

## Target Architecture

### User-facing

- One STT engine: `whisper.cpp`
- Clear model options in STT panel:
  - bundled default: Whisper Base
  - optional downloads: Whisper Tiny and any future Whisper variants
- VAD settings remain configurable in the voice/VAD workflow

### Internal

- STT recognition:
  - `whisper.cpp` only
- VAD:
  - short term: current browser VAD + existing backend Silero gate
  - medium term: browser VAD + direct ONNX Silero backend gate
- Voice runtime:
  - keep strategy registry, shadow evaluation, and handoff architecture

## Guiding Principles

- Do not regress wake/speak/interrupt responsiveness.
- Remove user-facing complexity before removing backend infrastructure.
- Preserve rollback points between phases.
- Prefer measurement over assumptions for VAD quality decisions.
- Separate STT recognition decisions from VAD decisions.

## Current State

### STT

- User-facing STT uses `whisper.cpp`.
- Legacy persisted Sherpa recognizer preferences migrate to Whisper.
- STT panel already supports local Whisper model handling.

### VAD

- Frontend browser VAD exists via `@ricky0123/vad-web`
- Backend Silero VAD gate uses direct ONNX Runtime when `silero_vad.onnx` is installed.
- Voice runtime already supports pluggable VAD strategies:
  - `ONNX Silero`
  - `energy_basic`
  - `microturn_v1`
  - `hybrid_interrupt`

## Desired End State

- STT engine dropdown no longer exposes Sherpa.
- Whisper model UX is the only STT model UX.
- Sherpa is no longer used as a recognizer.
- Strong model-based backend VAD remains available.
- Backend model-based VAD is implemented directly through ONNX Runtime rather than through Sherpa.
- If Sherpa remains at all, it is only temporary and internal.

## Phase Plan

## Phase 1: Lock Product Direction

- [ ] Confirm final product contract:
  - Whisper is the only STT engine
  - Whisper Base remains bundled default
  - Whisper Tiny remains optional download
  - Sherpa no longer appears as a recognizer choice
- [ ] Define supported STT modes:
  - standard transcription
  - barge-in
  - voice session / duplex
- [ ] Define minimum quality bar for VAD:
  - false-start tolerance
  - interruption responsiveness
  - noisy-room performance
  - low-volume speech detection

### Acceptance

- Team agrees that STT engine choice will be removed from user-facing UX.
- Team agrees that model-based VAD remains required.

## Phase 2: Remove Sherpa From User-Facing STT UX

- [x] Remove `sherpa-onnx` from the STT backend dropdown in the panel.
- [x] Update frontend copy so STT is framed only around Whisper.
- [x] Remove Sherpa recognizer-specific download messaging from STT UI.
- [x] Keep existing Whisper download UI:
  - bundled Base
  - optional Tiny
- [x] Preserve backend compatibility temporarily so old saved state does not hard-crash.
- [x] Add migration handling for persisted `sherpa_onnx` backend preferences:
  - map to `whisper_cpp`
  - show soft one-time message if necessary

### Acceptance

- UI no longer presents Sherpa as an STT engine.
- Existing users with saved Sherpa preference are migrated safely.
- No STT panel feature regression for Whisper users.

## Phase 3: Remove Sherpa From STT Recognition

- [x] Remove Sherpa recognizer path from backend STT routing.
- [x] Keep backend Silero VAD gate intact for now.
- [x] Keep frontend `vad-web` path intact.
- [x] Remove Sherpa recognizer model listing from `stt_list_models`.
- [x] Remove Sherpa recognizer download handling from STT panel flow.
- [x] Replace VAD-only Sherpa wiring with direct ONNX Silero boundaries.

### Acceptance

- Recognition path is Whisper-only.
- Backend VAD quality remains unchanged.
- No recognizer code path still depends on Sherpa model formats.

## Phase 4: Benchmark Current VAD Stack

- [x] Build a small VAD evaluation harness using representative audio:
  - quiet speech
  - noisy room speech
  - keyboard/background noise
  - interruptions
  - low-volume speech
  - clipped/short utterances
- [x] Measure:
  - speech onset latency
  - speech end latency
  - false-positive rate
  - false-negative rate
  - interruption responsiveness
- [x] Compare:
  - browser `vad-web`
  - backend ONNX Silero
  - current heuristic strategies

### Acceptance

- We have benchmark harness support before replacing production VAD.
- We know which layers are materially contributing to quality.

## Phase 5: Implement Direct ONNX Silero VAD

- [x] Introduce a new backend VAD strategy:
  - `onnx-silero`
- [x] Reuse existing ONNX runtime infrastructure where possible:
  - `ort-sys`
  - dynamic runtime loading
  - existing resource resolution patterns
- [x] Define explicit Silero inference contract:
  - frame size
  - sample rate
  - recurrent state handling
  - probability thresholding
  - hysteresis logic
- [x] Match current VAD event model to existing `VadStrategy` outputs.
- [x] Keep implementation behind feature-safe internal boundary so it can be shadow-tested first.

### Acceptance

- Direct ONNX Silero VAD compiles and runs on supported platforms.
- It integrates with the existing VAD strategy registry cleanly.

## Phase 6: Shadow Evaluation

- [x] Add `onnx-silero` to VAD registry as an alternate method.
- [x] Run shadow evaluation in the existing voice runtime:
  - active method vs shadow method
- [x] Record disagreement summaries:
  - onset mismatch
  - end mismatch
  - interruption mismatch
  - over-trigger / under-trigger
- [x] Compare against benchmark clips and real interactive sessions.
- [x] Tune thresholds and hysteresis until parity or better is reached.

### Acceptance

- `onnx-silero` uses the prior production hysteresis defaults and supports shadow evaluation.
- Shadow evaluation shows acceptable disagreement rates.

## Phase 7: Cut Over Production VAD

- [x] Make direct ONNX Silero the default model-based backend VAD method.
- [x] Keep fallback behavior available without Sherpa dependency.
- [x] Re-run duplex and interruption smoke tests.
- [x] Re-run STT latency and barge-in acceptance checks.

### Acceptance

- Production VAD no longer depends on Sherpa for primary operation.
- Voice session behavior remains stable.

## Phase 8: Remove Sherpa Dependency

- [x] Remove Sherpa Silero strategy from registry.
- [x] Remove `sherpa-onnx` dependency and related model download logic.
- [x] Remove dead code paths from:
  - STT backend routing
  - model listing
  - model download UI
  - runtime messaging
- [x] Update docs and dependency inventory.
- [x] Re-measure app size and dependency graph reduction.

### Acceptance

- `sherpa-onnx` no longer ships with the app.
- No STT or VAD user-facing regression remains.

## Risks

### Primary Risks

- Direct ONNX Silero implementation may initially underperform the previous wrapper behavior.
- Browser `vad-web` and backend VAD may diverge in edge cases, causing confusing behavior.
- Duplex/handoff paths may reveal VAD timing assumptions not obvious in standard transcription.

### Mitigations

- Keep phases discrete.
- Preserve shadow evaluation until parity is proven.
- Keep benchmark and shadow evaluation paths active until production confidence is established.
- Keep calibrated energy fallback when `silero_vad.onnx` is absent or ONNX Runtime fails to initialize.

## Test Plan

### Functional

- [ ] Start/stop STT
- [ ] Whisper Base transcription
- [ ] Whisper Tiny download and selection
- [ ] mic permission flow
- [ ] no-mic flow
- [ ] long utterance handling
- [ ] short utterance handling

### Voice UX

- [ ] barge-in while TTS is active
- [ ] interruption during duplex session
- [ ] fast turn-taking
- [ ] quiet speaker
- [ ] noisy background

### Platform

- [ ] Linux
- [ ] Windows
- [ ] macOS

### Packaging

- [ ] only required STT/VAD runtime assets ship per platform
- [ ] no Sherpa recognizer assets remain once removed
- [ ] no broken resource resolution after platform-specific bundling

## Rollback Strategy

- Phase 2 rollback:
  - restore Sherpa option in UI if migration logic causes user regressions
- Phase 5/6 rollback:
  - switch active VAD to `energy-basic` while direct ONNX Silero remains shadow-only
- Phase 7 rollback:
  - switch active VAD method back to `energy-basic` if quality regression appears

## Success Criteria

- Users see one STT engine, not two.
- Whisper remains reliable across Linux, Windows, and macOS.
- VAD quality is equal or better than today.
- Voice interruption and handoff behavior does not regress.
- App dependency surface and shipped size are lower after Sherpa removal.
