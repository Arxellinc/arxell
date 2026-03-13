# Installation and Setup

## 1. Install prerequisites

### Linux (typical Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libasound2-dev
```

Install Node.js 18+ and Rust:
```bash
# Node (example via NodeSource or your package manager)
# Rust:
curl https://sh.rustup.rs -sSf | sh
source "$HOME/.cargo/env"
```

Install Tauri CLI:
```bash
npm install -g @tauri-apps/cli@2
```

### macOS
```bash
xcode-select --install
# Install Node.js and Rust (Homebrew or preferred method)
npm install -g @tauri-apps/cli@2
```

### Windows
- Install Visual Studio Build Tools (C++ workload)
- Install Node.js 18+
- Install Rust via rustup
- Install Tauri CLI:
```powershell
npm install -g @tauri-apps/cli@2
```

## 2. Get the source
```bash
git clone <your-repo-url> arx
cd arx
```

## 3. Install frontend dependencies
```bash
npm install
```

## 4. Run in development
```bash
npm run tauri dev
```

## 5. Build production
```bash
npm run tauri build
```

## 6. Verify installation
- App window opens.
- No startup crash in terminal.
- Sidebar/Chat/Workspace panels render.
- Backend logs appear in terminal panel.
- Model/API panels are reachable.

## 7. First-run configuration checklist
- Configure model endpoint settings (API panel or serve/local model flow).
- Optional voice setup:
  - set STT engine/URL,
  - set TTS engine paths/URLs,
  - verify audio devices.
- Set/create project workspace path if using file tools.

## Common setup failures
- `tauri dev` fails due missing system packages (Linux): install GTK/WebKit2GTK/ALSA dev packages.
- Voice local STT/TTS fails: missing Python deps (`faster-whisper`, `kokoro-onnx`, `soundfile`) or missing `piper` binary.
- Local model load unavailable: no compatible runtime backend/binary; install runtime engine from Serve panel.
- External API verification fails: check base URL normalization and auth key.
