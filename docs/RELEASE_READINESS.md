# Desktop release readiness

Review baseline: `main` at `8930472` (Arxell 0.2.12), reviewed 2026-09-30.

**Status: suitable only for a clearly labeled v0.2.12 preview, not a fully stable release.** Cross-platform CI and Linux clean-container package checks now pass, but physical clean-machine acceptance, broader model/provider/Pi acceptance, and signing/notarization remain incomplete.

## Repository and release state

- `main` already contains the Pi workspace, RPC-backed Looper, policy extension, provider bridge, and task scheduling fixes.
- The initially checked-out `feature/model-directory-runtime` diverges from main: 15 commits only on main, 14 only on the feature branch. It lacks the merged Pi/task work. Preserve it and port useful model-directory/Linux packaging changes through reviewed PRs, rather than replacing main wholesale.
- The latest published GitHub release is `v0.2.11` (2026-05-11); its assets are `.msi`, `.deb`, `.AppImage`, and an Apple Silicon `.dmg`. That tag predates the Pi service; current main's matching version number does not mean the downloadable release contains current main.
- Main's last recorded desktop CI run passed on 2026-07-23. The later model-directory PR failed; neither is evidence that today's dependencies and released packages work on fresh machines.

## Confirmed bugs addressed in this stabilization pass

### API credentials: mock instead of native storage

`src-tauri/Cargo.toml` previously enabled no keyring 3 native features. Keyring consequently selected its nonpersistent, entry-local mock on every desktop platform. The store's separate write/read entries could not round-trip a key, even though its availability probe reported an OS keychain.

Enable persistent Windows Credential Manager, macOS Keychain, and Linux Secret Service backends explicitly. Add a headless backend-persistence regression test and an opt-in native keychain round-trip test. Linux still needs a running/unlocked Secret Service; do not silently enable plaintext fallback.

### Pi: settled errors reported as success

`src-tauri/src/app/pi_rpc_service.rs` did not inspect `message_end.message.stopReason` or exhausted retry events. A failed provider request followed by `agent_settled` could return success and advance Looper.

Reject final errors, aborts, output-limit truncation, and exhausted retries; permit successful retries without clearing fatal extension errors. Add deterministic process-fixture coverage. Do not propagate raw provider diagnostics in the new error messages.

### Local inference: unrelated processes killed by port number

`src-tauri/src/app/runtime_service.rs` scanned `ss`/`netstat` output and killed matching PIDs without checking executable or ownership. Substring port matching was also unsafe.

Remove external-process killing. Report occupied/invalid ports and stop only the child owned by the runtime service. Port preflight is not a reservation; startup health checks still require further hardening below.

## Addressed in this pass (PR #20)

- **Pinned llama.cpp runtime preparation.** CI no longer resolves `/releases/latest` (whose current stable ships no engine assets — PR #20's first CI run reproduced this failure on all three platforms). Engines are built from the pinned source tag `v0.4.1`, with per-engine `--version` smoke tests, an architecture-aware cache key, and an always-run verification step. The current Linux runtime bundle also includes its `libgomp.so.1` dependency; GCC runtime notices are shipped with the app.
- **Complete dependency closure.** The engine copy step bundles shared libraries and Metal kernels (`*.so*`, `*.dylib`, `*.dll`, `*.metallib`, `*.metal`), including loader-visible Linux/macOS sonames that upstream emits as symlinks (copied as regular files under the soname). This is load-bearing: llama.cpp and whisper.cpp server binaries link to shared libraries that must ship alongside them. Linux AppImage packaging also exposes the bundled runtime library directories to linuxdeploy while it scans child executables; the launched app configures its own runtime loader paths. `is_runtime_support_file` (app-side install/copy path) recognizes `.metallib`/`.metal`; Metal kernels are embedded by default at v0.4.1.
- **macOS architecture accuracy.** The matrix label now says `macos-arm64` (matching `macos-latest` hardware) and engines are built natively on the runner, eliminating the previous x64-asset/aarch64-app mismatch. `vulkan-1.dll` is intentionally not bundled on Windows: it is the system Khronos loader from the GPU driver, the app gates the Vulkan engine on runtime detection, and the CPU engine is the guaranteed fallback.

- **Pinned whisper.cpp runtime.** Upstream's latest release (`v1.9.4`) ships zero binary assets, so the old step silently bundled no whisper-server at all (STT broken out of the box) and its fallback could pick another platform's asset. The server is now built from the pinned source tag `v1.9.4` per platform, named to match the app's expectations (`src-tauri/src/stt/supervisor.rs`), with the shared-library closure (including Linux `libgomp.so.1`) bundled, a `--help` smoke test, and a fatal build failure instead of a silent `binary_not_found` manifest. Bundled Base English/Tiny English models are now downloaded from the correct model repository at a pinned revision, verified by SHA-256, and required for runtime preparation; a broken download fails the build rather than caching a silently degraded bundle. Whisper is also built with `GGML_NATIVE=OFF`.

- **Ubuntu 22.04 release baseline and clean-package smoke tests (PR #24).** Linux releases are built on Ubuntu 22.04/glibc 2.35, with pinned Vulkan headers and `glslc` and portable CPU targeting. CI installs and launches both `.deb` and AppImage packages in a clean Ubuntu 22.04 container and smoke-tests the bundled llama.cpp and Whisper binaries. The same cross-platform run validates Windows MSI install/launch/uninstall and mounts/validates the Apple Silicon DMG. Run `36771261380` passed all platform jobs.

- **Truthful local-runtime readiness.** `start()` previously declared the runtime healthy the moment a TCP port opened — before the model finished loading — and a spawn failure left the status stuck at `starting`. Startup now waits for llama-server's `/health` to report ready (with bounded port and model-load deadlines), detects a child that exits during startup, emits real `llama.runtime.loading` progress from the same loop (replacing the racy background thread), and marks the state `failed` on every error path. The `/health` parser is unit-tested against loading/ready/unparseable bodies.

- **Pinned in-app engine downloader.** `download_engine_binary` resolved GitHub `/releases/latest`; upstream's current stable ships no engine assets, so a fresh install without bundled engines could never download one. The downloader now targets the release Arxell bundles and tests (`v0.4.1` by default, overridable via `ARXELL_LLAMA_RUNTIME_RELEASE`), never falls back to another platform's asset, and reports an actionable error pointing at the bundled engines. Asset selection and release-URL resolution are unit-tested.

- **Hardened Pi runtime probing.** Discovery and probes previously missed npm's default global bin (`%APPDATA%\npm`) and Homebrew's `/opt/homebrew/bin` when a GUI-launched app inherits a minimal PATH, and `pi --version`/`node --version` subprocesses had no deadline, so one hung wrapper could freeze the readiness dialog. Probes now run with an augmented PATH (deduplicated), piped output, and a 10-second hard timeout that kills the child; supplemental directories are also probed for candidates. Timeout behavior and PATH augmentation are unit-tested (including a hung-executable fixture).

## Outstanding release blockers

| Priority | Finding / evidence | Required acceptance |
|---|---|---|
| P1 | Pi and Node are not bundled. Arxell accepts parseable Pi versions and installs the current Pi npm package privately when Node/npm (and Windows Git Bash) are available; Pi 0.84.2 and 0.99.1 passed only RPC startup, policy-extension load, and `get_state` smoke checks. Interactive Pi uses the user's profile; Looper uses Arxell credentials. | Test first-run install, interactive use, and complete Looper runs on clean Windows/macOS/Linux accounts; document the Node/npm/Git Bash prerequisites and separate interactive authentication. |
| P1 | Pi executable discovery under PATH-poor GUI launches is mitigated (npm/`%APPDATA%`, Homebrew, timeouts), but unusual HOME paths, reboot persistence, and Windows npm-shim behavior remain untested hands-on. | Exercise setup on clean platform accounts, including spaces/non-ASCII paths and restart persistence. |
| P1 | Chat's Rust provider and generated Looper model profiles use OpenAI-compatible Chat Completions. All profiles declare the same context/output limits. | Publish an explicit provider support matrix. Test OpenAI-compatible public APIs and local endpoints. Add native Anthropic/Gemini/Responses adapters if claiming those protocols; derive local context limits rather than advertising 131072 tokens for an 8192-token server. |
| P1 | A real 4B GGUF CPU inference succeeded with the bundled llama.cpp from the Linux AppImage on this developer host. Linux `.deb`/AppImage install, launch, and sidecar smoke tests now pass in a clean Ubuntu 22.04 container; Windows MSI install/launch/uninstall and macOS DMG mount validation pass in CI. Physical clean-machine installs and installer-driven model/chat/Pi/keychain behavior are not verified; public-provider authentication has not been tested. | Execute the remaining acceptance matrix below with built artifacts on clean platform accounts. |
| P1 | Windows signing and macOS signing/notarization are not configured; the release pipeline will produce unsigned installers. | Disclose unsigned status and Gatekeeper/SmartScreen warnings in release notes unless signing identities and notarization credentials are provided and validated. |
| P1 | Native TTS assets and executable discovery (espeak-ng, Kokoro, onnxruntime) are Linux-biased; per-target voice resource paths are not validated. | Either validate voice dependency/resource paths per target, or clearly mark voice unavailable when dependencies are absent. Missing optional voice must not prevent core chat/coding. |
| P1 | Credential fallback read/modify/write and deletion paths need further review; native backend selection alone does not prove migration/deletion/locked-store behavior. | Restart/update/delete tests with both native and explicitly acknowledged fallback storage; no lost updates, stale keys, or permissive plaintext files. |

## Stabilization sequence

1. Merge narrowly scoped credential, Pi error-state, and process-ownership fixes after cross-platform checks.
2. Repair and pin runtime preparation. Port useful work from the preserved feature branch selectively. Verify package contents and architecture, add cold-cache builds and artifact smoke tests.
3. Define provider support and deliver managed Pi/setup diagnostics. Add a mock HTTP provider suite for auth failures, streaming, disconnects, tool calls, retries, and cancellation, plus an actual pinned-Pi/local mock-provider integration test.
4. Preserve the passing Linux clean-container and Windows/macOS installer CI checks; obtain physical clean-machine install/upgrade evidence before claiming stable cross-platform acceptance.
5. Publish only after checksums, release notes, platform prerequisites, and known limitations are explicit. Version 0.2.12 is already synchronized on main.

## Release acceptance matrix

Run the following for Windows x64 MSI, Linux x64 `.deb`, Linux x64 `.AppImage`, macOS Apple Silicon DMG, and Intel DMG if supported:

- Fresh standard-user install and GUI launch without a developer PATH; uninstall and reinstall.
- Upgrade existing data from released 0.2.11 without losing conversations, tasks, workspace state, or credentials.
- Configure a public OpenAI-compatible API, authenticate, stream chat, restart the app, and authenticate again.
- Invalid/revoked key, missing model, quota/rate limit, unreachable endpoint, and mid-stream disconnect produce visible errors, not success.
- Download/load a small supported GGUF on CPU; chat and a tool-capable Pi run; GPU backends when available. No compiler should be required on the user's machine.
- Local-only chat after disconnecting the network, once runtime and model installation is complete.
- Real pinned Pi interactive session and complete Looper cycle with cloud and local models; approval, cancellation, pause/resume, and project-boundary behavior.
- Occupied runtime port leaves its existing owner untouched. Exit/restart with active processes leaves no unwanted children.
- Spaces, non-ASCII and long paths; unwritable directories, low disk space, interrupted downloads, corrupted settings, and recovery after forced exit.
- No secrets in exports/logs/generated Pi metadata; keychain unavailable/locked behavior is explicit.
- Optional voice absent/disabled does not break the above.

Keep results with OS/version, architecture, package checksum, runtime/Pi/model versions, backend, and logs stripped of secrets. See `SMOKE_TEST.md` for the credential test procedure.

## Evidence and limits

- Follow-up renderer/IPC probe: the initial failure was a **test-build configuration error**. A direct Cargo build without `tauri/custom-protocol` loaded `devUrl` with no embedded frontend. A regression test reproduced the missing assets; the corrected `desktop-smoke` feature embeds them. The native Linux app then rendered a visible application frame and returned version `0.2.12` through real Rust IPC under a temporary profile/minimal PATH. macOS execution of this new probe remains pending CI; this is not package-install, model/provider, or upgrade acceptance.
- Baseline Linux: frontend build and TypeScript checks passed; 28 frontend tests and 155 desktop-feature Rust tests passed.
- Credential-backend and failed-Pi-settlement regression tests were run before the fixes and failed as expected.
- After fixes: frontend build/type checks and 28 frontend tests passed; both Rust check modes and 160 desktop-feature Rust tests passed (one opt-in native-store test excluded from the normal suite).
- The opt-in native-store test also passed against a real GNOME Keyring in an isolated D-Bus session and temporary home/data directory, using only a synthetic credential.
- Linux `cargo tauri build --no-bundle --features tauri-runtime` passed. This compiles the application; it is not an installer or first-run test.
- PR #20's first CI run: steps through "Run Rust tests" passed on Linux, macOS, and Windows; all three jobs then failed because upstream's current `latest` llama.cpp release ships no engine assets. Cross-platform CI run [`36771261380`](https://github.com/Arxellinc/arxell/actions/runs/36771261380) passes Linux `.deb`/AppImage clean Ubuntu 22.04 install/launch and bundled llama/Whisper smoke tests, macOS Apple Silicon DMG validation, and Windows x64 MSI install/launch/uninstall. This is meaningful package smoke evidence, not physical clean-machine or full-feature acceptance.
- llama.cpp `v0.4.1` CPU engine was built locally from the pinned recipe and executed from an isolated engine directory (binary + copied closure only), confirming a self-contained engine (`--version` exit 0, no unresolved shared libraries).
- Tests using fake Pi do not establish compatibility with a real Pi package or provider.
- On this Linux host, the v0.2.12 AppImage launched previously and its Whisper sidecar returned healthy. In this follow-up, the AppImage's bundled CPU llama-server loaded `/home/user/models/Qwen3.5-4B-Q4_0.gguf` and returned `ready` from a real completion request (7 tokens generated, 0.4 seconds). This does not validate installer-driven app-to-model integration.
- A bare Ubuntu 22.04 container first failed to launch the Ubuntu 24.04-built AppImage because bundled libraries required GLIBC 2.38/2.39. That concrete compatibility failure motivated the Ubuntu 22.04 build baseline and clean-container tests, which now pass in CI.
- Windows/macOS clean installs, provider credentials, signing, and full interactive Pi/Looper behavior remain unverified. Full cross-platform stability is still unverified.
