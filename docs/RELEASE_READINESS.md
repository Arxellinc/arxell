# Desktop release readiness

Review baseline: `main` at `6e260f7` (Arxell 0.2.11), reviewed 2026-09-29.

**Status: not ready to label a new release fully stable.** Source tests pass on the review Linux host, but clean-machine installer, real model, and cross-platform acceptance remain required. No new release tag should be published merely because unit tests pass.

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

- **Pinned llama.cpp runtime preparation.** CI no longer resolves `/releases/latest` (whose current stable ships no engine assets — PR #20's first CI run reproduced this failure on all three platforms). Engines are built from the pinned source tag `v0.4.1`, with per-engine `--version` smoke tests, an arch-aware cache key (`runtimes-llama-source-v2-<os>-<arch>-…`), and an always-run verification step. Local validation: CPU engine built from the exact recipe and executed from an isolated engine directory containing only the copied closure (`exit=0`, zero unresolved dynamic dependencies).
- **Complete dependency closure.** The engine copy step now bundles shared libraries and Metal kernels (`*.so*`, `*.dylib`, `*.dll`, `*.metallib`, `*.metal`). This is load-bearing, not defensive: the v0.4.1 Linux build links `llama-server` against `libggml*`/`libllama*` shared objects. `is_runtime_support_file` (app-side install/copy path) now also recognizes `.metallib`/`.metal`; Metal kernels are embedded by default at v0.4.1 (`GGML_METAL_EMBED_LIBRARY=${GGML_METAL}`), so those remain insurance.
- **macOS architecture accuracy.** The matrix label now says `macos-arm64` (matching `macos-latest` hardware) and engines are built natively on the runner, eliminating the previous x64-asset/aarch64-app mismatch. `vulkan-1.dll` is intentionally not bundled on Windows: it is the system Khronos loader from the GPU driver, the app gates the Vulkan engine on runtime detection, and the CPU engine is the guaranteed fallback.

- **Pinned whisper.cpp runtime.** Upstream's latest release (`v1.9.4`) ships zero binary assets, so the old step silently bundled no whisper-server at all (STT broken out of the box) and its fallback could pick another platform's asset. The server is now built from the pinned source tag `v1.9.4` per platform, named to match the app's expectations (`src-tauri/src/stt/supervisor.rs`), with the shared-library closure bundled, a `--help` smoke test, and a fatal build failure instead of a silent `binary_not_found` manifest. STT model downloads remain non-fatal (voice degrades, the bundle does not break). Validated locally: `--target whisper-server` builds cleanly and the isolated closure runs with no unresolved libraries.

- **Truthful local-runtime readiness.** `start()` previously declared the runtime healthy the moment a TCP port opened — before the model finished loading — and a spawn failure left the status stuck at `starting`. Startup now waits for llama-server's `/health` to report ready (with bounded port and model-load deadlines), detects a child that exits during startup, emits real `llama.runtime.loading` progress from the same loop (replacing the racy background thread), and marks the state `failed` on every error path. The `/health` parser is unit-tested against loading/ready/unparseable bodies.

- **Pinned in-app engine downloader.** `download_engine_binary` resolved GitHub `/releases/latest`; upstream's current stable ships no engine assets, so a fresh install without bundled engines could never download one. The downloader now targets the release Arxell bundles and tests (`v0.4.1` by default, overridable via `ARXELL_LLAMA_RUNTIME_RELEASE`), never falls back to another platform's asset, and reports an actionable error pointing at the bundled engines. Asset selection and release-URL resolution are unit-tested.

## Outstanding release blockers

| Priority | Finding / evidence | Required acceptance |
|---|---|---|
| P0 | Linux packages are built on Ubuntu 24.04; there is no clean-machine install/functional matrix on main. AppImage media framework bundling is disabled. | Define the minimum distro/glibc/WebKit baseline, declare `.deb` runtime dependencies, and test both package formats outside the build environment on supported distributions. || P1 | Pi and Node are not bundled; supported Pi is `>=0.81.0,<0.82.0`. The review machine has Pi 0.84.2 and is correctly outside that range. Interactive Pi uses the user's profile; Looper uses Arxell credentials. | For a download-and-run coding product, ship a verified managed runtime or provide an explicit prerequisite/setup flow. Test the actual pinned Pi, not just a fake process; document separate interactive authentication. |
| P1 | Pi discovery misses `%APPDATA%/npm` when absent from PATH; macOS executable discovery does not ensure the Node interpreter is discoverable. Probes have no timeout. | PATH-poor GUI launches, npm shims, spaces/non-ASCII paths, missing Bash/Node, hung wrapper, restart persistence, and version compatibility tests. |
| P1 | Chat's Rust provider and generated Looper model profiles use OpenAI-compatible Chat Completions. All profiles declare the same context/output limits. | Publish an explicit provider support matrix. Test OpenAI-compatible public APIs and local endpoints. Add native Anthropic/Gemini/Responses adapters if claiming those protocols; derive local context limits rather than advertising 131072 tokens for an 8192-token server. |
| P1 | No installer-driven chat/Pi/keychain tests; unit fixtures do not authenticate to public APIs or exercise a GGUF runtime. | Execute the acceptance matrix below using built artifacts, not a developer checkout. |
| P1 | No Windows signing or macOS signing/notarization configuration in the workflow. | Decide signing identities/credentials and verify Gatekeeper/SmartScreen installation behavior. Never claim unsigned downloads are warning-free. |
| P1 | Native TTS assets and executable discovery (espeak-ng, Kokoro, onnxruntime) are Linux-biased; per-target voice resource paths are not validated. | Either validate voice dependency/resource paths per target, or clearly mark voice unavailable when dependencies are absent. Missing optional voice must not prevent core chat/coding. |
| P1 | Credential fallback read/modify/write and deletion paths need further review; native backend selection alone does not prove migration/deletion/locked-store behavior. | Restart/update/delete tests with both native and explicitly acknowledged fallback storage; no lost updates, stale keys, or permissive plaintext files. |

## Stabilization sequence

1. Merge narrowly scoped credential, Pi error-state, and process-ownership fixes after cross-platform checks.
2. Repair and pin runtime preparation. Port useful work from the preserved feature branch selectively. Verify package contents and architecture, add cold-cache builds and artifact smoke tests.
3. Define provider support and deliver managed Pi/setup diagnostics. Add a mock HTTP provider suite for auth failures, streaming, disconnects, tool calls, retries, and cancellation, plus an actual pinned-Pi/local mock-provider integration test.
4. Validate the release candidate on clean Windows, macOS, and Linux machines, including upgrades from the published 0.2.11 release.
5. Bump/synchronize the version only for a verified candidate; publish immutable artifacts with checksums and release notes stating supported OS/architecture, prerequisites, and known limitations.

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

- Baseline Linux: frontend build and TypeScript checks passed; 28 frontend tests and 155 desktop-feature Rust tests passed.
- Credential-backend and failed-Pi-settlement regression tests were run before the fixes and failed as expected.
- After fixes: frontend build/type checks and 28 frontend tests passed; both Rust check modes and 160 desktop-feature Rust tests passed (one opt-in native-store test excluded from the normal suite).
- The opt-in native-store test also passed against a real GNOME Keyring in an isolated D-Bus session and temporary home/data directory, using only a synthetic credential.
- Linux `cargo tauri build --no-bundle --features tauri-runtime` passed. This compiles the application; it is not an installer or first-run test.
- PR #20's first CI run: steps through "Run Rust tests" passed on Linux, macOS, and Windows (validating the keyring/Pi/port fixes cross-platform); all three jobs then failed at "Prepare bundled llama.cpp runtimes" because upstream's current `latest` release ships no engine assets — the exact breakage this pass fixes.
- llama.cpp `v0.4.1` CPU engine was built locally from the pinned recipe and executed from an isolated engine directory (binary + copied closure only), confirming a self-contained engine (`--version` exit 0, no unresolved shared libraries).
- Tests using fake Pi do not establish compatibility with a real Pi package or provider.
- This review did not launch Windows/macOS installers, spend provider credits, or download/run a GGUF model. Full cross-platform stability is still unverified.
