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

export interface SheetsColumnFilter {
  column: number;
  sortDirection: "asc" | "desc" | null;
}

type SheetsColumnFilterSnapshot = SheetsColumnFilter[];

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
  canUndo?: boolean;
  canRedo?: boolean;
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
  canUndo?: boolean;
  canRedo?: boolean;
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
  backendCanUndo: boolean;
  backendCanRedo: boolean;
  canUndo: boolean;
  canRedo: boolean;
  scrollX: number;
  scrollY: number;
  colWidths: Map<number, number>;
  rowHeights: Map<number, number>;
  editingCell: { row: number; col: number } | null;
  copySelectionSource: SheetsSelection | null;
  columnFilters: SheetsColumnFilter[];
  viewRowOrder: number[];
  filterUndoStack: SheetsColumnFilterSnapshot[];
  filterRedoStack: SheetsColumnFilterSnapshot[];
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
    backendCanUndo: false,
    backendCanRedo: false,
    canUndo: false,
    canRedo: false,
    scrollX: 0,
    scrollY: 0,
    colWidths: new Map(),
    rowHeights: new Map(),
    editingCell: null,
    copySelectionSource: null,
    columnFilters: [],
    viewRowOrder: [],
    filterUndoStack: [],
    filterRedoStack: []
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
  recomputeSheetsView(slice);
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
  recomputeSheetsView(slice);
  syncEditorValue(slice);
}

export function replaceSheetsCells(slice: SheetsToolState, cells: SheetsCellSnapshot[]): void {
  const next: Record<string, SheetsCellSnapshot> = {};
  for (const cell of cells) {
    next[sheetsCellKey(cell.row, cell.col)] = cell;
  }
  slice.cellsByKey = next;
  recomputeSheetsView(slice);
}

export function mergeSheetsCells(slice: SheetsToolState, cells: SheetsCellSnapshot[]): void {
  for (const cell of cells) {
    slice.cellsByKey[sheetsCellKey(cell.row, cell.col)] = cell;
  }
  recomputeSheetsView(slice);
}

export function applySheetsSnapshotMeta(
  slice: SheetsToolState,
  meta: Pick<SheetsInspectResult, "filePath" | "fileName" | "rowCount" | "columnCount" | "usedRange" | "dirty" | "revision" | "aiModelId" | "canUndo" | "canRedo">
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
  slice.backendCanUndo = meta.canUndo ?? false;
  slice.backendCanRedo = meta.canRedo ?? false;
  syncViewport(slice);
  recomputeSheetsView(slice);
  syncEditorValue(slice);
}

export function clearSheetsWorkbook(slice: SheetsToolState): void {
  const initial = getInitialSheetsState();
  Object.assign(slice, initial);
}

export function resetSheetsViewState(slice: SheetsToolState): void {
  slice.columnFilters = [];
  slice.viewRowOrder = [];
  slice.filterUndoStack = [];
  slice.filterRedoStack = [];
  syncUndoRedoAvailability(slice);
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

export function getSelectedSheetColumns(slice: Pick<SheetsToolState, "selection" | "rowCount">): number[] {
  const selection = slice.selection;
  if (!selection) return [];
  const startRow = Math.min(selection.startRow, selection.endRow);
  const endRow = Math.max(selection.startRow, selection.endRow);
  if (startRow !== 0 || endRow !== Math.max(0, slice.rowCount - 1)) return [];
  const startCol = Math.min(selection.startCol, selection.endCol);
  const endCol = Math.max(selection.startCol, selection.endCol);
  const columns: number[] = [];
  for (let col = startCol; col <= endCol; col++) columns.push(col);
  return columns;
}

export function getSheetsColumnFilter(
  slice: Pick<SheetsToolState, "columnFilters">,
  column: number
): SheetsColumnFilter | null {
  return slice.columnFilters.find((filter) => filter.column === column) ?? null;
}

export function isSheetsColumnFiltered(
  slice: Pick<SheetsToolState, "columnFilters">,
  column: number
): boolean {
  return getSheetsColumnFilter(slice, column) !== null;
}

export function areSheetsColumnsFiltered(
  slice: Pick<SheetsToolState, "columnFilters">,
  columns: number[]
): boolean {
  return columns.length > 0 && columns.every((column) => isSheetsColumnFiltered(slice, column));
}

export function addSheetsColumnFilters(slice: SheetsToolState, columns: number[]): boolean {
  const previous = cloneColumnFilters(slice.columnFilters);
  let changed = false;
  for (const column of columns) {
    if (column < 0 || column >= slice.columnCount) continue;
    if (slice.columnFilters.some((filter) => filter.column === column)) continue;
    slice.columnFilters.push({ column, sortDirection: null });
    changed = true;
  }
  if (changed) {
    pushFilterUndoState(slice, previous);
    recomputeSheetsView(slice);
  }
  return changed;
}

export function removeSheetsColumnFilters(slice: SheetsToolState, columns: number[]): boolean {
  const previous = cloneColumnFilters(slice.columnFilters);
  const next = slice.columnFilters.filter((filter) => !columns.includes(filter.column));
  if (next.length === slice.columnFilters.length) return false;
  slice.columnFilters = next;
  pushFilterUndoState(slice, previous);
  recomputeSheetsView(slice);
  return true;
}

export function setSheetsColumnFilterSort(
  slice: SheetsToolState,
  column: number,
  sortDirection: "asc" | "desc" | null
): boolean {
  const filter = slice.columnFilters.find((entry) => entry.column === column);
  if (!filter) return false;
  if (filter.sortDirection === sortDirection) return false;
  const previous = cloneColumnFilters(slice.columnFilters);
  filter.sortDirection = sortDirection;
  pushFilterUndoState(slice, previous);
  recomputeSheetsView(slice);
  return true;
}

export function undoSheetsViewChange(slice: SheetsToolState): boolean {
  const previous = slice.filterUndoStack.pop();
  if (!previous) return false;
  slice.filterRedoStack.push(cloneColumnFilters(slice.columnFilters));
  slice.columnFilters = cloneColumnFilters(previous);
  recomputeSheetsView(slice);
  return true;
}

export function redoSheetsViewChange(slice: SheetsToolState): boolean {
  const next = slice.filterRedoStack.pop();
  if (!next) return false;
  slice.filterUndoStack.push(cloneColumnFilters(slice.columnFilters));
  slice.columnFilters = cloneColumnFilters(next);
  recomputeSheetsView(slice);
  return true;
}

function recomputeSheetsView(slice: SheetsToolState): void {
  slice.columnFilters = slice.columnFilters.filter((filter) => filter.column >= 0 && filter.column < slice.columnCount);

  const baseRows = Array.from({ length: Math.max(0, slice.rowCount) }, (_, index) => index);
  const sortedFilters = slice.columnFilters.filter((filter) => filter.sortDirection !== null);
  if (sortedFilters.length === 0) {
    slice.viewRowOrder = baseRows;
    return;
  }

  slice.viewRowOrder = [...baseRows].sort((left, right) => compareSheetRows(slice, left, right, sortedFilters));
  syncUndoRedoAvailability(slice);
}

function pushFilterUndoState(slice: SheetsToolState, previous: SheetsColumnFilterSnapshot): void {
  slice.filterUndoStack.push(previous);
  slice.filterRedoStack = [];
}

function cloneColumnFilters(filters: SheetsColumnFilter[]): SheetsColumnFilterSnapshot {
  return filters.map((filter) => ({ ...filter }));
}

function syncUndoRedoAvailability(slice: SheetsToolState): void {
  slice.canUndo = slice.backendCanUndo || slice.filterUndoStack.length > 0;
  slice.canRedo = slice.backendCanRedo || slice.filterRedoStack.length > 0;
}

function compareSheetRows(
  slice: SheetsToolState,
  leftRow: number,
  rightRow: number,
  filters: SheetsColumnFilter[]
): number {
  for (const filter of filters) {
    if (!filter.sortDirection) continue;
    const direction = filter.sortDirection === "asc" ? 1 : -1;
    const compared = compareSheetCellValues(
      getSheetsCell(slice, leftRow, filter.column),
      getSheetsCell(slice, rightRow, filter.column)
    );
    if (compared !== 0) return compared * direction;
  }
  return leftRow - rightRow;
}

function compareSheetCellValues(left: SheetsCellSnapshot | null, right: SheetsCellSnapshot | null): number {
  const leftComparable = toComparableValue(left);
  const rightComparable = toComparableValue(right);
  if (leftComparable.rank !== rightComparable.rank) return leftComparable.rank - rightComparable.rank;
  if (leftComparable.type === "number" && rightComparable.type === "number") {
    return leftComparable.value - rightComparable.value;
  }
  return leftComparable.value.localeCompare(rightComparable.value, undefined, { numeric: true, sensitivity: "base" });
}

function toComparableValue(cell: SheetsCellSnapshot | null): { rank: number; type: "number" | "text"; value: number | string } {
  if (!cell || (!cell.input && !cell.display)) {
    return { rank: 2, type: "text", value: "" };
  }
  if (cell.error) {
    return { rank: 3, type: "text", value: cell.error };
  }
  const raw = (cell.display || cell.input).trim();
  if (!raw) {
    return { rank: 2, type: "text", value: "" };
  }
  if (cell.kind === "number") {
    const numeric = Number(raw.replaceAll(",", ""));
    if (Number.isFinite(numeric)) return { rank: 0, type: "number", value: numeric };
  }
  return { rank: 1, type: "text", value: raw };
}
