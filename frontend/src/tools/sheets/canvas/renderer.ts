import { getSheetsCell, type SheetsToolState } from "../state.js";
import { cellRect, visibleRange } from "./viewport.js";
import { columnLabel } from "./cellLabel.js";
import {
  ROW_HEIGHT, COL_WIDTH, HEADER_HEIGHT, GUTTER_WIDTH,
  FILL_HANDLE_PX,
  FONT_SIZE, FONT_FAMILY
} from "./constants.js";

export interface PaintParams {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  state: SheetsToolState;
  theme: ThemeColors;
  hoverResizeCol?: number | null;
  hoverResizeRow?: number | null;
  activeResizeCol?: number | null;
  activeResizeRow?: number | null;
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
  filterColor: string;
}

// TODO: dirty-region clip - add dirtyRect parameter and clip painting to changed regions
export function paintGrid({
  ctx,
  width,
  height,
  state,
  theme,
  hoverResizeCol = null,
  hoverResizeRow = null,
  activeResizeCol = null,
  activeResizeRow = null
}: PaintParams): void {
  const { scrollX, scrollY, colWidths, rowHeights, selection, editingCell } = state;

  ctx.clearRect(0, 0, width, height);

  const visible = visibleRange(width, height, scrollX, scrollY,
    state.columnCount, state.rowCount, colWidths, rowHeights, state.viewRowOrder);

  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textBaseline = "middle";

  for (let viewRow = visible.rowStart; viewRow <= visible.rowEnd; viewRow++) {
    const row = state.viewRowOrder[viewRow] ?? viewRow;
    for (let col = visible.colStart; col <= visible.colEnd; col++) {
      const r = cellRect(col, row, scrollX, scrollY, colWidths, rowHeights, state.viewRowOrder);

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

        let text = cell.display || cell.input;
        const maxWidth = r.w - 10;
        if (maxWidth > 0) {
          const measured = ctx.measureText(text);
          if (measured.width > maxWidth) {
            let truncated = text;
            let ellipsis = "\u2026";
            while (ctx.measureText(truncated + ellipsis).width > maxWidth && truncated.length > 1) {
              truncated = truncated.slice(0, -1);
            }
            if (truncated.length < text.length) {
              text = truncated + ellipsis;
            }
          }
        }
        ctx.fillText(text, r.x + 5, r.y + r.h / 2, maxWidth);
      }
    }
  }

  for (let col = visible.colStart; col <= visible.colEnd; col++) {
    const r = cellRect(col, 0, scrollX, scrollY, colWidths, rowHeights);
    ctx.fillStyle = isColumnSelected(state, col) ? theme.selectionBg : theme.headerBg;
    ctx.fillRect(r.x, 0, r.w, HEADER_HEIGHT);
    ctx.strokeStyle = theme.cellBorder;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(r.x + 0.5, 0.5, r.w - 1, HEADER_HEIGHT - 1);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "center";
    ctx.fillText(columnLabel(col), r.x + r.w / 2, HEADER_HEIGHT / 2);
    if (state.columnFilters.some((filter) => filter.column === col)) {
      drawHeaderFilterIcon(ctx, r.x + r.w - 16, 7, theme.filterColor);
    }
    ctx.textAlign = "left";
  }

  for (let viewRow = visible.rowStart; viewRow <= visible.rowEnd; viewRow++) {
    const row = state.viewRowOrder[viewRow] ?? viewRow;
    const r = cellRect(0, row, scrollX, scrollY, colWidths, rowHeights, state.viewRowOrder);
    ctx.fillStyle = isRowSelected(state, row) ? theme.selectionBg : theme.headerBg;
    ctx.fillRect(0, r.y, GUTTER_WIDTH, r.h);
    ctx.strokeStyle = theme.cellBorder;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0.5, r.y + 0.5, GUTTER_WIDTH - 1, r.h - 1);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "center";
    ctx.fillText(String(row + 1), GUTTER_WIDTH / 2, r.y + r.h / 2);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = isEntireSheetSelected(state) ? theme.selectionBg : theme.headerBg;
  ctx.fillRect(0, 0, GUTTER_WIDTH, HEADER_HEIGHT);
  ctx.strokeStyle = theme.cellBorder;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(0.5, 0.5, GUTTER_WIDTH - 1, HEADER_HEIGHT - 1);

  if (selection) {
    const tl = cellRect(selection.startCol, selection.startRow, scrollX, scrollY, colWidths, rowHeights, state.viewRowOrder);
    const br = cellRect(selection.endCol,   selection.endRow,   scrollX, scrollY, colWidths, rowHeights, state.viewRowOrder);
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

    const fx = sx + sw - FILL_HANDLE_PX;
    const fy = sy + sh - FILL_HANDLE_PX;
    ctx.fillStyle = theme.selectionBorder;
    ctx.fillRect(fx, fy, FILL_HANDLE_PX, FILL_HANDLE_PX);
  }

  const resizeCol = activeResizeCol ?? hoverResizeCol;
  if (resizeCol !== null) {
    const r = cellRect(resizeCol, 0, scrollX, scrollY, colWidths, rowHeights);
    const edgeX = Math.round(r.x + r.w) - 1;
    ctx.fillStyle = theme.selectionBorder;
    ctx.fillRect(edgeX, 0, 2, height);
  }

  const resizeRow = activeResizeRow ?? hoverResizeRow;
  if (resizeRow !== null) {
    const r = cellRect(0, resizeRow, scrollX, scrollY, colWidths, rowHeights, state.viewRowOrder);
    const edgeY = Math.round(r.y + r.h) - 1;
    ctx.fillStyle = theme.selectionBorder;
    ctx.fillRect(0, edgeY, width, 2);
  }
}

function drawHeaderFilterIcon(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  color: string
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 8, y);
  ctx.lineTo(x + 5, y + 4);
  ctx.lineTo(x + 5, y + 8);
  ctx.lineTo(x + 3, y + 9);
  ctx.lineTo(x + 3, y + 4);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function isEntireSheetSelected(state: SheetsToolState): boolean {
  if (!state.selection) return false;
  return state.selection.startRow === 0
    && state.selection.startCol === 0
    && state.selection.endRow === Math.max(0, state.rowCount - 1)
    && state.selection.endCol === Math.max(0, state.columnCount - 1);
}

function isColumnSelected(state: SheetsToolState, col: number): boolean {
  if (!state.selection) return false;
  return state.selection.startCol <= col
    && state.selection.endCol >= col
    && state.selection.startRow === 0
    && state.selection.endRow === Math.max(0, state.rowCount - 1);
}

function isRowSelected(state: SheetsToolState, row: number): boolean {
  if (!state.selection) return false;
  return state.selection.startRow <= row
    && state.selection.endRow >= row
    && state.selection.startCol === 0
    && state.selection.endCol === Math.max(0, state.columnCount - 1);
}
