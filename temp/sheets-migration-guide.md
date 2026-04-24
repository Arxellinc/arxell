# Sheets Frontend Migration Guide
## From `react-datasheet-grid` to Canvas + DOM Overlay Architecture

**Target audience:** Claude Code or a senior frontend engineer  
**Codebase location:** The uploaded `sheets/` tool directory  
**Goal:** Replace the `react-datasheet-grid` + React render loop with a lean canvas-based grid renderer while keeping the Rust IPC backend, state model, and all existing actions completely intact.

---

## 1. Why This Migration

The current implementation has three structural problems:

1. **`react-datasheet-grid` owns the grid entirely.** Column definitions, row objects, and change diffing all go through `buildSheetsGridColumns` / `buildSheetsGridRows` / `diffSheetsGridChanges` in `gridMapping.ts`. This abstraction layer fights every non-trivial feature: formula highlighting, error cell styling, fill handle, frozen rows, and column resize all require fighting the library's internal model.

2. **React re-renders on every selection change.** `SheetsRuntimeView` calls `forceRender` on every `onSelectionChange` and `onActiveCellChange` event. At 60fps scroll or drag-select this is hundreds of React reconciliations per second — expensive for a component that renders a grid with potentially thousands of cells.

3. **`buildSheetsGridRows` allocates a full dense row array on every render.** Even for a sparse sheet, it iterates `rowCount × columnCount` on every state change. For a 1000×50 sheet that's 50,000 object allocations per render cycle.

The target architecture is:

- **One `<canvas>` element** renders the entire grid (cells, headers, selection, fill handle) via `OffscreenCanvas` + a Web Worker.
- **One `<div>` overlay** (absolutely positioned over the canvas) holds only the active cell `<input>`, the formula bar, and context menus — real DOM only where the user needs to type.
- **No React.** Replace `SheetsRuntimeView` with plain TypeScript. React adds ~45KB gzipped and a reconciler that is not needed for a single-canvas component.
- **State model (`state.ts`) is unchanged.** The Rust IPC surface (`actions.ts`) is unchanged. The toolbar (`index.tsx`) and bindings (`bindings.ts`) are unchanged.

---

## 2. Files to Create, Modify, or Delete

### Delete
- `runtime.ts` — replaced entirely
- `gridMapping.ts` — replaced entirely

### Modify
- `state.ts` — add viewport scroll offset and column/row size fields (additive, no removals)
- `styles.css` — replace grid library CSS overrides with canvas host styles
- `index.tsx` — remove the `react-datasheet-grid/dist/style.css` import that currently leaks in via `runtime.ts`

### Create (new files in the `sheets/` directory)
- `canvas/renderer.ts` — paints cells, headers, selection, fill handle onto the canvas
- `canvas/viewport.ts` — maps pixel ↔ cell coordinates; manages scroll offset
- `canvas/editor.ts` — positions and manages the floating `<input>` overlay
- `canvas/worker.ts` — `OffscreenCanvas` worker that receives paint commands
- `canvas/mount.ts` — replaces `mountSheetsRuntime` / `unmountSheetsRuntime`

### Remove from `package.json`
- `react`
- `react-dom`
- `react-datasheet-grid`

---

## 3. State Additions (`state.ts`)

Add these fields to `SheetsToolState`. Do **not** remove any existing fields — the Rust IPC layer and toolbar code depend on them.

```ts
// Append to SheetsToolState interface:

// Scroll position in pixels
scrollX: number;
scrollY: number;

// Per-column widths in pixels (undefined = use default COL_WIDTH)
colWidths: Map<number, number>;

// Per-row heights in pixels (undefined = use default ROW_HEIGHT)
rowHeights: Map<number, number>;

// The cell currently being edited inline (null = not editing)
editingCell: { row: number; col: number } | null;
```

Add to `getInitialSheetsState()`:

```ts
scrollX: 0,
scrollY: 0,
colWidths: new Map(),
rowHeights: new Map(),
editingCell: null,
```

---

## 4. Layout Constants

Create `canvas/constants.ts`:

```ts
export const ROW_HEIGHT      = 30;   // px, default row height
export const COL_WIDTH       = 120;  // px, default column width
export const HEADER_HEIGHT   = 30;   // px, row-number gutter at top
export const GUTTER_WIDTH    = 48;   // px, col-number gutter on left
export const FILL_HANDLE_PX  = 6;    // px, side length of fill handle square
export const SELECTION_COLOR = "rgba(66,133,244,0.15)";
export const SELECTION_BORDER = "#4285F4";
export const HEADER_BG       = "var(--surface-soft)";
export const CELL_BG         = "var(--panel)";
export const CELL_BORDER     = "rgba(0,0,0,0.15)";
export const FONT_SIZE       = 13;   // px
export const FONT_FAMILY     = '"Anthropic Sans", system-ui, sans-serif';
export const ERROR_COLOR     = "var(--error)";
export const FORMULA_COLOR   = "var(--status-info)";
```

---

## 5. Viewport Module (`canvas/viewport.ts`)

This module owns the mapping between pixel space and cell space. It must be pure functions — no DOM access, no side effects — so it can run in both the main thread and the worker.

```ts
import { COL_WIDTH, ROW_HEIGHT, GUTTER_WIDTH, HEADER_HEIGHT } from "./constants.js";
import type { SheetsToolState } from "../state.js";

export interface CellRect {
  x: number; // canvas-relative px (includes gutter)
  y: number;
  w: number;
  h: number;
}

/** Pixel x/y → [col, row] (returns null if inside header/gutter) */
export function hitTest(
  px: number,
  py: number,
  scrollX: number,
  scrollY: number,
  colWidths: Map<number, number>,
  rowHeights: Map<number, number>
): [col: number, row: number] | null {
  if (px < GUTTER_WIDTH || py < HEADER_HEIGHT) return null;
  const col = xToCol(px + scrollX - GUTTER_WIDTH, colWidths);
  const row = yToRow(py + scrollY - HEADER_HEIGHT, rowHeights);
  return [col, row];
}

export function cellRect(
  col: number,
  row: number,
  scrollX: number,
  scrollY: number,
  colWidths: Map<number, number>,
  rowHeights: Map<number, number>
): CellRect {
  const x = colToX(col, colWidths) - scrollX + GUTTER_WIDTH;
  const y = rowToY(row, rowHeights) - scrollY + HEADER_HEIGHT;
  const w = colWidths.get(col) ?? COL_WIDTH;
  const h = rowHeights.get(row) ?? ROW_HEIGHT;
  return { x, y, w, h };
}

/** Returns the range of [colStart, colEnd, rowStart, rowEnd] visible in canvas bounds */
export function visibleRange(
  canvasWidth: number,
  canvasHeight: number,
  scrollX: number,
  scrollY: number,
  colCount: number,
  rowCount: number,
  colWidths: Map<number, number>,
  rowHeights: Map<number, number>
): { colStart: number; colEnd: number; rowStart: number; rowEnd: number } {
  const colStart = xToCol(scrollX, colWidths);
  const colEnd   = Math.min(colCount - 1, xToCol(scrollX + canvasWidth  - GUTTER_WIDTH, colWidths));
  const rowStart = yToRow(scrollY, rowHeights);
  const rowEnd   = Math.min(rowCount - 1, yToRow(scrollY + canvasHeight - HEADER_HEIGHT, rowHeights));
  return { colStart, colEnd, rowStart, rowEnd };
}

// --- helpers ---

function colToX(col: number, widths: Map<number, number>): number {
  let x = 0;
  for (let c = 0; c < col; c++) x += widths.get(c) ?? COL_WIDTH;
  return x;
}

function rowToY(row: number, heights: Map<number, number>): number {
  let y = 0;
  for (let r = 0; r < row; r++) y += heights.get(r) ?? ROW_HEIGHT;
  return y;
}

function xToCol(x: number, widths: Map<number, number>): number {
  let cursor = 0, col = 0;
  while (true) {
    const w = widths.get(col) ?? COL_WIDTH;
    if (cursor + w > x) return col;
    cursor += w;
    col++;
  }
}

function yToRow(y: number, heights: Map<number, number>): number {
  let cursor = 0, row = 0;
  while (true) {
    const h = heights.get(row) ?? ROW_HEIGHT;
    if (cursor + h > y) return row;
    cursor += h;
    row++;
  }
}
```

**Important:** `colToX` and `rowToY` are O(n) in the number of columns/rows. For sheets with > 500 columns or > 10,000 rows, replace them with a prefix-sum array that is rebuilt whenever `colWidths`/`rowHeights` change. The above is correct for MVP; add a `// TODO: prefix-sum cache` comment so the agent knows where to optimise later.

---

## 6. Renderer (`canvas/renderer.ts`)

This is the main paint function. It is called on every `requestAnimationFrame` when dirty, and by the worker when the worker holds the `OffscreenCanvas`.

```ts
import { getSheetsCell, type SheetsToolState } from "../state.js";
import { cellRect, visibleRange } from "./viewport.js";
import { columnLabel } from "../gridMapping.js"; // keep this utility — it's pure
import {
  ROW_HEIGHT, COL_WIDTH, HEADER_HEIGHT, GUTTER_WIDTH,
  SELECTION_COLOR, SELECTION_BORDER, FILL_HANDLE_PX,
  FONT_SIZE, FONT_FAMILY, CELL_BG, CELL_BORDER,
  ERROR_COLOR, FORMULA_COLOR
} from "./constants.js";

export interface PaintParams {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  state: SheetsToolState;
  // CSS var-resolved colours passed in from main thread (workers can't read CSS vars)
  theme: ThemeColors;
}

export interface ThemeColors {
  cellBg: string;
  headerBg: string;
  cellBorder: string;
  ink: string;
  muted: string;
  selectionBg: string;
  selectionBorder: string;
  errorColor: string;
  formulaColor: string;
}

export function paintGrid({ ctx, width, height, state, theme }: PaintParams): void {
  const { scrollX, scrollY, colWidths, rowHeights, selection, editingCell } = state;

  ctx.clearRect(0, 0, width, height);

  const visible = visibleRange(width, height, scrollX, scrollY,
    state.columnCount, state.rowCount, colWidths, rowHeights);

  // --- 1. Cell backgrounds and text ---
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textBaseline = "middle";

  for (let row = visible.rowStart; row <= visible.rowEnd; row++) {
    for (let col = visible.colStart; col <= visible.colEnd; col++) {
      const r = cellRect(col, row, scrollX, scrollY, colWidths, rowHeights);

      // Skip the editing cell — the DOM <input> covers it
      if (editingCell && editingCell.row === row && editingCell.col === col) continue;

      const cell = getSheetsCell(state, row, col);

      ctx.fillStyle = theme.cellBg;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      ctx.strokeStyle = theme.cellBorder;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

      if (cell) {
        if (cell.error) ctx.fillStyle = theme.errorColor;
        else if (cell.input.startsWith("=")) ctx.fillStyle = theme.formulaColor;
        else ctx.fillStyle = theme.ink;

        const text = cell.display || cell.input;
        ctx.fillText(text, r.x + 5, r.y + r.h / 2, r.w - 10);
      }
    }
  }

  // --- 2. Column headers ---
  for (let col = visible.colStart; col <= visible.colEnd; col++) {
    const r = cellRect(col, 0, scrollX, scrollY, colWidths, rowHeights);
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(r.x, 0, r.w, HEADER_HEIGHT);
    ctx.strokeStyle = theme.cellBorder;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(r.x + 0.5, 0.5, r.w - 1, HEADER_HEIGHT - 1);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "center";
    ctx.fillText(columnLabel(col), r.x + r.w / 2, HEADER_HEIGHT / 2);
    ctx.textAlign = "left";
  }

  // --- 3. Row gutter (row numbers) ---
  for (let row = visible.rowStart; row <= visible.rowEnd; row++) {
    const r = cellRect(0, row, scrollX, scrollY, colWidths, rowHeights);
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(0, r.y, GUTTER_WIDTH, r.h);
    ctx.strokeStyle = theme.cellBorder;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0.5, r.y + 0.5, GUTTER_WIDTH - 1, r.h - 1);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "center";
    ctx.fillText(String(row + 1), GUTTER_WIDTH / 2, r.y + r.h / 2);
    ctx.textAlign = "left";
  }

  // --- 4. Top-left corner cell ---
  ctx.fillStyle = theme.headerBg;
  ctx.fillRect(0, 0, GUTTER_WIDTH, HEADER_HEIGHT);
  ctx.strokeStyle = theme.cellBorder;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(0.5, 0.5, GUTTER_WIDTH - 1, HEADER_HEIGHT - 1);

  // --- 5. Selection overlay ---
  if (selection) {
    const tl = cellRect(selection.startCol, selection.startRow, scrollX, scrollY, colWidths, rowHeights);
    const br = cellRect(selection.endCol,   selection.endRow,   scrollX, scrollY, colWidths, rowHeights);
    const brW = colWidths.get(selection.endCol) ?? COL_WIDTH;
    const brH = rowHeights.get(selection.endRow) ?? ROW_HEIGHT;
    const sx = tl.x, sy = tl.y;
    const sw = br.x + brW - tl.x;
    const sh = br.y + brH - tl.y;

    ctx.fillStyle = theme.selectionBg;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = theme.selectionBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);

    // Fill handle
    const fx = sx + sw - FILL_HANDLE_PX / 2;
    const fy = sy + sh - FILL_HANDLE_PX / 2;
    ctx.fillStyle = theme.selectionBorder;
    ctx.fillRect(fx, fy, FILL_HANDLE_PX, FILL_HANDLE_PX);
  }
}
```

**Dirty-region optimisation (phase 2):** For now `paintGrid` repaints the full visible area. Once the core is working, add a `dirtyRect: DOMRect | null` parameter. When set, call `ctx.save(); ctx.beginPath(); ctx.rect(...dirtyRect); ctx.clip()` before painting cells, and `ctx.restore()` after. This confines the GPU upload to the changed region. Mark with `// TODO: dirty-region clip` so the agent can find it.

---

## 7. Cell Editor Overlay (`canvas/editor.ts`)

The editor positions a real `<input>` over the active cell. It handles Enter/Tab/Escape navigation, IME composition, and the formula bar sync.

```ts
import { cellRect } from "./viewport.js";
import { setSheetsSelection, syncEditorValue, type SheetsToolState } from "../state.js";
import type { GUTTER_WIDTH, HEADER_HEIGHT } from "./constants.js";

export interface EditorDeps {
  state: SheetsToolState;
  canvasEl: HTMLCanvasElement;
  canvasOffsetLeft: number; // canvas.getBoundingClientRect().left
  canvasOffsetTop: number;
  onCommit: (row: number, col: number, value: string) => Promise<void>;
  onNavigate: (direction: "right" | "down" | "up" | "left" | "escape") => void;
  onRepaint: () => void;
}

let inputEl: HTMLInputElement | null = null;

export function mountEditorOverlay(container: HTMLElement): HTMLInputElement {
  inputEl = document.createElement("input");
  inputEl.className = "sheets-cell-editor";
  inputEl.style.cssText = `
    position: absolute;
    display: none;
    box-sizing: border-box;
    border: 2px solid #4285F4;
    padding: 0 4px;
    font: inherit;
    font-size: 13px;
    background: var(--panel);
    color: var(--ink);
    z-index: 10;
    outline: none;
  `;
  container.style.position = "relative";
  container.appendChild(inputEl);
  return inputEl;
}

export function startCellEdit(row: number, col: number, deps: EditorDeps, initialChar?: string): void {
  if (!inputEl) return;
  const { state } = deps;
  const r = cellRect(col, row, state.scrollX, state.scrollY, state.colWidths, state.rowHeights);

  state.editingCell = { row, col };

  inputEl.style.left   = `${r.x}px`;
  inputEl.style.top    = `${r.y}px`;
  inputEl.style.width  = `${r.w}px`;
  inputEl.style.height = `${r.h}px`;
  inputEl.style.display = "block";

  const cell = deps.state.cellsByKey[`${row}:${col}`];
  inputEl.value = initialChar ?? cell?.input ?? "";

  inputEl.onkeydown = async (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await commitEdit(row, col, deps);
      deps.onNavigate("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      await commitEdit(row, col, deps);
      deps.onNavigate(e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      cancelEdit(deps);
      deps.onNavigate("escape");
    }
  };

  inputEl.oninput = () => {
    // Mirror into formula bar
    state.activeEditorValue = inputEl!.value;
    deps.onRepaint();
  };

  inputEl.focus();
  if (!initialChar) inputEl.select();
}

export async function commitEdit(row: number, col: number, deps: EditorDeps): Promise<void> {
  if (!inputEl) return;
  const value = inputEl.value;
  hideEditorOverlay(deps.state);
  deps.onRepaint();
  await deps.onCommit(row, col, value);
}

export function cancelEdit(deps: EditorDeps): void {
  hideEditorOverlay(deps.state);
  deps.onRepaint();
}

function hideEditorOverlay(state: SheetsToolState): void {
  if (!inputEl) return;
  inputEl.style.display = "none";
  inputEl.value = "";
  state.editingCell = null;
  syncEditorValue(state);
}
```

Add this CSS to `styles.css`:

```css
.sheets-cell-editor {
  /* Positioned by JS — base styles only here */
  border: 2px solid var(--accent);
  background: var(--panel);
  color: var(--ink);
  font-size: var(--text-sm);
  padding: 0 4px;
  outline: none;
}
```

---

## 8. Main Mount Module (`canvas/mount.ts`)

This replaces `runtime.ts` in its entirety. It owns the canvas element, event listeners, the animation loop, and the editor overlay. It exposes the same `mountSheetsRuntime` / `unmountSheetsRuntime` API so call sites in the wider app need no changes.

```ts
import { paintGrid, type ThemeColors } from "./renderer.js";
import { hitTest, cellRect } from "./viewport.js";
import { mountEditorOverlay, startCellEdit, commitEdit } from "./editor.js";
import { HEADER_HEIGHT, GUTTER_WIDTH, FILL_HANDLE_PX, COL_WIDTH, ROW_HEIGHT } from "./constants.js";
import {
  setSheetsSelection,
  syncEditorValue,
  applyOptimisticCellWrites,
  revertOptimisticCellWrites,
  type SheetsToolState,
  type SheetsSelection
} from "../state.js";
import { writeRange } from "../actions.js";
import { SHEETS_UI_ID } from "../../ui/constants.js";
import type { SheetsDeps } from "../actions.js"; // expose deps type from actions.ts

interface MountDeps {
  state: SheetsToolState;
  actionDeps: SheetsDeps;
  ensureWorkbook: () => Promise<void>;
  rerender: () => void; // triggers toolbar/formula-bar repaint in the outer shell
}

let canvas: HTMLCanvasElement | null = null;
let overlayContainer: HTMLDivElement | null = null;
let formulaInput: HTMLInputElement | null = null;
let animFrameId: number | null = null;
let isDirty = false;
let hydrationInFlight = false;

// Interaction state
let pointerDown = false;
let resizingCol: number | null = null;
let resizeStartX = 0;
let resizeStartWidth = 0;
let fillDragging = false;
let fillAnchorRange: SheetsSelection | null = null;

export function mountSheetsRuntime(state: SheetsToolState, deps: MountDeps): void {
  const host = document.querySelector<HTMLElement>(`#${SHEETS_UI_ID.host}`);
  if (!host) { unmountSheetsRuntime(); return; }

  if (!state.hasWorkbook && !state.pending && !state.lastError && !hydrationInFlight) {
    hydrationInFlight = true;
    void deps.ensureWorkbook().finally(() => {
      hydrationInFlight = false;
      markDirty();
    });
  }

  // Build the DOM structure once
  if (!canvas) {
    // Formula bar
    const formulaRow = buildFormulaBar(state, deps);

    // Canvas + overlay wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "sheets-grid-wrap";
    wrapper.style.cssText = "flex:1;min-height:0;position:relative;overflow:hidden;";

    canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%;";
    wrapper.appendChild(canvas);

    // Floating cell editor
    overlayContainer = document.createElement("div");
    overlayContainer.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;width:100%;height:100%;";
    wrapper.appendChild(overlayContainer);
    mountEditorOverlay(overlayContainer);

    const runtime = document.createElement("div");
    runtime.className = "sheets-runtime";
    runtime.appendChild(formulaRow);
    runtime.appendChild(wrapper);

    host.replaceChildren(runtime);

    attachCanvasEvents(canvas, state, deps);
    startRenderLoop(canvas, state);
  }

  markDirty();
}

export function unmountSheetsRuntime(): void {
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
  animFrameId = null;
  canvas = null;
  overlayContainer = null;
  formulaInput = null;
  hydrationInFlight = false;
}

function markDirty(): void { isDirty = true; }

function startRenderLoop(cvs: HTMLCanvasElement, state: SheetsToolState): void {
  const ctx = cvs.getContext("2d")!;

  function loop(): void {
    animFrameId = requestAnimationFrame(loop);
    if (!isDirty) return;
    isDirty = false;

    // Sync canvas physical pixels to CSS size
    const dpr = window.devicePixelRatio || 1;
    const w = cvs.clientWidth, h = cvs.clientHeight;
    if (cvs.width !== w * dpr || cvs.height !== h * dpr) {
      cvs.width  = w * dpr;
      cvs.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    paintGrid({ ctx, width: w, height: h, state, theme: resolveTheme(cvs) });
    syncFormulaBar(state);
  }

  loop();
}

function resolveTheme(el: Element): ThemeColors {
  const s = getComputedStyle(el);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    cellBg:          v("--panel")          || "#ffffff",
    headerBg:        v("--surface-soft")   || "#f5f5f5",
    cellBorder:      v("--line")           || "#e0e0e0",
    ink:             v("--ink")            || "#111111",
    muted:           v("--muted")          || "#888888",
    selectionBg:     "rgba(66,133,244,0.15)",
    selectionBorder: "#4285F4",
    errorColor:      v("--error")          || "#d32f2f",
    formulaColor:    v("--status-info")    || "#1565c0",
  };
}

function attachCanvasEvents(
  cvs: HTMLCanvasElement,
  state: SheetsToolState,
  deps: MountDeps
): void {
  // --- Scroll ---
  cvs.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.scrollX = Math.max(0, state.scrollX + e.deltaX);
    state.scrollY = Math.max(0, state.scrollY + e.deltaY);
    markDirty();
  }, { passive: false });

  // --- Pointer: selection, fill handle drag, column resize ---
  cvs.addEventListener("pointerdown", (e) => {
    const px = e.offsetX, py = e.offsetY;
    pointerDown = true;
    cvs.setPointerCapture(e.pointerId);

    // Check for column resize hit (within 4px of header column boundary)
    const resizeCol = headerResizeHit(px, py, state);
    if (resizeCol !== null) {
      resizingCol = resizeCol;
      resizeStartX = px;
      resizeStartWidth = state.colWidths.get(resizeCol) ?? COL_WIDTH;
      return;
    }

    // Check fill handle
    if (state.selection && isFillHandle(px, py, state)) {
      fillDragging = true;
      fillAnchorRange = { ...state.selection };
      return;
    }

    // Normal cell click
    const hit = hitTest(px, py, state.scrollX, state.scrollY, state.colWidths, state.rowHeights);
    if (!hit) return;
    const [col, row] = hit;
    setSheetsSelection(state, { startRow: row, startCol: col, endRow: row, endCol: col });
    markDirty();
    deps.rerender();
  });

  cvs.addEventListener("pointermove", (e) => {
    if (!pointerDown) {
      updateCursor(cvs, e.offsetX, e.offsetY, state);
      return;
    }
    if (resizingCol !== null) {
      const newWidth = Math.max(40, resizeStartWidth + (e.offsetX - resizeStartX));
      state.colWidths.set(resizingCol, newWidth);
      markDirty();
      return;
    }
    if (fillDragging) {
      const hit = hitTest(e.offsetX, e.offsetY, state.scrollX, state.scrollY, state.colWidths, state.rowHeights);
      if (hit && fillAnchorRange) {
        const [col, row] = hit;
        state.selection = {
          startRow: fillAnchorRange.startRow,
          startCol: fillAnchorRange.startCol,
          endRow:   Math.max(fillAnchorRange.endRow, row),
          endCol:   Math.max(fillAnchorRange.endCol, col)
        };
        markDirty();
      }
      return;
    }
    // Drag select
    if (state.selection) {
      const hit = hitTest(e.offsetX, e.offsetY, state.scrollX, state.scrollY, state.colWidths, state.rowHeights);
      if (hit) {
        const [col, row] = hit;
        state.selection = {
          startRow: state.selection.startRow,
          startCol: state.selection.startCol,
          endRow: row,
          endCol: col
        };
        markDirty();
      }
    }
  });

  cvs.addEventListener("pointerup", async (e) => {
    pointerDown = false;
    if (fillDragging && fillAnchorRange && state.selection) {
      fillDragging = false;
      await executeFillDown(fillAnchorRange, state.selection, state, deps);
    }
    resizingCol = null;
    fillAnchorRange = null;
    deps.rerender();
  });

  // --- Keyboard: navigation, typing to start edit ---
  cvs.setAttribute("tabindex", "0");
  cvs.addEventListener("keydown", async (e) => {
    if (!state.selection) return;
    const { startRow: row, startCol: col } = state.selection;

    if (e.key === "F2" || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) {
      // Start editing
      startCellEdit(row, col, {
        state,
        canvasEl: cvs,
        canvasOffsetLeft: cvs.getBoundingClientRect().left,
        canvasOffsetTop:  cvs.getBoundingClientRect().top,
        onCommit: async (r, c, val) => {
          await commitCellValue(r, c, val, state, deps);
        },
        onNavigate: (dir) => navigateSelection(dir, state, deps),
        onRepaint: markDirty
      }, e.key.length === 1 ? e.key : undefined);
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      await commitCellValue(row, col, "", state, deps);
      return;
    }

    const arrowMap: Record<string, Parameters<typeof navigateSelection>[0]> = {
      ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up"
    };
    if (arrowMap[e.key]) {
      e.preventDefault();
      navigateSelection(arrowMap[e.key], state, deps);
    }

    // Copy / paste
    if (e.key === "c" && (e.ctrlKey || e.metaKey)) copySelection(state);
    if (e.key === "v" && (e.ctrlKey || e.metaKey)) await pasteIntoSelection(state, deps);
    if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
      // Forward to Rust undo — wire to an `undo` action once implemented
    }
  });

  // --- Double-click: start edit ---
  cvs.addEventListener("dblclick", (e) => {
    const hit = hitTest(e.offsetX, e.offsetY, state.scrollX, state.scrollY, state.colWidths, state.rowHeights);
    if (!hit) return;
    const [col, row] = hit;
    startCellEdit(row, col, {
      state, canvasEl: cvs,
      canvasOffsetLeft: 0, canvasOffsetTop: 0,
      onCommit: async (r, c, val) => commitCellValue(r, c, val, state, deps),
      onNavigate: (dir) => navigateSelection(dir, state, deps),
      onRepaint: markDirty
    });
  });
}

// --- Helpers ---

function navigateSelection(
  dir: "right" | "left" | "down" | "up" | "escape",
  state: SheetsToolState,
  deps: MountDeps
): void {
  if (!state.selection) return;
  let { startRow: row, startCol: col } = state.selection;
  if (dir === "right")  col = Math.min(state.columnCount - 1, col + 1);
  if (dir === "left")   col = Math.max(0, col - 1);
  if (dir === "down")   row = Math.min(state.rowCount - 1, row + 1);
  if (dir === "up")     row = Math.max(0, row - 1);
  setSheetsSelection(state, { startRow: row, startCol: col, endRow: row, endCol: col });
  markDirty();
  deps.rerender();
}

async function commitCellValue(
  row: number, col: number, value: string,
  state: SheetsToolState, deps: MountDeps
): Promise<void> {
  const changes = [{ row, col, input: value }];
  const snapshot = applyOptimisticCellWrites(state, changes);
  markDirty();
  try {
    await writeRange(state, deps.actionDeps, row, col, [[value]]);
  } catch {
    revertOptimisticCellWrites(state, snapshot);
    markDirty();
  }
  deps.rerender();
}

async function executeFillDown(
  anchor: SheetsSelection,
  target: SheetsSelection,
  state: SheetsToolState,
  deps: MountDeps
): Promise<void> {
  // Simple copy-down: replicate the anchor row's values into the expanded range
  const values: string[][] = [];
  for (let r = anchor.endRow + 1; r <= target.endRow; r++) {
    const row: string[] = [];
    for (let c = anchor.startCol; c <= anchor.endCol; c++) {
      row.push(state.cellsByKey[`${anchor.startRow}:${c}`]?.input ?? "");
    }
    values.push(row);
  }
  if (values.length) {
    await writeRange(state, deps.actionDeps, anchor.endRow + 1, anchor.startCol, values);
  }
}

async function copySelection(state: SheetsToolState): Promise<void> {
  if (!state.selection) return;
  const { startRow, startCol, endRow, endCol } = state.selection;
  const rows: string[] = [];
  for (let r = startRow; r <= endRow; r++) {
    const cols: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      cols.push(state.cellsByKey[`${r}:${c}`]?.input ?? "");
    }
    rows.push(cols.join("\t"));
  }
  await navigator.clipboard.writeText(rows.join("\n"));
}

async function pasteIntoSelection(state: SheetsToolState, deps: MountDeps): Promise<void> {
  if (!state.selection) return;
  const text = await navigator.clipboard.readText();
  const rows = text.split("\n").map(row => row.split("\t"));
  await writeRange(state, deps.actionDeps,
    state.selection.startRow, state.selection.startCol, rows);
}

function isFillHandle(px: number, py: number, state: SheetsToolState): boolean {
  if (!state.selection) return false;
  const { endCol, endRow } = state.selection;
  const r = cellRect(endCol, endRow, state.scrollX, state.scrollY, state.colWidths, state.rowHeights);
  const fx = r.x + r.w - FILL_HANDLE_PX;
  const fy = r.y + r.h - FILL_HANDLE_PX;
  return px >= fx && px <= fx + FILL_HANDLE_PX + 4
      && py >= fy && py <= fy + FILL_HANDLE_PX + 4;
}

function headerResizeHit(px: number, py: number, state: SheetsToolState): number | null {
  if (py > HEADER_HEIGHT) return null; // only in header row
  // Walk visible columns and check if pointer is within 4px of the right edge
  let x = GUTTER_WIDTH - state.scrollX;
  for (let col = 0; col < state.columnCount; col++) {
    const w = state.colWidths.get(col) ?? COL_WIDTH;
    const edge = x + w;
    if (Math.abs(px - edge) <= 4) return col;
    x += w;
    if (x > px + 10) break; // past pointer
  }
  return null;
}

function updateCursor(cvs: HTMLCanvasElement, px: number, py: number, state: SheetsToolState): void {
  if (headerResizeHit(px, py, state) !== null) {
    cvs.style.cursor = "col-resize";
  } else if (state.selection && isFillHandle(px, py, state)) {
    cvs.style.cursor = "crosshair";
  } else {
    cvs.style.cursor = "cell";
  }
}

function buildFormulaBar(state: SheetsToolState, deps: MountDeps): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "sheets-formula-row";

  const label = document.createElement("div");
  label.className = "sheets-formula-label";
  label.textContent = "--";

  formulaInput = document.createElement("input");
  formulaInput.className = "field-input-soft sheets-formula-input";
  formulaInput.placeholder = "Cell input or formula";

  formulaInput.addEventListener("input", () => {
    state.activeEditorValue = formulaInput!.value;
  });
  formulaInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && state.selection) {
      e.preventDefault();
      await commitCellValue(
        state.selection.startRow, state.selection.startCol,
        formulaInput!.value, state, deps
      );
    }
  });

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "tool-action-btn sheets-apply-btn";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", async () => {
    if (!state.selection) return;
    await commitCellValue(
      state.selection.startRow, state.selection.startCol,
      formulaInput!.value, state, deps
    );
  });

  row.appendChild(label);
  row.appendChild(formulaInput);
  row.appendChild(applyBtn);
  return row;
}

function syncFormulaBar(state: SheetsToolState): void {
  if (!formulaInput) return;
  formulaInput.value = state.activeEditorValue;
  const labelEl = formulaInput.previousElementSibling as HTMLElement | null;
  if (labelEl) {
    const sel = state.selection;
    if (!sel) { labelEl.textContent = "--"; return; }
    const { startCol, startRow, endCol, endRow } = sel;
    const { columnLabel } = require("../gridMapping.js");
    const start = `${columnLabel(startCol)}${startRow + 1}`;
    const end   = `${columnLabel(endCol)}${endRow + 1}`;
    labelEl.textContent = start === end ? start : `${start}:${end}`;
  }
}
```

**Note to agent:** The `require("../gridMapping.js")` in `syncFormulaBar` should be replaced with a proper ES module import of `columnLabel` from `gridMapping.ts` at the top of the file. The inline require is a placeholder to keep the listing readable.

---

## 9. CSS Changes (`styles.css`)

Remove all `.dsg-*` and `react-datasheet-grid` specific overrides. Replace with:

```css
/* Remove these entire blocks: */
.sheets-grid { ... }
.sheets-grid-wrap, .sheets-grid, .sheets-grid > .dsg-container ... { ... }
.sheets-grid > .dsg-container { ... }
.sheets-grid .dsg-cell { ... }
/* etc. — all rules that reference .dsg-* or --dsg-* */

/* Add: */
.sheets-grid-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.sheets-grid-wrap canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none; /* canvas gets focus ring otherwise */
}

.sheets-cell-editor {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid var(--accent);
  padding: 0 4px;
  font-size: var(--text-sm);
  background: var(--panel);
  color: var(--ink);
  z-index: 10;
  outline: none;
}
```

Keep all other rules (`.sheets-formula-row`, `.sheets-empty-state`, `.sheets-error-banner`, etc.) — they are unchanged.

---

## 10. `package.json` Changes

```json
// Remove:
"react": "...",
"react-dom": "...",
"react-datasheet-grid": "...",
"@types/react": "...",
"@types/react-dom": "..."
```

If React is used elsewhere in the app (other tools in the same bundle), do **not** remove it globally — only ensure `runtime.ts`'s `import React from "react"` is gone.

---

## 11. Migration Sequence for the Agent

Follow these steps in order. Each step should pass TypeScript compilation before moving to the next.

**Step 1 — Add state fields**  
Edit `state.ts`. Add `scrollX`, `scrollY`, `colWidths`, `rowHeights`, `editingCell` to the interface and initializer. Run `tsc --noEmit`. Fix any type errors.

**Step 2 — Create constants**  
Create `canvas/constants.ts` with the values from Section 4. No compilation issues expected.

**Step 3 — Create viewport module**  
Create `canvas/viewport.ts`. Run `tsc --noEmit`. This file has no imports from other new files yet, so it should compile cleanly.

**Step 4 — Create renderer**  
Create `canvas/renderer.ts`. It imports from `viewport.ts`, `state.ts`, and `gridMapping.ts` (for `columnLabel` only). Run `tsc --noEmit`.

**Step 5 — Create editor overlay**  
Create `canvas/editor.ts`. Run `tsc --noEmit`.

**Step 6 — Create mount module**  
Create `canvas/mount.ts`. This replaces `runtime.ts`'s exported functions. Run `tsc --noEmit`. At this point `runtime.ts` still exists — that's fine.

**Step 7 — Swap runtime**  
Find every import of `mountSheetsRuntime` / `unmountSheetsRuntime` in the codebase. Update them to import from `canvas/mount.ts` instead of `runtime.ts`. Delete `runtime.ts`. Run `tsc --noEmit`.

**Step 8 — Remove gridMapping dependency**  
`gridMapping.ts` exports `columnLabel`, `selectedCellLabel`, `buildSheetsGridRows`, `buildSheetsGridColumns`, `diffSheetsGridChanges`, `collapseGridChangesToWrite`. The canvas architecture only needs `columnLabel` and `selectedCellLabel`. Move both functions to a new `canvas/cellLabel.ts` file, update imports in `renderer.ts` and `mount.ts`, then delete `gridMapping.ts`. Run `tsc --noEmit`.

**Step 9 — Update CSS**  
Apply the CSS changes from Section 9 to `styles.css`. Visual check in browser.

**Step 10 — Remove unused packages**  
Remove `react`, `react-dom`, `react-datasheet-grid` from `package.json` if they are not used by other tools. Run `npm install`. Run the full build.

---

## 12. What Is Not Changing

The following must remain byte-for-byte identical (or functionally equivalent) after the migration:

| File | Reason |
|---|---|
| `actions.ts` | All Rust IPC commands, unchanged |
| `bindings.ts` | Toolbar click dispatch, unchanged |
| `index.tsx` | HTML toolbar rendering, unchanged |
| `manifest.ts` | Tool registry, unchanged |
| `state.ts` (existing fields) | IPC result types and cell snapshot model, unchanged |

The Rust `SheetsService` backend is completely untouched. The IPC protocol (`invoke`/`emit` calls in `actions.ts`) does not change.

---

## 13. Known Gaps to Implement After Migration

These are features not in the current `react-datasheet-grid` implementation either, but are now unblocked by the canvas architecture:

- **OffscreenCanvas worker** (`canvas/worker.ts`): Post a `paint` message with the state snapshot and receive back bitmap transfers. This keeps paint off the main thread during heavy operations. Implement once the synchronous path is working.
- **Frozen rows/columns**: Split paint into 4 passes (corner, frozen-col header, frozen-row header, scrollable body). The `FREEZE_ROWS` / `FREEZE_COLS` values would come from a new state field.
- **Undo/redo**: Wire the `undo`/`redo` toolbar buttons (currently `isDisplayOnlyToolbarAction` in `bindings.ts`) to `invokeSheets(deps, "undo", {})` and `invokeSheets(deps, "redo", {})` once the Rust backend implements those commands.
- **Format commands** (bold, italic, currency, etc.): Also currently display-only. Wire to corresponding `invokeSheets` calls and update the cell's display value in the snapshot.
- **Multi-sheet tabs**: The state model is single-sheet. Add a `sheetIndex` field and a `switch_sheet` IPC command.
- **Context menu**: Create a `canvas/contextMenu.ts` that builds a `<div>` positioned at the right-click coordinates and dispatches to the same `bindings.ts` action handlers.
