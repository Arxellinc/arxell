# Kokoro Quantized Rollout Checklist

## Scope
- Bundle quantized Kokoro model in app resources.
- Bundle portable Python runtime per target.
- Remove runtime dependency on system Python and runtime pip installs.
- Fix StatusBar race so TTS status refreshes when bootstrap completes.

## CI Requirements
- [ ] `scripts/prepare_kokoro_runtime.py` runs on all release runners.
- [ ] Runtime archive created at `src-tauri/resources/kokoro-runtime/kokoro-runtime-{os}-{arch}.zip`.
- [ ] Quantized model downloaded to `public/voice/model_quantized.onnx`.
- [ ] Import smoke test passes: `kokoro_onnx`, `soundfile`, `onnxruntime`.
- [ ] Synthesis smoke test passes with `tts_kokoro.py`.

## Runtime Requirements
- [ ] `ensure_kokoro_runtime()` extracts bundled runtime archive into `app_data_dir/kokoro/runtime/`.
- [ ] Runtime extraction is lock-guarded and idempotent.
- [ ] Python path is validated after extraction.
- [ ] `kokoro_python_path` is not clobbered on every launch.

## UI Requirements
- [ ] `StatusBar` listens for `kokoro:bootstrap`.
- [ ] On `done && ok`, `StatusBar` re-runs `checkTtsEngines()`.
- [ ] Listener cleans up on unmount.

## Rollback Plan
- [ ] Set `ARXELL_KOKORO_MODEL_VARIANT=fp32` to prefer non-quantized resource name.
- [ ] Revert only model-bundle changes if audio quality or runtime fails.
- [ ] Keep bundled runtime and race-condition fixes in place.
