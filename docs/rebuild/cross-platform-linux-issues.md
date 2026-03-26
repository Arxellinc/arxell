# Linux Build and Runtime Issues

This document identifies issues that cause the Arxell app to fail on Linux when built for production (`npm run tauri build`).

## Critical Issues

### 1. Missing webkit2gtk Dependency

**File:** `src-tauri/Cargo.toml` (line 73)

```toml
[target.'cfg(target_os = "linux")'.dependencies]
webkit2gtk = "2.0"
```

**Issue:** The `webkit2gtk` crate requires system-level GTK/WebKit development libraries. On many Linux distributions, these are not installed by default.

**Build Failure Symptom:**
```
error: failed to run custom build command for `webkit2gtk-2.0`
```

**Fix:** Install required dependencies before building:

```bash
# Debian/Ubuntu
sudo apt-get install libwebkit2gtk-4.1-dev build-essential libssl-dev libsoup-3.0-dev libgtk-4.1-dev

# Fedora/RHEL
sudo dnf install webkit2gtk4.1-devel openssl-devel gtk3-devel libsoup3-devel

# Arch Linux
sudo pacman -S webkit2gtk-4.1 base-devel openssl libsoup
```

### 2. ALSA Development Headers

**File:** Referenced in `src-tauri/src/audio/` (cpal crate usage)

**Issue:** The `cpal` audio library may require ALSA development headers for audio device enumeration on Linux.

**Build Failure Symptom:**
```
error: unknown type name 'snd_pcm_format_t'
```

**Fix:**
```bash
# Debian/Ubuntu
sudo apt-get install libasound2-dev

# Fedora/RHEL  
sudo dnf install alsa-lib-devel

# Arch Linux
sudo pacman -S alsa-lib
```

### 3. Resource Path Resolution Issues

**File:** `src-tauri/tauri.conf.json` (lines 40-50)

```json
"resources": {
  "resources/silero_vad.onnx": "resources/silero_vad.onnx",
  "resources/scripts/voice/tts_kokoro.py": "resources/scripts/voice/tts_kokoro.py",
  ...
  "../public/whisper/ggml-base-q8_0.bin": "resources/whisper/ggml-base-q8_0.bin",
  "../public/voice": "resources/voice"
}
```

**Issue:** The resources use relative paths (`../public/`) which may not resolve correctly during the Tauri bundling process. This can cause runtime failures where bundled voice models and scripts are not found.

**Runtime Failure Symptom:**
```
Failed to deploy bundled Whisper model: ...
Bundled Kokoro model not found in resources
```

**Fix:** Ensure the public directory structure matches the expected paths, or update paths to use absolute references from the project root.

### 4. Python Path Resolution on Linux

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

**Issue:** On some Linux systems (especially minimal installations or those using `python-is-python3`), `python3` may not be available or the correct interpreter.

**Runtime Failure Symptom:**
```
python_launch_failed: No such file or directory
```

**Fix:** Consider adding fallback detection:
```rust
fn default_python_bin() -> String {
    // Try python3 first
    if std::process::Command::new("python3").arg("--version").output().is_ok() {
        return "python3".to_string();
    }
    // Fallback to python
    "python".to_string()
}
```

### 5. espeak-ng Not Available

**File:** `src-tauri/src/audio/tts.rs` (lines 366-387)

**Issue:** espeak-ng is used as a TTS fallback but may not be installed on all Linux systems.

**Runtime Failure Symptom:**
```
espeak-ng is not available
```

**Fix:** Install espeak-ng:
```bash
# Debian/Ubuntu
sudo apt-get install espeak-ng

# Fedora/RHEL
sudo dnf install espeak-ng

# Arch Linux
sudo pacman -S espeak-ng
```

### 6. Zip Archive Permission Handling

**File:** `src-tauri/src/lib.rs` (lines 505-511)

```rust
#[cfg(unix)]
{
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = entry.unix_mode() {
        let _ = std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode));
    }
}
```

**Issue:** This code only runs on Unix, but extracting archives may fail if the zip was created on Windows with different permission semantics. Additionally, `libc::prctl` is used which is Linux-specific.

**Build/Run Issue:** Properly guarded but could fail with malformed archives.

### 7. Desktop Entry and Icon Paths

**File:** `src-tauri/tauri.conf.json` (lines 30-51)

**Issue:** Linux desktop entry generation requires proper icon paths. The current icon configuration uses PNG and ICO formats but Linux desktop files typically need SVG or specific sizes.

**Fix:** Add proper desktop file configuration:
```json
"linux": {
  "appimage": {
    "bundleMediaFramework": true
  },
  "deb": {
    "depends": ["libwebkit2gtk-4.1-0", "libssl3"]
  }
}
```

## Known Runtime Issues

### 8. GPU Acceleration (Vulkan)

**File:** `src-tauri/src/model_manager/` (various)

**Issue:** Vulkan support requires:
- Vulkan SDK installed
- Compatible GPU drivers
- Proper validation layers (for debugging)

**Runtime Failure Symptom:**
```
Vulkan: no compatible devices found
```

**Fix:** Ensure Mesa drivers or proprietary NVIDIA/AMD drivers are installed with Vulkan support.

### 9. PipeWire vs PulseAudio

**File:** `src-tauri/src/audio/`

**Issue:** Modern Linux systems may use PipeWire, but cpal may have issues detecting audio devices properly.

**Runtime Failure Symptom:**
```
No suitable input device found
```

**Fix:** Ensure audio system is properly configured with PipeWire or PulseAudio.

## Build Configuration Recommendations

### Minimum Cargo Features for Linux

For a Linux release build without GPU acceleration (CPU-only):
```bash
cargo build --release --features "openmp"
```

For Vulkan support:
```bash
cargo build --release --features "vulkan"
```

### Environment Variables

Set these before building:
```bash
export CARGO_BUILD_JOBS=4
export RUST_LOG=info
```

## Summary Checklist

- [ ] Install webkit2gtk development libraries
- [ ] Install ALSA development libraries
- [ ] Install espeak-ng for TTS fallback
- [ ] Verify Python3 is available
- [ ] Ensure audio system (PulseAudio/PipeWire) is running
- [ ] Install GPU drivers with Vulkan support (optional)
- [ ] Test voice/STT/TTS functionality after installation
