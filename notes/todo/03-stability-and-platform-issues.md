# Stability and Cross-Platform Issues

Covers Linux, macOS, and Windows pain points, failure modes, and actionable remediation.

---

## Linux

### L1 — Vulkan Fallback Path
- The CUDA build is the primary tested configuration. Vulkan (the fallback for AMD/Intel GPUs on Linux) is less tested
- Vulkan drivers on Linux are distributed inconsistently across distros (Ubuntu, Fedora, Arch have different default driver stacks)
- **Risk:** Users on AMD GPUs with RADV/AMDVLK driver mismatches will get mysterious launch failures
- **Mitigation:** Add a runtime Vulkan probe in `system_info.rs` before attempting to start llama-server with the Vulkan backend; fall back to CPU with a user-visible warning

### L2 — whisper-rs Compilation
- `whisper-rs` is feature-gated as `whisper-rs-stt` (default on Linux/macOS)
- Requires `clang` and a C++ compiler — not always present on minimal Linux installs
- **Risk:** Source builds fail on fresh CI or minimal distros
- **Mitigation:** Document the exact apt/dnf/pacman packages required; consider shipping a pre-compiled whisper binary similar to how llama-server is shipped

### L3 — CPAL / ALSA / PipeWire Audio
- CPAL on Linux uses ALSA by default; PipeWire is increasingly common as the session audio server
- PipeWire provides an ALSA compatibility layer but it can malfunction with applications that hold ALSA exclusively
- Audio device enumeration can return dozens of ALSA "virtual" devices; the app may pick the wrong default
- **Risk:** Voice features fail silently on PipeWire setups; mic appears active but produces no audio
- **Mitigation:** In `audio/device.rs`, filter ALSA device list to prefer `default`, `pulse`, or `pipewire` named devices; log which device was selected

### L4 — AppImage / Packaging
- Tauri on Linux produces `.deb` and `.AppImage` bundles
- AppImage bundles GLIBC at compile time; users on older distros (Ubuntu 20.04) may get "GLIBC_2.32 not found" errors
- **Mitigation:** Build on the oldest supported Ubuntu LTS; document minimum GLIBC version

### L5 — File Permissions on App Data Dir
- On some Linux distros with XDG BaseDir compliance issues, `app_data_dir` may not exist or may be read-only
- **Risk:** DB init fails, whisper models not deployed, app crashes with unclear error
- **Mitigation:** Add explicit `fs::create_dir_all` with error logging before every file write in startup

---

## macOS

### M1 — Apple Silicon (aarch64) vs Intel (x86_64)
- Metal backend is the primary accelerator on macOS
- The app ships separate bundles for aarch64 and x86_64; Universal Binary not yet in tauri.conf.json
- Rosetta 2 translation causes subtle Metal performance differences
- **Risk:** x86_64 binary on M-series Mac hits different Metal resource limits
- **Mitigation:** Test both architectures explicitly; consider Universal Binary build for the macOS release

### M2 — Gatekeeper / Code Signing
- Unsigned macOS binaries trigger "app is damaged and can't be opened" on macOS 13+
- The tauri.conf.json does not show explicit notarization config
- **Risk:** Users who download the DMG get blocked by Gatekeeper; the workaround (right-click → Open) is not obvious
- **Mitigation:** Either set up code signing + notarization before public release OR ship clear first-launch instructions. For end-of-week launch, at minimum document the `xattr -dr com.apple.quarantine /Applications/Arxell.app` workaround prominently

### M3 — Kokoro Python Bootstrap on macOS
- The Kokoro runtime ZIP is platform-specific (`macos-x86_64.zip` or `macos-aarch64.zip`)
- Python version differences between macOS 12, 13, 14 can break PyPI package installs
- `whisper-rs` links against system `libclang` — Xcode Command Line Tools must be installed
- **Risk:** TTS/STT fails on a clean macOS install without Xcode CLT
- **Mitigation:** Pre-bundle the Python environment in the app package rather than installing at runtime; OR document the dependency clearly with an in-app error that includes the fix

### M4 — Memory Pressure Management
- macOS unified memory means GPU and system RAM share the pool
- `system_info.rs` uses IOKit for memory monitoring on macOS — the probe can return stale data
- On M-series Macs with 8GB, running a 7B model + the app UI simultaneously can trigger OS memory pressure
- **Risk:** App receives memory pressure notification and is backgrounded/killed mid-inference
- **Mitigation:** The existing memory warning (< 6GB available) is a good start; add guidance to users on how to reduce context size

---

## Windows

### W1 — whisper-rs Not Available
- `whisper-rs` is excluded on Windows (`#[cfg(not(target_os = "windows"))]` or feature flag)
- Windows STT falls back to the Python whisper daemon
- **Risk:** TTS/STT requires a working Python install; many Windows users don't have Python or have conflicting versions
- **Mitigation (primary):** Consider shipping a pre-built `whisper.dll`/`whisper.exe` sidecar and calling it directly rather than through Python. There are C-API builds of whisper.cpp for Windows. This eliminates the Python dependency for STT
- **Mitigation (secondary):** Use Windows built-in speech recognition (`Windows.Media.SpeechRecognition`) as fallback via Tauri plugin

### W2 — Path Separators and AppData
- Windows uses `\` path separators; Rust's `std::path::Path` handles this correctly, but any string concatenation of paths will break
- `AppData\Roaming` is the typical location; `app_data_dir()` from Tauri should handle this, but bundled resource paths need verification
- **Risk:** Model paths, script paths, and state file paths with backslashes in format strings cause "file not found" on Windows
- **Mitigation:** Audit all path constructions in `lib.rs` and `model_manager/engine_installer.rs`; use `Path::join()` exclusively

### W3 — Process Management and PID Adoption
- `terminate_pid` on Windows uses `taskkill /F /PID`
- Windows PIDs are recycled aggressively; a stale state file PID may point to a system process
- The `is_pid_alive()` check does not verify process name on Windows
- **Risk:** On startup, the app terminates a random Windows process with the same PID as a previous llama-server
- **Mitigation:** Before calling `taskkill`, verify the process name matches `llama-server.exe` via `tasklist /FI "PID eq {pid}"` query

### W4 — Antivirus False Positives
- Unsigned binaries that spawn subprocesses and make network connections are commonly flagged by Windows Defender
- llama-server.exe downloads and a downloaded engine binary are high-risk targets for AV flagging
- **Risk:** Users get "virus found" warnings; app fails to run llama-server
- **Mitigation:** Code signing is essential for Windows. Submit to Microsoft for whitelisting if possible. Add clear user-facing messaging if llama-server is blocked

### W5 — Long Path Support
- Default Windows max path length is 260 characters
- Model file paths stored in `AppData\Roaming\dev.arx.app\models\...` can easily exceed this for deeply nested models
- **Risk:** File operations fail with cryptic "path not found" errors
- **Mitigation:** Enable Long Path support in the Windows manifest; add to `tauri.conf.json` bundle settings

### W6 — Console Window Flicker
- Spawning subprocesses (llama-server.exe, Python scripts) on Windows can briefly show a console window
- `std::process::Command` should use `.creation_flags(0x08000000)` (`CREATE_NO_WINDOW`) on Windows
- **Risk:** Console windows flash briefly; looks broken to users
- **Mitigation:** Audit all `Command::new(...)` calls in `engine_installer.rs` and audio script launchers for Windows `creation_flags`

---

## Cross-Platform Issues

### X1 — Startup Time
- First-run startup (Kokoro ZIP extraction + Python validation) can take 10–30 seconds on all platforms
- The window appears blank during this time
- **Priority:** HIGH — first impression is critical for a public launch
- **Fix:** Deferred async startup + progress events (see architecture notes)

### X2 — No Graceful Degradation for Voice
- If voice setup fails (Python missing, CPAL error, etc.), the app does not clearly communicate which parts are unavailable
- Voice buttons may appear enabled but produce no results
- **Fix:** Emit a structured capabilities object on startup: `{ stt: bool, tts: bool, reason: string }` and have the frontend disable buttons and show tooltips accordingly

### X3 — Local Server Health Not Monitored After Start
- Once llama-server is started, there is no periodic health check
- If the server crashes mid-session (OOM, driver crash), subsequent chat attempts get "connection refused" with no clear message
- **Fix:** Background health probe every 30 seconds; if server is dead, update AppState and emit an event so the frontend shows a recovery prompt

### X4 — Token Count Approximation
- `count_tokens(text) = text.len() / 4` in `turn.rs` — this is a rough heuristic
- Overestimates for short text, underestimates for code/JSON with many symbols
- This affects when compaction triggers, which can lead to context truncation on some conversations
- **Fix:** Use the local model's tokenizer (already exists in `model_manager/tokenizer.rs`) to get exact counts

### X5 — No Crash Reporting
- No automated crash reporting or telemetry
- Post-public-launch debugging will be difficult without crash reports
- **Recommendation:** Add opt-in Sentry integration; Tauri has a `tauri-plugin-sentry` that handles this cleanly with minimal privacy impact

### X6 — Concurrent DB Access from Multiple Commands
- `Mutex<Connection>` wrapping SQLite is safe but serializing. Two concurrent Tauri commands that both need to write to the DB will contend
- This is especially relevant for the A2A workflow engine where multiple runs could write concurrently
- **Fix (minimal):** Enable WAL mode in DB init; this allows concurrent reads and reduces write conflicts without a connection pool

---

## Priority Matrix for Pre-Launch

| Issue | Platform | Severity | Effort | Priority |
|---|---|---|---|---|
| Blank startup screen | All | HIGH | Medium | 1 |
| macOS Gatekeeper | macOS | HIGH | Low | 2 |
| Windows console flicker | Windows | MED | Low | 3 |
| Windows PID safety check | Windows | HIGH | Low | 4 |
| WAL mode for DB | All | MED | Very Low | 5 |
| Local server health check | All | MED | Low | 6 |
| Windows path separator audit | Windows | HIGH | Medium | 7 |
| Voice degradation messaging | All | MED | Low | 8 |
| Vulkan probe + CPU fallback | Linux | MED | Medium | 9 |
| macOS code signing | macOS | HIGH | High | 10 |
