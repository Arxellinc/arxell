# Voice Mode Fixes

## Kokoro first-run install validation (after v0.2.13)

The v0.2.13 onboarding **Install voice** action downloaded the correct standard Kokoro ONNX graph but rejected it for missing `sample_rate` metadata. That field belongs to a different runtime/export convention; Arxell's direct ONNX Runtime synthesis returns 24 kHz audio without it. Existing developer voice assets had hidden the clean-install failure.

- The installer now verifies exact size and SHA-256 for both the downloaded model and voice pack, including existing cached copies, instead of scanning the model for `sample_rate`.
- Model revision: `onnx-community/Kokoro-82M-v1.0-ONNX` at `1939ad2a8e416c0acfeecc08a694d14ef25f2231`; model SHA-256: `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478` (Hugging Face LFS digest).
- Voice pack: `thewh1teagle/kokoro-onnx`, release `model-files-v1.1`, asset `voices-v1.0.bin`; SHA-256: `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d` (GitHub asset digest).
- `ARXELL_KOKORO_MODEL_URL` / `ARXELL_KOKORO_VOICES_URL` may redirect downloads to mirrors, but no longer bypass size/checksum validation. They must serve the same pinned artifacts.
- Regression tests reproduce the published-model rejection, reject empty/truncated/same-size-corrupted downloads, preserve previous assets on validation/transfer failure, remove temporary files, repair corrupt caches, and reuse valid caches without network access.
- Linux CI additionally installs both actual artifacts into an isolated temporary directory through loopback HTTP, phonemizes text using bundled espeak-ng, and requires finite/non-silent 24 kHz audio from ONNX Runtime. This does not establish Windows/macOS audio-device playback acceptance.

No IPC payload or contract version changes. Retrying the unchanged v0.2.13 installer will still fail; a rebuilt application is required.

## Earlier changes — May 2026


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
