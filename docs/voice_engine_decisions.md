# Voice Engine Decisions

## 2026-03-06: Disable IndexTTS on AMD-focused setups

- Decision: `index_tts` is disabled in the app UI and backend routing.
- Reason: local installation pulled a large CUDA/NVIDIA-first Python stack that is not suitable for this AMD target machine.
- Policy:
  - Do not enable or recommend `index-tts` by default on AMD-only targets.
  - Prefer `kokoro`, `piper`, or `kitten` for local TTS on this hardware profile.
  - If `index-tts` is reconsidered later, require an explicit hardware matrix and install-size review first.
