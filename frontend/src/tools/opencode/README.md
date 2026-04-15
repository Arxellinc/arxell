# OpenCode Tool

AI-powered coding agent in your terminal. Supports multiple agents running in parallel, each in its own PTY session with its own working directory.

## Overview

This builtin workspace tool wraps the [opencode](https://opencode.ai) CLI inside the app's existing terminal infrastructure. No new Rust backend code — the tool reuses `TerminalManager` and the PTY layer. Each agent is one PTY session running `opencode`, managed by the frontend.

## Multi-Agent Architecture

```
┌──────────────────────────────────────────────────┐
│ [Agent 1 ●] [Agent 2 ●] [+New]                  │  ← toolbar tabs (renderToolToolbar)
├──────────────────────────────────────────────────┤
│ 📂 ~/Projects/my-app > src > auth                │  ← breadcrumb bar
├──────────────────────────────────────────────────┤
│                                                  │
│              opencode TUI                        │  ← xterm terminal host
│              (Agent 1 PTY session)               │
│                                                  │
└──────────────────────────────────────────────────┘
```

- **Toolbar**: Dynamic tabs (`tabsMode: "dynamic"`) matching the terminal tool's tab pattern. Each tab is one agent. `+New` opens a spawn modal.
- **Breadcrumb**: 28px bar between toolbar and terminal host showing the agent's `cwd`, split on `/`, home collapsed to `~`.
- **Terminal host**: Single `#opencodeTerminalHost` — remounted when switching agents (same pattern as the terminal tool's session switching).

## First-Run Flow

1. User clicks OpenCode icon in workspace topbar
2. Tab activation triggers `ensureOpenCodeInit` via `workspaceLifecycle.ts`
3. `checkOpenCodeInstalled()` opens a hidden `/bin/sh` PTY, runs `which opencode`, inspects output via IPC event stream
4. **If installed** — `spawnAgent()` creates the first agent ("Agent 1") with a new PTY session
5. **If not installed** — install modal with the official curl command:
   - **Cancel** — dismisses
   - **I've Installed It** — re-checks and auto-spawns first agent on success

## Agent Lifecycle

### Spawning

1. Click `+New` tab button → opens spawn modal with Label, Working Directory, Initial Prompt fields
2. Click "Spawn Agent" → `spawnAgent()` creates a PTY session via `TerminalManager.createSession({ cwd })`
3. Agent is appended to `state.agents`, set as `activeAgentId`
4. After 500ms settle delay, `opencode\n` is sent as terminal input
5. If Initial Prompt was provided, it's queued after opencode starts

### Switching

Clicking an agent tab sets `activeAgentId`. On the next render cycle, the terminal host is remounted with that agent's session ID.

### Closing

Clicking the `×` close button on a tab calls `closeAgent()` which closes the PTY session and removes the agent from state. If the closed agent was active, the last remaining agent becomes active.

## Files

| File | Purpose |
|------|---------|
| `manifest.ts` | Tool manifest (`id: "opencode"`, icon `bot-message-square`, category `workspace`) |
| `state.ts` | `OpenCodeAgent` and `OpenCodeToolState` types, initial state factory |
| `actions.ts` | Core logic: `checkOpenCodeInstalled`, `spawnAgent`, `switchAgent`, `closeAgent`, `openSpawnModal`, `recheckAfterInstall` |
| `index.tsx` | Render functions: toolbar tabs, breadcrumb bar, terminal host, install modal, spawn modal |
| `bindings.ts` | Click and input handlers for tabs, modals, spawn form fields |
| `styles.css` | Breadcrumb, modal, terminal host, spawn form styles |

## State Shape

```ts
interface OpenCodeAgent {
  id: string;              // unique per agent
  label: string;           // display name in tab
  sessionId: string;       // PTY session ID from TerminalManager
  status: "starting" | "running" | "idle" | "done" | "error";
  cwd: string;             // working directory at spawn time
  startedAtMs: number;
}

interface OpenCodeToolState {
  agents: OpenCodeAgent[];
  activeAgentId: string | null;
  installModalOpen: boolean;
  installChecking: boolean;
  installed: boolean | null;
  busy: boolean;
  spawnModalOpen: boolean;
  spawnLabelDraft: string;
  spawnCwdDraft: string;
  spawnPromptDraft: string;
  nextAgentIndex: number;  // auto-increment for default labels
}
```

## External Wiring Points

- **Icon**: `frontend/src/icons/bot-message-square.svg` (from `icons-all/`) registered in `frontend/src/icons/index.ts`
- **Frontend registry**: `frontend/src/tools/registry.ts` — `PREFERRED_TOOL_ORDER` includes `"opencode"`
- **View builder**: `frontend/src/tools/host/viewBuilder.ts` — `opencodeState` in `WorkspaceToolViewInput`, renders toolbar + body + modals
- **Lifecycle**: `frontend/src/tools/host/workspaceLifecycle.ts` — `opencode-tool` tab activation triggers `ensureOpenCodeInit`
- **Dispatch**: `frontend/src/tools/host/workspaceDispatch.ts` — `OPENCODE_DATA_ATTR` in target selector, opencode deps in dispatch
- **Constants**: `frontend/src/tools/ui/constants.ts` — `OPENCODE_DATA_ATTR` (action, agentId, closeAgentId), `OPENCODE_UI_ID`
- **App state**: `frontend/src/main.ts` — `opencodeState`, `opencodeNeedsInit`, deps wiring, active agent terminal mounting
- **Backend registry**: `src-tauri/src/workspace_tools/mod.rs` — `WorkspaceToolManifest` for `opencode`

## Breadcrumb

The breadcrumb renders the active agent's `cwd`:

- Splits on `/`, collapses `/home/user` to `~`
- Last segment is bolded
- 28px tall, monospace 11px, muted color
- Folder icon prefix
- Purely display — no click navigation (yet)

## Install Check

Uses a probe PTY session to avoid false positives:

1. Opens `/bin/sh` (not login shell, avoids RC file side effects)
2. Sends `which opencode\n`
3. Listens for `terminal.output` events via `client.onEvent()` for 2 seconds
4. Found if output contains `/` and not `not found` or `which: no`
5. Closes probe session before returning

## Terminal Session

Each agent gets its own PTY:

1. `TerminalManager.createSession({ cwd })` opens a new PTY
2. Session is mounted into `#opencodeTerminalHost` on render cycle
3. After 500ms settle, `opencode\n` is sent as input
4. PTY uses `xterm-256color` (compatible with opencode's TUI)
5. All interaction flows through the standard terminal event pipeline
6. Switching agents remounts the terminal host with the new session ID

## Future Enhancements

- **Terminal output parsing**: Watch `terminal.output` events per-agent for status signals (running/idle/error, files changed, token usage)
- **Agent templates**: Pre-built spawn configs for common workflows (Code Review, Write Tests, Fix Lint)
- **Split view**: Two terminal hosts in a CSS grid split for side-by-side agents
- **Orchestration panel**: Batch-spawn multiple agents with different tasks and monitor from a parent view
- **Auto-configure API connections**: Write user's API connections into opencode's `~/.config/opencode/config.toml`
- **Diff view**: Run `git diff` in an agent's cwd when it finishes, render in files tool
- **Right sidebar**: Complex workflow visualization, integrated ralph loops
