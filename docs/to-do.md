# TTS Runtime Migration To-Do

## Completed

- [x] Direct ORT FFI wrapper via `ort-sys` (bypasses broken `ort` crate) in `kokoro_ort.rs`
- [x] `synthesize_phonemes()` compiles and calls ONNX model — **smoke tested: "hello world" → 37,800 samples (1.575s audio at 24kHz)**
- [x] Kokoro tokenizer with unknown-symbol dropping and boundary padding (8 tests)
- [x] Voice `.bin` loader with style selection by token length (5 tests)
- [x] Phonemizer trait + bundled eSpeak resolver (2 tests)
- [x] Wire Kokoro branch in `speak()` gated on phonemizer availability
- [x] Implement `speak_stream()` as sentence-chunked `synthesize_phonemes()` calls
- [x] `cargo check` passes cleanly
- [x] 19/19 TTS unit tests pass (including 3 new e2e integration tests)
- [x] Frontend build passes (`npm run build`)
- [x] Vendored Kokoro vocab in `resources/kokoro/config.json`
- [x] ONNX Runtime shared library bundled at `resources/onnxruntime/linux-x64/libonnxruntime.so`
- [x] Compiled `espeak-ng` binary at `resources/espeak-ng/bin/espeak-ng`
- [x] Compiled `espeak-ng-data` at `resources/espeak-ng/share/espeak-ng-data/`
- [x] Bundled model at `resources/kokoro/model_quantized.onnx` (88 MB)
- [x] Bundled voices at `resources/kokoro/{af,af_heart,af_bella,af_jessica}.bin`
- [x] Timing/event telemetry parity for Kokoro branches
- [x] Misaki-symbol normalization table — verified no-op for en-us (all espeak IPA chars already in Kokoro vocab)
- [x] Optional system `espeak-ng` fallback (via `which espeak-ng`) when bundled binary missing
- [x] Clean legacy code: removed dead `BzDecoder`/`Archive`/`Duration`/`Write` imports, `DOWNLOAD_PROGRESS_INTERVAL_MS`, `copy_response_with_progress` function
- [x] Runtime diagnostics logging for resolved model/voice/config/eSpeak/ORT paths
- [x] Tauri resource bundling includes `kokoro/`, `espeak-ng/**/*`, `onnxruntime/**/*`
- [x] Removed Sherpa-specific messages/guards from Kokoro path — engine ID now `"kokoro"` (was `"sherpa-kokoro"`)
- [x] `sherpa-onnx` dependency retained — Piper/Matcha/Kitten engines still use it (fully isolated from Kokoro path)
- [x] **Smoke test: full phonemize → tokenize → synthesize → WAV pipeline** — `"Hello world. This is a test of text to speech."` → 39,600 samples at 24kHz
- [x] **Smoke test: stream chunked synthesis** — `"Hello. How are you? I am fine."` splits into 3 sentences, each synthesized independently, total ~3 chunks
- [x] **Smoke test: WAV encoding** — valid RIFF WAV output with correct PCM16 data section
- [x] `split_into_sentences` now splits on newlines (espeak-ng uses `\n` as sentence separator in IPA output)

## Remaining (cross-platform only)

- [ ] Bundle ORT + espeak-ng for macOS and Windows targets

## Definition Of Done

- [x] `speak`, `speak_stream`, and `self_test` for Kokoro work using only bundled assets under `resources/kokoro` and `resources/espeak-ng`.
- [x] No runtime dependency on system `espeak-ng` unless explicitly enabled.
- [x] `cargo check` passes, 19+ tests pass, frontend build passes.
- [x] Sherpa is no longer in the Kokoro synthesis path.
