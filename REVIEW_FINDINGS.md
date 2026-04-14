# Voice Feature & TTS Panel Review Findings

**Date:** 2026-04-14  
**Reviewer:** Code Review  
**Scope:** Voice/TTS feature, TTS panel UI, voice download flow, model resources, gitignore

---

## 1. Architecture Overview

### Backend (TTS State Machine)
- **Location:** [`src-tauri/src/tts/mod.rs`](src-tauri/src/tts/mod.rs)
- **State:** `TTSState` holds `Arc<Mutex<HashMap<String, SherpaEngine>>` — engine is cached by engine key
- **Engines supported:** Kokoro, Piper, Matcha, Kitten (via `TtsEngine` enum at line 142)
- **Default:** Kokoro (line 28: `DEFAULT_ENGINE`)
- **Engine selection:** `TtsEngine::from_str()` at line 150, mapping UI strings to internal enum
- **Engine keys:** `"kokoro"`, `"piper"`, `"matcha"`, `"kitten"` (used for multi-engine settings isolation)
- **Engine IDs:** `"sherpa-kokoro"`, `"sherpa-piper"`, `"sherpa-matcha"`, `"sherpa-kitten"` (for UI/responses)

### Frontend Panel
- **Location:** [`frontend/src/panels/ttsPanel.ts`](frontend/src/panels/ttsPanel.ts)
- **Engine rules/metadata:** [`frontend/src/tts/engineRules.ts`](frontend/src/tts/engineRules.ts)
- **State type:** `PrimaryPanelRenderState.tts` (from [`frontend/src/panels/types.ts`](frontend/src/panels/types.ts))

---

## 2. Voice Download / Model Fetching Flow

### Kokoro Download (lines 1381-1477 in `src-tauri/src/tts/mod.rs`)

1. User selects Kokoro engine, clicks download button in TTS panel
2. Frontend calls `TtsDownloadModelRequest` with URL from `KOKORO_BUNDLE_OPTIONS` (two presets: v1.1 Multi-Lang ~109 MB, v0.19 English ~128 MB)
3. Backend `download_model()` (line 1381):
   - Validates engine is Kokoro (line 1397) — **returns graceful error for non-Kokoro**
   - Uses `reqwest::blocking::Client` to download `.tar.bz2` archive (line 1419-1427)
   - Writes to `kokoro_dir/model-download.tar.bz2` (line 1415)
   - Decompresses with `BzDecoder` and untars to `kokoro_dir` (lines 1434-1440)
   - Deletes archive after extraction (line 1442)
   - Shuts down engine, calls `ensure_assets()` to re-resolve paths
   - Returns resolved paths (model, voices, tokens, data_dir)

### Asset Resolution (`ensure_assets()` at line 726)
1. Creates `kokoro_dir` in app data directory
2. If bundled resources exist at `resources/voice` or `voice`, copies them to `kokoro_dir`
3. Loads persisted TTS settings
4. Calls `resolve_paths_for_settings()` to auto-detect model/voices/tokens/data_dir

### Path Resolution Strategy (complex, lines 401-519)
The system has a sophisticated multi-tier fallback chain:
- **User-configured paths** (highest priority, from settings)
- **Companion files in model directory** (`model_parent_dir()` looks alongside the model file)
- **kokoro_dir defaults** (kokoro-v0_19.int8.onnx, model.int8.onnx, voices.bin, tokens.txt, espeak-ng-data)
- **Recursive search** (up to 4 levels deep for voices.bin, tokens.txt via `recursive_find_file_named`)

**Version detection:** Uses `voices.bin` file size to detect v0.19 vs v1.1 bundles — v0.19 voices < 15 MB, v1.1 voices > 20 MB (line 443-447)

### Non-Kokoro Engines (Piper, Matcha, Kitten)
- **No built-in download flow** — only "Open Trusted Source" link shown
- User must manually download from k2-fsa.org and browse to select files
- `download_model()` returns `ok: false` with message at line 1401

---

## 3. Voice Panel UI Analysis

### What's Good
- **Compatibility hints** (`resolveTtsCompatHint()` line 6-25) provide user-friendly error messages for common failure cases:
  - Missing `sample_rate` metadata (wrong Kokoro ONNX variant)
  - Incompatible bundle (model/voices mismatch)
  - Missing `tokens.txt` or `espeak-ng-data`
  - Invalid model file path
- **Bundle label display** (`bundleLabelFromModelPath()` line 27-34) shows parent folder + filename for clarity
- **Engine-specific UI hints** via `getTtsEngineUiConfig()` at line 78 — each engine shows expected file layout
- **Kokoro one-click download** with two preset bundle options (line 108-114)
- **Secondary path support** for engines that need it (Matcha vocoder, Kitten voices)

### Issues Found

#### Issue 1: Voice List Shows Hardcoded Kokoro Voices (CRITICAL)
- At line 930-931 in `src-tauri/src/tts/mod.rs`:
  ```rust
  let mut voices = if matches!(signature.engine, TtsEngine::Kokoro) {
      known_kokoro_voices()
  } else {
      vec!["speaker_0".to_string()]
  };
  ```
- Kokoro always gets the full 55 hardcoded voice list from `known_kokoro_voices()` (lines 625-683)
- **Actual available voices are engine-determined, not voice file determined**
- If user provides a custom voice pack with different voices, UI will show wrong voices
- For other engines, only `speaker_0` is shown regardless of actual model

#### Issue 2: No Download Progress Feedback
- `download_model()` in backend (line 1381) has **no progress events emitted**
- User sees no download progress indicator — just waits
- HTTP client has no timeout configured (line 1419-1421)
- Large files (109-128 MB) could appear frozen

#### Issue 3: Mixed-up UI Labels for Secondary Path
- `secondaryPath` field in state is used for **both** voices_path (Kokoro/Kitten) **and** vocoder (Matcha)
- `secondaryLabel` changes based on engine ("Voices Path" vs "Vocoder Path" vs "Lexicon Path")
- But the state field name `secondaryPath` is confusing — no semantic indication of what it contains
- `voicesPath` and `secondaryPath` both point to voices for Kokoro (line 1138-1140, 1142-1148)

#### Issue 4: Engine Settings Are Not Fully Isolated
- `PersistedEnginePaths` stores paths per engine key (line 582-597)
- But `settings_set()` at line 1167 mirrors to legacy fields (`settings.model_path`, etc.)
- The legacy field mirroring means switching engines could retain paths from previous engine
- Settings file format (`tts-settings.json`) has both legacy fields and `engine_settings` map

#### Issue 5: lexicon Disabled (line 864)
- Lexicon is hard-disabled with comment: "some bundles contain tokens that are incompatible with the selected tokens.txt"
- This is a workaround for a crash, but no way for user to enable or diagnose

---

## 4. Model Sizes in Resources

| File | Size | Purpose |
|------|------|---------|
| `voice/kitten/model.fp16.onnx` | 23 MB | KittenTTS acoustic model |
| `voice/kitten/voices.bin` | 8 KB | Kitten voice definitions |
| `voice/matcha/model.onnx` | 71 MB | Matcha acoustic model |
| `voice/matcha/vocoder.onnx` | 52 MB | Matcha neural vocoder |
| `voice/piper/model.onnx` | 75 MB | Piper (VITS) model |
| `voice/espeak-ng-data/` | 19 MB | Pronunciation data (shared across all engines) |
| `whisper/ggml-base-q8_0.bin` | 78 MB | Whisper base (quantized) |
| `whisper/ggml-tiny.en-q8_0.bin` | 42 MB | Whisper tiny English (quantized) |
| `whisper-server/whisper-server-linux-x86_64` | 2 MB | Whisper server binary |
| **Total voice resources** | **~220 MB** | All bundled TTS models + espeak-ng-data |
| **Total whisper resources** | **~122 MB** | Whisper models + server |

**Note:** The `espeak-ng-data/` directory (19 MB) is shared and required by Kokoro, Piper, and likely Kitten. It is bundled but not shown in download options — it's auto-copied from `resources/voice/espeak-ng-data` to app data on first run.

---

## 5. .gitignore Analysis

Current `.gitignore` entries relevant to voice/TTS:
```
agent/target/
```
**Missing entries that should be added:**
- `src-tauri/resources/voice/*.onnx` — large binary model files
- `src-tauri/resources/voice/*/model*.onnx`
- `src-tauri/resources/voice/*/*.onnx`  
- `src-tauri/resources/whisper/*.bin`
- `src-tauri/resources/whisper-server/*` (binary + .inuse marker)
- `src-tauri/resources/llama-runtime/` (LLM runtime binaries)
- `frontend/node_modules/` (already present but good)
- `src-tauri/target/` (already present — Rust build)

**Currently ignored but shouldn't be:**
- None identified — the espeak-ng-data is small enough (19 MB) to keep in git, but the ONNX models total ~150 MB which is too large for a repo.

---

## 6. STT Panel Comparison

The STT panel ([`frontend/src/panels/sttPanel.ts`](frontend/src/panels/sttPanel.ts)) has a cleaner model download UX:
- Model download buttons are inside an `<details>` collapsible section (line 154)
- Each model shows its **name** (human-readable) and **filename** being downloaded
- Download progress is shown via `<progress>` element (line 171-181)
- Error state is displayed below the table (line 183-191)
- Backend `stt_download_model()` returns progress implicitly via state updates

**TTS could learn from this:** Move Kokoro download buttons into an collapsible section, show download progress, and display named presets rather than raw URLs.

---

## 7. Summary of Issues

| Severity | Issue | Location |
|----------|-------|----------|
| **High** | Voice list is hardcoded for Kokoro, doesn't reflect actual voice file | [`src-tauri/src/tts/mod.rs:930`](src-tauri/src/tts/mod.rs:930) |
| **High** | No progress feedback for model downloads | [`src-tauri/src/tts/mod.rs:1381`](src-tauri/src/tts/mod.rs:1381) |
| **Medium** | Non-Kokoro engines have no download flow, only external link | [`ttsPanel.ts:115`](frontend/src/panels/ttsPanel.ts:115) |
| **Medium** | Large ONNX models (~150 MB) not in .gitignore | [`.gitignore`](.gitignore) |
| **Medium** | `lexicon` hard-disabled with no user diagnostic | [`src-tauri/src/tts/mod.rs:864`](src-tauri/src/tts/mod.rs:864) |
| **Low** | `secondaryPath` field name is ambiguous across engines | [`frontend/src/panels/ttsPanel.ts:56`](frontend/src/panels/ttsPanel.ts:56) |
| **Low** | Model download uses blocking HTTP client with no timeout | [`src-tauri/src/tts/mod.rs:1419`](src-tauri/src/tts/mod.rs:1419) |

---

## 8. Recommendations

1. **Voice list should reflect actual available voices** — For Kokoro, either read voices from `voices.bin` metadata or expose which voice pack is active. Consider parsing voice names from the bundle rather than hardcoding 55 voices.

2. **Add download progress events** — Emit periodic events during the download so the UI can show progress. Consider adding a `TtsDownloadProgress` event type.

3. **Add .gitignore entries** for large binary model files:
   ```
   src-tauri/resources/voice/*.onnx
   src-tauri/resources/voice/*/*.onnx
   src-tauri/resources/whisper/*.bin
   src-tauri/resources/whisper-server/*
   src-tauri/resources/llama-runtime/**
   ```

4. **Consider collapsible download section** like STT panel has — cleaner UI when there are multiple bundle options.

5. **Add timeout to HTTP client** — A 60-90 second timeout would prevent hung downloads from appearing frozen.
