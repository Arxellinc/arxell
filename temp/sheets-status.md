# Sheets Migration — Phase Status

## Overview

Migration from CSV-only MVP to multi-format architecture with native `.sheet.jsonl`, IronCalc engine, source adapters, and capability gating.

---

## Phase 0 — COMPLETED

**Goal**: Genericize all CSV-specific naming with zero behavior change.

### Changes

**Backend (`sheets_types.rs`, `sheets_service.rs`, `invoke/sheets.rs`)**
- `OpenCsvResult` → `OpenSheetResult`, `SaveCsvResult` → `SaveSheetResult`
- `open_csv()` → `open_sheet()`, `save_csv()` → `save_sheet()`
- IPC actions `open_csv`/`save_csv` → `open_sheet`/`save_sheet`
- Payload types `OpenCsvPayload`/`SaveCsvPayload` → `OpenSheetPayload`/`SaveSheetPayload`
- Added `format: String` field to `WorkbookState` (default `"csv"`, `#[serde(default)]`)

**Agent tools (`agent_tools/sheets.rs`)**
- Fixed `save_sheet` → `service.save_sheet()`
- Added missing `delete_rows` and `delete_columns` to schema and handlers

**Frontend (`state.ts`, `actions.ts`, `index.tsx`, `runtime.ts`, `bindings.ts`, `manifest.ts`, `workspaceRuntime.ts`, `workspaceDispatch.ts`, `main.ts`)**
- All functions, types, dialog titles, button labels, binding actions renamed
- `openCsv`/`saveCsv` → `openSheet`/`saveSheet` across ~15 files

### Verification
- 16 backend tests + 17 frontend tests pass
- CSV open/save works identically

---

## Phase 1 — COMPLETED

**Goal**: Native JSONL parser and serializer for `.sheet.jsonl` format.

### Changes

**New file: `sheets_jsonl.rs`**
- Types: `CellStyle`, `ColMeta`, `RowMeta`, `SheetHeader`, `CellTuple`, `RowData`, `MergedRange`, `JsonlSheetData`
- `parse_jsonl()` / `serialize_jsonl()` — full round-trip capable
- `jsonl_to_sheet_state()` / `sheet_state_to_jsonl()` — conversion to/from `SheetState`

**Modified: `sheets_service.rs`**
- `detect_format()` wired into `open_sheet()` and `save_sheet()` — branches on `.sheet.jsonl` vs `.csv`

**Modified: `mod.rs`**
- Registered `pub mod sheets_jsonl;`

### Tests Added
- `jsonl_file_round_trip` — parse → serialize → parse produces identical state
- `jsonl_empty_sheet` — empty sheet serializes/deserializes
- `jsonl_handles_sparse_rows` / `jsonl_handles_sparse_cells` — only non-empty data appears
- `jsonl_style_table_round_trip` — style ids resolve correctly
- `jsonl_col_and_row_meta_round_trip` — column/row metadata preserved
- `jsonl_unknown_records_skipped` — forward compat with unknown record types
- `jsonl_missing_optional_records` — `fz`, `cm`, `rm`, `mg` are optional
- `jsonl_format_detection` — file extension detection

### Verification
- 26 total sheets tests pass (9 new JSONL + 1 format detection + 16 existing)

---

## Phase 2 — COMPLETED

**Goal**: Source adapter model and capability system.

### Changes

**New file: `sheets_capabilities.rs`**
- `CapabilitySet` struct with 15 boolean flags: `formulas`, `styles`, `formats`, `typed_cells`, `column_widths`, `row_heights`, `frozen_panes`, `merges`, `insert_rows`, `delete_rows`, `insert_cols`, `delete_cols`, `rename_cols`, `schema_changes`, `transactions`
- `capabilities_for_native()` — all on
- `capabilities_for_csv()` — formulas, insert/delete rows/cols on
- `capabilities_for_sqlite()` — typed_cells, insert/delete rows, transactions on

**New file: `sheets_source.rs`**
- `SheetSourceKind` enum: `NativeJsonl`, `Csv`, `SqliteTable`
- `SheetSource` struct: kind, location, identity, read_only, capabilities
- `source_from_path()` — detect kind from extension
- `source_for_new_sheet()` — default source for new sheets
- `source_for_sqlite()` — SQLite source factory

**Modified: `sheets_types.rs`**
- `WorkbookState` now carries `source: SheetSource` (`#[serde(default)]`, defaults to CSV)

**Modified: `sheets_service.rs`**
- `OpenSheetResult` includes `capabilities: CapabilitySet`
- `inspect_sheet()` and `new_sheet()` expose capabilities

**Modified: Frontend `state.ts`, `actions.ts`**
- `SheetsToolState` has `sourceKind: string` and `capabilities: Record<string, boolean>`
- `openSheet()` parses capabilities and infers sourceKind via `inferSourceKind()`

### Verification
- 26 backend tests + 17 frontend tests pass

---

## Phase 3 — COMPLETED

**Goal**: Replace custom formula engine with IronCalc behind the existing `FormulaEngine` trait.

### Changes

**`Cargo.toml`**
- Added `ironcalc = "0.7.1"` dependency
- Added `ironcalc-engine` feature flag (opt-in, default off)

**`sheets_formula.rs`**
- `IronCalcEngine` struct (gated behind `#[cfg(feature = "ironcalc-engine")]`)
- Implements `FormulaEngine` — creates temporary IronCalc `Model`, feeds cells (0→1 based index conversion), calls `evaluate()`, extracts computed values and errors
- Handles `CellType::ErrorValue` detection with formatted error messages via `get_formatted_cell_value()`
- `create_engine()` factory returns `Box<dyn FormulaEngine>` — switches between `IronCalcEngine` and `BackendFormulaEngine` based on feature flag
- `BackendFormulaEngine` preserved as fallback when feature is off

**`sheets_service.rs`**
- `formula_engine` field changed from `BackendFormulaEngine` to `Box<dyn FormulaEngine>`
- `mutate_sheet()` and `finalize_sheet()` signatures updated to `&dyn FormulaEngine`
- All call sites use `self.formula_engine.as_ref()`

### Parity Tests Added (9 tests, behind `#[cfg(feature = "ironcalc-engine")]`)
- `ironcalc_basic_arithmetic_and_references` — `=A1*3`, `=A1+B1`
- `ironcalc_sum_range` — `=SUM(A1:A3)`
- `ironcalc_circular_reference_surfaces_error` — `=B1`/`=A1` cycle
- `ironcalc_division_by_zero_surfaces_error` — `=A1/0`
- `ironcalc_average_function` — `=AVERAGE(A1:A3)`
- `ironcalc_if_function` — `=IF(A1>3,"yes","no")`
- `ironcalc_boolean_literals` — TRUE/FALSE
- `ironcalc_text_values` — `=A1&" world"` concatenation
- `ironcalc_parity_with_backend_arithmetic` — runs same cells through both engines, asserts identical computed values

### Behavior Differences
- IronCalc treats out-of-bounds references as empty cells (like Excel), not errors — test updated to be engine-agnostic
- Error messages differ (e.g., `#CIRC!` vs "circular reference") — tests check error presence, not text

### Verification
- 53 tests pass without feature (default engine)
- 62 tests pass with `--features ironcalc-engine` (53 base + 9 parity)

---

## Phase 3.5 + Phase 4 — COMPLETED

**Goal**: App always opens with a ready spreadsheet (never blank screen). Frontend hides/disables features per source capabilities.

### Backend Changes

**`sheets_source.rs`**
- `source_for_new_sheet()` returns `NativeJsonl` with full capabilities (was CSV)

**`sheets_service.rs`**
- `new_sheet()` uses format `"jsonl"`, file name `"New Sheet"` (was `"New Sheet.csv"`, `"csv"`)
- Returns `capabilities` in `InspectSheetResult`
- `inspect_sheet()` also returns capabilities from current workbook

**`sheets_types.rs`**
- `InspectSheetResult` gains `capabilities: Option<CapabilitySet>` field (`#[serde(default)]`)

### Frontend Changes

**`state.ts`**
- `SheetsInspectResult` type includes optional `capabilities`

**`actions.ts`**
- `createNewSheet()` — sets `capabilities` and `sourceKind` from backend response
- `refreshSheetSnapshot()` — propagates capabilities from `inspect_sheet` result
- `inferSourceKind()` — maps capabilities to `"nativeJsonl"`, `"sqliteTable"`, or `"csv"`

**`main.ts`**
- `ensureWorkbook` directly calls `createNewSheet()` when no workbook exists (1 IPC call instead of inspect→fallback→create)

**`index.tsx` — Toolbar capability gating**
- Add Row/Column buttons disabled when `insertRows`/`insertCols` capability is false
- Delete Row/Column buttons disabled when `deleteRows`/`deleteCols` capability is false
- Buttons remain enabled when capabilities are absent (backward compat)

**`runtime.ts` — Runtime capability gating**
- Formula bar (input + Apply button) hidden when `capabilities.formulas` is false
- Status row shows source kind: "Native" / "SQLite" / "CSV"

**`bindings.ts` — Action capability gating**
- `add-row`/`add-column`/`delete-row`/`delete-column` check capability before executing
- Shows `window.alert("This action is not supported for the current sheet format.")` when capability is missing

### Verification
- 53 backend tests pass (default), 62 with ironcalc-engine
- 17 frontend tests pass
- Frontend build and TypeScript check pass

---

## Phase 5 — PENDING

SQLite source adapter (open/edit/save SQLite tables as sheets).

## Phase 6 — PENDING

Polish: agent gaps, export (CSV/XLSX), edge cases, README update.
