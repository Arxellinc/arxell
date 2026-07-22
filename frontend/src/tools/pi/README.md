# Pi Tool

AI-powered coding agent in your terminal. Supports multiple agents running in parallel, each in its own PTY session with its own working directory.

## Overview

This builtin workspace tool wraps the [Pi coding harness](https://pi.dev/) inside the app's existing terminal infrastructure. Interactive sessions reuse `TerminalManager` and the PTY layer; availability is checked by the backend runtime probe. Each agent is one PTY session running `pi`, managed by the frontend.

## Multi-Agent Architecture

```
┌──────────────────────────────────────────────────┐
│ [Agent 1 ●] [Agent 2 ●] [+New]                  │  ← toolbar tabs (renderToolToolbar)
├──────────────────────────────────────────────────┤
│ 📂 ~/Projects/my-app > src > auth                │  ← breadcrumb bar
├──────────────────────────────────────────────────┤
│                                                  │
│              pi TUI                        │  ← xterm terminal host
│              (Agent 1 PTY session)               │
│                                                  │
└──────────────────────────────────────────────────┘
```

- **Toolbar**: Dynamic tabs (`tabsMode: "dynamic"`) matching the terminal tool's tab pattern. Each tab is one agent. `+New` opens a spawn modal.
- **Breadcrumb**: 28px bar between toolbar and terminal host showing the agent's `cwd`, split on `/`, home collapsed to `~`.
- **Terminal host**: Single `#piTerminalHost` — remounted when switching agents (same pattern as the terminal tool's session switching).

## First-Run Flow

1. User clicks Pi icon in workspace topbar
2. Tab activation triggers `ensurePiInit` via `workspaceLifecycle.ts`
3. `checkPiInstalled()` calls the backend Pi runtime probe (`pi --version`) through the Looper invoke gateway
4. **If installed** — `spawnAgent()` creates the first agent ("Agent 1") with a new PTY session
5. **If not installed** — install modal with the official npm package command:
   - **Cancel** — dismisses
   - **I've Installed It** — re-checks and auto-spawns first agent on success

## Agent Lifecycle

### Spawning

1. Click `+New` tab button → opens spawn modal with Label, Working Directory, Initial Prompt fields
2. Click "Spawn Agent" → `spawnAgent()` creates a PTY session via `TerminalManager.createSession({ cwd })`
3. Agent is appended to `state.agents`, set as `activeAgentId`
4. After a short settle delay, privacy environment flags and `pi` are sent as terminal input
5. If Initial Prompt was provided, it is submitted after Pi starts

### Switching

Clicking an agent tab sets `activeAgentId`. On the next render cycle, the terminal host is remounted with that agent's session ID.

### Closing

Clicking the `×` close button on a tab calls `closeAgent()` which closes the PTY session and removes the agent from state. If the closed agent was active, the last remaining agent becomes active.

## Files

| File | Purpose |
|------|---------|
| `manifest.ts` | Tool manifest (`id: "pi"`, icon `bot-message-square`, category `workspace`) |
| `state.ts` | `PiAgent` and `PiToolState` types, initial state factory |
| `actions.ts` | Core logic: `checkPiInstalled`, `spawnAgent`, `switchAgent`, `closeAgent`, `openSpawnModal`, `recheckAfterInstall` |
| `index.tsx` | Render functions: toolbar tabs, breadcrumb bar, terminal host, install modal, spawn modal |
| `bindings.ts` | Click and input handlers for tabs, modals, spawn form fields |
| `styles.css` | Breadcrumb, modal, terminal host, spawn form styles |

## State Shape

```ts
interface PiAgent {
  id: string;              // unique per agent
  label: string;           // display name in tab
  sessionId: string;       // PTY session ID from TerminalManager
  status: "starting" | "running" | "idle" | "done" | "error";
  cwd: string;             // working directory at spawn time
  startedAtMs: number;
}

interface PiToolState {
  agents: PiAgent[];
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
- **Frontend registry**: `frontend/src/tools/registry.ts` — `PREFERRED_TOOL_ORDER` includes `"pi"`
- **View builder**: `frontend/src/tools/host/viewBuilder.ts` — `piState` in `WorkspaceToolViewInput`, renders toolbar + body + modals
- **Lifecycle**: `frontend/src/tools/host/workspaceLifecycle.ts` — `pi-tool` tab activation triggers `ensurePiInit`
- **Dispatch**: `frontend/src/tools/host/workspaceDispatch.ts` — `PI_DATA_ATTR` in target selector, pi deps in dispatch
- **Constants**: `frontend/src/tools/ui/constants.ts` — `PI_DATA_ATTR` (action, agentId, closeAgentId), `PI_UI_ID`
- **App state**: `frontend/src/main.ts` — `piState`, `piNeedsInit`, deps wiring, active agent terminal mounting
- **Backend registry**: `src-tauri/src/workspace_tools/mod.rs` — `WorkspaceToolManifest` for `pi`

## Breadcrumb

The breadcrumb renders the active agent's `cwd`:

- Splits on `/`, collapses `/home/user` to `~`
- Last segment is bolded
- 28px tall, monospace 11px, muted color
- Folder icon prefix
- Purely display — no click navigation (yet)

## Install Check

Uses the backend runtime service without opening a PTY:

1. Resolves explicit, managed, PATH, npm, pnpm, Yarn, and Bun candidates
2. Runs the selected executable with `--version`
3. Enforces the supported `>=0.81.0,<0.82.0` range and checks Windows Bash readiness
4. Returns typed path, version, Node/npm/Bash, and recovery diagnostics
5. Opens setup UI with recheck and explicit-path controls when Pi is unavailable

## Terminal Session

Each agent gets its own PTY:

1. `TerminalManager.createSession({ cwd })` opens a new PTY
2. Session is mounted into `#piTerminalHost` on render cycle
3. After a short settle delay, Pi is launched with telemetry and version checks disabled
4. PTY uses `xterm-256color` (compatible with pi's TUI)
5. All interaction flows through the standard terminal event pipeline
6. Switching agents remounts the terminal host with the new session ID

## Future Enhancements

- **Terminal output parsing**: Watch `terminal.output` events per-agent for status signals (running/idle/error, files changed, token usage)
- **Agent templates**: Pre-built spawn configs for common workflows (Code Review, Write Tests, Fix Lint)
- **Split view**: Two terminal hosts in a CSS grid split for side-by-side agents
- **Orchestration panel**: Batch-spawn multiple agents with different tasks and monitor from a parent view
- **Auto-configure API connections**: Write user's API connections into pi's `~/.config/pi/config.toml`
- **Diff view**: Run `git diff` in an agent's cwd when it finishes, render in files tool
- **Right sidebar**: Complex workflow visualization, integrated ralph loops
