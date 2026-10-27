# Arxell v0.2.13 — Preview

A public preview of the current Pi-powered workspace, including the stabilization work since v0.2.11. Version 0.2.12 was not published; this release includes those changes. Installers are unsigned and macOS builds are not notarized. Full physical clean-machine and live-provider acceptance remains incomplete.

## Highlights

- **Pi coding workspace and Looper.** Interactive terminal sessions plus isolated RPC automation, explicit approvals, project-boundary checks, and truthful failure reporting.
- **Safer credentials and processes.** Persistent native keychain backends, explicit plaintext-fallback consent, and local-runtime shutdown limited to app-owned processes.
- **Smaller installers.** llama.cpp and Kokoro assets install on demand; bundled Whisper/espeak data is trimmed and duplicate Linux ONNX libraries are removed. Onboarding and notifications guide runtime installation and updates.
- **More reliable chat.** Bounded local-model readiness, authoritative Stop behavior, cancellable provider waits and retries, and separate connect/first-response/idle deadlines without a total generation-duration cap.
- **Desktop fixes.** Event subscribers survive broadcast lag, terminal output is batched safely, packaged media/style policies and scoped image previews are repaired, and long model names are truncated with tooltips.
- **Durable tasks and memory.** Improved approval, scheduling, delegated-run outcome tracking, local memory persistence, and context privacy.

## Downloads and verification

- Windows x64: `.msi`
- Linux x64: `.deb` and `.AppImage`
- macOS Apple Silicon: `.dmg`

Download `SHA256SUMS.txt` alongside the installers. On Linux run `sha256sum --check --ignore-missing SHA256SUMS.txt`; on macOS use `shasum -a 256 <installer>` and compare the matching entry; on Windows use `Get-FileHash <installer> -Algorithm SHA256`.

## Prerequisites

- Linux builds target Ubuntu 22.04 / glibc 2.35 and require WebKitGTK 4.1 and package dependencies. macOS builds target Apple Silicon on macOS 14 or later; no Intel macOS installer is provided.
- Downloaded x86-64 local-model engines require AVX2/FMA/F16C/BMI2-capable CPUs. Model files and llama.cpp are separate downloads; GPU acceleration depends on compatible drivers. CPU inference is the fallback.
- Pi is external, not bundled. Arxell detects an existing installation or installs a private copy when Node.js/npm are available (Node.js >= 22.19 for the current Pi package). Windows also needs Git for Windows/Bash. Interactive Pi uses the user's Pi profile; Looper uses the configured Arxell connection.
- Linux credential storage needs an unlocked Secret Service, such as GNOME Keyring. Plaintext fallback is never enabled silently.
- Cloud chat and Looper require OpenAI Chat Completions-compatible endpoints. Native Anthropic/Gemini protocols require a compatible gateway.

## Known limitations

- Windows SmartScreen and macOS Gatekeeper can warn because installers are unsigned and not notarized. Verify the source and checksums before installing.
- Release CI checks Linux package installation/startup in clean Ubuntu 22.04 containers, Windows MSI installation/startup/uninstallation, macOS DMG installation/startup, packaged runtime probes, and Linux/macOS renderer-to-Rust IPC. These are automated smoke checks, not complete model/provider/Pi, upgrade, or physical clean-machine acceptance.
- Live public-provider credentials and paid inference are not part of automated release testing. Verify your own provider/model configuration.
- Optional voice support depends on platform media/runtime dependencies and has less cross-platform acceptance coverage than core text workflows.
- Pi policy checks are defense in depth, not an operating-system sandbox.
- The frontend dependency audit reports 10 advisories (5 high, 3 moderate, 2 low), spanning build tooling and runtime/transitive dependencies. Updates and exposure review are still pending; do not use this preview for untrusted content or security-sensitive workloads.

Conversations and settings stay on the device. Selected context is sent to a configured cloud provider when you initiate a cloud-backed operation. API credentials use the OS credential store by default. See [release readiness](RELEASE_READINESS.md) for the remaining acceptance matrix.
