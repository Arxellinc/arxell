# Voice Mode Fixes — May 2026

## Problem

Voice mode was non-functional: no speech generated, TTS panel "test text" also silent, and the "Loading model..." indicator was invisible when the LLM model was warming up.

**Root cause (TTS):** The Kokoro ONNX model had been updated (quantized), and the input/output tensor names changed. The `kokoro_ort.rs` code hardcoded `"input_ids"` as the first input name, which the quantized model rejected with `Invalid input name: input_ids`.

**Root cause (loading indicator):** `chatSend.ts` correctly set `chatModelStatusMessage = "Loading model into memory..."` and called `renderAndBind()`, but the `is-loading` CSS class had no styles defined. The text rendered silently in a tiny `0.6rem` muted font, invisible to the user.

---

## Changes

### 1. `src-tauri/src/tts/kokoro_ort.rs` — Dynamic ONNX I/O name discovery

**`CachedSession` struct (line 16-21):**
- Added `input_names: Vec<String>` and `output_names: Vec<String>` fields
- Changed derive from `Copy` to `Clone` (Vec doesn't implement Copy)

**New `query_session_names()` function (after line 200):**
- Queries the ONNX session at creation time for actual input/output names via `SessionGetInputCount`, `SessionGetInputName`, `SessionGetOutputCount`, `SessionGetOutputName`
- Returns `(Vec<String>, Vec<String>)` so inference uses whatever names the model actually exports

**`get_or_create_session()` (line 286-291):**
- Calls `query_session_names(session)` after session creation
- Stores returned names in `CachedSession`
- Uses `.cloned()` instead of `.copied()` for cache lookup (Vec is not Copy)
- Uses `.or_insert(cached).clone()` for insertion/return

**`synthesize_phonemes()` (lines 316-362):**
- Builds `CString` name arrays dynamically from `cached.input_names` and `cached.output_names` instead of hardcoded `"input_ids"`, `"style"`, `"speed"`, `"waveform"`
- Tensor order `[tokens, style, speed]` is preserved; names follow whatever order the model declares

### 2. `frontend/src/styles.css` — Loading indicator visibility

**New style block (after line 2049):**
```css
.composer .composer-model-caps.is-loading {
  color: var(--accent);
  opacity: 1;
  font-size: var(--text-sm);
}
```

When `chatModelStatusMessage` is set (model loading), the composer meta text now renders in the accent color at `--text-sm` (0.75rem) with full opacity, making it clearly visible to the user.
