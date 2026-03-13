# User Guide

## Main layout
- Left sidebar:
  - time/date, live resource metrics,
  - model status/select,
  - voice section,
  - history/projects/conversations,
  - system alerts, diagnostics.
- Center chat panel:
  - mode selector (`chat`, `code`, `architect`, `auto`),
  - skills/toggles,
  - message stream,
  - input bar + voice controls.
- Right workspace panel:
  - tool bar and panel area,
  - optional console/terminal area.

## Sidebar features
- Project and conversation management:
  - create/delete/rename projects,
  - create/delete/select conversations,
  - assign/select active conversation.
- Global search over projects/chats/tasks.
- New Task / New Project buttons.
- Diagnostics section with expandable check results.

## Chat features
- Send text prompts and receive streamed responses.
- Stop stream using Stop control.
- Clear chat for active conversation.
- Skills bar:
  - lists seeded + user skills,
  - toggles active user-selectable skills,
  - special toggles: Thinking and Reasoning,
  - syncs voice skill with voice mode.
- Mode selector:
  - `chat`: general assistant behavior.
  - `code`: implementation-focused behavior.
  - `architect`: system-design behavior.
  - `auto`: auto-dispatches pending tasks.

## Voice features
- Voice mode toggle button on chat panel.
- VoiceStatus area:
  - STT/TTS engine status,
  - mic level and test speaker,
  - advanced settings.
- VAD settings panel:
  - threshold/silence/padding/limits,
  - prefill + barge-in settings.

## Workspace and tools
- Files + Code views:
  - file tree, tabbed editing, markdown preview, diff viewer.
- Tool panels include:
  - Avatar, API's, Tasks, MCP, Extensions, System, Agents, Web, Help, Notes, Terminal, Serve.
- Terminal tool panel:
  - path guard and command guard controls,
  - blocked command handling with user prompt modal.

## Tasks panel
- Task list and detail view.
- Task creation supports standardized description template.
- Shows task metadata and JSON view for agent visibility.

## MCP panel
- Create/edit/remove MCP server definitions.
- Maintains transport/endpoint/command/tool metadata.
- Exposes JSON view for agent-readable context.

## Help panel
- Reads markdown files under project `help/` directory.
- Left list of docs, right rendered markdown content.

## FAQ
<details>
<summary>Why is model status disconnected/red?</summary>
Usually model runtime is not loaded and no verified API model is active. Check Serve/API panel and runtime status.
</details>

<details>
<summary>Why does terminal command get blocked?</summary>
Path guard can block execution outside project root; command guard can block disallowed commands (e.g. `rm` by default).
</details>

<details>
<summary>Why voice transcript is empty?</summary>
Check mic input level, STT endpoint/config, whisper dependencies, and diagnostics results.
</details>
