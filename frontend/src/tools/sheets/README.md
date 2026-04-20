# Sheets MVP

## Scope

- Single-sheet CSV open, edit, and save
- Backend-owned canonical workbook state in Rust
- Formula evaluation in Rust for both user and agent edits
- Frontend grid rendering with `react-datasheet-grid`

## Supported Formulas

- Cell references like `=A1`
- Arithmetic with `+`, `-`, `*`, `/`, and parentheses
- Ranges like `A1:A5`
- Functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `IF`, `COUNT`

## Agent Capabilities

- Inspect the current sheet
- Read a range
- Set one cell or write a rectangular range
- Insert rows or columns
- Save the current open sheet

## Design Notes

- The Rust `SheetsService` is the source of truth for workbook state.
- The frontend only keeps transient UI state plus a refreshed snapshot cache.
- Agent and user edits share the same backend mutation paths.

## Known Limitations

- CSV only
- Single sheet only
- No merged cells, charts, collaboration, or XLSX support
- Frontend refreshes by re-reading backend snapshots after each mutation
