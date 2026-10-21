# Arxell v0.2.12 — Preview

**Preview release candidate:** built from `main` at `74543e1` after cross-platform CI passed on the unified candidate (#29/#30). It remains a preview: installers are unsigned, and physical clean-machine/provider acceptance is incomplete.

Arxell v0.2.12 is a cross-platform desktop build with safer native credential storage, hardened Pi RPC failure handling, safer local-runtime process ownership, smaller on-demand runtime packaging, and improved chat header layout.

## Highlights

- **Much smaller installers.** The local Linux `.deb` is 94 MiB and the AppImage is 168 MiB, down from 449 MiB and 473 MiB for v0.2.11. llama.cpp engines and the Kokoro TTS model are downloaded on demand; Whisper ships one multilingual base model; espeak-ng ships English-only data; and the packaged ONNX Runtime is no longer duplicated through symlink aliases.
- **Runtimes in onboarding.** First run now includes an **Install Local Runtimes** step, with an **Install now** notification if it is skipped, plus notifications when a newer llama.cpp release is available.
- **Portable Linux voice runtime.** espeak-ng 1.52.0 is rebuilt from the pinned source on Ubuntu 22.04 (glibc 2.34 maximum), so the bundled phonemizer runs on the release baseline.
- **Readable model names.** Long model IDs are truncated with an ellipsis in the chat header and status bar; hover for the full name.
- **Runtime and Pi hardening.** Native credential storage, Pi RPC failure/retry handling, local-runtime process ownership, and packaged runtime notices were tightened.

## Downloads

- Windows x64: MSI installer
- Linux x64: `.deb` (~94 MiB) and AppImage (~168 MiB) from the local release build, built against Ubuntu 22.04 / glibc 2.35
- macOS Apple Silicon: DMG

Download `SHA256SUMS.txt` with the installers and verify the checksum before installing. MSI and DMG sizes are reported by the release CI.

## Prerequisites and compatibility

- Linux: Ubuntu 22.04 or a compatible/newer distribution with WebKitGTK 4.1 and the listed package dependencies. Older glibc systems are not supported.
- Pi coding tools: Arxell uses an existing Pi installation when detected. If Pi is absent, it can install a private copy when Node.js/npm are available (and Git Bash is available on Windows). Interactive Pi uses the user's Pi profile; Looper uses Arxell's configured connection.
- Local models: no API key is needed, but model files and the llama.cpp engine are downloaded separately. Downloaded x86-64 engines require AVX2/FMA/F16C/BMI2-capable CPUs; disabling runner-native tuning does not support every historical x86-64 processor. CPU inference is the fallback; GPU acceleration depends on the platform and installed driver.
- Cloud chat and Looper currently use OpenAI Chat Completions-compatible endpoints, including compatible local servers. Native Anthropic and Gemini APIs are not supported directly; use an OpenAI-compatible gateway.

## Important limitations

- Installers are unsigned and macOS builds are not notarized. Windows SmartScreen and macOS Gatekeeper may show warnings; only install after verifying the checksum and source.
- Linux `.deb` and AppImage install/launch plus on-demand llama.cpp and bundled Whisper runtime smoke checks passed in a clean Ubuntu 22.04 CI container; real GGUF CPU inference was separately verified on the development host. Windows CI installed, launched, and uninstalled the MSI; macOS CI mounted and validated the DMG. These checks do not replace physical clean-machine acceptance or validate full model/chat/Pi workflows on Windows and macOS.
- Live public-provider credentials and paid inference were not used for release testing. Verify your provider/model configuration before relying on the app.
- Optional voice/audio behavior varies with system media dependencies and has not received the same cross-platform acceptance as core chat and local text inference.

Conversations and settings remain on the device. Requests are sent to a configured provider only when you initiate a cloud-backed operation. API credentials use the operating-system credential store by default.
