import type { ChatIpcClient } from "../../ipcClient.js";
import { ensureUserProject, getActiveProjectName, getUserProjectRoots } from "../../projects.js";
import {
  applySheetsSnapshotMeta,
  clearSheetsWorkbook,
  mergeSheetsCells,
  replaceSheetsCells,
  resetSheetsViewState,
  syncEditorValue,
  type SheetsCellSnapshot,
  type SheetsInspectResult,
  type SheetsOpenSheetResult,
  type SheetsReadRangeResult,
  type SheetsToolState,
  type SheetsUsedRange
} from "./state.js";

interface SheetsDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
}

interface ToolInvokeResponse<T> {
  ok: boolean;
  data: T;
  error?: string;
}

export async function openSheetWithDialog(slice: SheetsToolState, deps: SheetsDeps): Promise<void> {
  const requested = await pickOpenSheetPath(slice.filePath || undefined, deps);
  if (!requested) return;
  await openSheet(slice, deps, requested);
}

export async function createNewSheet(slice: SheetsToolState, deps: SheetsDeps): Promise<void> {
  if (!deps.client) {
    slice.lastError = "Sheets IPC client is unavailable.";
    slice.statusMessage = null;
    return;
  }
  slice.pending = true;
  slice.lastError = null;
  slice.statusMessage = "Creating sheet...";
  try {
    const meta = await invokeSheets<SheetsInspectResult>(deps, "new_sheet", {});
    resetSheetsViewState(slice);
    applySheetsSnapshotMeta(slice, meta);
    if (meta.capabilities && Object.keys(meta.capabilities).length > 0) {
      slice.capabilities = meta.capabilities;
      slice.sourceKind = inferSourceKind(meta.capabilities);
    } else {
      slice.capabilities = {};
      slice.sourceKind = "csv";
    }
    replaceSheetsCells(slice, []);
    syncEditorValue(slice);
    slice.statusMessage = "New Sheet";
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
    slice.statusMessage = null;
  } finally {
    slice.pending = false;
  }
}

export async function saveSheetWithDialog(slice: SheetsToolState, deps: SheetsDeps): Promise<void> {
  if (!slice.hasWorkbook) return;
  const requested = await pickSaveSheetPath(
    slice.filePath || slice.fileName || `sheet${sheetExtension(slice.sourceKind)}`,
    slice.sourceKind,
    deps
  );
  if (!requested) return;
  await saveSheet(slice, deps, requested);
}

export async function saveSheetCurrent(slice: SheetsToolState, deps: SheetsDeps): Promise<void> {
  if (!slice.hasWorkbook) return;
  if (!slice.filePath) {
    await saveSheetWithDialog(slice, deps);
    return;
  }
  await saveSheet(slice, deps, slice.filePath);
}

export async function openSheet(slice: SheetsToolState, deps: SheetsDeps, path: string): Promise<void> {
  if (!deps.client) return;
  slice.pending = true;
  slice.lastError = null;
  slice.statusMessage = "Opening sheet...";
  try {
    const response = await invokeSheets<SheetsOpenSheetResult>(deps, "open_sheet", { path });
    resetSheetsViewState(slice);
    applySheetsSnapshotMeta(slice, {
      filePath: response.filePath,
      fileName: response.fileName,
      rowCount: response.sheet.rowCount,
      columnCount: response.sheet.columnCount,
      usedRange: response.sheet.usedRange,
      dirty: response.sheet.dirty,
      revision: response.sheet.revision,
      aiModelId: response.aiModelId,
      canUndo: response.canUndo ?? false,
      canRedo: response.canRedo ?? false
    });
    slice.capabilities = response.capabilities ?? {};
    slice.sourceKind = Object.keys(response.capabilities ?? {}).length > 0
      ? inferSourceKind(response.capabilities)
      : "csv";
    replaceSheetsCells(slice, response.sheet.cells || []);
    syncEditorValue(slice);
    slice.statusMessage = `Opened ${response.fileName}`;
  } catch (error) {
    clearSheetsWorkbook(slice);
    slice.lastError = error instanceof Error ? error.message : String(error);
    slice.statusMessage = null;
  } finally {
    slice.pending = false;
  }
}

export async function saveSheet(
  slice: SheetsToolState,
  deps: SheetsDeps,
  path: string | null
): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  slice.pending = true;
  slice.lastError = null;
  slice.statusMessage = "Saving sheet...";
  try {
    const response = await invokeSheets<{ filePath: string; rowCount: number; columnCount: number }>(
      deps,
      "save_sheet",
      { path }
    );
    slice.filePath = response.filePath;
    slice.fileName = basename(response.filePath);
    slice.statusMessage = `Saved ${slice.fileName}`;
    await refreshSheetSnapshot(slice, deps);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
    slice.statusMessage = null;
  } finally {
    slice.pending = false;
  }
}

export async function refreshSheetSnapshot(slice: SheetsToolState, deps: SheetsDeps): Promise<void> {
  if (!deps.client) {
    slice.lastError = "Sheets IPC client is unavailable.";
    return;
  }
  try {
    const meta = await invokeSheets<SheetsInspectResult>(deps, "inspect_sheet", {});
    applySheetsSnapshotMeta(slice, meta);
    if (meta.capabilities && Object.keys(meta.capabilities).length > 0) {
      slice.capabilities = meta.capabilities;
      slice.sourceKind = inferSourceKind(meta.capabilities);
    }
    const cells = await loadUsedRangeCells(deps, meta.usedRange);
    replaceSheetsCells(slice, cells);
    syncEditorValue(slice);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no sheet is open")) {
      await createNewSheet(slice, deps);
      return;
    }
    slice.lastError = message;
  }
}

export async function setAiModel(slice: SheetsToolState, deps: SheetsDeps, modelId: string): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  slice.pending = true;
  slice.lastError = null;
  try {
    const meta = await invokeSheets<SheetsInspectResult>(deps, "set_ai_model", { modelId });
    applySheetsSnapshotMeta(slice, meta);
    const cells = await loadUsedRangeCells(deps, meta.usedRange);
    replaceSheetsCells(slice, cells);
    syncEditorValue(slice);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    slice.pending = false;
  }
}

export async function readVisibleRange(slice: SheetsToolState, deps: SheetsDeps): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  try {
    const cells = await loadUsedRangeCells(deps, slice.usedRange);
    replaceSheetsCells(slice, cells);
    syncEditorValue(slice);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
  }
}

export async function setCellInput(
  slice: SheetsToolState,
  deps: SheetsDeps,
  row: number,
  col: number,
  input: string
): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) {
    throw new Error("Sheets IPC client is unavailable or no workbook is open.");
  }
  slice.lastError = null;
  const isAiFormula = looksLikeAiFormula(input);
  if (isAiFormula) {
    mergeSheetsCells(slice, [{
      row,
      col,
      input,
      display: "Processing...",
      kind: "text",
      error: null
    }]);
    syncEditorValue(slice);
    slice.statusMessage = "Processing AI formula...";
  }
  try {
    const result = await invokeSheets<{ revision: number; updatedCells: SheetsCellSnapshot[]; dirty: boolean }>(deps, "set_cell", {
      row,
      col,
      input,
      source: "user"
    });
    slice.dirty = result.dirty;
    slice.revision = result.revision;
    mergeSheetsCells(slice, result.updatedCells);
    syncEditorValue(slice);
    if (isAiFormula) slice.statusMessage = null;
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
    if (isAiFormula) slice.statusMessage = null;
    throw error;
  }
}

function looksLikeAiFormula(input: string): boolean {
  return /^\s*=\s*AI\s*\(/i.test(input);
}

export async function writeRange(
  slice: SheetsToolState,
  deps: SheetsDeps,
  startRow: number,
  startCol: number,
  values: string[][]
): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) {
    throw new Error("Sheets IPC client is unavailable or no workbook is open.");
  }
  slice.lastError = null;
  try {
    const result = await invokeSheets<{ revision: number; updatedRange: { startRow: number; startCol: number; endRow: number; endCol: number } | null; dirty: boolean }>(deps, "write_range", {
      startRow,
      startCol,
      values,
      source: "user"
    });
    slice.dirty = result.dirty;
    slice.revision = result.revision;

    // Read back updated cells to get formula results
    if (result.updatedRange) {
      const readResult = await invokeSheets<{ cells: SheetsCellSnapshot[] }>(deps, "read_range", {
        startRow: result.updatedRange.startRow,
        startCol: result.updatedRange.startCol,
        endRow: result.updatedRange.endRow,
        endCol: result.updatedRange.endCol
      });
      mergeSheetsCells(slice, readResult.cells);
      syncEditorValue(slice);
    }
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function copyPasteRange(
  slice: SheetsToolState,
  deps: SheetsDeps,
  srcStartRow: number,
  srcStartCol: number,
  srcEndRow: number,
  srcEndCol: number,
  destStartRow: number,
  destStartCol: number,
  values: string[][]
): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) {
    throw new Error("Sheets IPC client is unavailable or no workbook is open.");
  }
  slice.lastError = null;
  try {
    const result = await invokeSheets<{ revision: number; updatedRange: { startRow: number; startCol: number; endRow: number; endCol: number } | null; dirty: boolean }>(deps, "copy_paste_range", {
      srcStartRow,
      srcStartCol,
      srcEndRow,
      srcEndCol,
      destStartRow,
      destStartCol,
      values,
      source: "user"
    });
    slice.dirty = result.dirty;
    slice.revision = result.revision;

    if (result.updatedRange) {
      const readResult = await invokeSheets<{ cells: SheetsCellSnapshot[] }>(deps, "read_range", {
        startRow: result.updatedRange.startRow,
        startCol: result.updatedRange.startCol,
        endRow: result.updatedRange.endRow,
        endCol: result.updatedRange.endCol
      });
      mergeSheetsCells(slice, readResult.cells);
      syncEditorValue(slice);
    }
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function insertRows(
  slice: SheetsToolState,
  deps: SheetsDeps,
  index: number,
  count = 1
): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  slice.pending = true;
  slice.lastError = null;
  try {
    await invokeSheets(deps, "insert_rows", {
      index,
      count,
      source: "user"
    });
    await refreshSheetSnapshot(slice, deps);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    slice.pending = false;
  }
}

export async function insertColumns(
  slice: SheetsToolState,
  deps: SheetsDeps,
  index: number,
  count = 1
): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  slice.pending = true;
  slice.lastError = null;
  try {
    await invokeSheets(deps, "insert_columns", {
      index,
      count,
      source: "user"
    });
    await refreshSheetSnapshot(slice, deps);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    slice.pending = false;
  }
}

export async function deleteRows(
  slice: SheetsToolState,
  deps: SheetsDeps,
  index: number,
  count = 1
): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  slice.pending = true;
  slice.lastError = null;
  try {
    await invokeSheets(deps, "delete_rows", {
      index,
      count,
      source: "user"
    });
    await refreshSheetSnapshot(slice, deps);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    slice.pending = false;
  }
}

export async function deleteColumns(
  slice: SheetsToolState,
  deps: SheetsDeps,
  index: number,
  count = 1
): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  slice.pending = true;
  slice.lastError = null;
  try {
    await invokeSheets(deps, "delete_columns", {
      index,
      count,
      source: "user"
    });
    await refreshSheetSnapshot(slice, deps);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    slice.pending = false;
  }
}

export async function undo(slice: SheetsToolState, deps: SheetsDeps): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  slice.pending = true;
  slice.lastError = null;
  try {
    await invokeSheets(deps, "undo", {});
    await refreshSheetSnapshot(slice, deps);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    slice.pending = false;
  }
}

export async function redo(slice: SheetsToolState, deps: SheetsDeps): Promise<void> {
  if (!deps.client || !slice.hasWorkbook) return;
  slice.pending = true;
  slice.lastError = null;
  try {
    await invokeSheets(deps, "redo", {});
    await refreshSheetSnapshot(slice, deps);
  } catch (error) {
    slice.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    slice.pending = false;
  }
}

async function loadUsedRangeCells(
  deps: SheetsDeps,
  usedRange: SheetsUsedRange | null
): Promise<SheetsCellSnapshot[]> {
  if (!usedRange) return [];
  const response = await invokeSheets<SheetsReadRangeResult>(deps, "read_range", {
    startRow: usedRange.startRow,
    startCol: usedRange.startCol,
    endRow: usedRange.endRow,
    endCol: usedRange.endCol
  });
  return response.cells;
}

async function invokeSheets<T>(
  deps: SheetsDeps,
  action: string,
  payload: Record<string, unknown>
): Promise<T> {
  if (!deps.client) {
    throw new Error("Sheets IPC client is unavailable.");
  }
  const correlationId = deps.nextCorrelationId();
  const response = (await deps.client.toolInvoke({
    correlationId,
    toolId: "sheets",
    action,
    mode: "sandbox",
    payload
  })) as ToolInvokeResponse<T>;
  if (!response.ok) {
    throw new Error(extractSheetsErrorMessage(response.error));
  }
  return response.data;
}

function extractSheetsErrorMessage(value: string | undefined): string {
  if (!value) return "Sheets request failed.";
  try {
    const parsed = JSON.parse(value) as { message?: string };
    if (typeof parsed?.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Fall back to raw string.
  }
  return value;
}

async function pickOpenSheetPath(defaultPath: string | undefined, deps: SheetsDeps): Promise<string | null> {
  const resolvedDefaultPath = defaultPath || await getDefaultSheetsPath(deps, "sheet.csv");
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
          title: "Open Sheet",
          directory: false,
          multiple: false,
          defaultPath: resolvedDefaultPath
        }
      });
      if (Array.isArray(selected)) return selected[0] ?? null;
      return selected;
    } catch {
      // Fall back to prompt.
    }
  }
  const entered = window.prompt("Open sheet path", resolvedDefaultPath)?.trim();
  return entered || null;
}

async function pickSaveSheetPath(defaultPath: string, sourceKind: string, deps: SheetsDeps): Promise<string | null> {
  const filters = saveDialogFilters(sourceKind);
  const resolvedDefaultPath = await getDefaultSheetsPath(deps, defaultPath);
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | null>("plugin:dialog|save", {
        options: {
          title: "Save Sheet",
          defaultPath: ensurePathExtension(resolvedDefaultPath, sheetExtension(sourceKind)),
          filters
        }
      });
      return selected ? ensurePathExtension(selected, sheetExtension(sourceKind)) : null;
    } catch {
      // Fall back to prompt.
    }
  }
  const entered = window.prompt(
    `Save Sheet (${filters.map(filter => `${filter.name}: ${filter.extensions.map(ext => `.${ext}`).join(", ")}`).join(" | ")})`,
    ensurePathExtension(resolvedDefaultPath, sheetExtension(sourceKind))
  )?.trim();
  return entered ? ensurePathExtension(entered, sheetExtension(sourceKind)) : null;
}

async function getDefaultSheetsPath(deps: SheetsDeps, fileName: string): Promise<string> {
  const normalizedFileName = basename(fileName || "sheet.csv") || "sheet.csv";
  if (!deps.client) return normalizedFileName;
  const activeProjectName = getActiveProjectName();
  if (activeProjectName) {
    const project = await ensureUserProject(deps.client, deps.nextCorrelationId(), activeProjectName);
    return joinPath(project.sheetsPath, normalizedFileName);
  }
  const roots = await getUserProjectRoots(deps.client, deps.nextCorrelationId());
  return joinPath(roots.projectsRoot, normalizedFileName);
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name.replace(/^[/\\]+/, "")}`;
}

function saveDialogFilters(sourceKind: string): Array<{ name: string; extensions: string[] }> {
  if (sourceKind === "nativeJsonl") {
    return [{ name: "Native Sheets", extensions: ["jsonl"] }];
  }
  if (sourceKind === "sqliteTable") {
    return [{ name: "SQLite", extensions: ["sqlite"] }];
  }
  return [{ name: "CSV", extensions: ["csv"] }];
}

function sheetExtension(sourceKind: string): string {
  if (sourceKind === "nativeJsonl") return ".jsonl";
  if (sourceKind === "sqliteTable") return ".sqlite";
  return ".csv";
}

function ensurePathExtension(path: string, extension: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const dir = lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : "";
  const file = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  if (!file) return `${trimmed}${normalizedExtension}`;
  if (/\.[^./\\]+$/.test(file)) {
    return `${dir}${file.replace(/\.[^./\\]+$/, normalizedExtension)}`;
  }
  return `${trimmed}${normalizedExtension}`;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function inferSourceKind(capabilities: Record<string, boolean>): string {
  if (capabilities.formulas && capabilities.styles && capabilities.merges) return "nativeJsonl";
  if (capabilities.typed_cells && capabilities.transactions && !capabilities.formulas) return "sqliteTable";
  return "csv";
}
