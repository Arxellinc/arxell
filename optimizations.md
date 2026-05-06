# Performance Optimization Opportunities

A thorough audit of the frontend codebase for load-time and runtime performance. No code was modified; this document captures findings and recommendations only.

---

## Current Build Profile

| Metric | Value |
|--------|-------|
| Total JS bundle (gzip) | ~1.1 MB |
| Main chunk (`index-*.js`) | 1,181 KB (309 KB gzip) |
| CSS bundle (`index-*.css`) | 158 KB |
| Total build output | ~13 MB (includes mermaid/three chunks + static assets) |
| Static assets | `wireframe.glb` at 8.1 MB |
| Largest JS chunks: | `index` (1.2 MB), `wireframeRuntime` (600 KB), `mermaid.core` (599 KB) |
| Source: `main.ts` | 8,928 lines |

---

## 1. High Impact: Full-DOM Re-rendering on Every State Change

**Severity: High** | **File:** `src/main.ts:2866-3120`

The entire application re-renders by replacing `#app.innerHTML` on virtually every state change. The `renderAndBind()` function:

1. Builds the entire page as an HTML string via template literal concatenation
2. Sets `app.innerHTML` to destroy and recreate the full DOM tree
3. Re-queries and re-attaches all event listeners

This happens for trivial changes like toggling a bottom-bar visibility preference, changing a VAD parameter, or selecting an STT model.

### What it causes
- Flash/re-paint on every interaction
- All event listeners are garbage-collected and re-created each cycle
- Text input focus/scroll position is lost and must be manually preserved/restored
- Browser must parse and layout the entire page repeatedly

### Existing mitigations (partial)
- `scheduleChatStreamDomUpdate()` batches chat stream updates via `requestAnimationFrame`, updating only the messages container
- `updateBottomBarResourceNodesInPlace()` does targeted in-place DOM updates for resource stats
- `preserveEditableFocusBeforeRender()` / `restoreEditableFocusAfterRender()` save/restore cursor across renders

### Recommendations
- **Targeted DOM updates**: For simple state changes (toggle visibility, update a label, change a slider value), update only the affected elements instead of rebuilding the entire page. The existing `updateBottomBarResourceNodesInPlace()` pattern is a good model to follow.
- **Event delegation**: Some panels already use delegation but the workspace pane re-binds 7+ event types on every render. Consider binding delegation handlers once at mount time.
- **Longer-term**: Consider a lightweight rendering approach (lit-html, incremental-dom, or even manual DOM diffing) that only patches changed nodes rather than replacing everything.

---

## 2. High Impact: Main Bundle Size (1.18 MB, 309 KB gzip)

**Severity: High** | **File:** `vite.config.ts`, `src/main.ts`

The main `index-*.js` chunk is 1.18 MB (309 KB gzip). Everything that isn't lazy-loaded ships in this bundle.

### What's in the main bundle
All panel code, all tool code, xterm, highlight.js (22 languages), OverlayScrollbars, React hooks (used only by STT), the entire IPC client (2,384 lines), all app orchestration modules, and all CSS-in-JS template strings.

### Recommendations

#### a) Code-split panels by route/tab
Only one panel is visible at a time (chat, history, devices, APIs, TTS, STT, llama.cpp, model manager, avatar, settings). Each panel's render body and action bindings could be lazy-loaded when the user navigates to that tab.

Currently `main.ts` imports and wires all panels at the top level:
```
src/main.ts:42  import { attachPrimaryPanelInteractions, getPanelDefinition } from "./panels";
src/main.ts:43  import { bindChatPanel } from "./panels/chatPanel";
src/main.ts:57  import { renderHighlightedCode } from "./tools/notepad/shared";
src/main.ts:58  import { TerminalManager, ... } from "./tools/terminal/index";
```

Panels like `avatarPanel`, `modelManagerPanel`, `settingsPanel`, `llamaCppPanel`, `sttPanel`, `ttsPanel` are loaded eagerly but only needed when their tab is active.

#### b) Code-split tools by workspace tab
Tools (files, notepad, sheets, tasks, memory, flow, looper, opencode, chart, web search, manager) are all loaded upfront. Most tools are only accessed when their workspace tab is selected. The existing tool registry (`src/tools/registry.ts`) could be extended to lazy-load tool definitions.

#### c) Lazy-load the IPC client
The `ipcClient.ts` file is 2,384 lines. It's only needed after the Tauri runtime is detected. Consider deferring the import.

#### d) Vite `manualChunks` configuration
The current `vite.config.ts` has no chunking configuration:
```ts
export default defineConfig({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) }
});
```

Adding `build.rollupOptions.output.manualChunks` could separate:
- `highlight.js` into its own chunk (loaded only when code editors are used)
- `xterm` + addons into its own chunk (loaded only when terminal is opened)
- `OverlayScrollbars` into a vendor chunk

---

## 3. High Impact: React Loaded for Just 2 Files

**Severity: Medium** | **Files:** `src/stt/useAudioQueue.ts`, `src/stt/useSTT.ts`

React is a production dependency (`react@^18.3.1`, `react-dom@^18.3.1`) but is only used by 2 STT (speech-to-text) hook files for `useRef`, `useState`, `useEffect`, and `useCallback`. No React components are rendered, no JSX is used, and `react-dom` is never imported.

### Impact
React adds ~6-7 KB gzip to the main bundle for functionality that could be replaced with plain closures and mutable state objects — the same pattern the rest of the app already uses.

### Recommendation
Rewrite the two STT hooks as plain TypeScript modules using module-level state (matching the app's existing architecture), then remove `react` and `react-dom` from `dependencies`.

---

## 4. Medium Impact: Mermaid Pulls in 2+ MB of Diagram Code

**Severity: Medium** | **File:** `src/tools/chart/runtime.ts`

Mermaid is correctly lazy-loaded via `import("mermaid")`, which is good. However, the mermaid core chunk alone is 599 KB (145 KB gzip), and it pulls in additional diagram-type chunks totaling another ~800 KB (cytoscape, wardley, katex, etc.). All of these load when the chart tool is first used, even though users likely only need 1-2 diagram types.

### Recommendation
- Configure mermaid to only initialize the specific diagram types needed (flowchart, sequence) via `mermaid.initialize({ ... })` with `maxTextSize` and specific diagram filters.
- Consider whether mermaid is the right tool, or if a lighter charting library would suffice for the use case.

---

## 5. Medium Impact: 8.1 MB Static GLB Asset

**Severity: Medium** | **File:** `public/avatar/wireframe.glb`

The wireframe avatar model is 8.1 MB and lives in `public/`, meaning it is copied as-is to the build output. It is only needed when the avatar preview is active (which itself is gated behind a lazy-loaded module).

### Recommendation
- Move `wireframe.glb` out of `public/` and load it dynamically from the avatar runtime module (similar to how the three.js code is already lazy-loaded).
- Consider providing a lower-poly version for initial load, with an option to upgrade to the full model.
- Add `.glb` to Vite's `build.assetsInclude` if needed, or fetch it via `fetch()`/`URL` constructor on demand.

---

## 6. Medium Impact: CSS Bundle is 158 KB (All Loaded Eagerly)

**Severity: Medium** | **Files:** `src/styles.css` (5,097 lines / 93 KB), 11 tool CSS files

All CSS is bundled into a single 158 KB file that loads on startup. This includes:
- Avatar panel styles (only needed when avatar tab is active)
- Model manager styles (only needed on model manager tab)
- LLaMA runtime styles (only needed on engine tab)
- STT/TTS panel styles
- First-run onboarding wizard styles (only needed once)
- All 11 tool-specific stylesheets (only needed when that tool is active)

### Recommendation
- The existing pattern of tool-scoped CSS files (`src/tools/<tool>/styles.css`) is good. Vite already code-splits CSS alongside JS when those modules are lazy-loaded. So if tools and panels are lazy-loaded (per recommendation #2), their CSS will automatically be split into separate chunks.
- The global `styles.css` could be trimmed by extracting panel-specific styles (avatar, model manager, STT, TTS, onboarding) into their respective panel modules.

---

## 7. Medium Impact: Unbounded `state.events` Array

**Severity: Medium** | **File:** `src/app/events.ts:266`

Every application event is pushed to `state.events` with no upper bound. Other similar collections have limits:
- `consoleEntries`: capped at 600 (`MAX_CONSOLE_ENTRIES`)
- `llamaRuntimeLogs`: capped at 300
- `taskNotifications`: capped at 100

But `state.events` grows indefinitely for the entire app session.

### Recommendation
Apply the same bounding pattern used elsewhere:
```ts
state.events.push(event);
if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
```
Suggested cap: 2,000-5,000 events.

---

## 8. Medium Impact: Unbounded Correlation Tracking Maps

**Severity: Low-Medium** | **File:** `src/main.ts`

Several Maps/Sets track chat correlation IDs and are never cleaned:
- `chatPaneIdByCorrelation` (Map) — grows with every chat message
- `chatTtsLatencyCapturedByCorrelation` (Set) — never explicitly cleared
- `chatTtsSawStreamDeltaByCorrelation` (Set) — never explicitly cleared

### Recommendation
Clear correlation tracking data when conversations are closed/reset. Add cleanup in the conversation reset path.

---

## 9. Low-Medium Impact: xterm CSS Loaded Eagerly

**Severity: Low-Medium** | **File:** `src/main.ts:2`

```ts
import "xterm/css/xterm.css";
```

xterm CSS is imported at the top level in `main.ts`, loading terminal styles even if the user never opens a terminal.

### Recommendation
Move this import into `src/tools/terminal/index.tsx` so it loads only when the terminal tool is initialized. If the terminal module is then code-split (per recommendation #2), its CSS will be in a separate chunk.

---

## 10. Low Impact: `icons-all/` Directory Bloats Repository

**Severity: Low** | **Directory:** `src/icons-all/` (1,695 files, 6.7 MB)

The `icons-all/` directory contains 1,695 SVG icon files but is **not imported by any source file**. It appears to be a source library used to selectively copy icons into `src/icons/` (101 icons, 484 KB — the ones actually bundled).

### Recommendation
- Add `src/icons-all/` to `.gitignore` or move it outside the frontend package to reduce repo clone size.
- Document the icon workflow: copy needed icons from `icons-all/` to `icons/`, then register in `icons/index.ts`.
- Alternatively, consider using an npm icon package and importing only the icons needed.

---

## 11. Low Impact: highlight.js Loads 22 Languages Eagerly

**Severity: Low** | **File:** `src/tools/files/highlight.ts`

The highlight.js integration already follows best practices by using `highlight.js/lib/core` with selective language registration (22 languages). This is well-implemented.

### Recommendation
If the main bundle is code-split per recommendation #2, this will naturally end up in a code-editor chunk. Otherwise, the current approach is already near-optimal.

---

## 12. Low Impact: No Build Minification Configuration

**Severity: Low** | **File:** `vite.config.ts`

Vite uses esbuild for minification by default, which is fast but produces slightly larger output than terser. The build config has no minification options set.

### Recommendation
For production builds, consider:
```ts
build: {
  minify: "terser",
  terserOptions: { compress: { passes: 2 } }
}
```
Or at minimum, verify that `cssMinify` is enabled (it's on by default in Vite 5+).

---

## 13. Low Impact: Missing `preload` Hints

**Severity: Low** | **File:** `index.html`

The built HTML has no `<link rel="preload">` or `<link rel="modulepreload">` hints for critical chunks.

### Recommendation
Vite can generate modulepreload links. Add to `vite.config.ts`:
```ts
build: { modulePreload: { resolveDependencies: ... } }
```
This helps the browser discover and fetch critical chunks earlier.

---

## 14. Low Impact: Potential Timer Leak in STT Audio Queue

**Severity: Low** | **File:** `src/stt/useAudioQueue.ts:79`

```ts
setTimeout(() => playNext(), 100)
```

This has no stored timer ID and no `clearTimeout` on cleanup. If the React component unmounts during the 100ms window, the callback fires on a stale closure. The practical impact is low (it checks an empty queue and returns).

### Recommendation
Store the timer ID and clear it in the cleanup function if this hook is refactored. If React is removed per recommendation #3, this becomes moot.

---

## Summary: Prioritized Action Items

| Priority | Item | Expected Impact |
|----------|------|-----------------|
| **P0** | Targeted DOM updates for simple state changes | Eliminates full-page re-renders for toggles, slider changes, label updates |
| **P0** | Code-split panels and tools by tab | Reduces initial JS bundle from ~309 KB gzip to ~150-200 KB |
| **P1** | Remove React dependency | Saves ~6-7 KB gzip, removes unnecessary framework |
| **P1** | Lazy-load `wireframe.glb` (8.1 MB) | Defers large asset until avatar is used |
| **P1** | Move xterm CSS import to terminal module | Defers terminal styles until needed |
| **P1** | Bound `state.events` array | Prevents unbounded memory growth in long sessions |
| **P2** | Code-split CSS by splitting panel/tool modules | Reduces initial CSS from 158 KB to ~60-80 KB |
| **P2** | Configure Vite `manualChunks` | Better cache granularity for vendor libraries |
| **P2** | Clean correlation tracking Maps/Sets | Prevents slow memory growth over long sessions |
| **P3** | Move `icons-all/` out of repo or gitignore | Reduces repo clone size by 6.7 MB |
| **P3** | Add modulepreload hints | Slightly faster chunk discovery |
| **P3** | Consider terser for production minification | Slightly smaller bundle output |

---

# Implementation Plan: P0 Optimizations

Detailed plan for the two highest-impact changes. Each phase is designed to be **incrementally shippable** — no phase depends on a later phase, and each can be tested independently.

---

## P0-A: Targeted DOM Updates for Simple State Changes

### Problem

`renderAndBind()` is called **197 times** across `main.ts`. Every call:
1. Rebuilds the entire page as an HTML string (~15-30 KB per render)
2. Replaces `#app.innerHTML` (destroys every DOM node)
3. Re-attaches all event listeners (sidebar, topbar, workspace, panels)

Even trivial changes like toggling a checkbox or moving a slider cause all of this work.

### Strategy: "Slot-based targeted updates"

Rather than replacing the whole page, introduce a lightweight update system that targets specific DOM "slots" in place. The app already has one working example: `updateBottomBarResourceNodesInPlace()` at `main.ts:1609`, which does targeted `textContent` updates on specific elements.

### Architecture

```
┌─────────────────────────────────────────────────┐
│ renderAndBind()                                  │
│   ├── render() → full innerHTML replacement      │  ← current (keep for structural changes)
│   └── bind()  → re-attach all listeners          │
│                                                  │
│ patchUI(key)  → targeted DOM update              │  ← NEW (for simple state changes)
│   ├── find slot element by data attribute        │
│   └── update only that element's innerHTML/text  │
│                                                  │
│ renderAndBind() remains for:                     │
│   - Tab switches (structural layout change)      │
│   - Panel content changes                        │
│   - Chat messages, conversations                 │
│   - Workspace tool changes                       │
└─────────────────────────────────────────────────┘
```

### Phase 1: Infrastructure — `patchUI()` helper

**Goal:** Create a generic helper that updates a specific DOM slot in place.

**New file:** `src/app/patchUI.ts`

```typescript
// Update the innerHTML of a single slot element
export function patchSlot(selector: string, html: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.innerHTML = html;
}

// Update the textContent of a single element
export function patchText(selector: string, text: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.textContent = text;
}

// Toggle a class on an element
export function patchClass(selector: string, className: string, add: boolean): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.classList.toggle(className, add);
}

// Set an attribute on an element
export function patchAttr(selector: string, attr: string, value: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.setAttribute(attr, value);
}
```

**Testing:** Unit tests that verify DOM updates without full re-render.

**Estimated effort:** 1 hour. No existing code changes.

---

### Phase 2: Convert settings toggles to targeted updates

**Goal:** The most frequent "trivial re-renders" are settings toggles (bottom bar visibility, notification chimes, display mode). Convert these first because they are self-contained.

**Affected handlers** (all in the `renderAndBind` callback inside `main.ts`):

| Handler | Line | What changes | Targeted update needed |
|---------|------|-------------|----------------------|
| `onSetDisplayModePreference` | ~7340 | Theme attribute + topbar icon | `document.documentElement.dataset.theme` + swap topbar button icon |
| `onSetShowAppResourceCpu` | ~6205 | Bottom bar text visibility | Toggle `.hidden` on bottom bar CPU span |
| `onSetShowAppResourceMemory` | ~6215 | Bottom bar text visibility | Toggle `.hidden` on bottom bar RAM span |
| `onSetShowAppResourceNetwork` | ~6225 | Bottom bar text visibility | Toggle `.hidden` on bottom bar Net span |
| `onSetShowBottomEngine` | ~6208 | Bottom bar text visibility | Toggle `.hidden` on bottom bar engine span |
| `onSetShowBottomModel` | ~6214 | Bottom bar text visibility | Toggle `.hidden` on bottom bar model span |
| `onSetShowBottomContext` | ~6220 | Bottom bar text visibility | Toggle `.hidden` on bottom bar context span |
| `onSetShowBottomSpeed` | ~6226 | Bottom bar text visibility | Toggle `.hidden` on bottom bar speed span |
| `onSetShowBottomTtsLatency` | ~6232 | Bottom bar text visibility | Toggle `.hidden` on bottom bar TTS latency span |
| `onSetEnableNotificationChime` | ~6242 | Settings checkbox | Update checkbox `.checked` state |
| `onSetEnableChatQuestionChime` | ~6252 | Settings checkbox | Update checkbox `.checked` state |
| `onToggleAutoSafe` | ~7357 | Topbar icon | Toggle topbar button class |

**Implementation pattern for each:**

```typescript
// BEFORE (causes full re-render):
const handler = async () => {
  await bindings.onSetShowAppResourceCpu(checked);
  // renderAndBind() called inside the binding → full re-render
};

// AFTER (targeted update):
const handler = async () => {
  state.showAppResourceCpu = checked;
  persistShowAppResourcesCpu(checked);
  appResourcePolling.restart();  // already handles its own targeted updates
  patchClass("#bottomCpuStat", "hidden", !checked);
};
```

**Prerequisites:** Phase 1 (`patchUI.ts`)

**Risk:** Low. These are simple visibility toggles with no side effects on other DOM elements.

**Testing:** Manual testing of each toggle. Verify bottom bar items show/hide, settings checkboxes stay in sync, display mode changes correctly.

**Estimated effort:** 3-4 hours for all ~12 handlers.

---

### Phase 3: Convert sidebar tab switches to partial re-renders

**Goal:** When switching sidebar tabs (chat → settings → TTS), only the primary pane needs to change — not the topbar, bottombar, sidebar rail, or workspace pane.

**Implementation:**

Currently `render()` builds everything and sets `app.innerHTML`. Instead, introduce `renderPrimaryPaneOnly()`:

```typescript
function renderPrimaryPaneOnly(): void {
  const primaryPane = document.querySelector<HTMLElement>(".primary-pane");
  if (!primaryPane) return;

  syncPrimaryChatPanelFromFlatState();
  const panel = getPanelDefinition(state.sidebarTab, selectPrimaryPanelState(state) as any);
  const primaryChatPanel = getPrimaryChatPanelState();

  // Update pane title
  const titleEl = primaryPane.querySelector<HTMLElement>(".pane-title");
  if (titleEl) titleEl.innerHTML = renderPanelTitleIcon({...});

  // Update actions
  const actionsEl = primaryPane.querySelector<HTMLElement>(".primary-panel-actions");
  if (actionsEl) actionsEl.innerHTML = panel.renderActions();

  // Update body
  // The panel body is the bulk of the content
  const bodyContainer = primaryPane.querySelector<HTMLElement>(".panel-body") ??
    /* fallback: everything after actions */ ...;
  if (bodyContainer) bodyContainer.innerHTML = panel.renderBody();
}
```

Then modify `attachSidebarInteractions` to call `renderPrimaryPaneOnly()` + re-bind only the primary panel listeners (instead of the full `renderAndBind()`).

**Additional change needed:** Add a stable wrapper element inside each pane's rendered HTML. Currently the panel body HTML is injected directly into the `<section class="pane">`. Adding a `<div class="pane-body">` wrapper would make targeted updates reliable:

```html
<!-- In composePrimaryPaneHtml() output -->
<section class="pane primary-pane">
  <header class="pane-topbar">...</header>
  <div class="primary-panel-actions">...</div>
  <div class="pane-body">           <!-- NEW stable wrapper -->
    {panelBodyHtml}
  </div>
</section>
```

**Prerequisites:** Phase 1

**Risk:** Medium. Must ensure that event listeners for the new panel are correctly bound after the targeted update. The existing `attachPrimaryPanelInteractions()` already dispatches by tab, so it can be called in isolation.

**Testing:** Switch between all 12 sidebar tabs. Verify each panel renders correctly, all buttons work, state persists across tab switches, no stale listeners remain.

**Estimated effort:** 4-6 hours.

---

### Phase 4: Convert workspace tab switches to partial re-renders

**Goal:** When switching workspace tabs (terminal → files → tasks), only the workspace tool view needs to change — not the sidebar, topbar, primary pane, or bottombar.

**Implementation:** Similar to Phase 3, but targeting the workspace pane:

```typescript
function renderWorkspaceToolOnly(): void {
  const toolView = document.querySelector<HTMLElement>(".workspace-tool-view");
  if (!toolView) return;

  const toolViews = buildWorkspaceToolViews(selectWorkspaceViewState({...}) as any);
  const currentView = toolViews[state.workspaceTab];
  if (!currentView) return;

  const toolbarEl = document.querySelector<HTMLElement>(".tool-toolbar");
  if (toolbarEl) toolbarEl.innerHTML = currentView.actionsHtml;
  toolView.innerHTML = currentView.bodyHtml;

  // Re-mount terminal hosts if needed
  mountWorkspaceTerminalHosts(state, terminalManager, ...);

  // Re-bind workspace tool interactions for the active tool only
  // (already handled by delegation in workspacePane events)
}
```

**Prerequisites:** Phase 1

**Risk:** Medium. Workspace tools have complex interactions (canvas for sheets, terminals, file tree drag-and-drop). Must verify all interactions work after a partial re-render.

**Testing:** Switch between all 11 workspace tool tabs. Verify files editor works, notepad editing works, sheets canvas renders, terminal sessions persist, web search works.

**Estimated effort:** 4-6 hours.

---

### Phase 5: Batch rapid state changes with `requestAnimationFrame`

**Goal:** Some interactions trigger multiple rapid `renderAndBind()` calls (e.g., VAD parameter changes, slider drags). Add a batching layer to coalesce them.

**Implementation:**

```typescript
let pendingRenderLevel: "none" | "patch" | "full" = "none";
let renderRafId: number | null = null;

function schedulePatchRender(patchFn: () => void): void {
  if (pendingRenderLevel === "full") return; // full render already scheduled
  pendingRenderLevel = "patch";
  if (renderRafId !== null) return;
  renderRafId = requestAnimationFrame(() => {
    renderRafId = null;
    const level = pendingRenderLevel;
    pendingRenderLevel = "none";
    if (level === "full") {
      renderAndBind(currentSendMessage);
    } else {
      patchFn();
    }
  });
}
```

**Prerequisites:** Phases 2-4 (so there are patch functions to schedule).

**Risk:** Low. This is purely additive — it sits on top of the existing render system.

**Estimated effort:** 2-3 hours.

---

### Summary: P0-A Effort

| Phase | Description | Effort | Risk |
|-------|-------------|--------|------|
| 1 | `patchUI.ts` infrastructure | 1h | None |
| 2 | Settings toggles (12 handlers) | 3-4h | Low |
| 3 | Sidebar tab switch partial render | 4-6h | Medium |
| 4 | Workspace tab switch partial render | 4-6h | Medium |
| 5 | RAF batching for rapid changes | 2-3h | Low |
| | **Total** | **14-20h** | |

### What stays as full re-render

These scenarios should continue using full `renderAndBind()` because they involve structural DOM changes across multiple regions:

- Chat streaming (already partially optimized via `scheduleChatStreamDomUpdate`)
- Chat message send/receive
- Conversation load/create/clear
- API connection CRUD (affects both APIs panel and chat model dropdown)
- Split panel open/close (layout structure changes)
- Layout orientation toggle (landscape ↔ portrait changes the entire frame)
- First-run onboarding wizard
- Model manager download progress
- Avatar activation/deactivation

---

## P0-B: Code-Split Panels and Tools by Tab

### Problem

The main `index-*.js` chunk is 1,181 KB (309 KB gzip). All panels, tools, and vendor libraries are bundled into it. Only one panel and one workspace tool are visible at any time, but all code loads upfront.

### Current import graph (what's eagerly loaded)

```
main.ts (8,928 lines)
  ├── panels/index.ts → imports ALL 12 panels eagerly
  │   ├── apisPanel.ts
  │   ├── avatarPanel.ts
  │   ├── chatPanel.ts
  │   ├── devicesPanel.ts
  │   ├── historyPanel.ts
  │   ├── llamaCppPanel.ts
  │   ├── modelManagerPanel.ts
  │   ├── settingsPanel.ts
  │   ├── sttPanel.ts
  │   ├── ttsPanel.ts
  │   └── workspacePanel.ts
  ├── tools/host/viewBuilder.ts → imports ALL 11 tools eagerly
  │   ├── files/ (largest: highlight.ts, bindings.ts)
  │   ├── notepad/
  │   ├── sheets/ (canvas rendering)
  │   ├── tasks/
  │   ├── memory/
  │   ├── chart/
  │   ├── webSearch/
  │   ├── opencode/
  │   ├── looper/
  │   ├── docs/
  │   └── (files is also imported separately)
  ├── tools/terminal/index.tsx → xterm + addons (large)
  ├── tools/files/highlight.ts → highlight.js core + 22 languages
  ├── ipcClient.ts (2,384 lines)
  └── [all app orchestration modules]
```

### Strategy

Split into three tiers of code-splitting, from easiest to hardest:

---

### Phase 1: Vite `manualChunks` for vendor libraries

**Goal:** Separate heavy vendor libraries into their own chunks. Zero application code changes.

**File:** `vite.config.ts`

```typescript
export default defineConfig({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-highlight": ["highlight.js/lib/core"],
          "vendor-xterm": ["xterm", "@xterm/addon-fit", "@xterm/addon-web-links"],
          "vendor-overlayscrollbars": ["overlayscrollbars"],
        }
      }
    }
  }
});
```

**Impact:** These vendor libraries total ~50-60 KB gzip. They'll be in separate chunks that the browser can cache independently and load in parallel.

**Note:** `three` and `mermaid` are already code-split (via dynamic imports in `wireframeRuntime.ts` and `chart/runtime.ts`). The above only addresses what's still in the main bundle.

**Prerequisites:** None.

**Risk:** None. This is purely a build configuration change. Runtime behavior is identical.

**Testing:** Run `npm run build` and verify the new chunks appear. Run the app and verify highlight.js, xterm, and OverlayScrollbars still work.

**Estimated effort:** 30 minutes.

---

### Phase 2: Lazy-load panels

**Goal:** Only load the panel module for the currently active sidebar tab. When the user switches tabs, dynamically import the new panel's module.

**Current architecture** (`src/panels/index.ts`):

```typescript
// ALL panels imported eagerly at module level:
import { bindApisPanel, renderApisActions, renderApisBody } from "./apisPanel";
import { bindAvatarPanel, renderAvatarActions, renderAvatarBody } from "./avatarPanel";
import { bindChatPanel, renderChatActions, renderChatBody } from "./chatPanel";
// ... 9 more panels

export function getPanelDefinition(tab, state) {
  // Returns a { renderBody, renderActions } object based on tab
}
```

**Proposed architecture:**

Create a panel loader registry in `src/panels/index.ts`:

```typescript
type PanelModule = {
  renderBody: (state: PrimaryPanelRenderState, scopeId?: string) => string;
  renderActions: (state: PrimaryPanelRenderState, scopeId?: string) => string;
  bind?: (bindings: PrimaryPanelBindings, state: PrimaryPanelRenderState) => void;
};

// Chat panel stays eager (it's the default tab and most frequently used)
import { renderChatBody, renderChatActions, bindChatPanel } from "./chatPanel";

// Other panels lazy-loaded
const panelLoaders: Record<string, () => Promise<PanelModule>> = {
  history: () => import("./historyPanel").then(m => ({
    renderBody: (s) => m.renderHistoryBody(s),
    renderActions: () => m.renderHistoryActions,
    bind: (b) => m.bindHistoryPanel(b.onCreateConversation, b.onSelectConversation, b.onExportConversation, b.onDeleteConversation),
  })),
  avatar: () => import("./avatarPanel").then(m => ({
    renderBody: (s) => m.renderAvatarBody(s),
    renderActions: (s) => m.renderAvatarActions(s),
    bind: (b) => m.bindAvatarPanel(b),
  })),
  // ... etc for each panel
};

// Cache loaded modules
const panelCache: Record<string, PanelModule> = {};

export async function loadPanelModule(tab: SidebarTab): Promise<PanelModule> {
  if (tab === "chat") return { renderBody: renderChatBody, renderActions: renderChatActions, bind: bindChatPanel };
  const cached = panelCache[tab];
  if (cached) return cached;
  const loader = panelLoaders[tab];
  if (!loader) throw new Error(`Unknown panel: ${tab}`);
  const mod = await loader();
  panelCache[tab] = mod;
  return mod;
}
```

**Changes required in `main.ts`:**

The `render()` function currently calls `getPanelDefinition()` synchronously. With lazy-loading, the first visit to a tab needs to be async:

```typescript
// In attachSidebarInteractions:
tab.onclick = async () => {
  const nextTab = tab.dataset.sidebarTab as SidebarTab | undefined;
  if (!nextTab) return;
  state.sidebarTab = nextTab;

  // Load panel module (cached after first load)
  await loadPanelModule(nextTab);

  // Then render (same as before, but panel module is now loaded)
  if (nextTab === "llama_cpp") await refreshLlamaRuntime();
  renderAndBind(sendMessage);
};
```

**Also update `getPanelDefinition`** to use the cached module:

```typescript
export function getPanelDefinition(tab: SidebarTab, state: PrimaryPanelRenderState, scopeId = ""): PrimaryPanelDefinition {
  const cached = panelCache[tab];
  if (cached) {
    return {
      title: TAB_TITLES[tab],
      icon: TAB_ICONS[tab],
      renderBody: () => cached.renderBody(state, scopeId),
      renderActions: () => cached.renderActions(state, scopeId),
    };
  }
  // Fallback for unloaded panels (shouldn't happen if loadPanelModule was called)
  return { title: "Loading...", icon: APP_ICON.sidebar.settings, renderBody: () => "", renderActions: () => "" };
}
```

**Prerequisites:** Phase 1 (manual chunks for vendors).

**Risk:** Low-Medium. The main risk is a brief flash of "Loading..." on first tab visit. This can be mitigated by preloading common panels (history, settings) after initial render.

**Testing:** Click each sidebar tab. Verify panel loads correctly, all interactions work, no console errors. Test that switching back to a previously visited tab is instant (cached).

**Estimated effort:** 6-8 hours.

**Expected bundle reduction:** Panels total ~2,500 lines of code (chatPanel 627 + avatarPanel ~400 + llamaCppPanel ~400 + modelManagerPanel ~500 + sttPanel ~300 + ttsPanel ~300 + settingsPanel ~200 + others ~300). Removing ~1,800 lines (all non-chat) from the initial bundle should save ~30-40 KB gzip.

---

### Phase 3: Lazy-load workspace tool views

**Goal:** Only load the tool view builder code for the currently active workspace tab.

**Current architecture** (`src/tools/host/viewBuilder.ts`):

All 11 tools' `renderToolBody()` and `renderToolActions()` functions are imported eagerly. The `buildWorkspaceToolViews()` function builds HTML for ALL tools on every render, even though only one is visible.

**Proposed changes:**

#### a) Split `viewBuilder.ts` into per-tool view modules

Each tool already has its own directory. Add a `view.ts` export from each:

```typescript
// src/tools/files/view.ts (or add to existing index.tsx)
export function renderFilesToolHtml(state: FilesToolStateSlice): ToolViewHtml {
  return {
    actionsHtml: renderFilesToolActions(state),
    bodyHtml: renderFilesToolBody(state),
  };
}
```

#### b) Lazy-load tool views

```typescript
// src/tools/host/viewBuilder.ts
const toolViewLoaders: Record<string, () => Promise<{ render: (input: any) => ToolViewHtml }>> = {
  files: () => import("../files").then(m => ({ render: (input) => m.renderFilesToolHtml(input) })),
  notepad: () => import("../notepad").then(m => ({ render: (input) => m.renderNotepadToolHtml(input) })),
  sheets: () => import("../sheets").then(m => ({ render: (input) => m.renderSheetsToolHtml(input) })),
  // ...
};
```

#### c) Build only the active tool's HTML

```typescript
export function buildActiveToolView(
  activeToolId: string,
  input: WorkspaceToolViewInput
): ToolViewHtml | null {
  // For the active tool, build its HTML. For others, return empty.
  // This alone saves significant string building work even without lazy loading.
}
```

**Critical optimization:** Currently `buildWorkspaceToolViews()` builds HTML for ALL 11 tools on every render. Changing it to only build the active tool's HTML (regardless of lazy loading) would cut rendering work by ~10x for workspace renders. This can be done independently of the lazy-loading work.

**Prerequisites:** Phase 1.

**Risk:** Medium. Tools have complex state and interactions. The files tool's highlight.js integration and the sheets tool's canvas mounting need careful handling.

**Testing:** Switch between all workspace tool tabs. Verify each tool renders correctly, all interactions work, canvas elements mount/unmount properly, terminal sessions persist.

**Estimated effort:** 8-10 hours.

**Expected bundle reduction:** Tools code totals ~5,000+ lines. Removing ~4,000 lines from the initial bundle (keeping only the default tool, e.g., tasks) should save ~50-70 KB gzip. Combined with highlight.js and xterm being deferred, the total initial bundle could drop from 309 KB to ~180-200 KB gzip.

---

### Phase 4: Move xterm and highlight.js imports behind lazy boundaries

**Goal:** These heavy libraries should only load when their tool is first activated.

**xterm** (`tools/terminal/index.tsx`): Currently imported statically in `main.ts:58`. Move to a dynamic import that triggers when the terminal workspace tab is first selected.

**highlight.js** (`tools/files/highlight.ts`): Used by both `files` and `notepad` tools. Move the import into a shared lazy module that loads when either tool is first activated.

**Changes:**

```typescript
// main.ts - REMOVE static imports:
// import { TerminalManager, ... } from "./tools/terminal/index";
// import "xterm/css/xterm.css";

// REPLACE with:
let terminalModule: typeof import("./tools/terminal/index") | null = null;
async function getTerminalModule() {
  if (!terminalModule) terminalModule = await import("./tools/terminal/index");
  return terminalModule;
}
```

**Prerequisites:** Phase 3 (tools must be lazy-loaded for this to work).

**Risk:** Low. These modules are already isolated behind tool boundaries.

**Estimated effort:** 2-3 hours.

---

### Summary: P0-B Effort

| Phase | Description | Effort | Risk | Bundle savings |
|-------|-------------|--------|------|---------------|
| 1 | Vite `manualChunks` for vendors | 0.5h | None | ~10-15 KB gzip (better caching) |
| 2 | Lazy-load panels | 6-8h | Low-Med | ~30-40 KB gzip |
| 3 | Lazy-load workspace tools + build active only | 8-10h | Medium | ~50-70 KB gzip |
| 4 | Move xterm/highlight.js behind lazy boundaries | 2-3h | Low | ~30-40 KB gzip |
| | **Total** | **17-22h** | | **~120-165 KB gzip savings** |

---

## Combined P0 Execution Order

The recommended order minimizes risk and maximizes incremental value:

```
Week 1: P0-B Phase 1 (manualChunks) + P0-A Phase 1 (patchUI infrastructure)
        → Zero-risk build config change + utility module
        → Ship immediately

Week 2: P0-A Phase 2 (settings toggles → targeted updates)
        → Low-risk, immediately noticeable improvement
        → Every settings toggle becomes instant

Week 3: P0-A Phase 3 (sidebar tab partial renders)
        + P0-B Phase 2 (lazy-load panels)
        → Sidebar navigation becomes instant + smaller initial bundle

Week 4: P0-A Phase 4 (workspace tab partial renders)
        + P0-B Phase 3 (lazy-load tools + build active only)
        → Workspace navigation becomes instant + significantly smaller bundle

Week 5: P0-B Phase 4 (xterm/highlight behind lazy)
        + P0-A Phase 5 (RAF batching)
        → Final polish: terminal/code editor loads on demand, rapid changes batched
```

### Key principle

**Every phase is independently shippable.** If work stops after any week, the app is still better than before. No phase introduces tech debt or requires a later phase to clean up.

---

## Architecture Note

The app uses a vanilla TypeScript architecture with a single 8,928-line `main.ts` file containing a 411-property mutable state object. There is no framework (React is used only by 2 STT files), no virtual DOM, and no component system. Rendering is done by building HTML strings and replacing `innerHTML`. This architecture is simple and dependency-free, but it lacks the incremental update capabilities that even lightweight libraries provide.

The most impactful single change would be **reducing the scope of re-renders** — whether by targeted DOM updates for small changes, or by introducing a lightweight DOM diffing utility. Combined with code-splitting panels and tools (which Vite handles natively via dynamic `import()`), this would address both the load-time and runtime performance concerns.
