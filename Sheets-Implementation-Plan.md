# Sheets Implementation Plan

## Scope

This plan covers the migration from the current CSV-only Sheets MVP to a multi-format architecture with:

- a native `.sheet.jsonl` full-featured format
- `IronCalc` as the formula and recalculation engine
- multiple source adapters (native JSONL, CSV, SQLite table)
- capability-based feature gating in the UI and backend

This plan is derived from `Sheets-Readme.md` (the design review document) and maps every change to concrete files, types, and contracts in the current codebase.

## Phases Overview

| Phase | Focus | Risk | Estimated Touchpoints |
| --- | --- | --- | --- |
| 0 | Prepare: genericize naming, add format field | Low | ~25 files/types |
| 1 | Native JSONL parser and serializer | Medium | ~4 new files, ~6 modified |
| 2 | Source adapter model and capability system | Medium | ~5 new files, ~8 modified |
| 3 | IronCalc integration | High | ~6 modified files |
| 4 | Frontend capability gating | Medium | ~10 modified files |
| 5 | SQLite source adapter | Medium | ~4 new files, ~3 modified |
| 6 | Polish: agent gaps, export, edge cases | Low | ~5 modified files |

Each phase is designed to leave the app in a working, testable state before the next begins.

---

## Phase 0: Prepare — Genericize CSV-Specific Naming

### Goal

Remove all hardcoded CSV assumptions from type names, IPC command names, UI labels, and sync events without changing behavior. After this phase, the app works exactly as before but all naming is format-agnostic.

### Why First

Every subsequent phase depends on format-agnostic naming. Doing this first means later phases only add new code rather than also renaming existing code.

### Backend Changes

#### `src-tauri/src/services/sheets_types.rs`

Rename these IPC types:

| Current Name | New Name | Lines |
| --- | --- | --- |
| `OpenCsvResult` | `OpenSheetResult` | 108-114 |
| `SaveCsvResult` | `SaveSheetResult` | 116-122 |

Add a new enum and field:

```
enum SheetSourceKind { NativeJsonl, Csv, SqliteTable }
```

Add to `WorkbookState`:

- `source_kind: SheetSourceKind` (default `Csv` for backward compat)
- `format: String` (default `"csv"`)

These additions should be behind `#[serde(default)]` so existing serialized states still deserialize.

#### `src-tauri/src/services/sheets_service.rs`

Rename methods:

| Current Method | New Method | Lines |
| --- | --- | --- |
| `open_csv()` | `open_sheet()` | 81-167 |
| `save_csv()` | `save_sheet()` | 169-245 |

Keep private helper methods `parse_csv()` and `write_csv()` inside the service for now, called from `open_sheet()` and `save_sheet()` based on `source_kind`.

Update `new_sheet()`:

- Line 62: change default name from `"New Sheet.csv"` to `"New Sheet"` (extension added based on format)
- Store `source_kind: Csv` on the created workbook

Update `maybe_emit_sync()`:

- Line 965: change hardcoded `"format": "csv"` to use the workbook's actual `format` field

#### `src-tauri/src/tools/invoke/sheets.rs`

Rename IPC commands:

| Current Action | New Action |
| --- | --- |
| `open_csv` | `open_sheet` |
| `save_csv` | `save_sheet` |

Rename payload types:

| Current | New | Lines |
| --- | --- | --- |
| `OpenCsvPayload` | `OpenSheetPayload` | 159-163 |
| `SaveCsvPayload` | `SaveSheetPayload` | 165-169 |

Add optional `format` field to `OpenSheetPayload`:

- `format: Option<String>` (default `"csv"` when `None`)

Rename handler functions:

| Current | New |
| --- | --- |
| `invoke_open_csv()` | `invoke_open_sheet()` |
| `invoke_save_csv()` | `invoke_save_sheet()` |

Update `register()` to use new action names.

#### `src-tauri/src/agent_tools/sheets.rs`

- Line 193: change `service.save_csv()` call to `service.save_sheet()`
- The agent action name `save_sheet` is already correct; only the internal dispatch needed fixing
- Add missing `delete_rows` and `delete_columns` to the agent schema (lines 39-46)

### Frontend Changes

#### `frontend/src/tools/sheets/state.ts`

Rename:

| Current | New | Lines |
| --- | --- | --- |
| `SheetsOpenCsvResult` | `SheetsOpenSheetResult` | 42-46 |

Add to `SheetsToolState`:

- `sourceKind: string` (default `"csv"`)
- `capabilities: Record<string, boolean>` (default all true for now)

#### `frontend/src/tools/sheets/actions.ts`

Rename functions:

| Current | New |
| --- | --- |
| `openCsvWithDialog()` | `openSheetWithDialog()` |
| `openCsv()` | `openSheet()` |
| `saveCsvWithDialog()` | `saveSheetWithDialog()` |
| `saveCsv()` | `saveSheet()` |
| `pickOpenCsvPath()` | `pickOpenSheetPath()` |
| `pickSaveCsvPath()` | `pickSaveSheetPath()` |

Update IPC action strings:

- `"open_csv"` -> `"open_sheet"` (line 64)
- `"save_csv"` -> `"save_sheet"` (line 98)

Update dialog titles and status messages:

- `"Opening CSV..."` -> `"Opening sheet..."` (line 62)
- `"Saving CSV..."` -> `"Saving sheet..."` (line 94)
- `"Open CSV"` -> `"Open Sheet"` (lines 339, 351)
- `"Save CSV"` -> `"Save Sheet"` (lines 361, 369)

Update default names:

- `"New Sheet.csv"` -> `"New Sheet"` (line 42)

#### `frontend/src/tools/sheets/index.tsx`

Update labels:

- Line 8: `"New Sheet.csv"` -> `"New Sheet"`
- Line 15: `"New Sheet.csv"` -> `"New Sheet"`
- Line 33: `"Open CSV"` -> `"Open Sheet"`
- Line 41: `"Save CSV"` -> `"Save Sheet"`

#### `frontend/src/tools/sheets/bindings.ts`

Update action strings:

- `"open-csv"` -> `"open-sheet"` (line 21)
- `"save-csv"` -> `"save-sheet"` (line 32)

Update bound function names to match renamed actions.

#### `frontend/src/tools/sheets/manifest.ts`

- Line 7: update description from `"Backend-backed CSV sheet editor"` to `"Backend-backed sheet editor for structured workspace data"`

#### `frontend/src/tools/sheets/runtime.ts`

- Line 65: update empty state text from `"Open a CSV to inspect and edit structured data."` to `"Open a sheet to inspect and edit structured data."`

### Test Updates

Every test that references renamed types, action names, or method names must be updated in lockstep:

- `src-tauri/src/services/sheets_service.rs` inline tests (9 tests)
- `src-tauri/src/tools/invoke/sheets.rs` inline tests (5 tests)
- `src-tauri/src/agent_tools/sheets.rs` inline tests (3 tests)
- `frontend/tests/sheetsTool.test.ts` (5 tests)

### Verification

After Phase 0:

- all existing tests pass
- CSV open/save still works identically
- no functional behavior change
- all type names and action names are format-agnostic

---

## Phase 1: Native JSONL Parser and Serializer

### Goal

Implement a Rust parser and serializer for the `.sheet.jsonl` native format defined in `Sheets-Readme.md`. This phase does not integrate IronCalc or change the frontend. It only adds the ability to read and write native sheet files.

### New Files

#### `src-tauri/src/services/sheets_jsonl.rs`

This module should contain:

- `parse_jsonl(raw: &str) -> Result<SheetState, SheetsError>`
  - reads the header line and validates `sv: 1`
  - reads the style table record into a `Vec<CellStyle>`
  - reads optional `fz`, `cm`, `rm`, `mg` records
  - reads row records into the sparse `HashMap<CellCoord, CellState>`
  - returns a populated `SheetState`

- `serialize_jsonl(sheet: &SheetState, meta: &SheetMeta) -> Result<String, SheetsError>`
  - writes header, style table, layout records, row records
  - follows the deterministic record order from the spec
  - sorts rows and cells for stable output

- `CellStyle` struct with fields matching the style schema from `Sheets-Readme.md`

- `SheetMeta` struct for header-level metadata (name, locale, currency, timezone)

#### `src-tauri/src/services/sheets_jsonl_test.rs` or inline `#[cfg(test)]`

Tests should cover:

- round-trip: parse -> serialize -> parse produces identical state
- sparse rows: only non-empty rows appear
- sparse cells: only non-empty cells appear
- style table: ids resolve correctly
- format codes: valid format codes parse without error
- unknown record types: skipped gracefully (forward compat)
- missing optional records: `fz`, `cm`, `rm`, `mg` are optional
- edge cases: empty sheet, single cell, very large row index

### Modified Files

#### `src-tauri/src/services/sheets_types.rs`

Add style-related types:

- `CellStyle` struct with fields: `f`, `m`, `a`, `va`, `fg`, `bg`, `w`
- Add to `SheetState`: `styles: Vec<CellStyle>`, `frozen: Option<[usize;2]>`, `col_meta: Vec<ColMeta>`, `row_meta: Vec<RowMeta>`, `merges: Vec<[usize;4]>`
- All new fields should be `#[serde(default)]` for backward compatibility

#### `src-tauri/src/services/sheets_service.rs`

Add format dispatch to `open_sheet()` and `save_sheet()`:

- detect format from file extension (`.sheet.jsonl` vs `.csv`)
- when `NativeJsonl`: call `parse_jsonl()` / `serialize_jsonl()`
- when `Csv`: call existing `parse_csv()` / `write_csv()` helpers

#### `src-tauri/src/services/mod.rs`

Register the new module: `pub mod sheets_jsonl;`

### Verification

After Phase 1:

- can create a `SheetState` programmatically, serialize to JSONL, parse back, and get identical state
- existing CSV functionality still works
- no frontend changes yet

---

## Phase 2: Source Adapter Model and Capability System

### Goal

Introduce a formal source adapter abstraction and capability set that travels with every open sheet session. This makes it possible for the backend and frontend to query what operations are valid for the current source.

### New Files

#### `src-tauri/src/services/sheets_capabilities.rs`

Define:

- `CapabilitySet` struct with boolean flags:
  - `formulas`, `styles`, `formats`, `typed_cells`
  - `column_widths`, `row_heights`, `frozen_panes`, `merges`
  - `insert_rows`, `delete_rows`, `insert_cols`, `delete_cols`
  - `rename_cols`, `schema_changes`, `transactions`

- `fn capabilities_for_csv() -> CapabilitySet` — formulas on, everything else off
- `fn capabilities_for_native() -> CapabilitySet` — all on
- `fn capabilities_for_sqlite() -> CapabilitySet` — formulas off, typed on, transactions on, everything else off

#### `src-tauri/src/services/sheets_source.rs`

Define:

- `SheetSourceKind` enum (moved here from Phase 0 if not already separated)
- `SheetSource` struct:
  - `kind: SheetSourceKind`
  - `location: String`
  - `identity: String`
  - `read_only: bool`
  - `capabilities: CapabilitySet`

- `fn source_from_path(path: &str) -> SheetSource` — detect kind from extension
- `fn source_for_sqlite(db: &str, table: &str) -> SheetSource`

### Modified Files

#### `src-tauri/src/services/sheets_types.rs`

Add to `WorkbookState`:

- `source: SheetSource`

This should be `#[serde(default)]` with a default that produces a CSV source.

#### `src-tauri/src/services/sheets_service.rs`

Update `open_sheet()` to:

- detect source kind from file path
- store the `SheetSource` on the `WorkbookState`
- expose `pub fn capabilities() -> Option<CapabilitySet>` that reads from the current workbook

Update mutation methods (`set_cell_input`, `write_range`, `insert_rows`, etc.) to:

- check capabilities before mutating
- return a structured error when an unsupported operation is attempted

Update `SheetSnapshot` and `OpenSheetResult` to include `capabilities: CapabilitySet` so the frontend receives it.

#### `src-tauri/src/services/mod.rs`

Register new modules: `pub mod sheets_capabilities;`, `pub mod sheets_source;`

### Frontend Changes

#### `frontend/src/tools/sheets/state.ts`

Add to `SheetsToolState`:

- `capabilities: Record<string, boolean>`

#### `frontend/src/tools/sheets/actions.ts`

Parse capabilities from the `open_sheet` result and store them in state.

### Verification

After Phase 2:

- opening a CSV file sets `source.kind = Csv` with reduced capabilities
- opening a native JSONL file sets `source.kind = NativeJsonl` with full capabilities
- mutation methods reject operations that the current source does not support
- the frontend receives and stores the capability set

---

## Phase 3: IronCalc Integration

### Goal

Replace the custom formula engine (`sheets_formula.rs`) with `IronCalc` for parsing, evaluation, and recalculation.

This is the highest-risk phase because it changes the computation core.

### Approach

Integrate `IronCalc` gradually behind the existing `FormulaEngine` trait rather than replacing everything at once.

### Dependency Addition

#### `src-tauri/Cargo.toml`

Add:

```toml
ironcalc = { version = "0.7" }
```

Verify compatibility with the existing dependency tree. If conflicts arise, pin to a compatible version or use a `git` source.

### Modified Files

#### `src-tauri/src/services/sheets_formula.rs`

Create a new engine implementation alongside the existing one:

- Keep `FormulaEngine` trait intact
- Keep `BackendFormulaEngine` as-is initially (it becomes the fallback)
- Add `IronCalcEngine` struct implementing `FormulaEngine`
  - `recompute_sheet()` feeds raw cell inputs into an IronCalc `Model`
  - extracts computed values back into `CellState.computed`
  - maps IronCalc errors into `FormulaError`

- Add a feature flag or config to switch between engines
- Start with `IronCalcEngine` disabled by default so existing behavior is preserved

#### `src-tauri/src/services/sheets_service.rs`

Update `SheetsService::new()` to accept an engine selection parameter.

Update `finalize_sheet()` to use whichever engine is active.

### Migration Strategy

1. Add `IronCalcEngine` behind a feature flag
2. Run both engines in parallel during testing and compare results
3. Add a test that runs every existing formula test through both engines and asserts identical results
4. Once confidence is high, make `IronCalcEngine` the default
5. Keep `BackendFormulaEngine` as a fallback or remove it after a burn-in period

### New Tests

- parity tests: every existing formula test runs against both engines
- IronCalc-specific tests for functions not supported by the current engine
- round-trip tests: JSONL -> IronCalc -> JSONL produces consistent state

### Verification

After Phase 3:

- all existing formula tests pass with the new engine
- the app can evaluate a broader set of spreadsheet functions
- native JSONL files with formulas round-trip correctly through IronCalc
- fallback to the old engine is possible if issues are found

---

## Phase 4: Frontend Capability Gating

### Goal

Make the frontend hide or disable features that the current source does not support. This completes the user-facing half of the capability system.

### Modified Files

#### `frontend/src/tools/sheets/index.tsx`

Conditionally render toolbar buttons:

- "Save" always visible (saves to current source)
- "Save As" visible when source is not native (promotes to native)
- style and format controls only when `capabilities.styles` and `capabilities.formats` are true
- row/column insert/delete only when `capabilities.insertRows` / `capabilities.deleteRows` etc. are true

#### `frontend/src/tools/sheets/runtime.ts`

- hide the formula bar when `capabilities.formulas` is false
- update empty state text based on source kind
- show source kind indicator in the status area

#### `frontend/src/tools/sheets/bindings.ts`

- gate binding actions by capability
- show a user-facing message when attempting an unsupported action

#### `frontend/src/tools/sheets/actions.ts`

- update `openSheetWithDialog()` to accept multiple file types (`.sheet.jsonl`, `.csv`)
- update `saveSheetWithDialog()` to show format options when saving as
- add `exportSheet()` for export to CSV/XLSX without changing the source
- pass capabilities through to state after every open/refresh

#### `frontend/src/tools/sheets/state.ts`

- derive UI flags from capabilities:
  - `canStyle: boolean`
  - `canFormat: boolean`
  - `canFormula: boolean`
  - `canInsertRows: boolean`
  - `canDeleteRows: boolean`
  - `canMerge: boolean`
  - etc.

### Verification

After Phase 4:

- opening a CSV file hides style, format, merge, and layout controls
- opening a native JSONL file shows the full feature set
- attempting an unsupported operation shows a clear message rather than failing silently
- the formula bar appears or hides based on `capabilities.formulas`

---

## Phase 5: SQLite Source Adapter

### Goal

Add the ability to open a SQLite table directly as a sheet source, edit cell values, and save back to the database.

### New Files

#### `src-tauri/src/services/sheets_sqlite.rs`

Implement:

- `open_sqlite_table(db_path: &str, table: &str) -> Result<SheetState, SheetsError>`
  - read column names from `PRAGMA table_info`
  - read row data from `SELECT * FROM <table>`
  - map columns to sheet columns
  - detect primary key for stable row identity
  - return `SheetState` with `source = SqliteTable`

- `save_sqlite_table(sheet: &SheetState, source: &SheetSource) -> Result<(), SheetsError>`
  - build `UPDATE` statements for changed cells
  - execute in a transaction
  - use primary key for `WHERE` clauses

- detect when a table is not safely editable (no PK, computed columns, views)
  - open read-only in that case

#### `src-tauri/src/services/sheets_sqlite_test.rs` or inline tests

Tests should cover:

- open a table with known data
- edit a cell and save back
- verify the database reflects the edit
- open a table without a primary key -> read-only
- concurrent edit conflict detection (optional for v1)

### Modified Files

#### `src-tauri/src/services/sheets_service.rs`

Extend `open_sheet()` to handle SQLite sources.

Add a new entry point:

- `open_sqlite(db_path: &str, table: &str) -> Result<OpenSheetResult, SheetsError>`

Extend `save_sheet()` to dispatch to `save_sqlite_table()` when `source.kind == SqliteTable`.

#### `src-tauri/src/tools/invoke/sheets.rs`

Add a new IPC command:

- `open_sqlite_table` with payload `{ dbPath, tableName }`

#### `frontend/src/tools/sheets/actions.ts`

Add:

- `openSqliteTable(dbPath, tableName)` action
- Update the open dialog to show SQLite as an option

### Verification

After Phase 5:

- can open a SQLite table as a sheet
- can edit scalar values in cells
- can save edits back to the database
- unsupported features (formulas, styles) are hidden
- tables without stable identity open read-only

---

## Phase 6: Polish and Gaps

### Goal

Fill in remaining gaps in agent tools, export support, and edge cases.

### Agent Tool Gaps

#### `src-tauri/src/agent_tools/sheets.rs`

- Add `delete_rows` and `delete_columns` to the agent schema (currently missing)
- Add `open_sheet` and `open_sqlite_table` as agent actions if needed
- Update `save_sheet` to dispatch based on source kind

### Export Support

#### `src-tauri/src/services/sheets_export.rs` (new)

Implement:

- `export_csv(sheet: &SheetState, path: &str) -> Result<(), SheetsError>`
  - write raw cell input as CSV
  - formulas are written as strings

- `export_xlsx(sheet: &SheetState, path: &str) -> Result<(), SheetsError>`
  - use IronCalc's XLSX export if available
  - otherwise use the existing `zip` crate or a new `xlsx` dependency

#### `src-tauri/src/tools/invoke/sheets.rs`

Add export IPC commands:

- `export_csv`
- `export_xlsx`

### Frontend Export

#### `frontend/src/tools/sheets/actions.ts`

Add:

- `exportSheet(format: "csv" | "xlsx")`
- Update toolbar to show "Export" button with format options

### Documentation

#### `frontend/src/tools/sheets/README.md`

Replace the current MVP README with updated documentation reflecting the new multi-format architecture.

### Edge Cases

- Handle files with mixed or unknown extensions gracefully
- Handle corrupted JSONL files with clear error messages
- Handle concurrent external modifications to CSV or SQLite sources (detect on save)
- Handle very large sheets (streaming JSONL parse, avoid loading entire file into memory)

---

## Migration Path Summary

### What Changes By Phase

| Component | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Type names | Genericized | - | - | - | - | - | - |
| JSONL I/O | - | New | - | - | - | - | - |
| Source model | - | - | New | - | - | Extended | - |
| Capabilities | - | - | New | - | Consumed | Extended | - |
| Formula engine | - | - | - | IronCalc | - | - | - |
| Frontend gating | Labels only | - | Receives caps | - | Full gating | - | - |
| SQLite adapter | - | - | - | - | - | New | - |
| Export | - | - | - | - | - | - | New |
| Agent tools | Renames | - | - | - | - | - | Gaps filled |

### Testing Strategy

- Phase 0: all existing tests pass with renamed types
- Phase 1: new JSONL round-trip tests
- Phase 2: capability enforcement tests
- Phase 3: formula parity tests between old and new engine
- Phase 4: manual UI verification of capability gating
- Phase 5: SQLite integration tests with real database files
- Phase 6: export round-trip tests

### Rollback Points

- Phase 0: trivially reversible (rename back)
- Phase 1: JSONL code is additive; can be disabled
- Phase 2: source model is additive; defaults to CSV behavior
- Phase 3: IronCalc behind a feature flag; old engine remains available
- Phase 4: frontend gating is cosmetic; can be disabled
- Phase 5: SQLite adapter is additive
- Phase 6: polish only

---

## File Inventory

### New Files

| File | Phase | Purpose |
| --- | --- | --- |
| `src-tauri/src/services/sheets_jsonl.rs` | 1 | JSONL parser and serializer |
| `src-tauri/src/services/sheets_capabilities.rs` | 2 | Capability set definitions |
| `src-tauri/src/services/sheets_source.rs` | 2 | Source adapter model |
| `src-tauri/src/services/sheets_sqlite.rs` | 5 | SQLite source adapter |
| `src-tauri/src/services/sheets_export.rs` | 6 | CSV and XLSX export |

### Modified Files

| File | Phases | Changes |
| --- | --- | --- |
| `src-tauri/src/services/sheets_types.rs` | 0, 1, 2 | Rename types, add style/meta fields, add source |
| `src-tauri/src/services/sheets_service.rs` | 0, 1, 2, 3, 5 | Rename methods, format dispatch, source awareness, engine switching |
| `src-tauri/src/services/sheets_formula.rs` | 3 | Add IronCalc engine alongside existing |
| `src-tauri/src/services/mod.rs` | 1, 2 | Register new modules |
| `src-tauri/src/tools/invoke/sheets.rs` | 0, 5, 6 | Rename commands, add SQLite/export commands |
| `src-tauri/src/agent_tools/sheets.rs` | 0, 6 | Fix naming, fill schema gaps |
| `src-tauri/Cargo.toml` | 3, 5 | Add ironcalc, possibly rusqlite changes |
| `frontend/src/tools/sheets/state.ts` | 0, 2, 4 | Rename types, add capabilities |
| `frontend/src/tools/sheets/actions.ts` | 0, 2, 4, 5, 6 | Rename functions, add export/SQLite actions |
| `frontend/src/tools/sheets/index.tsx` | 0, 4 | Rename labels, capability-gated toolbar |
| `frontend/src/tools/sheets/runtime.ts` | 0, 4 | Update empty state, hide formula bar |
| `frontend/src/tools/sheets/bindings.ts` | 0, 4 | Rename actions, capability gating |
| `frontend/src/tools/sheets/manifest.ts` | 0 | Update description |
| `frontend/tests/sheetsTool.test.ts` | 0 | Update to renamed types/actions |

---

## Open Implementation Questions

These should be resolved during Phase 0 or Phase 1 before later phases begin:

1. **IronCalc version pinning** — does `0.7.x` compile cleanly against the current dependency tree, or does it require a specific Rust edition or MSRV?
2. **rusqlite usage** — the project already depends on `rusqlite` (Cargo.toml line 19). Should the SQLite adapter reuse the existing `rusqlite` connection pool or open separate connections?
3. **File extension detection** — should format be detected purely by file extension, or should the parser inspect file content (e.g., check if first line is valid JSON)?
4. **Style migration from CSV** — when a CSV file is promoted to native JSONL via Save As, should the system auto-apply any default styles (e.g., bold headers)?
5. **XLSX export dependency** — should the project add a dedicated XLSX library, or rely on IronCalc's built-in XLSX support?
6. **Native JSONL file extension** — the design doc uses `.sheet.jsonl`. Should the file picker filter for this exact extension or for `.jsonl` broadly?
