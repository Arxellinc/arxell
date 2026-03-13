# System Requirements

## Supported platforms (from source)
- Linux desktop (actively implemented and tested in code paths).
- macOS desktop (Metal and macOS-specific detection paths exist).
- Windows desktop (Windows command/shell and installer logic present).

## Minimum practical hardware
- CPU: modern x86_64 or arm64 capable of running Rust/Tauri desktop apps.
- RAM:
  - App itself: moderate usage.
  - Local model inference: highly model-dependent (can require many GB).
- Disk:
  - App binaries and dependencies.
  - Model files (`.gguf`) can be GB-scale.
  - Runtime engine binaries downloaded by installer.
- GPU (optional but recommended for local inference speed):
  - CUDA/NVIDIA, ROCm/AMD, Metal/Apple, or Vulkan depending on build/runtime.

## Software prerequisites
- Node.js 18+
- npm
- Rust toolchain (cargo)
- Tauri CLI v2 (`@tauri-apps/cli`)
- Platform build dependencies:
  - Linux: GTK/WebKit2GTK dev packages, ALSA dev headers, compiler toolchain.
  - macOS: Xcode command line tools.
  - Windows: Visual Studio Build Tools C++ workload.

## Optional runtime dependencies
- Local STT/TTS helpers require external tools:
  - Python3 (`stt_whisper.py`, `tts_kokoro.py`)
  - Python packages: `faster-whisper`, `kokoro-onnx`, `soundfile`
  - Optional `piper` binary for Piper TTS.
- Local model serving via downloaded `llama.cpp` engine binaries.

## Network requirements
- Required for:
  - external model APIs,
  - runtime engine downloads from GitHub releases,
  - browser panel remote page fetches.
- Not required for strictly local/offline workflows (except where external services are chosen).

## Platform-specific notes
- GPU backend compile features are explicit (`cuda`, `rocm`, `vulkan`, `metal`).
- Build script probes local toolkits and emits backend diagnostics.
- If no GPU backend/runtime is available, app supports CPU/metadata-only paths.
