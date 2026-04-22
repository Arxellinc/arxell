import { cellRect } from "./viewport.js";
import { syncEditorValue, type SheetsToolState } from "../state.js";
import { attachFormulaAutocomplete, type FormulaAutocompleteBinding } from "../formulaAutocomplete.js";

export interface EditorDeps {
  state: SheetsToolState;
  canvasEl: HTMLCanvasElement;
  canvasOffsetLeft: number;
  canvasOffsetTop: number;
  onCommit: (row: number, col: number, value: string) => Promise<void>;
  onNavigate: (direction: "right" | "down" | "up" | "left" | "escape") => void;
  onRepaint: () => void;
}

let inputEl: HTMLInputElement | null = null;
let commitInFlight = false;
let autocomplete: FormulaAutocompleteBinding | null = null;

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
  container.appendChild(inputEl);
  autocomplete = attachFormulaAutocomplete(inputEl, () => {
    if (!inputEl) return;
    const editingCell = currentEditingCell;
    if (!editingCell) return;
    editingCell.state.activeEditorValue = inputEl.value;
  });
  return inputEl;
}

let currentEditingCell: { state: SheetsToolState; row: number; col: number } | null = null;

export function startCellEdit(row: number, col: number, deps: EditorDeps, initialChar?: string): void {
  if (!inputEl) return;
  const { state } = deps;
  const r = cellRect(col, row, state.scrollX, state.scrollY, state.colWidths, state.rowHeights, state.viewRowOrder);

  state.editingCell = { row, col };
  currentEditingCell = { state, row, col };

  inputEl.style.left = `${r.x}px`;
  inputEl.style.top = `${r.y}px`;
  inputEl.style.width = `${r.w}px`;
  inputEl.style.height = `${r.h}px`;
  inputEl.style.display = "block";

  const cell = deps.state.cellsByKey[`${row}:${col}`];
  inputEl.value = initialChar ?? cell?.input ?? "";
  inputEl.onkeydown = async (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === "Enter") {
      e.preventDefault();
      await commitEdit(row, col, deps);
      deps.onNavigate("down");
      deps.canvasEl.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      await commitEdit(row, col, deps);
      deps.onNavigate(e.shiftKey ? "left" : "right");
      deps.canvasEl.focus();
    } else if (e.key === "Escape") {
      cancelEdit(deps);
      deps.onNavigate("escape");
      deps.canvasEl.focus();
    }
  };

  inputEl.oninput = () => {
    state.activeEditorValue = inputEl!.value;
    autocomplete?.refresh();
    deps.onRepaint();
  };

  inputEl.onblur = () => {
    if (commitInFlight || state.editingCell?.row !== row || state.editingCell?.col !== col) {
      return;
    }
    void commitEdit(row, col, deps);
  };

  inputEl.focus();
  if (!initialChar) inputEl.select();
  autocomplete?.refresh();
}

export function isFormulaEditActive(state: SheetsToolState): boolean {
  return Boolean(inputEl && state.editingCell && inputEl.style.display !== "none" && inputEl.value.startsWith("="));
}

export function insertEditorText(text: string, state: SheetsToolState, onRepaint: () => void): void {
  if (!inputEl || !state.editingCell || inputEl.style.display === "none") return;

  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? start;
  inputEl.value = `${inputEl.value.slice(0, start)}${text}${inputEl.value.slice(end)}`;
  const nextCaret = start + text.length;
  inputEl.setSelectionRange(nextCaret, nextCaret);
  state.activeEditorValue = inputEl.value;
  onRepaint();
  inputEl.focus();
}

export async function commitEdit(row: number, col: number, deps: EditorDeps): Promise<void> {
  if (!inputEl || commitInFlight) {
    return;
  }
  commitInFlight = true;
  const value = inputEl.value;
  hideEditorOverlay(deps.state);
  deps.onRepaint();
  try {
    await deps.onCommit(row, col, value);
  } finally {
    commitInFlight = false;
  }
}

export function cancelEdit(deps: EditorDeps): void {
  hideEditorOverlay(deps.state);
  deps.onRepaint();
}

function hideEditorOverlay(state: SheetsToolState): void {
  if (!inputEl) return;
  inputEl.onblur = null;
  inputEl.onkeydown = null;
  inputEl.oninput = null;
  inputEl.style.display = "none";
  inputEl.value = "";
  state.editingCell = null;
  currentEditingCell = null;
  autocomplete?.close();
  syncEditorValue(state);
}
