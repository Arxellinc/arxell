# Models and Configuration

## Supported model paths
1. API model configs (OpenAI-compatible endpoints)
2. Local GGUF models via runtime engine/load flow

## API model configuration
Managed in `API's` panel with fields:
- `name`, `api_type`, `model_id`, `base_url`, `api_key`
- optional metadata: parameter count, speed, context, pricing
- primary flag + verification status

Normalization behavior:
- Base URL is normalized toward OpenAI-compatible routes.
- Verification probes `/models` and optionally `/chat/completions`.

## Local model flow
- Discover `.gguf` under app models directory (`cmd_list_available_models`).
- Peek metadata (`cmd_peek_model_metadata`) without loading full weights.
- Load model (`cmd_load_model`) with config (context, GPU layers, mmap/mlock, threading, etc.).
- Unload model (`cmd_unload_model`) to release resources.

## Runtime engine management
- Runtime status from `cmd_get_runtime_status`.
- Install engine binaries with `cmd_install_runtime_engine`.
- Progress via `engine:install_progress` events.

## Where models are stored
- App data directory + `models/` subfolder (resolved by `cmd_get_models_dir`).
- Exact base path is OS-dependent Tauri `app_data_dir`.

## Performance considerations
- Backend feature/build determines local inference capability (`cuda`, `rocm`, `vulkan`, `metal` or cpu fallback).
- Model quantization and context length materially impact memory/speed.
- GPU/VRAM availability and driver readiness determine feasible model sizes.

## Key settings in DB (`settings` table)
Common keys include:
- `base_url`, `api_key`, `model`, `system_prompt`
- voice keys (`stt_*`, `tts_*`, `vad_*`)
- prefill/barge-in tuning (`prefill_enabled`, `stable_tail_words`, etc.)

## Known limitations
- Some system/runtime detection is best-effort and platform-variable.
- CPU-only paths may be metadata-only or significantly slower.
