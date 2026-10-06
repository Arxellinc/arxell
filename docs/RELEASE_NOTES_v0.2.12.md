# Arxell v0.2.12 — Preview

**Draft preview release notes:** v0.2.12 has not been published by this stabilization work. These notes describe the intended candidate, which must pass fresh integrated package checks before publication. It is not being labeled fully stable while clean-machine/provider acceptance and platform signing remain incomplete.

Arxell v0.2.12 is a cross-platform desktop build with safer native credential storage, hardened Pi RPC failure handling, safer local-runtime process ownership, and updated llama.cpp/Whisper runtime packaging.

## Downloads

- Windows x64: MSI installer
- Linux x64: `.deb` and AppImage (built against Ubuntu 22.04 / glibc 2.35)
- macOS Apple Silicon: DMG

Download `SHA256SUMS.txt` with the installers and verify the checksum before installing.

## Prerequisites and compatibility

- Linux: Ubuntu 22.04 or a compatible/newer distribution with WebKitGTK 4.1 and the listed package dependencies. Older glibc systems are not supported.
- Pi coding tools: Arxell uses an existing Pi installation when detected. If Pi is absent, it can install a private copy when Node.js/npm are available (and Git Bash is available on Windows). Interactive Pi uses the user's Pi profile; Looper uses Arxell's configured connection.
- Local models: no API key is needed, but model files must be downloaded separately. Bundled x86-64 engines require AVX2/FMA/F16C/BMI2-capable CPUs; disabling runner-native tuning does not support every historical x86-64 processor. CPU inference is the fallback; GPU acceleration depends on the platform and installed driver.
- Cloud chat and Looper currently use OpenAI Chat Completions-compatible endpoints, including compatible local servers. Native Anthropic and Gemini APIs are not supported directly; use an OpenAI-compatible gateway.

## Important limitations

- Installers are unsigned and macOS builds are not notarized. Windows SmartScreen and macOS Gatekeeper may show warnings; only install after verifying the checksum and source.
- Linux `.deb` and AppImage install/launch plus bundled llama.cpp and Whisper runtime smoke checks passed in a clean Ubuntu 22.04 CI container; real GGUF CPU inference was separately verified on the development host. Windows CI installed, launched, and uninstalled the MSI; macOS CI mounted and validated the DMG. These checks do not replace physical clean-machine acceptance or validate full model/chat/Pi workflows on Windows and macOS.
- Live public-provider credentials and paid inference were not used for release testing. Verify your provider/model configuration before relying on the app.
- Optional voice/audio behavior varies with system media dependencies and has not received the same cross-platform acceptance as core chat and local text inference.

Conversations and settings remain on the device. Requests are sent to a configured provider only when you initiate a cloud-backed operation. API credentials use the operating-system credential store by default.
