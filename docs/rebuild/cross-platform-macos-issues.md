# macOS Build and Runtime Issues

This document identifies issues that cause the Arxell app to fail on macOS when built for production (`npm run tauri build`).

## Critical Issues

### 1. whisper-rs Dependency

**File:** `src-tauri/Cargo.toml` (lines 75-78)

```toml
[target.'cfg(not(target_os = "windows"))'.dependencies]
# whisper-rs pulls in whisper.cpp bindgen; keep it off Windows by default to
# avoid toolchain-specific bindgen breakage during public release builds.
whisper-rs = { path = "../vendor/whisper-rs", optional = true }
```

**Issue:** The `whisper-rs` crate is optional but enabled by default via feature flags. It requires:
- C++ toolchain (clang)
- whisper.cpp build system
- Proper code signing for distribution

**Build Failure Symptom:**
```
error: failed to run custom build command for `whisper-rs`
```

**Fix:** The code correctly excludes whisper-rs from Windows but macOS builds may still fail. Ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```

Or disable the feature for pure Swift-based builds:
```bash
cargo build --release --no-default-features
```

### 2. Metal Backend Compilation

**File:** `src-tauri/Cargo.toml` (lines 93-94)

```toml
metal        = ["llama-cpp-2/metal"]  # Apple Metal (macOS/iOS)
```

**Issue:** The Metal backend requires:
- macOS SDK
- Proper Metal framework linking
- GPU with Metal support

**Build Failure Symptom:**
```
error: package `llama-cpp-2` does not have feature `metal`. 
The package `llama-cpp-2` enabled features requested: `metal`
```

**Fix:** Update llama-cpp-2 to a version that supports Metal, or use CPU-only builds:
```bash
cargo build --release --no-default-features
```

### 3. Code Signing and Notarization

**File:** `src-tauri/tauri.conf.json`

**Issue:** macOS requires:
- Developer ID certificate for distribution outside App Store
- Notarization via Apple's servers
- Hardened Runtime enabled

**Runtime Failure Symptom:**
```
"Arxell.app" cannot be opened because the developer cannot be verified.
```

**Fix:** Configure code signing in tauri.conf.json:
```json
{
  "tauri": {
    "macOS": {
      "minimumSystemVersion": "10.15",
      "frameworks": ["CoreAudio", "AudioToolbox", "AVFoundation"],
      "signingIdentity": "-",
      "providerShortName": null,
      "entitlements": null
    }
  }
}
```

For ad-hoc signing during development:
```bash
export CODESIGN_IDENTITY="-"
npm run tauri build
```

### 4. Entitlements for Audio/Video Access

**Issue:** macOS requires explicit user permission for:
- Microphone access (voice/STT)
- Screen recording (if applicable)
- Network access

**Runtime Failure Symptom:**
```
Permission denied: microphone access
```

**Fix:** Add to `src-tauri/entitlements.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

### 5. Python Path Detection on macOS

**File:** `src-tauri/src/commands/voice.rs` (lines 76-85, 94-111)

**Issue:** On macOS with Homebrew or pyenv, Python may be installed in non-standard locations. The code correctly handles `.exe` extension for Windows but macOS may have issues with Python detection.

**Runtime Failure Symptom:**
```
python_launch_failed: No such file or directory
kokoro_onnx import failed
```

**Fix:** Ensure Python is in PATH or configure explicitly:
```bash
# Add to ~/.zshrc or ~/.bash_profile
export PATH="/opt/homebrew/bin:$PATH"
```

Or set the Python path in app settings.

### 6. Audio Device Enumeration

**File:** `src-tauri/src/commands/voice.rs` (lines 1384-1430)

**Issue:** The code has Linux-specific device filtering that doesn't apply to macOS:
```rust
#[cfg(target_os = "linux")]
fn is_linux_alias(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("card=")
        || lower.contains(",dev=")
        ...
}
```

This is properly guarded with `#[cfg(target_os = "linux")]` but the audio device enumeration may still fail on macOS due to CoreAudio differences.

**Runtime Failure Symptom:**
```
No audio devices found
```

**Fix:** The code is properly structured; verify CoreAudio framework is linked in Cargo.toml:
```toml
[target.'cfg(target_os = "macos")'.dependencies]
# CoreAudio is linked via cpal automatically
```

### 7. Bundle Resources Not Found

**File:** `src-tauri/tauri.conf.json` (lines 40-50)

**Issue:** Similar to Linux, resource paths may not resolve correctly during bundling:
```json
"resources": {
  "resources/silero_vad.onnx": "resources/silero_vad.onnx",
  ...
  "../public/voice": "resources/voice"
}
```

**Runtime Failure Symptom:**
```
Runtime archive missing: kokoro-runtime-macos-x86_64.zip
```

**Fix:** Verify public/voice directory contains required files before build:
```bash
ls -la public/voice/
ls -la public/whisper/
```

### 8. Hardened Runtime Issues

**File:** Build configuration

**Issue:** With macOS Hardened Runtime enabled (required for notarization):
- JIT compilation may be blocked
- Dynamic code loading restricted
- Some system calls restricted

**Build Failure Symptom:**
```
Library not loaded: @rpath/...
```

**Fix:** Disable hardened runtime for development builds, or add exceptions:
```json
{
  "build": {
    "hardenedRuntime": false
  }
}
```

## macOS-Specific Considerations

### 9. Universal Binary Support

**Issue:** Building for both Intel (x86_64) and Apple Silicon (arm64) requires:
- Cross-compilation setup
- Or separate builds for each architecture

**Fix:** Use lipo for universal binaries:
```bash
# Build for both architectures
cargo build --release --target x86_64-apple-darwin
cargo build --release --target aarch64-apple-darwin
lipo -create -output release/arx target/x86_64-apple-darwin/release/arx target/aarch64-apple-darwin/release/arx
```

### 10. Minimum macOS Version

**File:** `src-tauri/tauri.conf.json`

**Issue:** The app should declare minimum supported version. Current config doesn't specify.

**Fix:** Add to bundle configuration:
```json
{
  "macOS": {
    "minimumSystemVersion": "12.0"
  }
}
```

## Build Configuration

### Recommended Features for macOS

For Apple Silicon with Metal:
```bash
cargo build --release --features "metal"
```

For Intel or fallback:
```bash
cargo build --release --no-default-features
```

### Xcode Requirements

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Accept license
sudo xcodebuild -license accept
```

## Summary Checklist

- [ ] Install Xcode Command Line Tools
- [ ] Accept Xcode license
- [ ] Configure code signing identity
- [ ] Create entitlements file for audio input
- [ ] Verify Python3 is in PATH
- [ ] Test on both Intel and Apple Silicon (or use universal binary)
- [ ] Set minimum macOS version in config
- [ ] Test audio input permissions
- [ ] Prepare for notarization (if distributing outside App Store)
