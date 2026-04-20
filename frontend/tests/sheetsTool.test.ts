import test from "node:test";
import assert from "node:assert/strict";

import { buildSheetsGridColumns, buildSheetsGridRows } from "../src/tools/sheets/gridMapping.js";
import { handleSheetsClick } from "../src/tools/sheets/bindings.js";
import { deleteColumns, deleteRows, openSheet, saveSheet, saveSheetCurrent, setCellInput } from "../src/tools/sheets/actions.js";
import {
  getInitialSheetsState,
  setSheetsSelection,
  syncEditorValue,
  type SheetsToolState
} from "../src/tools/sheets/state.js";

function createMockDeps(responses: Record<string, unknown[]>) {
  const calls: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const client = {
    async toolInvoke(request: {
      action: string;
      payload: Record<string, unknown>;
    }): Promise<{ ok: boolean; data: unknown; error?: string }> {
      calls.push({ action: request.action, payload: request.payload });
      const bucket = responses[request.action] || [];
      const next = bucket.shift();
      return {
        ok: true,
        data: next ?? {}
      };
    }
  };
  return {
    deps: {
      client: client as any,
      nextCorrelationId: () => "corr-test"
    },
    calls
  };
}

test("grid rows keep raw formula input while displaying computed text", () => {
  const state = getInitialSheetsState();
  state.hasWorkbook = true;
  state.rowCount = 1;
  state.columnCount = 1;
  state.cellsByKey["0:0"] = {
    row: 0,
    col: 0,
    input: "=A1+1",
    display: "2",
    kind: "number",
    error: null
  };
  setSheetsSelection(state, {
    startRow: 0,
    startCol: 0,
    endRow: 0,
    endCol: 0
  });
  syncEditorValue(state);

  const rows = buildSheetsGridRows(state);
  const cell = rows[0]?.c0 as { input: string; display: string };

  assert.equal(cell.input, "=A1+1");
  assert.equal(cell.display, "2");
  assert.equal(state.activeEditorValue, "=A1+1");
});

test("error cells receive error styling class", () => {
  const columns = buildSheetsGridColumns(1);
  const className = columns[0]?.cellClassName?.({
    rowData: {
      __rowIndex: 0,
      c0: {
        input: "=BAD()",
        display: "unsupported formula",
        kind: "error",
        error: "unsupported formula"
      }
    },
    rowIndex: 0,
    columnId: "c0"
  } as never);

  assert.equal(className, "sheets-grid-cell is-error");
});

test("open and save actions call sheets tool invoke actions", async () => {
  const state = getInitialSheetsState();
  const { deps, calls } = createMockDeps({
    open_sheet: [
      {
        filePath: "/tmp/demo.csv",
        fileName: "demo.csv",
        sheet: {
          rowCount: 1,
          columnCount: 1,
          usedRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
          dirty: false,
          revision: 1,
          cells: [{ row: 0, col: 0, input: "1", display: "1", kind: "number", error: null }]
        }
      }
    ],
    save_sheet: [{ filePath: "/tmp/demo.csv", rowCount: 1, columnCount: 1 }],
    inspect_sheet: [
      {
        filePath: "/tmp/demo.csv",
        fileName: "demo.csv",
        rowCount: 1,
        columnCount: 1,
        usedRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        dirty: false,
        revision: 1
      }
    ],
    read_range: [{ cells: [{ row: 0, col: 0, input: "1", display: "1", kind: "number", error: null }] }]
  });

  await openSheet(state, deps as any, "/tmp/demo.csv");
  await saveSheet(state, deps as any, "/tmp/demo.csv");

  assert.equal(calls[0]?.action, "open_sheet");
  assert.equal(calls[1]?.action, "save_sheet");
  assert.equal(calls[2]?.action, "inspect_sheet");
  assert.equal(calls[3]?.action, "read_range");
});

test("saveSheetCurrent saves to existing path without save-as prompt", async () => {
  const state = getInitialSheetsState();
  state.hasWorkbook = true;
  state.filePath = "/tmp/current.csv";
  state.fileName = "current.csv";
  state.rowCount = 1;
  state.columnCount = 1;
  state.usedRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
  const { deps, calls } = createMockDeps({
    save_sheet: [{ filePath: "/tmp/current.csv", rowCount: 1, columnCount: 1 }],
    inspect_sheet: [
      {
        filePath: "/tmp/current.csv",
        fileName: "current.csv",
        rowCount: 1,
        columnCount: 1,
        usedRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        dirty: false,
        revision: 2
      }
    ],
    read_range: [{ cells: [] }]
  });

  await saveSheetCurrent(state, deps as any);

  assert.equal(calls[0]?.action, "save_sheet");
  assert.equal(calls[0]?.payload.path, "/tmp/current.csv");
});

test("missing capability keys allow toolbar action dispatch", async () => {
  const state = getInitialSheetsState();
  state.hasWorkbook = true;
  state.rowCount = 1;
  state.columnCount = 1;
  state.capabilities = {};
  setSheetsSelection(state, {
    startRow: 0,
    startCol: 0,
    endRow: 0,
    endCol: 0
  });
  let insertedAt: number | null = null;

  const handled = await handleSheetsClick(
    { getAttribute: () => "add-row" } as unknown as HTMLElement,
    state,
    {
      createNewSheet: async () => undefined,
      openSheetWithDialog: async () => undefined,
      saveSheetCurrent: async () => undefined,
      saveSheetWithDialog: async () => undefined,
      insertRows: async (index) => {
        insertedAt = index;
      },
      insertColumns: async () => undefined,
      deleteRows: async () => undefined,
      deleteColumns: async () => undefined
    }
  );

  assert.equal(handled, true);
  assert.equal(insertedAt, 1);
});

test("setCellInput refreshes state from backend after mutation", async () => {
  const state: SheetsToolState = getInitialSheetsState();
  state.hasWorkbook = true;
  state.filePath = "/tmp/demo.csv";
  state.fileName = "demo.csv";
  state.rowCount = 1;
  state.columnCount = 1;
  state.usedRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
  state.cellsByKey["0:0"] = {
    row: 0,
    col: 0,
    input: "1",
    display: "1",
    kind: "number",
    error: null
  };

  const { deps, calls } = createMockDeps({
    set_cell: [{ revision: 2, dirty: true, updatedCells: [] }],
    inspect_sheet: [
      {
        filePath: "/tmp/demo.csv",
        fileName: "demo.csv",
        rowCount: 1,
        columnCount: 2,
        usedRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
        dirty: true,
        revision: 2
      }
    ],
    read_range: [
      {
        cells: [
          { row: 0, col: 0, input: "1", display: "1", kind: "number", error: null },
          { row: 0, col: 1, input: "=A1+1", display: "2", kind: "number", error: null }
        ]
      }
    ]
  });

  await setCellInput(state, deps as any, 0, 1, "=A1+1");

  assert.deepEqual(calls.map((call) => call.action), ["set_cell", "inspect_sheet", "read_range"]);
  assert.equal(state.revision, 2);
  assert.equal(state.dirty, true);
  assert.equal(state.cellsByKey["0:1"]?.display, "2");
});

test("delete row and column actions invoke backend mutations and refresh", async () => {
  const state: SheetsToolState = getInitialSheetsState();
  state.hasWorkbook = true;
  state.filePath = "/tmp/demo.csv";
  state.fileName = "demo.csv";
  state.rowCount = 2;
  state.columnCount = 2;
  state.usedRange = { startRow: 0, startCol: 0, endRow: 1, endCol: 1 };

  const { deps, calls } = createMockDeps({
    delete_rows: [{ revision: 3, dirty: true, rowCount: 1 }],
    delete_columns: [{ revision: 4, dirty: true, columnCount: 1 }],
    inspect_sheet: [
      {
        filePath: "/tmp/demo.csv",
        fileName: "demo.csv",
        rowCount: 1,
        columnCount: 2,
        usedRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
        dirty: true,
        revision: 3
      },
      {
        filePath: "/tmp/demo.csv",
        fileName: "demo.csv",
        rowCount: 1,
        columnCount: 1,
        usedRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        dirty: true,
        revision: 4
      }
    ],
    read_range: [
      { cells: [{ row: 0, col: 0, input: "1", display: "1", kind: "number", error: null }] },
      { cells: [{ row: 0, col: 0, input: "1", display: "1", kind: "number", error: null }] }
    ]
  });

  await deleteRows(state, deps as any, 0, 1);
  await deleteColumns(state, deps as any, 0, 1);

  assert.deepEqual(calls.map((call) => call.action), [
    "delete_rows",
    "inspect_sheet",
    "read_range",
    "delete_columns",
    "inspect_sheet",
    "read_range"
  ]);
  assert.equal(state.rowCount, 1);
  assert.equal(state.columnCount, 1);
});
