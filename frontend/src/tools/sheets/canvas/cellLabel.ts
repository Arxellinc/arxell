import type { SheetsSelection } from "../state.js";

export function columnLabel(index: number): string {
  let value = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function selectedCellLabel(selection: SheetsSelection | null): string {
  if (!selection) return "--";
  const start = `${columnLabel(selection.startCol)}${selection.startRow + 1}`;
  const end = `${columnLabel(selection.endCol)}${selection.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}