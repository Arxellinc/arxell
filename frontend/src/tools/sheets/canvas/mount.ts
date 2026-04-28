import { paintGrid, type ThemeColors } from "./renderer.js";
import { hitTest, cellRect, visibleRange } from "./viewport.js";
import { insertEditorText, isFormulaEditActive, mountEditorOverlay, startCellEdit } from "./editor.js";
import { columnLabel, selectedCellLabel } from "./cellLabel.js";
import { HEADER_HEIGHT, GUTTER_WIDTH, FILL_HANDLE_PX, COL_WIDTH, ROW_HEIGHT } from "./constants.js";
import { attachFormulaAutocomplete, type FormulaAutocompleteBinding } from "../formulaAutocomplete.js";
import { iconHtml } from "../../../icons-all/index.js";
import { APP_ICON } from "../../../icons-all/map.js";
import {
  getSheetsColumnFilter,
  isSheetsColumnFiltered,
  redoSheetsViewChange,
  setSheetsSelection,
  applyOptimisticCellWrites,
  revertOptimisticCellWrites,
  removeSheetsColumnFilters,
  setSheetsColumnFilterSort,
  undoSheetsViewChange,
  type SheetsToolState,
  type SheetsSelection
} from "../state.js";
import { SHEETS_UI_ID } from "../../ui/constants.js";

interface SheetsRuntimeDeps {
  rerender: () => void;
  ensureWorkbook: () => Promise<void>;
  undoSheet: () => Promise<void>;
  redoSheet: () => Promise<void>;
  updateFormulaBarValue: (value: string) => void;
  modelOptions: Array<{ id: string; label: string }>;
  aiModelId: string;
  setAiModel: (modelId: string) => Promise<void>;
  commitFormulaBar: (value: string) => Promise<void>;
  fireSetCellInput: (row: number, col: number, value: string) => Promise<void>;
  fireWriteRange: (startRow: number, startCol: number, values: string[][]) => Promise<void>;
  fireCopyPasteRange: (srcStartRow: number, srcStartCol: number, srcEndRow: number, srcEndCol: number, destStartRow: number, destStartCol: number, values: string[][]) => Promise<void>;
  insertRows: (index: number, count?: number) => Promise<void>;
  insertColumns: (index: number, count?: number) => Promise<void>;
  deleteRows: (index: number, count?: number) => Promise<void>;
  deleteColumns: (index: number, count?: number) => Promise<void>;
}

let canvas: HTMLCanvasElement | null = null;
let overlayContainer: HTMLDivElement | null = null;
let formulaInput: HTMLInputElement | null = null;
let formulaModelSelect: HTMLSelectElement | null = null;
let formulaAutocomplete: FormulaAutocompleteBinding | null = null;
let contextMenuEl: HTMLDivElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let animFrameId: number | null = null;
let isDirty = false;
let hydrationInFlight = false;

let pointerDown = false;
let resizingCol: number | null = null;
let resizingRow: number | null = null;
let resizeStartX = 0;
let resizeStartWidth = 0;
let resizeStartY = 0;
let resizeStartHeight = 0;
let hoverResizeCol: number | null = null;
let hoverResizeRow: number | null = null;
let headerDragMode: "row" | "col" | null = null;
let headerDragAnchor: number | null = null;
let fillDragging = false;
let fillAnchorRange: SheetsSelection | null = null;

const HEADER_RESIZE_GRAB_PX = 1;
const MIN_COL_WIDTH = 40;
const MIN_ROW_HEIGHT = 20;

let runtimeDeps: SheetsRuntimeDeps | null = null;

export function mountSheetsRuntime(state: SheetsToolState, deps: SheetsRuntimeDeps): void {
  runtimeDeps = deps;
  const host = document.querySelector<HTMLElement>(`#${SHEETS_UI_ID.host}`);
  if (!host) {
    unmountSheetsRuntime();
    return;
  }

  if (!state.hasWorkbook && !state.pending && !state.lastError && !hydrationInFlight) {
    hydrationInFlight = true;
    void runtimeDeps?.ensureWorkbook().finally(() => {
      hydrationInFlight = false;
      markDirty();
    });
  }

  if (!canvas || !host.contains(canvas)) {
    unmountSheetsRuntime();
    runtimeDeps = deps;
    const formulaRow = buildFormulaBar(
      state,
      runtimeDeps?.updateFormulaBarValue ?? (() => {}),
      runtimeDeps?.commitFormulaBar ?? (async () => {}),
      runtimeDeps?.modelOptions ?? [],
      runtimeDeps?.aiModelId ?? state.aiModelId,
      runtimeDeps?.setAiModel ?? (async () => {})
    );

    const wrapper = document.createElement("div");
    wrapper.className = "sheets-grid-wrap";
    wrapper.style.cssText = "flex:1;min-height:0;position:relative;overflow:hidden;";

    canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%;";
    wrapper.appendChild(canvas);

    overlayContainer = document.createElement("div");
    overlayContainer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";
    wrapper.appendChild(overlayContainer);
    mountEditorOverlay(overlayContainer);

    const runtime = document.createElement("div");
    runtime.className = "sheets-runtime";
    runtime.appendChild(formulaRow);
    runtime.appendChild(wrapper);

    contextMenuEl = document.createElement("div");
    contextMenuEl.className = "sheets-context-menu";
    contextMenuEl.style.display = "none";
    runtime.appendChild(contextMenuEl);

    host.replaceChildren(runtime);

    attachCanvasEvents(canvas, state);
    startRenderLoop(canvas, state);

  // Observe canvas size changes to trigger repaint
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        markDirty();
      });
      resizeObserver.observe(canvas);
    }
  }

  markDirty();
}

export function unmountSheetsRuntime(): void {
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
  animFrameId = null;
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  canvas = null;
  overlayContainer = null;
  formulaInput = null;
  formulaModelSelect = null;
  formulaAutocomplete?.destroy();
  formulaAutocomplete = null;
  contextMenuEl = null;
  hydrationInFlight = false;
  runtimeDeps = null;
}

function markDirty(): void { isDirty = true; }

function startRenderLoop(cvs: HTMLCanvasElement, state: SheetsToolState): void {
  const ctx = cvs.getContext("2d")!;

  function loop(): void {
    animFrameId = requestAnimationFrame(loop);
    if (!isDirty) return;
    isDirty = false;

    const dpr = window.devicePixelRatio || 1;
    const w = cvs.clientWidth, h = cvs.clientHeight;
    if (cvs.width !== w * dpr || cvs.height !== h * dpr) {
      cvs.width = w * dpr;
      cvs.height = h * dpr;
      // Reset and apply DPR scaling
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    paintGrid({
      ctx,
      width: w,
      height: h,
      state,
      theme: resolveTheme(cvs),
      hoverResizeCol,
      hoverResizeRow,
      activeResizeCol: resizingCol,
      activeResizeRow: resizingRow
    });
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
    formulaColor:    `color-mix(in srgb, ${v("--ink") || "#111111"} 80%, ${v("--status-info") || "#1565c0"} 20%)`,
    filterColor:     `color-mix(in srgb, ${v("--ink") || "#111111"} 78%, ${v("--status-info") || "#1565c0"} 22%)`,
  };
}

function attachCanvasEvents(
  cvs: HTMLCanvasElement,
  state: SheetsToolState
): void {
  cvs.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.scrollX = Math.max(0, state.scrollX + e.deltaX);
    state.scrollY = Math.max(0, state.scrollY + e.deltaY);
    markDirty();
  }, { passive: false });

  cvs.addEventListener("pointerdown", (e) => {
    hideContextMenu();
    const px = e.offsetX, py = e.offsetY;
    const headerFilterCol = headerFilterHit(px, py, state);
    if (headerFilterCol !== null) {
      cvs.focus();
      setSheetsSelection(state, {
        startRow: 0,
        startCol: headerFilterCol,
        endRow: Math.max(0, state.rowCount - 1),
        endCol: headerFilterCol
      });
      runtimeDeps?.rerender();
      showFilterMenu(e.clientX, e.clientY, state, headerFilterCol);
      markDirty();
      return;
    }
    const resizeHit = headerResizeHit(px, py, state);
    if (resizeHit) {
      cvs.focus();
      pointerDown = true;
      cvs.setPointerCapture(e.pointerId);
      if (resizeHit.kind === "col") {
        resizingCol = resizeHit.index;
        resizingRow = null;
        resizeStartX = px;
        resizeStartWidth = Math.round(state.colWidths.get(resizeHit.index) ?? COL_WIDTH);
      } else {
        resizingRow = resizeHit.index;
        resizingCol = null;
        resizeStartY = py;
        resizeStartHeight = Math.round(state.rowHeights.get(resizeHit.index) ?? ROW_HEIGHT);
      }
      markDirty();
      return;
    }
    const headerSelection = headerSelectionHit(px, py, state);
    if (headerSelection) {
      cvs.focus();
      headerDragMode = py <= HEADER_HEIGHT && px > GUTTER_WIDTH
        ? "col"
        : px <= GUTTER_WIDTH && py > HEADER_HEIGHT
          ? "row"
          : null;
      headerDragAnchor = headerDragMode === "col"
        ? headerSelection.startCol
        : headerDragMode === "row"
          ? headerSelection.startRow
          : null;
      setSheetsSelection(state, headerSelection);
      markDirty();
      return;
    }

    const hit = hitTest(px, py, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
    if (hit && isFormulaEditActive(state)) {
      e.preventDefault();
      const [col, row] = hit;
      setSheetsSelection(state, { startRow: row, startCol: col, endRow: row, endCol: col });
      insertEditorText(`${columnLabel(col)}${row + 1}`, state, markDirty);
      markDirty();
      return;
    }

    cvs.focus();
    pointerDown = true;
    cvs.setPointerCapture(e.pointerId);

    if (state.selection && isFillHandle(px, py, state)) {
      fillDragging = true;
      fillAnchorRange = normalizedSelection(state.selection);
      return;
    }

    if (!hit) return;
    const [col, row] = hit;
    setSheetsSelection(state, { startRow: row, startCol: col, endRow: row, endCol: col });
    markDirty();
  });

  cvs.addEventListener("pointermove", (e) => {
    const resizeHover = headerResizeHit(e.offsetX, e.offsetY, state);
    const nextHoverCol = resizeHover?.kind === "col" ? resizeHover.index : null;
    const nextHoverRow = resizeHover?.kind === "row" ? resizeHover.index : null;
    if (hoverResizeCol !== nextHoverCol || hoverResizeRow !== nextHoverRow) {
      hoverResizeCol = nextHoverCol;
      hoverResizeRow = nextHoverRow;
      markDirty();
    }
    if (!pointerDown) {
      updateCursor(cvs, e.offsetX, e.offsetY, state);
      return;
    }
    if (resizingCol !== null) {
      const newWidth = Math.max(MIN_COL_WIDTH, Math.round(resizeStartWidth + (e.offsetX - resizeStartX)));
      for (const col of resizedColumns(state, resizingCol)) {
        state.colWidths.set(col, newWidth);
      }
      markDirty();
      return;
    }
    if (resizingRow !== null) {
      const newHeight = Math.max(MIN_ROW_HEIGHT, Math.round(resizeStartHeight + (e.offsetY - resizeStartY)));
      for (const row of resizedRows(state, resizingRow)) {
        state.rowHeights.set(row, newHeight);
      }
      markDirty();
      return;
    }
    if (headerDragMode === "col" && headerDragAnchor !== null) {
      const headerSelection = headerSelectionHit(e.offsetX, Math.min(e.offsetY, HEADER_HEIGHT), state);
      if (headerSelection) {
        const endCol = headerSelection.startCol;
        setSheetsSelection(state, {
          startRow: 0,
          startCol: Math.min(headerDragAnchor, endCol),
          endRow: Math.max(0, state.rowCount - 1),
          endCol: Math.max(headerDragAnchor, endCol)
        });
        markDirty();
      }
      return;
    }
    if (headerDragMode === "row" && headerDragAnchor !== null) {
      const headerSelection = headerSelectionHit(Math.min(e.offsetX, GUTTER_WIDTH), e.offsetY, state);
      if (headerSelection) {
        const endRow = headerSelection.startRow;
        setSheetsSelection(state, {
          startRow: Math.min(headerDragAnchor, endRow),
          startCol: 0,
          endRow: Math.max(headerDragAnchor, endRow),
          endCol: Math.max(0, state.columnCount - 1)
        });
        markDirty();
      }
      return;
    }
    if (fillDragging) {
      const hit = hitTest(e.offsetX, e.offsetY, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
      if (hit && fillAnchorRange) {
        const [col, row] = hit;
        state.selection = {
          startRow: Math.min(fillAnchorRange.startRow, row),
          startCol: Math.min(fillAnchorRange.startCol, col),
          endRow: Math.max(fillAnchorRange.endRow, row),
          endCol: Math.max(fillAnchorRange.endCol, col)
        };
        markDirty();
      }
      return;
    }
    if (state.selection) {
      const hit = hitTest(e.offsetX, e.offsetY, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
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
      await executeFill(fillAnchorRange, state.selection, state);
    }
    resizingCol = null;
    resizingRow = null;
    headerDragMode = null;
    headerDragAnchor = null;
    fillAnchorRange = null;
    updateCursor(cvs, e.offsetX, e.offsetY, state);
    markDirty();
  });

  cvs.addEventListener("pointerleave", () => {
    if (pointerDown) return;
    hoverResizeCol = null;
    hoverResizeRow = null;
    headerDragMode = null;
    headerDragAnchor = null;
    cvs.style.cursor = "cell";
    markDirty();
  });

  cvs.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const px = e.offsetX;
    const py = e.offsetY;
    const headerSelection = headerSelectionHit(px, py, state);
    if (headerSelection) {
      setSheetsSelection(state, headerSelection);
      runtimeDeps?.rerender();
    } else {
      const hit = hitTest(px, py, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
      if (hit) {
        const [col, row] = hit;
        setSheetsSelection(state, { startRow: row, startCol: col, endRow: row, endCol: col });
        runtimeDeps?.rerender();
      }
    }
    markDirty();
    cvs.focus();
    showContextMenu(e.clientX, e.clientY, state);
  });

  cvs.setAttribute("tabindex", "0");
  cvs.addEventListener("keydown", async (e) => {
    if (await handleUndoRedoShortcut(e, state)) return;
    if (!state.selection) return;
    const { startRow: row, startCol: col } = state.selection;

    if (e.key === "F2" || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      startCellEdit(row, col, {
        state,
        canvasEl: cvs,
        canvasOffsetLeft: cvs.getBoundingClientRect().left,
        canvasOffsetTop: cvs.getBoundingClientRect().top,
        onCommit: async (r, c, val) => {
          await commitCellValue(r, c, val, state);
        },
        onNavigate: (dir) => navigateSelection(dir, state),
        onRepaint: markDirty
      }, e.key.length === 1 ? e.key : undefined);
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      await commitCellValue(row, col, "", state);
      return;
    }

    const arrowMap: Record<string, "right" | "left" | "down" | "up"> = {
      ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up"
    };
    const arrowDir = arrowMap[e.key];
    if (arrowDir) {
      e.preventDefault();
      navigateSelection(arrowDir, state);
    }

    if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      await copySelection(state);
    }
    if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      await pasteIntoSelection(state);
    }
  });

  cvs.addEventListener("dblclick", (e) => {
    const hit = hitTest(e.offsetX, e.offsetY, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
    if (!hit) return;
    const [col, row] = hit;
    setSheetsSelection(state, { startRow: row, startCol: col, endRow: row, endCol: col });
    const rect = cvs.getBoundingClientRect();
    startCellEdit(row, col, {
      state,
      canvasEl: cvs,
      canvasOffsetLeft: rect.left,
      canvasOffsetTop: rect.top,
      onCommit: async (r, c, val) => commitCellValue(r, c, val, state),
      onNavigate: (dir) => navigateSelection(dir, state),
      onRepaint: markDirty
    });
  });
}

async function handleUndoRedoShortcut(event: KeyboardEvent, state: SheetsToolState): Promise<boolean> {
  if (!runtimeDeps || state.pending || !state.hasWorkbook) return false;
  const primary = event.ctrlKey || event.metaKey;
  if (!primary || event.altKey) return false;

  const key = event.key.toLowerCase();
  const wantsUndo = key === "z" && !event.shiftKey;
  const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
  if (!wantsUndo && !wantsRedo) return false;

  event.preventDefault();
  if (wantsUndo) {
    if (!state.canUndo) return true;
    if (!undoSheetsViewChange(state)) await runtimeDeps.undoSheet();
  } else {
    if (!state.canRedo) return true;
    if (!redoSheetsViewChange(state)) await runtimeDeps.redoSheet();
  }
  markDirty();
  runtimeDeps.rerender();
  return true;
}

function navigateSelection(
  dir: "right" | "left" | "down" | "up" | "escape",
  state: SheetsToolState
): void {
  if (!state.selection) return;
  let { startRow: row, startCol: col } = state.selection;
  if (dir === "right")  col = Math.min(state.columnCount - 1, col + 1);
  if (dir === "left")   col = Math.max(0, col - 1);
  if (dir === "down")   row = Math.min(state.rowCount - 1, row + 1);
  if (dir === "up")     row = Math.max(0, row - 1);
  if (dir === "escape") { markDirty(); return; }
  setSheetsSelection(state, { startRow: row, startCol: col, endRow: row, endCol: col });
  runtimeDeps?.rerender();
  markDirty();
  requestAnimationFrame(() => {
    canvas?.focus();
  });
}

async function commitCellValue(
  row: number, col: number, value: string,
  state: SheetsToolState,
  deps?: SheetsRuntimeDeps
): Promise<void> {
  const usedDeps = deps || runtimeDeps;
  
  if (!usedDeps) {
    return;
  }
  
  const changes = [{ row, col, input: value }];
  const snapshot = applyOptimisticCellWrites(state, changes);
  markDirty();
  
  try {
    await usedDeps.fireSetCellInput(row, col, value);
  } catch (error) {
    revertOptimisticCellWrites(state, snapshot);
    markDirty();
  }
  usedDeps.rerender();
  requestAnimationFrame(() => {
    canvas?.focus();
  });
}

async function executeFill(
  anchor: SheetsSelection,
  target: SheetsSelection,
  state: SheetsToolState
): Promise<void> {
  if (!runtimeDeps) return;
  const normalizedAnchor = normalizedSelection(anchor);
  const normalizedTarget = normalizedSelection(target);
  const anchorHeight = normalizedAnchor.endRow - normalizedAnchor.startRow + 1;
  const anchorWidth = normalizedAnchor.endCol - normalizedAnchor.startCol + 1;

  const targetMatchesAnchor =
    normalizedTarget.startRow === normalizedAnchor.startRow &&
    normalizedTarget.startCol === normalizedAnchor.startCol &&
    normalizedTarget.endRow === normalizedAnchor.endRow &&
    normalizedTarget.endCol === normalizedAnchor.endCol;
  if (targetMatchesAnchor) return;

  for (let destRow = normalizedTarget.startRow; destRow <= normalizedTarget.endRow; destRow++) {
    for (let destCol = normalizedTarget.startCol; destCol <= normalizedTarget.endCol; destCol++) {
      const insideAnchor =
        destRow >= normalizedAnchor.startRow &&
        destRow <= normalizedAnchor.endRow &&
        destCol >= normalizedAnchor.startCol &&
        destCol <= normalizedAnchor.endCol;
      if (insideAnchor) continue;

      const srcRow = normalizedAnchor.startRow + positiveModulo(destRow - normalizedAnchor.startRow, anchorHeight);
      const srcCol = normalizedAnchor.startCol + positiveModulo(destCol - normalizedAnchor.startCol, anchorWidth);
      const value = state.cellsByKey[`${srcRow}:${srcCol}`]?.input ?? "";

      await runtimeDeps.fireCopyPasteRange(
        srcRow,
        srcCol,
        srcRow,
        srcCol,
        destRow,
        destCol,
        [[value]]
      );
    }
  }
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

async function copySelection(state: SheetsToolState): Promise<void> {
  if (!state.selection) return;
  const { startRow, startCol, endRow, endCol } = normalizedSelection(state.selection);
  const rows: string[] = [];
  for (let r = startRow; r <= endRow; r++) {
    const cols: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      cols.push(state.cellsByKey[`${r}:${c}`]?.input ?? "");
    }
    rows.push(cols.join("\t"));
  }
  // Keep an internal source range even if browser clipboard access fails so in-app
  // pastes can still preserve spreadsheet-style relative reference behavior.
  state.copySelectionSource = { startRow, startCol, endRow, endCol };
  try {
    await navigator.clipboard.writeText(rows.join("\n"));
  } catch {}
}

async function pasteIntoSelection(state: SheetsToolState): Promise<void> {
  if (!state.selection || !runtimeDeps) return;
  try {
    const text = await navigator.clipboard.readText();
    const rows = text.split("\n").map(row => row.split("\t"));
    const src = state.copySelectionSource;
    if (src) {
      await runtimeDeps.fireCopyPasteRange?.(
        src.startRow, src.startCol, src.endRow, src.endCol,
        state.selection.startRow, state.selection.startCol,
        rows
      );
    } else {
      await runtimeDeps.fireWriteRange?.(state.selection.startRow, state.selection.startCol, rows);
    }
    state.copySelectionSource = null;
  } catch {}
}

async function clearSelection(state: SheetsToolState): Promise<void> {
  if (!state.selection || !runtimeDeps) return;
  const { startRow, startCol, endRow, endCol } = normalizedSelection(state.selection);
  const values = Array.from({ length: endRow - startRow + 1 }, () =>
    Array.from({ length: endCol - startCol + 1 }, () => "")
  );
  await runtimeDeps.fireWriteRange(startRow, startCol, values);
}

function normalizedSelection(selection: SheetsSelection): SheetsSelection {
  return {
    startRow: Math.min(selection.startRow, selection.endRow),
    startCol: Math.min(selection.startCol, selection.endCol),
    endRow: Math.max(selection.startRow, selection.endRow),
    endCol: Math.max(selection.startCol, selection.endCol)
  };
}

function selectionKind(state: SheetsToolState): "cell" | "row" | "column" | "sheet" {
  if (!state.selection) return "cell";
  const sel = normalizedSelection(state.selection);
  const fullRows = sel.startCol === 0 && sel.endCol === Math.max(0, state.columnCount - 1);
  const fullCols = sel.startRow === 0 && sel.endRow === Math.max(0, state.rowCount - 1);
  if (fullRows && fullCols) return "sheet";
  if (fullRows) return "row";
  if (fullCols) return "column";
  return "cell";
}

function showContextMenu(clientX: number, clientY: number, state: SheetsToolState): void {
  if (!contextMenuEl || !runtimeDeps) return;
  const deps = runtimeDeps;
  const kind = selectionKind(state);
  const items: Array<{ label: string; disabled?: boolean; action: () => Promise<void> | void }> = [
    { label: "Cut", disabled: !state.selection, action: async () => { await copySelection(state); await clearSelection(state); } },
    { label: "Copy", disabled: !state.selection, action: async () => { await copySelection(state); } },
    { label: "Paste", disabled: !state.selection, action: async () => { await pasteIntoSelection(state); } }
  ];

  if (kind === "row" || kind === "sheet") {
    const rowIndex = state.selection ? normalizedSelection(state.selection).startRow : state.rowCount;
    items.push(
      { label: "Insert Row Above", action: async () => { await deps.insertRows(rowIndex, 1); } },
      { label: "Insert Row Below", action: async () => { await deps.insertRows(rowIndex + 1, 1); } },
      { label: "Delete Row", disabled: state.capabilities.deleteRows === false, action: async () => { await deps.deleteRows(rowIndex, 1); } }
    );
  }

  if (kind === "column" || kind === "sheet") {
    const colIndex = state.selection ? normalizedSelection(state.selection).startCol : state.columnCount;
    items.push(
      { label: "Insert Column Left", action: async () => { await deps.insertColumns(colIndex, 1); } },
      { label: "Insert Column Right", action: async () => { await deps.insertColumns(colIndex + 1, 1); } },
      { label: "Delete Column", disabled: state.capabilities.deleteCols === false, action: async () => { await deps.deleteColumns(colIndex, 1); } }
    );
  }

  contextMenuEl.replaceChildren(...items.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sheets-context-menu-item";
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", async () => {
      hideContextMenu();
      await item.action();
      deps.rerender();
      requestAnimationFrame(() => canvas?.focus());
    });
    return button;
  }));

  contextMenuEl.style.display = "grid";
  contextMenuEl.style.left = `${clientX}px`;
  contextMenuEl.style.top = `${clientY}px`;
}

function hideContextMenu(): void {
  if (!contextMenuEl) return;
  contextMenuEl.style.display = "none";
}

function isFillHandle(px: number, py: number, state: SheetsToolState): boolean {
  if (!state.selection) return false;
  const { endCol, endRow } = state.selection;
  const r = cellRect(endCol, endRow, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
  const fx = r.x + r.w - FILL_HANDLE_PX;
  const fy = r.y + r.h - FILL_HANDLE_PX;
  return px >= fx && px <= fx + FILL_HANDLE_PX + 4
      && py >= fy && py <= fy + FILL_HANDLE_PX + 4;
}

function headerResizeHit(
  px: number,
  py: number,
  state: SheetsToolState
): { kind: "col" | "row"; index: number } | null {
  const { colWidths, rowHeights, scrollX, scrollY, columnCount, rowCount } = state;
  if (py <= HEADER_HEIGHT && px > GUTTER_WIDTH) {
    const { colStart, colEnd } = visibleRange(
      canvas?.clientWidth ?? window.innerWidth,
      canvas?.clientHeight ?? window.innerHeight,
      scrollX,
      scrollY,
      columnCount,
      rowCount,
      colWidths,
      rowHeights,
      state.viewRowOrder
    );
    let x = GUTTER_WIDTH - scrollX;
    for (let col = 0; col <= colEnd; col++) {
      const w = colWidths.get(col) ?? COL_WIDTH;
      if (col >= colStart) {
        const edge = x + w;
        if (Math.abs(px - edge) <= HEADER_RESIZE_GRAB_PX) return { kind: "col", index: col };
      }
      x += w;
      if (x > px + 10) break;
    }
  }
  if (px <= GUTTER_WIDTH && py > HEADER_HEIGHT) {
    const { rowStart, rowEnd } = visibleRange(
      canvas?.clientWidth ?? window.innerWidth,
      canvas?.clientHeight ?? window.innerHeight,
      scrollX,
      scrollY,
      columnCount,
      rowCount,
      colWidths,
      rowHeights
    );
    let y = HEADER_HEIGHT - scrollY;
    for (let row = 0; row <= rowEnd; row++) {
      const actualRow = state.viewRowOrder[row] ?? row;
      const h = rowHeights.get(actualRow) ?? ROW_HEIGHT;
      if (row >= rowStart) {
        const edge = y + h;
        if (Math.abs(py - edge) <= HEADER_RESIZE_GRAB_PX) return { kind: "row", index: actualRow };
      }
      y += h;
      if (y > py + 10) break;
    }
  }
  return null;
}

function headerSelectionHit(px: number, py: number, state: SheetsToolState): SheetsSelection | null {
  if (px <= GUTTER_WIDTH && py <= HEADER_HEIGHT) {
    return {
      startRow: 0,
      startCol: 0,
      endRow: Math.max(0, state.rowCount - 1),
      endCol: Math.max(0, state.columnCount - 1)
    };
  }

  if (py <= HEADER_HEIGHT && px > GUTTER_WIDTH) {
    const hit = hitTest(px, HEADER_HEIGHT + 1, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
    if (!hit) return null;
    const [col] = hit;
    return {
      startRow: 0,
      startCol: col,
      endRow: Math.max(0, state.rowCount - 1),
      endCol: col
    };
  }

  if (px <= GUTTER_WIDTH && py > HEADER_HEIGHT) {
    const hit = hitTest(GUTTER_WIDTH + 1, py, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
    if (!hit) return null;
    const [, row] = hit;
    return {
      startRow: row,
      startCol: 0,
      endRow: row,
      endCol: Math.max(0, state.columnCount - 1)
    };
  }

  return null;
}

function updateCursor(cvs: HTMLCanvasElement, px: number, py: number, state: SheetsToolState): void {
  const resizeHit = headerResizeHit(px, py, state);
  if (resizeHit?.kind === "col") {
    cvs.style.cursor = "col-resize";
  } else if (resizeHit?.kind === "row") {
    cvs.style.cursor = "row-resize";
  } else if (headerFilterHit(px, py, state) !== null) {
    cvs.style.cursor = "pointer";
  } else if (headerSelectionHit(px, py, state)) {
    cvs.style.cursor = "pointer";
  } else if (state.selection && isFillHandle(px, py, state)) {
    cvs.style.cursor = "crosshair";
  } else {
    cvs.style.cursor = "cell";
  }
}

function headerFilterHit(px: number, py: number, state: SheetsToolState): number | null {
  if (py > HEADER_HEIGHT || px <= GUTTER_WIDTH) return null;
  const hit = hitTest(px, HEADER_HEIGHT + 1, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
  if (!hit) return null;
  const [col] = hit;
  if (!isSheetsColumnFiltered(state, col)) return null;
  const r = cellRect(col, 0, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);
  const iconLeft = r.x + r.w - 18;
  return px >= iconLeft && px <= iconLeft + 14 ? col : null;
}

function showFilterMenu(clientX: number, clientY: number, state: SheetsToolState, column: number): void {
  if (!contextMenuEl || !runtimeDeps) return;
  const filter = getSheetsColumnFilter(state, column);
  if (!filter) return;
  const items: Array<{ label: string; disabled?: boolean; action: () => void }> = [
    { label: "Sort A to Z", action: () => { setSheetsColumnFilterSort(state, column, "asc"); } },
    { label: "Sort Z to A", action: () => { setSheetsColumnFilterSort(state, column, "desc"); } },
    { label: "Clear Sort", disabled: filter.sortDirection === null, action: () => { setSheetsColumnFilterSort(state, column, null); } },
    { label: "Remove Filter", action: () => { removeSheetsColumnFilters(state, [column]); } }
  ];
  contextMenuEl.replaceChildren(...items.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sheets-context-menu-item";
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", () => {
      hideContextMenu();
      item.action();
      runtimeDeps?.rerender();
      markDirty();
    });
    return button;
  }));
  contextMenuEl.style.display = "grid";
  contextMenuEl.style.left = `${clientX}px`;
  contextMenuEl.style.top = `${clientY}px`;
}

function resizedColumns(state: SheetsToolState, targetCol: number): number[] {
  if (!state.selection) return [targetCol];
  const selection = normalizedSelection(state.selection);
  const selectsFullColumns = selection.startRow === 0 && selection.endRow === Math.max(0, state.rowCount - 1);
  if (!selectsFullColumns || targetCol < selection.startCol || targetCol > selection.endCol) {
    return [targetCol];
  }
  const cols: number[] = [];
  for (let col = selection.startCol; col <= selection.endCol; col++) cols.push(col);
  return cols;
}

function resizedRows(state: SheetsToolState, targetRow: number): number[] {
  if (!state.selection) return [targetRow];
  const selection = normalizedSelection(state.selection);
  const selectsFullRows = selection.startCol === 0 && selection.endCol === Math.max(0, state.columnCount - 1);
  if (!selectsFullRows || targetRow < selection.startRow || targetRow > selection.endRow) {
    return [targetRow];
  }
  const rows: number[] = [];
  for (let row = selection.startRow; row <= selection.endRow; row++) rows.push(row);
  return rows;
}

function buildFormulaBar(
  state: SheetsToolState,
  updateFormulaBarValue: (value: string) => void,
  commitFormulaBar: (value: string) => Promise<void>,
  modelOptions: Array<{ id: string; label: string }>,
  activeModelId: string,
  setAiModel: (modelId: string) => Promise<void>
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "sheets-formula-row";

  const label = document.createElement("div");
  label.className = "sheets-formula-label";
  label.textContent = "--";

  formulaInput = document.createElement("input");
  formulaInput.className = "field-input-soft sheets-formula-input";
  formulaInput.placeholder = "Cell input or formula";
  formulaAutocomplete?.destroy();
  formulaAutocomplete = attachFormulaAutocomplete(formulaInput, () => {
    if (!formulaInput) return;
    state.activeEditorValue = formulaInput.value;
    updateFormulaBarValue(formulaInput.value);
  });

  formulaInput.addEventListener("input", () => {
    state.activeEditorValue = formulaInput!.value;
    updateFormulaBarValue(formulaInput!.value);
  });
  formulaInput.addEventListener("keydown", async (e) => {
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && state.selection) {
      e.preventDefault();
      await commitFormulaBar(formulaInput!.value);
      markDirty();
      runtimeDeps?.rerender();
      requestAnimationFrame(() => canvas?.focus());
    }
  });

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "tool-action-btn sheets-apply-btn";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", async () => {
    if (!state.selection) return;
    await commitFormulaBar(formulaInput!.value);
    markDirty();
    runtimeDeps?.rerender();
    requestAnimationFrame(() => canvas?.focus());
  });

  row.appendChild(label);
  row.appendChild(formulaInput);
  row.appendChild(applyBtn);

  const modelWrap = document.createElement("div");
  modelWrap.className = "sheets-ai-model-wrap";

  const modelIcon = document.createElement("span");
  modelIcon.className = "sheets-ai-model-icon";
  modelIcon.innerHTML = iconHtml(APP_ICON.brand, { size: 16, tone: "dark" });
  modelWrap.appendChild(modelIcon);

  const modelSelect = document.createElement("select");
  formulaModelSelect = modelSelect;
  modelSelect.className = "field-select sheets-ai-model-select";
  modelSelect.title = "Select AI formula model";
  const options = modelOptions.length ? modelOptions : [{ id: "local:runtime", label: "local/default" }];
  modelSelect.replaceChildren(
    ...options.map((option) => {
      const el = document.createElement("option");
      el.value = option.id;
      el.textContent = option.label;
      if (option.id === activeModelId) el.selected = true;
      return el;
    })
  );
  modelSelect.addEventListener("change", async () => {
    await setAiModel(modelSelect.value);
    markDirty();
    runtimeDeps?.rerender();
  });
  modelWrap.appendChild(modelSelect);
  row.appendChild(modelWrap);
  return row;
}

function syncFormulaBar(state: SheetsToolState): void {
  if (!formulaInput) return;
  formulaInput.value = state.activeEditorValue;
  if (document.activeElement === formulaInput) formulaAutocomplete?.refresh();
  else formulaAutocomplete?.close();
  if (formulaModelSelect && formulaModelSelect.value !== state.aiModelId) {
    formulaModelSelect.value = state.aiModelId;
  }
  const labelEl = formulaInput.previousElementSibling as HTMLElement | null;
  if (labelEl) {
    const sel = state.selection;
    if (!sel) { labelEl.textContent = "--"; return; }
    const { startCol, startRow, endCol, endRow } = sel;
    const start = `${selectedCellLabel({ startRow, startCol, endRow, endCol }).split(":")[0]}`;
    labelEl.textContent = start;
  }
}
