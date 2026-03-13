# Quick Start

## Fastest path to first successful session
1. Start app:
```bash
npm run tauri dev
```
2. Open model/API configuration:
- Use `API's` panel to add/verify an API model, or
- Use `Serve` panel to load a local GGUF model/runtime.
3. In chat panel, ensure a conversation exists (auto-created if none).
4. Send a prompt in InputBar.
5. Confirm streaming assistant response appears.

## First-time checklist
- [ ] A model source is configured (API or local runtime/model).
- [ ] Conversation exists and is selected.
- [ ] If using voice, STT/TTS engines are configured and test passes.
- [ ] Optional: project workspace path set for file operations.

## Basic end-to-end workflow
1. Create/select project in sidebar.
2. Start a chat and ask for a file change.
3. Use Files/Code workspace panel to inspect created/edited files.
4. Use terminal panel for guarded command execution if needed.
5. Review diagnostics/logs for issues.

## What you should see
- Sidebar: time/resources/model/voice/history.
- Chat: mode selector, skills bar, messages, input.
- Workspace: tool bar and selected tool panel content.

## Next
Continue with [05_user_guide.md](./05_user_guide.md).
