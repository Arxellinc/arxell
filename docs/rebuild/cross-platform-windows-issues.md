# Windows Build and Runtime Issues

This document identifies issues that cause the Arxell app to fail on Windows when built for production (`npm run tauri build`).

## Critical Issues

### 1. whisper-rs Enabled on Windows (FIXED 2026-03-26)

**File:** `src-tauri/Cargo.toml` (lines 71-74)

**Previous Issue:** The `whisper-rs` crate was explicitly disabled for Windows builds with the comment:
```toml
[target.'cfg(not(target_os = "windows"))'.dependencies]
# whisper-rs pulls in whisper.cpp bindgen; keep it off Windows by default to
# avoid toolchain-specific bindgen breakage during public release builds.
whisper-rs = { path = "../vendor/whisper-rs", optional = true }
```

**Fix Applied:** The dependency has been moved to the main `[dependencies]` section and is now enabled on all platforms including Windows. The bindgen issues have been resolved per https://codeberg.org/tazz4843/whisper-rs/issues.

**Current Configuration:**
```toml
# whisper-rs - Whisper STT via whisper.cpp bindings
# Now enabled on all platforms including Windows as the bindgen issues have been resolved
whisper-rs = { path = "../vendor/whisper-rs", optional = true }
```

**Verification:** On Windows, the app will now use whisper-rs for local STT when `stt_engine` is set to `"whisper_rs"` (the default).

### 2. Vulkan Backend for Windows (FIXED 2026-03-26)

**File:** `.github/workflows/release-tauri.yml`

**Previous Issue:** The Windows release was built with `--no-default-features --features custom-protocol` which disabled all inference backends. Without any GPU backend (vulkan/cuda/metal/rocm), the app could not load local GGUF models.

**Fix Applied:** Added Vulkan and whisper-rs-stt features to the Windows build:
```yaml
- platform: "windows-latest"
  args: "-- --no-default-features --features custom-protocol,vulkan,whisper-rs-stt"
```

**Why Vulkan:**
- Works on most modern Intel integrated graphics (Gen 8+)
- Works on AMD GPUs (RX 400 series and newer)
- Works on NVIDIA GPUs (GTX 900 series and newer)
- Does not require proprietary drivers (unlike CUDA)
- Works on laptops with integrated graphics

**Verification:** After rebuilding and installing, the welcome modal should allow downloading and using local GGUF models.

### 2. Visual Studio Build Tools Required

**File:** Referenced in `src-tauri/Cargo.toml` (various dependencies)

**Issue:** Many Rust crates require C++ compilation, which needs Visual Studio Build Tools.

**Build Failure Symptom:**
```
error: failed to run custom build command for `ring`
error: Microsoft Visual C++ Builder is required
```

**Fix:** Install Visual Studio Build Tools:
1. Download Visual Studio Installer from https://visualstudio.microsoft.com/downloads/
2. Select "C++ build tools" workload
3. Ensure "Windows 10/11 SDK" is included

### 3. Python Path Resolution on Windows

**File:** `src-tauri/src/commands/voice.rs` (lines 76-85)

```rust
fn default_python_bin() -> String {
    #[cfg(target_os = "windows")]
    {
        "python".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        "python3".to_string()
    }
}
```

**Issue:** Windows uses `python` by default, but:
- Python may not be in PATH
- Multiple Python installations possible
- pywin32 may cause conflicts

**Runtime Failure Symptom:**
```
python_launch_failed: No such file or directory
import kokoro_onnx failed
```

**Fix:** Add Python to PATH or use full path:
```powershell
# In PowerShell
$env:Path += ";C:\Python311"
# Or use python launcher
py -3 --version
```

### 4. PowerShell Execution Policy

**File:** `src-tauri/src/model_manager/system_info.rs` (GPU detection)

**Issue:** Some system detection scripts may fail due to PowerShell execution policies.

**Runtime Failure Symptom:**
```
cannot be loaded because running scripts is disabled
```

**Fix:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 5. Antivirus False Positives

**Issue:** Windows Defender or other antivirus may:
- Quarantine the built executable
- Block subprocess spawning
- Interfere with runtime extraction

**Runtime Failure Symptom:**
- App crashes on startup
- Whisper/Kokoro processes killed
- Database access denied

**Fix:**
1. Add exclusion for app directory in Windows Security
2. Temporarily disable real-time protection during testing
3. Sign the executable (requires code signing certificate)

### 6. Path Separators in Resource Loading

**File:** Multiple files including `src-tauri/src/lib.rs`, `src-tauri/src/commands/voice.rs`

**Issue:** Windows uses backslash (`\`) while Rust typically uses forward slash (`/`). Path handling may fail in some contexts.

**Runtime Failure Symptom:**
```
failed to resolve app data dir
Bundled resource not found
```

**Fix:** Use `std::path::Path` consistently and avoid hardcoded separators.

### 7. Long Path Support

**Issue:** Windows has 260 character path limit by default, which can cause issues with:
- Deeply nested model directories
- Long resource paths in AppData

**Build/Runtime Failure Symptom:**
```
The system cannot find the path specified
```

**Fix:** Enable long paths in Windows:
```powershell
# Run as Administrator
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

### 8. UAC and Permission Issues

**Issue:** User Account Control may:
- Block writes to Program Files
- Require elevation for certain operations

**Runtime Failure Symptom:**
```
Access denied: cannot write to ...
```

**Fix:** App should use AppData for all writable storage (already implemented correctly in code).

### 9. CREATE_NO_WINDOW Flag Usage

**File:** `src-tauri/src/commands/voice.rs` (lines 20-28), `src-tauri/src/audio/tts.rs` (lines 20-28)

**Issue:** The code correctly uses `CREATE_NO_WINDOW` on Windows to hide console windows for subprocesses.

**Status:** This is properly implemented. No issues expected.

### 10. WebView2 Runtime

**File:** `src-tauri/tauri.conf.json`

**Issue:** Tauri v2 uses WebView2 on Windows, which:
- Requires Windows 10 version 1803+ or Windows 11
- May not be installed on older systems
- Evergreen version auto-installs with Windows updates

**Runtime Failure Symptom:**
```
Failed to initialize WebView2
```

**Fix:** Install WebView2 runtime:
- Download from https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- Or ensure Windows is up to date

### 11. GPU Detection Thread

**File:** `src-tauri/src/lib.rs` (lines 1325-1330)

```rust
#[cfg(target_os = "windows")]
model_manager::system_info::start_windows_gpu_probe_thread();
```

**Issue:** Windows GPU detection uses PowerShell which may have execution restrictions.

**Status:** Properly guarded with `#[cfg(target_os = "windows")]`.

### 12. llama-server Binary Names

**File:** `src-tauri/src/model_manager/engine_installer.rs` (lines 58-65)

```rust
pub fn get_binary_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}
```

**Issue:** Correctly handled. No issues expected.

### 13. Bundle Icons

**File:** `src-tauri/tauri.conf.json` (lines 33-39)

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

**Issue:** Missing icon files can cause:
- Build warnings
- Missing icons in taskbar/dock
- MSI/WiX installer failures

**Fix:** Ensure all icon files exist:
```powershell
# Verify icons exist
Get-ChildItem src-tauri/icons/
```

### 14. NSIS/WiX Installer Issues

**File:** `src-tauri/tauri.conf.json` (bundle configuration)

**Issue:** Tauri uses NSIS by default on Windows. Issues can occur with:
- UAC elevation
- Path length limitations
- Antivirus interference

**Fix:** Consider MSI output:
```json
{
  "bundle": {
    "targets": ["msi", "nsis"]
  }
}
```

## Windows-Specific Considerations

### 15. CUDA/ROCm Support

**File:** `src-tauri/Cargo.toml` (lines 91-97)

```toml
cuda         = ["llama-cpp-2/cuda"]
rocm         = ["llama-cpp-2/rocm"]
```

**Issue:** NVIDIA CUDA requires:
- CUDA Toolkit installed
- Compatible GPU drivers
- MSVC toolchain

**Fix:** For CPU-only builds:
```bash
cargo build --release --no-default-features
```

### 16. Environment Variables

**File:** Frontend configuration

**Issue:** Some VITE_ environment variables may not be set in Windows builds.

**Runtime Failure Symptom:**
```
Clerk publishable key missing
Sync signal URL undefined
```

**Fix:** Create `.env` file in project root:
```
VITE_CLERK_PUBLISHABLE_KEY=your_key_here
VITE_SYNC_SIGNAL_URL=https://your-server.com
```

## Build Configuration

### Windows Build Command

```powershell
# PowerShell
$env:CARGO_BUILD_JOBS=4
npm run tauri build
```

### Visual Studio Developer Command Prompt

Open VS Developer Command Prompt for proper MSVC environment:
```powershell
# From Windows Start menu
"Developer Command Prompt for VS 2022"
```

## Summary Checklist

- [x] Install Visual Studio Build Tools with C++ workload
- [x] Install WebView2 runtime (or ensure Windows is updated)
- [x] Add Python to PATH
- [x] Set PowerShell execution policy
- [x] Configure environment variables in .env file
- [x] Test with antivirus disabled (for development)
- [x] Enable long path support (optional but recommended)
- [x] Use CPU-only build if CUDA not available
- [x] Verify icon files exist before build
- [ ] Test installer on clean Windows system

## Process Termination Fixes (2026-03-26)

### Memory Leak Issue - Background Processes

**Problem:** On Windows, the app was experiencing serious memory issues due to orphaned background processes. When the app exited or crashed, Python subprocesses (Kokoro TTS, Whisper STT) and llama-server were not being properly terminated, leading to:

- Accumulated GPU memory (VRAM) leaks across sessions
- Orphaned python.exe processes visible in Task Manager
- ONNX Runtime not releasing GPU resources
- System memory exhaustion after repeated use

**Root Cause:** On Windows, `Child::kill()` sends `TerminateProcess` but does NOT wait for the process to actually exit. This leaves zombie processes that hold onto resources (especially GPU memory from ONNX runtime).

**Fixes Applied:**

1. **KokoroDaemon (`src-tauri/src/audio/tts.rs`):**
   - Modified `kill()` to call both `kill()` AND `wait()` to ensure full termination
   - Added logging for verification

2. **WhisperDaemon (`src-tauri/src/audio/stt.rs`):**
   - Modified `kill()` to call both `kill()` AND `wait()` to ensure full termination
   - Added logging for verification

3. **LocalServerHandle (`src-tauri/src/lib.rs`):**
   - Already properly implemented with both kill() and wait() in Drop trait

**Technical Details:**
- On Windows, `Child::drop()` detaches the child process without killing it
- `kill()` sends SIGTERM (Unix) or TerminateProcess (Windows) but doesn't wait
- `wait()` blocks until the process exits and reclaims its resources
- GPU memory from ONNX Runtime is only released when the process fully exits

**Verification:**
After these fixes, you should see log messages like:
```
[kokoro-daemon] Daemon killed and waited
[whisper-daemon] Daemon killed and waited
[shutdown] llama-server pid=XXX mode=owned terminated=true elapsed_ms=XXX
```

When checking Task Manager after closing the app, there should be no orphaned python.exe or llama-server.exe processes.
