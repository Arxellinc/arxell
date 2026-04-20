import { createTextColumn, keyColumn } from "react-datasheet-grid";
import { getSheetsCell, type SheetsCellSnapshot, type SheetsSelection, type SheetsToolState } from "./state.js";

export interface SheetsGridCell {
  input: string;
  display: string;
  kind: SheetsCellSnapshot["kind"];
  error: string | null;
}

export interface SheetsGridRow {
  __rowIndex: number;
  [key: string]: unknown;
}

export interface SheetsGridChange {
  row: number;
  col: number;
  input: string;
}

export interface SheetsGridOperation {
  type: "UPDATE" | "DELETE" | "CREATE";
  fromRowIndex: number;
  toRowIndex: number;
}

export interface SheetsGridRangeWrite {
  startRow: number;
  startCol: number;
  values: string[][];
}

const EMPTY_GRID_CELL: SheetsGridCell = {
  input: "",
  display: "",
  kind: "empty",
  error: null
};

export function buildSheetsGridRows(slice: SheetsToolState): SheetsGridRow[] {
  const rowCount = Math.max(1, slice.rowCount || 0);
  const colCount = Math.max(1, slice.columnCount || 0);
  const result = Array.from({ length: rowCount }, (_, rowIndex) => {
    const row: SheetsGridRow = { __rowIndex: rowIndex };
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      row[columnKey(colIndex)] = toGridCell(getSheetsCell(slice, rowIndex, colIndex));
    }
    return row;
  });
  console.log("[sheets] buildSheetsGridRows rowCount:", rowCount, "colCount:", colCount, "first row keys:", Object.keys(result[0] || {}));
  return result;
}

export function buildSheetsGridColumns(columnCount: number) {
  const count = Math.max(1, columnCount || 0);
  console.log("[sheets] buildSheetsGridColumns count:", count);
  const textColumn = createTextColumn<SheetsGridCell>({
    continuousUpdates: false,
    parseUserInput: (value) => ({
      input: value,
      display: value,
      kind: value ? "text" : "empty",
      error: null
    }),
    parsePastedValue: (value) => ({
      input: value,
      display: value,
      kind: value ? "text" : "empty",
      error: null
    }),
    deletedValue: EMPTY_GRID_CELL,
    formatBlurredInput: (value) => value?.display ?? "",
    formatInputOnFocus: (value) => value?.input ?? "",
    formatForCopy: (value) => value?.input ?? ""
  });

  return Array.from({ length: count }, (_, colIndex) => ({
    ...keyColumn(columnKey(colIndex) as never, textColumn as never),
    title: columnLabel(colIndex),
    basis: 124,
    grow: 1,
    shrink: 0,
    minWidth: 88,
    cellClassName: ({ rowData }: { rowData: SheetsGridRow }) => {
      const cell = rowData[columnKey(colIndex)] as SheetsGridCell | undefined;
      if (cell?.error) return "sheets-grid-cell is-error";
      if (cell?.input?.startsWith("=")) return "sheets-grid-cell is-formula";
      return "sheets-grid-cell";
    }
  }));
}

export function diffSheetsGridChanges(
  before: SheetsGridRow[],
  after: SheetsGridRow[],
  operations: SheetsGridOperation[],
  columnCount: number
): SheetsGridChange[] {
  const width = Math.max(1, columnCount || 0);
  const changed: SheetsGridChange[] = [];
  for (const operation of operations) {
    if (operation.type !== "UPDATE") continue;
    for (let rowIndex = operation.fromRowIndex; rowIndex <= operation.toRowIndex; rowIndex += 1) {
      const previous = before[rowIndex];
      const next = after[rowIndex];
      if (!next) continue;
      for (let colIndex = 0; colIndex < width; colIndex += 1) {
        const key = columnKey(colIndex);
        const beforeInput = ((previous?.[key] as SheetsGridCell | undefined) ?? EMPTY_GRID_CELL).input;
        const afterInput = ((next[key] as SheetsGridCell | undefined) ?? EMPTY_GRID_CELL).input;
        if (beforeInput !== afterInput) {
          changed.push({
            row: rowIndex,
            col: colIndex,
            input: afterInput
          });
        }
      }
    }
  }
  return changed;
}

export function collapseGridChangesToWrite(changes: SheetsGridChange[], rows: SheetsGridRow[]): SheetsGridRangeWrite | null {
  if (!changes.length) return null;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  for (const change of changes) {
    minRow = Math.min(minRow, change.row);
    maxRow = Math.max(maxRow, change.row);
    minCol = Math.min(minCol, change.col);
    maxCol = Math.max(maxCol, change.col);
  }
  const values: string[][] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    const outRow: string[] = [];
    const rowData = rows[row];
    for (let col = minCol; col <= maxCol; col += 1) {
      const key = columnKey(col);
      const cell = (rowData?.[key] as SheetsGridCell | undefined) ?? EMPTY_GRID_CELL;
      outRow.push(cell.input);
    }
    values.push(outRow);
  }
  return {
    startRow: minRow,
    startCol: minCol,
    values
  };
}

export function selectedCellLabel(selection: SheetsSelection | null): string {
  if (!selection) return "--";
  const start = `${columnLabel(selection.startCol)}${selection.startRow + 1}`;
  const end = `${columnLabel(selection.endCol)}${selection.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

function toGridCell(cell: SheetsCellSnapshot | null): SheetsGridCell {
  return {
    input: cell?.input ?? "",
    display: cell?.display ?? "",
    kind: cell?.kind ?? "empty",
    error: cell?.error ?? null
  };
}

function columnKey(index: number): string {
  return `c${index}`;
}

export function columnLabel(index: number): string {
  let value = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}
