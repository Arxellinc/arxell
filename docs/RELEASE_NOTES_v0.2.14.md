# Arxell v0.2.14 — Kokoro voice installation hotfix

Fixes **Install voice** during first-run setup, which failed in v0.2.13 with `invalid Kokoro ONNX model (missing sample_rate metadata)`.

## Changes

- Validate the standard Kokoro model using its pinned SHA-256 digest and size, not metadata from a different model/runtime format. Arxell's direct ONNX Runtime synthesis does not require `sample_rate` metadata and outputs 24 kHz audio.
- Pin the Hugging Face model revision and verify the matching voice pack too. Existing cached assets receive the same checks; corrupt/incomplete downloads fail without replacing prior files during transfer/validation, and temporary downloads are cleaned up.
- Add cross-platform regressions using the actual model/voice artifacts and loopback download fixtures. Linux CI additionally performs a fresh isolated asset install, phonemization, and real non-silent speech synthesis.
- Download URL overrides remain available for mirrors but must serve the same pinned artifacts; overrides no longer disable checksum/size validation.

## Upgrading

Download v0.2.14, quit v0.2.13, and launch the new version. Retry **Install voice** in setup (or the runtime-install notification/TTS controls). No manual model copying, metadata editing, or deletion of your conversations/LLM models is required. Failed v0.2.13 downloads were temporary and should have been removed automatically.

## Downloads

- Windows x64: MSI
- Linux x64: DEB and AppImage (Ubuntu 22.04 / glibc 2.35 baseline, WebKitGTK 4.1)
- macOS Apple Silicon: DMG (macOS 14+)

Verify your installer against the attached `SHA256SUMS.txt`. On Linux use `sha256sum --check --ignore-missing SHA256SUMS.txt`; on macOS use `shasum -a 256 <installer>`; on Windows use `Get-FileHash <installer> -Algorithm SHA256`.

## Prerequisites and remaining limitations

- Installers remain unsigned; macOS builds are not notarized. Gatekeeper/SmartScreen warnings may appear.
- Pi requires an existing installation or Node.js/npm (Node.js >= 22.19 for the current Pi package); Windows additionally requires Git Bash. Downloaded x86-64 local-model engines require AVX2/FMA/F16C/BMI2-capable CPUs. Cloud providers must expose OpenAI Chat Completions-compatible endpoints. Linux keychain storage requires an unlocked Secret Service.
- Linux real speech synthesis and automated cross-platform package smoke checks are not complete physical clean-machine, Windows/macOS voice playback, upgrade, Pi, or live-provider acceptance. This hotfix does not claim to resolve those remaining gaps.
- The frontend dependency audit still reports 10 advisories (5 high, 3 moderate, 2 low). Dependency updates and exposure review remain outstanding; avoid untrusted content and security-sensitive workloads.
- Pi policy is defense in depth, not an OS sandbox. Selected context is sent to a cloud provider only when you initiate a cloud-backed operation.

See [release readiness](RELEASE_READINESS.md) and [voice validation notes](voice-updates.md) for evidence and limitations. Other functionality is unchanged from v0.2.13.
