import { COL_WIDTH, ROW_HEIGHT, GUTTER_WIDTH, HEADER_HEIGHT } from "./constants.js";

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function hitTest(
  px: number,
  py: number,
  scrollX: number,
  scrollY: number,
  colWidths: Map<number, number>,
  rowHeights: Map<number, number>,
  rowOrder?: number[]
): [col: number, row: number] | null {
  if (px < GUTTER_WIDTH || py < HEADER_HEIGHT) return null;
  const col = xToCol(px + scrollX - GUTTER_WIDTH, colWidths);
  const row = resolveActualRow(yToViewRow(py + scrollY - HEADER_HEIGHT, rowHeights, rowOrder), rowOrder);
  return [col, row];
}

export function cellRect(
  col: number,
  row: number,
  scrollX: number,
  scrollY: number,
  colWidths: Map<number, number>,
  rowHeights: Map<number, number>,
  rowOrder?: number[]
): CellRect {
  const x = colToX(col, colWidths) - scrollX + GUTTER_WIDTH;
  const viewRow = actualRowToViewRow(row, rowOrder);
  const y = viewRowToY(viewRow, rowHeights, rowOrder) - scrollY + HEADER_HEIGHT;
  const w = colWidths.get(col) ?? COL_WIDTH;
  const h = rowHeights.get(resolveActualRow(viewRow, rowOrder)) ?? ROW_HEIGHT;
  return { x, y, w, h };
}

export function visibleRange(
  canvasWidth: number,
  canvasHeight: number,
  scrollX: number,
  scrollY: number,
  colCount: number,
  rowCount: number,
  colWidths: Map<number, number>,
  rowHeights: Map<number, number>,
  rowOrder?: number[]
): { colStart: number; colEnd: number; rowStart: number; rowEnd: number } {
  const colStart = xToCol(scrollX, colWidths);
  const colEnd   = Math.min(colCount - 1, xToCol(scrollX + canvasWidth  - GUTTER_WIDTH, colWidths));
  const rowStart = yToViewRow(scrollY, rowHeights, rowOrder);
  const rowEnd   = Math.min(rowCount - 1, yToViewRow(scrollY + canvasHeight - HEADER_HEIGHT, rowHeights, rowOrder));
  return { colStart, colEnd, rowStart, rowEnd };
}

// TODO: prefix-sum cache - optimize colToX and rowToY to use cached prefix sums
function colToX(col: number, widths: Map<number, number>): number {
  let x = 0;
  for (let c = 0; c < col; c++) x += widths.get(c) ?? COL_WIDTH;
  return x;
}

function viewRowToY(viewRow: number, heights: Map<number, number>, rowOrder?: number[]): number {
  let y = 0;
  for (let viewIndex = 0; viewIndex < viewRow; viewIndex++) {
    y += heights.get(resolveActualRow(viewIndex, rowOrder)) ?? ROW_HEIGHT;
  }
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

function yToViewRow(y: number, heights: Map<number, number>, rowOrder?: number[]): number {
  let cursor = 0, row = 0;
  while (true) {
    const h = heights.get(resolveActualRow(row, rowOrder)) ?? ROW_HEIGHT;
    if (cursor + h > y) return row;
    cursor += h;
    row++;
  }
}

function resolveActualRow(viewRow: number, rowOrder?: number[]): number {
  return rowOrder?.[viewRow] ?? viewRow;
}

function actualRowToViewRow(actualRow: number, rowOrder?: number[]): number {
  if (!rowOrder || rowOrder.length === 0) return actualRow;
  const index = rowOrder.indexOf(actualRow);
  return index === -1 ? actualRow : index;
}
