# TTS Engine Panel Behavior

## Purpose
Define the current, expected behavior of the TTS panel and per-engine file layout.

This document is authoritative for current implementation. The older planning document in `docs/todo/TTS_KOKORO_INTEGRATION_PLAN.md` is historical context only.

## Engine Layout

Runtime TTS assets are normalized into per-engine folders under app data:

- `<app_data_dir>/tts/kokoro/`
- `<app_data_dir>/tts/piper/`
- `<app_data_dir>/tts/matcha/`
- `<app_data_dir>/tts/kitten/`

The backend migrates legacy/shared layouts into this per-engine structure and seeds shared assets (`tokens.txt`, `espeak-ng-data`) into each engine folder.

## Engine Requirements

- `kokoro`
  - Required: `model.onnx` (or equivalent Kokoro model), `voices.bin` (or compatible `.bin` voices file), `tokens.txt`, `espeak-ng-data/`.
  - Secondary path represents voices path and must resolve to `.bin`.
- `kitten`
  - Required: model ONNX, voices `.bin`, `tokens.txt`, `espeak-ng-data/`.
  - Secondary path represents voices path and must resolve to `.bin`.
- `matcha`
  - Required: model ONNX, vocoder ONNX, `tokens.txt`, `espeak-ng-data/`.
  - Secondary path represents vocoder path and must resolve to `.onnx`.
- `piper`
  - Required: model ONNX, `tokens.txt`, `espeak-ng-data/`.
  - Optional: lexicon `.txt` (secondary path).

## Engine Switch Behavior

When the `Engine` dropdown changes:

1. Clear engine-scoped fields immediately in UI:
   - `modelPath`
   - `secondaryPath`
   - `voicesPath`
   - `tokensPath`
   - `dataDir`
   - `pythonPath`
   - `scriptPath`
   - `lastBytes`, `lastDurationMs`, `lastSampleRate`
   - status/message reset to neutral state
2. Reset voice defaults for selected engine:
   - `kokoro` -> `af_heart`
   - all others -> `speaker_0`
3. Reset speed to `1.0`.
4. Persist selected engine in backend engine-specific settings store.
5. Re-resolve engine assets from selected model directory and/or per-engine app-data directory.

This prevents stale paths or incompatible assets from the previously-selected engine from leaking into the new engine state.

## Panel Visibility Rules

- Always visible:
  - Engine
  - Voice
  - Speed
  - Model Path
  - Tokens Path
  - Data Dir
- Conditionally visible:
  - `kokoro`: show `Voices Path`
  - `kitten`: show `Voices Path`
  - `matcha`: show `Vocoder Path`
  - `piper`: hide secondary-path row (lexicon is optional and auto-resolved when available)

## Regression Tests

Frontend unit coverage for these rules is in:

- `frontend/tests/ttsEngineRules.test.ts`

Run with:

- `cd frontend && npm run test`
