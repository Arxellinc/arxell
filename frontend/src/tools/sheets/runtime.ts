import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DataSheetGrid } from "react-datasheet-grid";
import type { SelectionWithId } from "react-datasheet-grid/dist/types";
import "react-datasheet-grid/dist/style.css";
import { SHEETS_UI_ID } from "../ui/constants";
import { buildSheetsGridColumns, buildSheetsGridRows, diffSheetsGridChanges, selectedCellLabel, type SheetsGridRow } from "./gridMapping.js";
import type { SheetsGridOperation } from "./gridMapping.js";
import { setSheetsSelection, applyOptimisticCellWrites, revertOptimisticCellWrites, type SheetsSelection, type SheetsToolState } from "./state.js";

interface SheetsRuntimeDeps {
  rerender: () => void;
  ensureWorkbook: () => Promise<void>;
  commitFormulaBar: (value: string) => Promise<void>;
  updateFormulaBarValue: (value: string) => void;
  applyGridChanges: (rows: SheetsGridRow[], operations: SheetsGridOperation[]) => { changes: import("./gridMapping.js").SheetsGridChange[]; write: import("./gridMapping.js").SheetsGridRangeWrite | null };
  fireWriteRange: (startRow: number, startCol: number, values: string[][]) => Promise<void>;
}

let mountedRoot: Root | null = null;
let mountedHost: HTMLElement | null = null;
let sheetsHydrationInFlight = false;

const STABLE_HOST_ID = "sheets-react-root";

export function mountSheetsRuntime(state: SheetsToolState, deps: SheetsRuntimeDeps): void {
  let host = document.querySelector<HTMLElement>(`#${SHEETS_UI_ID.host}`);
  if (!host) {
    unmountSheetsRuntime();
    return;
  }
  if (!state.hasWorkbook && !state.pending && !state.lastError && !sheetsHydrationInFlight) {
    sheetsHydrationInFlight = true;
    void deps.ensureWorkbook().finally(() => {
      sheetsHydrationInFlight = false;
      deps.rerender();
    });
  }
  let stableHost = document.getElementById(STABLE_HOST_ID);
  if (!stableHost) {
    stableHost = document.createElement("div");
    stableHost.id = STABLE_HOST_ID;
    stableHost.className = "sheets-runtime-host";
    stableHost.style.cssText = "flex:1;min-height:0;overflow:hidden;";
    mountedRoot = createRoot(stableHost);
  }
  if (stableHost.parentElement !== host) {
    host.replaceChildren(stableHost);
  }
  mountedHost = host;
  mountedRoot?.render(React.createElement(SheetsRuntimeBoundary, null, React.createElement(SheetsRuntimeView, { state, deps })));
}

export function unmountSheetsRuntime(): void {
  mountedRoot?.unmount();
  mountedRoot = null;
  mountedHost = null;
  sheetsHydrationInFlight = false;
}

class SheetsRuntimeBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): React.ReactNode {
    const error = this.state.error;
    if (error) {
      return React.createElement(
        "div",
        { className: "sheets-runtime-error" },
        React.createElement("div", null, "Sheet grid failed to render."),
        React.createElement("pre", null, error.message)
      );
    }
    return this.props.children;
  }
}

function SheetsRuntimeView({
  state,
  deps
}: {
  state: SheetsToolState;
  deps: SheetsRuntimeDeps;
}): React.ReactElement {
  const [, forceRender] = useState(0);
  console.log("[sheets] SheetsRuntimeView render hasWorkbook:", state.hasWorkbook, "rowCount:", state.rowCount, "colCount:", state.columnCount, "cells:", Object.keys(state.cellsByKey).length);
  const [gridHeight, setGridHeight] = useState(() => initialGridHeight());
  console.log("[sheets] gridHeight:", gridHeight);

  const rerenderRuntime = () => {
    forceRender((version) => version + 1);
  };

  if (!state.hasWorkbook) {
    return React.createElement(
      "div",
      { className: "sheets-empty-state" },
      React.createElement(
        "div",
        null,
        state.pending ? "Preparing sheet..." : "Open a sheet to inspect and edit structured data."
      ),
      React.createElement(
        "div",
        { className: "sheets-empty-note" },
        state.lastError || "All persistent edits go through the Rust backend service."
      )
    );
  }

  const rows = buildSheetsGridRows(state);
  const columns = buildSheetsGridColumns(state.columnCount);
  const canFormula = !state.capabilities || state.capabilities.formulas;

  const onSelectionChange = (selection: SelectionWithId | null) => {
    console.log("[sheets] onSelectionChange", selection);
    const nextSelection: SheetsSelection | null = selection
      ? {
          startRow: selection.min.row,
          startCol: selection.min.col,
          endRow: selection.max.row,
          endCol: selection.max.col
        }
      : null;
    if (isSameSelection(state.selection, nextSelection)) {
      return;
    }
    setSheetsSelection(state, nextSelection);
    rerenderRuntime();
  };

  const onFormulaInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    deps.updateFormulaBarValue(event.target.value);
    rerenderRuntime();
  };

  const onFormulaKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await deps.commitFormulaBar(state.activeEditorValue);
    rerenderRuntime();
  };

  const onGridChange = (nextRows: SheetsGridRow[], operations: SheetsGridOperation[]) => {
    console.log("[sheets] onGridChange rows:", nextRows?.length, "ops:", JSON.stringify(operations));
    const { changes, write } = deps.applyGridChanges(nextRows, operations);
    console.log("[sheets] changes:", changes.length, changes);
    if (!write) return;
    const snapshot = applyOptimisticCellWrites(state, changes);
    rerenderRuntime();
    void deps.fireWriteRange(write.startRow, write.startCol, write.values).catch(() => {
      revertOptimisticCellWrites(state, snapshot);
      rerenderRuntime();
    });
  };

  const selectedLabel = selectedCellLabel(state.selection);

  console.log("[sheets] DataSheetGrid about to render with rows:", rows?.length, "columns:", columns?.length);
  return React.createElement(
    "div",
    { className: "sheets-runtime" },
    canFormula
      ? React.createElement(
          "div",
          { className: "sheets-formula-row" },
          React.createElement("div", { className: "sheets-formula-label" }, selectedLabel),
          React.createElement("input", {
            className: "field-input-soft sheets-formula-input",
            value: state.activeEditorValue,
            placeholder: "Cell input or formula",
            onChange: onFormulaInput,
            onKeyDown: onFormulaKeyDown,
            disabled: state.pending
          }),
          React.createElement(
            "button",
            {
              type: "button",
              className: "tool-action-btn sheets-apply-btn",
              onClick: () => {
                void deps.commitFormulaBar(state.activeEditorValue).then(rerenderRuntime);
              },
              disabled: state.pending || !state.selection
            },
            "Apply"
          )
        )
      : null,
    React.createElement(
      "div",
      { className: "sheets-grid-wrap" },
      React.createElement(DataSheetGrid as any, {
        className: "sheets-grid",
        value: rows,
        columns: columns as any,
        gutterColumn: { basis: 48, grow: 0, shrink: 0, minWidth: 48 },
        height: gridHeight,
        rowHeight: 30,
        headerRowHeight: 30,
        lockRows: true,
        autoAddRow: false,
        disableContextMenu: false,
        onChange: (nextValue: SheetsGridRow[], operations: SheetsGridOperation[]) => {
          void onGridChange(nextValue, operations);
        },
        onActiveCellChange: ({ cell }: { cell: { row: number; col: number } | null }) => {
          onSelectionChange(
            cell
              ? {
                  min: { row: cell.row, col: cell.col },
                  max: { row: cell.row, col: cell.col }
                }
              : null
          );
        },
        onSelectionChange: ({ selection }: { selection: SelectionWithId | null }) => {
          onSelectionChange(selection);
        }
      })
    )
  );
}

function initialGridHeight(): number {
  return Math.max(520, window.innerHeight - 150);
}

function isSameSelection(a: SheetsSelection | null, b: SheetsSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.startRow === b.startRow &&
    a.startCol === b.startCol &&
    a.endRow === b.endRow &&
    a.endCol === b.endCol
  );
}
