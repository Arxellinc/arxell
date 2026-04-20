import { SHEETS_DATA_ATTR } from "../ui/constants.js";
import type { SheetsToolState } from "./state.js";

interface SheetsBindingsDeps {
  createNewSheet: () => Promise<void>;
  openSheetWithDialog: () => Promise<void>;
  saveSheetCurrent: () => Promise<void>;
  saveSheetWithDialog: () => Promise<void>;
  insertRows: (index: number, count?: number) => Promise<void>;
  insertColumns: (index: number, count?: number) => Promise<void>;
  deleteRows: (index: number, count?: number) => Promise<void>;
  deleteColumns: (index: number, count?: number) => Promise<void>;
}

export async function handleSheetsClick(
  target: HTMLElement,
  slice: SheetsToolState,
  deps: SheetsBindingsDeps
): Promise<boolean> {
  const action = target.getAttribute(SHEETS_DATA_ATTR.action);
  if (!action) return false;
  if (action === "open-sheet") {
    await deps.openSheetWithDialog();
    return true;
  }
  if (action === "new-sheet") {
    await deps.createNewSheet();
    return true;
  }
  if (action === "focus-sheet") {
    return true;
  }
  if (action === "save-sheet") {
    await deps.saveSheetCurrent();
    return true;
  }
  if (action === "save-sheet-as") {
    await deps.saveSheetWithDialog();
    return true;
  }
  if (isDisplayOnlyToolbarAction(action)) {
    return true;
  }
  if (action === "add-row") {
    if (!checkCapability(slice, "insertRows")) return true;
    const index = slice.selection ? slice.selection.endRow + 1 : slice.rowCount;
    await deps.insertRows(index, 1);
    return true;
  }
  if (action === "add-column") {
    if (!checkCapability(slice, "insertCols")) return true;
    const index = slice.selection ? slice.selection.endCol + 1 : slice.columnCount;
    await deps.insertColumns(index, 1);
    return true;
  }
  if (action === "delete-row") {
    if (!slice.selection) return true;
    if (!checkCapability(slice, "deleteRows")) return true;
    const confirmed = window.confirm(`Delete row ${slice.selection.startRow + 1}?`);
    if (!confirmed) return true;
    await deps.deleteRows(slice.selection.startRow, 1);
    return true;
  }
  if (action === "delete-column") {
    if (!slice.selection) return true;
    if (!checkCapability(slice, "deleteCols")) return true;
    const confirmed = window.confirm(`Delete column ${slice.selection.startCol + 1}?`);
    if (!confirmed) return true;
    await deps.deleteColumns(slice.selection.startCol, 1);
    return true;
  }
  return false;
}

function isDisplayOnlyToolbarAction(action: string): boolean {
  return (
    action === "undo" ||
    action === "redo" ||
    action === "format-currency" ||
    action === "format-percent" ||
    action === "format-number" ||
    action === "format-date" ||
    action === "format-datetime" ||
    action === "style-bold" ||
    action === "style-italic" ||
    action === "style-strikethrough" ||
    action === "create-filter" ||
    action === "freeze-first-row" ||
    action === "hyperlink"
  );
}

function checkCapability(slice: SheetsToolState, key: string): boolean {
  if (!slice.capabilities || slice.capabilities[key] !== false) return true;
  window.alert(`This action is not supported for the current sheet format.`);
  return false;
}
