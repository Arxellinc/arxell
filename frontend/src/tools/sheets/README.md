# Sheets Tool

## Current Scope

- Backend-owned canonical workbook state in Rust
- Canvas-based frontend grid runtime (selection, edit, resize, fill, context menu)
- Open, create, inspect, edit, and save workflows through invoke actions
- Formula evaluation in Rust for both user and agent edits
- Formula bar with function autocomplete and AI model selection
- Undo/redo and row/column insert/delete flows

## Supported Formulas

See `docs/Supported-Formulas.md` for the canonical and complete list.

## Agent Capabilities

- Create or open a sheet
- Inspect metadata for the current sheet
- Read a range
- Set one cell or write a rectangular range
- Insert/delete rows or columns
- Save the current open sheet

## Design Notes

- The Rust `SheetsService` is the source of truth for workbook state.
- The frontend keeps transient UI state plus a refreshed snapshot cache.
- Agent and user edits share backend mutation paths with source tagging.
- Frontend invokes backend actions via `toolId: "sheets"` and typed action payloads.

## Known Limitations

- XLSX import/export is not implemented.
- Multi-sheet workbook UX is limited; primary flow targets a single active sheet view.
- Several toolbar formatting/styling actions are currently present as UI affordances and not fully wired end-to-end.
- Frontend still relies on snapshot/range refreshes after many backend mutations.
