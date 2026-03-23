# Launch Readiness — End of Week Public Release

This document takes a realistic look at what needs to happen before ARX goes public, and provides a prioritized checklist.

---

## The Stakes

A public launch means:
- Strangers will install the app without support from the development team
- Issues encountered in the first hour will determine whether users stay
- Critical bugs discovered post-launch are much more expensive to recover from than pre-launch fixes
- The app represents the team's technical credibility

The goal is not perfection — it's a **stable first impression** with a clear path forward.

---

## Critical Blockers (Must Fix Before Launch)

### C1 — Blank Startup Screen
**Problem:** On first run, the user sees a blank window for 5–30 seconds.
**Impact:** Many users will assume the app is broken and close it.
**Fix:** Display a minimal loading screen with progress feedback immediately. Even just "Setting up voice models..." is better than nothing.
**Effort:** Low (emit startup events from Rust, render a loading div in React).

### C2 — macOS Gatekeeper Warning
**Problem:** Unsigned macOS builds show "app is damaged and can't be opened."
**Impact:** Most non-technical macOS users will not know the workaround.
**Options:**
  - (Best) Code sign and notarize the macOS build before launch
  - (Acceptable) Add a prominent first-launch guide in README/docs: `sudo xattr -dr com.apple.quarantine /Applications/Arxell.app`
  - (Alternative) Distribute via Homebrew cask (bypasses Gatekeeper issues for CLI users)

### C3 — Windows PID Safety
**Problem:** On startup, the app may kill a random Windows process if the state file PID has been recycled.
**Impact:** Rare but catastrophic — could kill a user's running process.
**Fix:** Verify process name matches `llama-server.exe` before `taskkill`. Low-effort, high-safety.

### C4 — No User Messaging When Voice Setup Fails
**Problem:** If Python is missing, whisper-rs fails to link, or Kokoro bootstrap fails, voice features silently don't work.
**Impact:** Users think the app is broken; "the mic button does nothing."
**Fix:** Emit a structured capabilities event on startup. Frontend shows disabled state with tooltip explaining why (e.g., "Voice unavailable: Python 3.10+ required").

### C5 — Local Server Crash Not Detected Post-Start
**Problem:** If llama-server crashes after initial startup (GPU OOM, driver crash), subsequent chat fails with a generic network error.
**Impact:** Users see "request failed" with no actionable message.
**Fix:** Background health probe (every 30s). If server is dead, show "Local model offline — restart?" prompt.

---

## High Priority (Should Fix Before Launch)

### H1 — README Must Be Complete and Accurate
The README.md is the first thing users and contributors read. It needs:
- Clear "what is this" description (one paragraph, non-technical)
- Installation instructions for all three platforms (Linux/macOS/Windows)
- System requirements (RAM, GPU, OS version)
- Quick start guide (5 steps to first AI response)
- Troubleshooting section for common first-run issues
- Contributing guide link

### H2 — Error Messages Must Be Actionable
Current error messages from Tauri commands are often raw strings like "request failed" or the inner Rust error. Before launch:
- Model load failure: "Could not start local model. Check that the file exists and you have enough RAM."
- API key failure: "API request failed. Check your API key in Settings."
- Voice failure: "Voice setup failed. See the troubleshooting guide."

### H3 — Settings Must Survive App Updates
If the settings DB schema changes between v0.9.x and v1.0, users who upgrade may lose their settings or get a crash on startup.
- Verify that DB migrations handle missing columns gracefully
- Test upgrade path from v0.8.x to current

### H4 — Enable WAL Mode
One line in DB init: `conn.execute_batch("PRAGMA journal_mode=WAL;")`
This prevents write-blocking reads and reduces the chance of DB corruption on unexpected shutdown.

### H5 — Console Window on Windows
Spawned Python subprocesses and llama-server.exe may flash a console window on Windows.
Audit all `Command::new()` calls for `CREATE_NO_WINDOW` flag.

---

## Medium Priority (First Week After Launch)

### M1 — Crash Reporting (Opt-In)
Add Sentry or similar. Without it, debugging post-launch issues is blind. A simple opt-in telemetry prompt on first run with clear privacy explanation will capture crashes that users wouldn't otherwise report.

### M2 — Automated Builds for All Platforms
Verify that CI builds successfully produce:
- `.deb` + `.AppImage` for Linux
- `.dmg` for macOS (both arm64 and x86_64)
- `.exe` / `.msi` for Windows

Automated builds gate the ability to ship fixes quickly. If these are manual, the release process is a bottleneck.

### M3 — Keyboard Shortcuts Documentation
The app has keyboard shortcuts (keybindings system) but they may not be documented in the UI. Add a keybindings reference accessible from Help.

### M4 — Model Download Experience
The first-run experience for someone without a local model needs to be smooth:
- Recommend a specific model (e.g., "Llama-3.2-3B-Instruct.Q4_K_M.gguf")
- Provide a direct download link or in-app download button
- Show download progress

### M5 — API Key Setup Guide
For users who want to use cloud APIs (OpenAI, Anthropic), the settings UI must clearly explain where to get API keys and what to enter.

---

## Nice to Have (Post-Launch Roadmap)

- Flow templates (3–5 built-in templates)
- Sub-agent spawning tool
- Voice without Python dependency (tract-onnx Kokoro)
- specta type generation for IPC safety
- Contributor guide with architecture diagram
- Video demo / screenshots in README

---

## Pre-Launch Checklist

### Platform Testing

```
[ ] macOS (Apple Silicon, arm64): Install, first run, voice, local model, API model
[ ] macOS (Intel, x86_64): Same as above
[ ] Ubuntu 22.04 LTS: Install .deb, first run, voice, local model
[ ] Ubuntu 24.04 LTS: Same
[ ] Fedora 40: Install .AppImage, basic functionality
[ ] Windows 11: Install .exe, first run, voice fallback, local model
[ ] Windows 10: Basic functionality
```

### Feature Testing

```
[ ] First run: startup completes, welcome screen shows
[ ] Chat with local model: load model, send message, receive streaming response
[ ] Chat with API: configure API key, send message, receive response
[ ] Voice STT: record speech, receive transcript in chat input
[ ] Voice TTS: receive chat response, audio plays
[ ] Code workspace: open terminal, run a command
[ ] Conversation management: create, switch, delete conversations
[ ] Settings: all settings save and persist after restart
[ ] Project management: create project, associate conversations
[ ] App update: install new version over old, settings preserved
```

### Security Checklist

```
[ ] API keys not logged in plaintext
[ ] API keys not included in crash reports
[ ] Memory files not included in crash reports
[ ] webproxy:// scheme does not allow file:// access
[ ] Tool gateway cannot execute arbitrary shell commands not authorized by user
[ ] No hardcoded credentials in the codebase (security_preflight.sh passes)
```

### Documentation

```
[ ] README: installation instructions for all platforms
[ ] README: system requirements
[ ] README: quick start (5 steps)
[ ] README: troubleshooting section
[ ] CONTRIBUTING.md: up to date
[ ] LICENSE: correct
[ ] In-app help: accessible from UI
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| macOS Gatekeeper blocks most macOS users | HIGH | HIGH | Code sign OR clear documentation |
| Windows users have no Python for voice | HIGH | MEDIUM | Clear messaging; voice optional |
| LLM model download confusion | HIGH | MEDIUM | Guided first-run with specific recommendations |
| DB corruption on power-loss | MEDIUM | HIGH | WAL mode |
| Kokoro bootstrap failure freezes startup | MEDIUM | HIGH | Async startup + error recovery |
| llama-server GPU OOM not detected | MEDIUM | MEDIUM | Health probe |
| Negative first impression from blank startup | HIGH | HIGH | Startup progress screen |
| Security issue in webproxy scheme | LOW | VERY HIGH | Audit before launch |

---

## The One Thing That Changes Everything

If forced to pick one change that has the largest impact on the public launch's success:

**Implement the startup progress screen** (Critical blocker C1).

It is the first thing every user sees. It costs 1–2 days of work. And it changes the first impression from "is this broken?" to "this is a professional app." Every other improvement is additive; this one is foundational to first-run trust.

---

## Post-Launch: Toward REPL Loops

Once the app is stable in users' hands, the development focus shifts to Phase 1 of the REPL loop implementation (see `05-repl-loops-vision-and-design.md`):

1. Wire agent crate into Tauri commands (unify chat paths)
2. Add `spawn_agent` tool
3. Build flow session database schema
4. Build 2–3 flow templates
5. Update FlowPanel to show live agent trees

This work can happen in parallel with community engagement — the architecture is clear, the interfaces are defined, and individual pieces can be contributed independently.
