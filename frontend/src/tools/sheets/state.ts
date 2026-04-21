export type SheetsCellKind = "empty" | "text" | "number" | "boolean" | "error";

export interface SheetsUsedRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SheetsCellSnapshot {
  row: number;
  col: number;
  input: string;
  display: string;
  kind: SheetsCellKind;
  error: string | null;
}

export interface SheetsSelection {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SheetsViewportState {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SheetsSheetSnapshot {
  rowCount: number;
  columnCount: number;
  usedRange: SheetsUsedRange | null;
  dirty: boolean;
  revision: number;
  cells?: SheetsCellSnapshot[];
}

export interface SheetsOpenSheetResult {
  filePath: string;
  fileName: string;
  sheet: SheetsSheetSnapshot;
  capabilities: Record<string, boolean>;
  aiModelId: string;
}

export interface SheetsInspectResult {
  filePath: string | null;
  fileName: string | null;
  rowCount: number;
  columnCount: number;
  usedRange: SheetsUsedRange | null;
  dirty: boolean;
  revision: number;
  aiModelId: string;
  capabilities?: Record<string, boolean>;
}

export interface SheetsReadRangeResult {
  cells: SheetsCellSnapshot[];
}

export interface SheetsToolState {
  hasWorkbook: boolean;
  filePath: string | null;
  fileName: string | null;
  rowCount: number;
  columnCount: number;
  usedRange: SheetsUsedRange | null;
  dirty: boolean;
  revision: number;
  aiModelId: string;
  cellsByKey: Record<string, SheetsCellSnapshot>;
  selection: SheetsSelection | null;
  activeEditorValue: string;
  pending: boolean;
  lastError: string | null;
  statusMessage: string | null;
  viewport: SheetsViewportState;
  sourceKind: string;
  capabilities: Record<string, boolean>;
  scrollX: number;
  scrollY: number;
  colWidths: Map<number, number>;
  rowHeights: Map<number, number>;
  editingCell: { row: number; col: number } | null;
}

export function getInitialSheetsState(): SheetsToolState {
  return {
    hasWorkbook: false,
    filePath: null,
    fileName: null,
    rowCount: 0,
    columnCount: 0,
    usedRange: null,
    dirty: false,
    revision: 0,
    aiModelId: "local:runtime",
    cellsByKey: {},
    selection: null,
    activeEditorValue: "",
    pending: false,
    lastError: null,
    statusMessage: null,
    viewport: {
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0
    },
    sourceKind: "csv",
    capabilities: {},
    scrollX: 0,
    scrollY: 0,
    colWidths: new Map(),
    rowHeights: new Map(),
    editingCell: null
  };
}

export function sheetsCellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function getSheetsCell(
  slice: Pick<SheetsToolState, "cellsByKey">,
  row: number,
  col: number
): SheetsCellSnapshot | null {
  return slice.cellsByKey[sheetsCellKey(row, col)] ?? null;
}

export function applyOptimisticCellWrites(
  slice: SheetsToolState,
  changes: Array<{ row: number; col: number; input: string }>
): Record<string, SheetsCellSnapshot | undefined> {
  const snapshot: Record<string, SheetsCellSnapshot | undefined> = {};
  for (const change of changes) {
    const key = sheetsCellKey(change.row, change.col);
    snapshot[key] = slice.cellsByKey[key];
    const existing = slice.cellsByKey[key];
    // For optimistic update: display = input (formula results will be recalculated by backend)
    slice.cellsByKey[key] = {
      row: change.row,
      col: change.col,
      input: change.input,
      display: change.input, // Show the input immediately
      kind: existing?.kind ?? (change.input ? "text" : "empty"),
      error: null
    };
  }
  slice.dirty = true;
  syncEditorValue(slice);
  return snapshot;
}

export function revertOptimisticCellWrites(
  slice: SheetsToolState,
  snapshot: Record<string, SheetsCellSnapshot | undefined>
): void {
  for (const [key, cell] of Object.entries(snapshot)) {
    if (cell) {
      slice.cellsByKey[key] = cell;
    } else {
      delete slice.cellsByKey[key];
    }
  }
  syncEditorValue(slice);
}

export function replaceSheetsCells(slice: SheetsToolState, cells: SheetsCellSnapshot[]): void {
  const next: Record<string, SheetsCellSnapshot> = {};
  for (const cell of cells) {
    next[sheetsCellKey(cell.row, cell.col)] = cell;
  }
  slice.cellsByKey = next;
}

export function mergeSheetsCells(slice: SheetsToolState, cells: SheetsCellSnapshot[]): void {
  for (const cell of cells) {
    slice.cellsByKey[sheetsCellKey(cell.row, cell.col)] = cell;
  }
}

export function applySheetsSnapshotMeta(
  slice: SheetsToolState,
  meta: Pick<SheetsInspectResult, "filePath" | "fileName" | "rowCount" | "columnCount" | "usedRange" | "dirty" | "revision" | "aiModelId">
): void {
  slice.hasWorkbook = true;
  slice.filePath = meta.filePath;
  slice.fileName = meta.fileName;
  slice.rowCount = meta.rowCount;
  slice.columnCount = meta.columnCount;
  slice.usedRange = meta.usedRange;
  slice.dirty = meta.dirty;
  slice.revision = meta.revision;
  slice.aiModelId = meta.aiModelId;
  syncViewport(slice);
  syncEditorValue(slice);
}

export function clearSheetsWorkbook(slice: SheetsToolState): void {
  const initial = getInitialSheetsState();
  Object.assign(slice, initial);
}

export function setSheetsSelection(slice: SheetsToolState, selection: SheetsSelection | null): void {
  slice.selection = selection;
  syncEditorValue(slice);
}

export function syncEditorValue(slice: SheetsToolState): void {
  const selection = slice.selection;
  if (!selection) {
    slice.activeEditorValue = "";
    return;
  }
  const cell = getSheetsCell(slice, selection.startRow, selection.startCol);
  slice.activeEditorValue = cell?.input ?? "";
}

export function syncViewport(slice: SheetsToolState): void {
  slice.viewport = {
    startRow: 0,
    startCol: 0,
    endRow: Math.max(0, slice.rowCount - 1),
    endCol: Math.max(0, slice.columnCount - 1)
  };
}
