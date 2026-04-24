# Sheets Design Review Draft

## Purpose

This document captures the current thinking for the next-generation Sheets architecture before implementation planning. It is intended for expert review and focuses on:

- native source-of-truth format
- support for multiple backing source types
- schema design for a compact one-sheet-per-file native format
- formula engine direction
- save, save as, and export semantics
- capability-based UI and backend behavior

This is a design document, not an implementation spec. It favors explicit decisions, tradeoffs, and rationale so the approach can be reviewed before detailed work begins.

## Current State

The current Sheets MVP is intentionally narrow:

- single-sheet only
- CSV open, edit, and save
- backend-owned workbook state in Rust
- formula evaluation in Rust
- frontend is a grid UI over backend snapshots

Today, the Rust backend service is the canonical owner of sheet state. The frontend holds transient UI state and rehydrates from backend snapshots after mutations. That architectural direction should remain intact.

## Core Direction

The proposed direction is:

1. Keep the backend as the canonical owner of the in-memory sheet session.
2. Adopt `IronCalc` as the spreadsheet formula and recalculation engine.
3. Introduce a native Arxell sheet file format for full-featured sheets.
4. Continue to support non-native backing sources such as CSV and SQLite tables directly, without converting them on open.
5. Hide or disable features that are not supported by the current backing source.

This gives the app a clear full-featured native format while still supporting data-oriented sources directly.

## High-Level Decisions

### Decision: Backend-Owned Session Model

The backend remains the source of truth for the active sheet session.

Reasoning:

- keeps user edits and agent edits on the same mutation path
- avoids divergent frontend and backend workbook semantics
- aligns with the current architecture
- is the cleanest fit for `IronCalc`

### Decision: `IronCalc` Over HyperFormula

`IronCalc` is the preferred formula engine for this app.

Reasoning:

- Rust-native and backend-friendly
- open source under permissive licensing
- workbook-oriented rather than just expression-oriented
- much better architectural fit than a TypeScript or Node-based engine

`HyperFormula` is technically strong, but it is TypeScript-centric and GPL/commercial, which makes it a poor center of gravity for a Rust/Tauri backend-owned sheets system.

### Decision: One Sheet Per Native File

The native format should be one file per sheet.

Reasoning:

- simpler than a workbook package in v1
- easier to inspect, diff, and move around
- aligns with the current single-sheet direction
- keeps the format focused and lean

This does not prevent multi-sheet support later. It only means multi-sheet should not be part of the initial file format contract.

### Decision: JSONL for the Native Full-Feature Format

The native full-featured format should be JSONL.

Reasoning:

- line-oriented diffs
- easy incremental reads
- easy grepability
- manually inspectable
- flexible enough for sparse records
- simple to serialize and parse in Rust

The goal is not to create a pure event-sourced log. The goal is a compact, line-oriented snapshot format.

### Decision: Sparse Row Records, Not Cell Records

The native JSONL format should use one record per non-empty row, with sparse cells inside the row.

Reasoning:

- simpler than one-line-per-cell
- much easier for humans to read
- still compact if sparse
- maps naturally to CSV import/export
- keeps file length manageable

Long rows are the main downside. The schema should counter that by using compact row and cell encodings, shared style ids, and omitted defaults.

### Decision: Multiple Source Types With Capability Gating

There should not be a single universal persisted format for all sheet sessions.

Instead, there should be:

- one normalized in-memory session model
- multiple backing source adapters
- one capability matrix that determines what features are available for a given source

This allows the app to open and edit:

- native `.sheet.jsonl`
- plain `.csv`
- a SQLite table

without converting on open.

## Design Goals

- preserve backend-owned canonical state
- support formulas through `IronCalc`
- keep native files compact and reviewable in Git
- support full-featured native sheets and reduced-feature non-native sources
- avoid hidden metadata sidecars in v1
- make unsupported features explicit rather than lossy
- preserve raw user intent in storage

## Non-Goals For Initial Design

- workbook packages with multiple sheets in one file
- collaborative real-time editing
- charts
- borders and advanced visual formatting
- conditional formatting
- rich text inside a cell
- hidden sidecar metadata for CSV or SQLite sources
- pure event sourcing as the only storage model

## Core Model

The system should have a normalized in-memory sheet session that is independent of the backing source.

### Session Components

Each open sheet session should contain:

- sheet grid state
- style table
- row metadata
- column metadata
- merge metadata
- source descriptor
- capability set
- dirty state
- revision state

### Source Descriptor

Each session should know where it came from.

Suggested source kinds:

- `native-jsonl`
- `csv`
- `sqlite-table`

Suggested source fields:

- `kind`
- `location`
- `identity`
- `readOnly`
- `capabilities`

Examples:

- native file at `/tmp/budget.sheet.jsonl`
- CSV file at `/tmp/budget.csv`
- SQLite source `db=/tmp/app.db, table=invoices`

### Capability Set

Capabilities should drive both the backend rules and the UI.

Suggested capabilities:

- `formulas`
- `styles`
- `formats`
- `typedCells`
- `columnWidths`
- `rowHeights`
- `frozenPanes`
- `merges`
- `insertRows`
- `deleteRows`
- `insertCols`
- `deleteCols`
- `renameCols`
- `schemaChanges`
- `transactions`

The UI should hide or disable unsupported operations instead of pretending all source types are equivalent.

## Source Types

### Native JSONL

This is the full-featured native sheet format.

Supports:

- formulas
- styles
- formats
- row metadata
- column metadata
- frozen panes
- merged cells
- save back to the same file

This is the only initial format intended to preserve the full sheet feature set.

### CSV

CSV should remain a first-class backing source that can be opened and saved directly without conversion.

Supports:

- raw cell values
- formula strings as raw text
- in-app formula evaluation for strings beginning with `=`
- saving raw content back to CSV

Does not support:

- styles
- formatting metadata
- merges
- frozen panes
- row heights
- column widths

Important note: CSV does not truly support sheet styles or layout. Those features should be unavailable rather than silently lost on save.

### SQLite Table

SQLite tables should also be openable directly as backing sources without conversion.

Supports:

- typed cell data from SQLite columns
- scalar editing
- transaction-backed saves
- row insertion and deletion where safe

Does not support in v1:

- formulas stored as spreadsheet formulas
- styles
- formatting metadata
- merges
- frozen panes
- column insertion and deletion
- schema editing by default

For SQLite tables, formulas should generally be disabled in v1. A database table is not a spreadsheet-native format, and storing spreadsheet formulas inside typed columns is usually the wrong behavior.

If a table lacks a stable row identity, it should likely open read-only.

## Native JSONL Format

### Naming

Suggested extension:

- `.sheet.jsonl`

Example:

- `budget.sheet.jsonl`

### Record Ordering

The file should have deterministic record ordering.

Recommended order:

1. sheet header
2. style table
3. optional frozen panes
4. optional column metadata
5. optional row metadata
6. optional merge records
7. row records

Rows should be sorted by row index.

Cells inside each row should be sorted by column index.

### Canonical Stored Data

The native file should persist only canonical user-authored state.

Canonical:

- sheet name
- grid size metadata
- raw cell input
- style definitions
- row metadata
- column metadata
- merge metadata
- default locale/currency/timezone display context

Derived, not canonical:

- computed values
- dependency graph
- recalculation caches
- internal `IronCalc` structures

The backend should rebuild derived state from canonical stored state on load.

### Cell Value Rule

Cell values should be stored as raw input strings.

Examples:

- `"42"`
- `"12.500"`
- `"TRUE"`
- `"2026-04-19"`
- `"=SUM(B2:B40)"`
- `"'=literal-leading-equals"`

Reasoning:

- preserves formulas exactly
- preserves typed user intent as entered
- avoids ambiguity between value, display, and source text
- aligns with how spreadsheet editing actually behaves

Formatting determines display. Formulas determine computed values. Storage keeps the original input.

## Native Schema

The schema is intentionally compact, but it should not become cryptic beyond reason.

The biggest size savings come from sparse rows, tuple cells, shared styles, and omitted defaults. Short key names help, but they are secondary.

### Record Types

The initial record types should be:

- `s` sheet header
- `st` style table
- `fz` frozen panes
- `cm` column metadata
- `rm` row metadata
- `mg` merged ranges
- `r` row data

### Sheet Header Record

Example:

```json
{"t":"s","sv":1,"n":"Budget","sz":[2000,50],"lc":"en-US","cy":"USD","tz":"UTC","ds":0}
```

Fields:

- `t`: record type, always `s`
- `sv`: schema version
- `n`: sheet name
- `sz`: `[rowCount,colCount]`
- `lc`: locale
- `cy`: default currency code for `$` display formats
- `tz`: timezone
- `ds`: default style id

Notes:

- `ds` should normally be `0`
- `lc`, `cy`, and `tz` are display and interpretation context, not computed cache

### Style Table Record

Example:

```json
{"t":"st","v":[{}, {"f":"$2","a":">"}, {"f":"#2","a":">"}, {"f":"dt","a":">"}, {"m":["**"]}]}
```

Fields:

- `t`: record type, always `st`
- `v`: style array where the array index is the style id

Rules:

- style `0` is always the default empty style `{}`
- cells refer to styles by integer id
- repeated inline style objects should be avoided

### Frozen Panes Record

Example:

```json
{"t":"fz","v":[1,0]}
```

Meaning:

- `[frozenRows,frozenCols]`

### Column Metadata Record

Example:

```json
{"t":"cm","v":[[0,180],[1,96,1],[4,120,0,1]]}
```

Each tuple is:

- `[col,width?,styleId?,hidden?]`

Notes:

- omit defaults where possible
- `hidden` should be `1` when true

### Row Metadata Record

Example:

```json
{"t":"rm","v":[[0,28,4],[10,22],[15,0,0,1]]}
```

Each tuple is:

- `[row,height?,styleId?,hidden?]`

### Merge Record

Example:

```json
{"t":"mg","v":[[0,0,0,3],[5,2,7,2]]}
```

Each tuple is:

- `[r1,c1,r2,c2]`

### Row Data Record

Example:

```json
{"t":"r","r":0,"c":[[0,"Item",4],[1,"Cost",4],[2,"Paid At",4]]}
{"t":"r","r":1,"c":[[0,"Hosting"],[1,"=ROUND(12*5,2)",1],[2,"2026-04-19 13:30",3]]}
{"t":"r","r":40,"c":[[1,"=SUM(B2:B40)",1]]}
```

Fields:

- `t`: record type, always `r`
- `r`: row index
- `c`: sparse list of cell tuples

Each cell tuple is:

- `[col,rawInput,styleId?]`

Rules:

- omit empty rows entirely
- omit empty cells entirely
- style id may be omitted if default style applies

## Style Schema

### Style Principles

The style system should be intentionally limited in v1.

Support only:

- display formatting
- basic text marks
- alignment
- text and fill colors
- wrapping

Skip in v1:

- borders
- conditional formatting
- rich text
- data validation
- filters
- notes/comments

### Style Keys

Recommended style keys:

- `f`: format code
- `m`: text marks
- `a`: horizontal alignment
- `va`: vertical alignment
- `fg`: foreground/text color
- `bg`: background/fill color
- `w`: wrap

Example:

```json
{"f":"$2","a":">","m":["**"],"fg":"k","bg":"gy","w":1}
```

### Format Codes

Borrow compact symbolic conventions where it makes the format easier to read.

General:

- `g`: general
- `@`: plain text

Numbers:

- `#`: number, default decimals
- `#0`: integer
- `#1`: one decimal
- `#2`: two decimals
- `#3`: three decimals
- `#,0`: grouped integer
- `#,1`: grouped one decimal
- `#,2`: grouped two decimals
- `#,3`: grouped three decimals

Currency:

- `$`: currency, default decimals
- `$0`: currency, zero decimals
- `$1`: currency, one decimal
- `$2`: currency, two decimals
- `$3`: currency, three decimals

Percent:

- `%`: percent, zero decimals
- `%1`: percent, one decimal
- `%2`: percent, two decimals
- `%3`: percent, three decimals

Date/time:

- `d`: date
- `t`: time
- `dt`: datetime

Possible future extensions:

- `e`: scientific notation
- `du`: duration
- `x:<custom>`: custom format escape hatch

### Currency Semantics

The compact format code can use `$` for currency display classes, but the actual currency identity should come from sheet or context metadata such as `cy: "USD"`.

Reasoning:

- `$` is compact and familiar
- `USD`, `CAD`, and `AUD` all render as currency classes in many UX contexts
- the actual currency identity should not be encoded only in a display token

### Rounding Rule

There are two different concepts:

- formula rounding
- display rounding

Formula rounding:

- uses a formula like `=ROUND(B2,2)`
- changes the computed value

Display rounding:

- uses a style format like `$2` or `#2`
- changes only the display

The system must preserve this distinction.

### Text Marks

Borrow from Markdown where it keeps formatting compact and recognizable.

Recommended marks:

- `**`: bold
- `_`: italic
- `~~`: strikethrough
- `` ` ``: monospace
- `u`: underline

Store marks as an array:

```json
{"m":["**","_"]}
```

### Alignment Codes

Horizontal alignment `a`:

- `<`: left
- `>`: right
- `=`: center
- `j`: justify

Vertical alignment `va`:

- `^`: top
- `=`: middle
- `v`: bottom

### Colors

Support short palette tokens and full hex values.

Suggested palette:

- `k`: default dark
- `w`: white
- `r`: red
- `g`: green
- `b`: blue
- `y`: yellow
- `o`: orange
- `p`: purple
- `c`: cyan
- `gy`: gray

Examples:

- `"fg":"r"`
- `"bg":"gy"`
- `"fg":"#1f2937"`

### Wrap

- `w: 1` means wrap on
- omitted means wrap off

## Why Sparse Rows Instead Of Cell Records

This was considered explicitly.

### Pros of Row Records

- simpler mental model
- closer to how spreadsheet users think
- fewer total records
- easier for humans to inspect
- natural fit for CSV import/export
- easy row-wise streaming

### Cons of Row Records

- editing one cell rewrites the whole row line
- very wide rows can become long
- column insert/delete touches many row records

### Why Row Records Still Win

For this project, the simplicity benefits outweigh the surgical-diff benefits of one-line-per-cell.

The schema design reduces the row-length downside by using:

- sparse rows
- sparse cells
- tuple cells
- shared style ids
- omitted defaults

That produces a compact, readable format without the complexity of pure cell-event records.

## Save Semantics

The system should distinguish clearly between `Save`, `Save As`, and `Export`.

### Save

`Save` writes back to the original backing source.

Examples:

- native JSONL sheet saves back to the same `.sheet.jsonl`
- CSV saves back to the same `.csv`
- SQLite-backed session writes changes back to the same table

### Save As

`Save As` creates a new backing source and switches the current session to that new source.

Examples:

- CSV -> native JSONL
- native JSONL -> CSV
- SQLite table -> native JSONL

`Save As` is a conversion that changes the session's backing source after success.

### Export

`Export` writes another format without changing the current backing source.

Examples:

- native JSONL export to CSV
- native JSONL export to XLSX
- SQLite-backed table export to CSV

`Export` should never silently change the session's source type.

## Capability Matrix

Initial recommended behavior:

| Source | Formulas | Styles | Formats | Typed Cells | Row/Col Layout | Merges | Save Back |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Native JSONL | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| CSV | Yes as raw formula strings | No | No | Weak/text-like | No | No | Yes |
| SQLite Table | No in v1 | No | No | Yes | No | No | Yes |

Notes:

- CSV can preserve formulas as raw strings beginning with `=` and evaluate them in-app.
- SQLite should remain data-table oriented in v1 and should not pretend to be a full spreadsheet source.

## No Sidecars In v1

The initial design should avoid hidden sidecar metadata files or hidden metadata tables.

Examples to avoid in v1:

- `budget.csv.meta`
- hidden SQLite tables for visual formatting overlays
- split ownership between raw data and invisible formatting stores

Reasoning:

- makes source of truth ambiguous
- increases user surprise
- complicates save behavior
- makes review and debugging harder

The rule for v1 should be simple:

- if a source type does not support a feature, that feature is unavailable when editing that source directly

## Adapter Model

Each source type should be implemented by a backend adapter.

Suggested responsibilities:

- load source into normalized session state
- advertise capabilities
- save normalized session state back to the source
- describe source identity and read-only constraints

Suggested adapter contract:

- `load() -> SheetSession`
- `save(session) -> Result`
- `capabilities() -> CapabilitySet`
- `describe() -> SourceInfo`

Possible future additions:

- `refresh()`
- `detectExternalChanges()`
- `export(format)`

## CSV Adapter Behavior

Recommended CSV rules:

- read fields as raw strings
- if a field begins with `=`, allow formula evaluation in-app
- save raw strings back to CSV
- disable styles, layout, merges, and formatting metadata

This allows CSV to act as a data-first sheet source without pretending it is a rich spreadsheet container.

## SQLite Adapter Behavior

Recommended SQLite rules:

- require a stable row identity where possible
- map visible columns directly to table columns
- update values in a transaction
- open read-only when row identity is unsafe or ambiguous
- disable spreadsheet-only features in v1

Formulas should be disabled in v1 for SQLite-backed sheets unless a future design introduces an explicit formula layer separate from stored table values.

## Native JSONL and `IronCalc`

The native JSONL format should not serialize `IronCalc` internals directly.

Instead:

1. parse native JSONL into the normalized sheet session
2. feed raw cell inputs into `IronCalc`
3. rebuild dependency graph and computed values in memory
4. expose computed snapshots to the UI
5. persist only canonical user-authored state back to JSONL

Reasoning:

- keeps the file format stable even if the engine changes
- avoids locking the storage format to private engine structures
- makes the format easier to inspect and reason about

## Example Native File

```json
{"t":"s","sv":1,"n":"Budget","sz":[2000,50],"lc":"en-US","cy":"USD","tz":"UTC","ds":0}
{"t":"st","v":[{}, {"f":"$2","a":">"}, {"f":"#2","a":">"}, {"f":"dt","a":">"}, {"m":["**"]}, {"m":["**"],"a":"="}, {"f":"%1","a":">"}, {"fg":"r"}, {"bg":"gy"}]}
{"t":"fz","v":[1,0]}
{"t":"cm","v":[[0,220],[1,110,1],[2,160,3],[3,90,6]]}
{"t":"rm","v":[[0,28,5]]}
{"t":"mg","v":[[0,0,0,3]]}
{"t":"r","r":0,"c":[[0,"Budget Overview",5]]}
{"t":"r","r":1,"c":[[0,"Item",4],[1,"Cost",4],[2,"Paid At",4],[3,"Tax",4]]}
{"t":"r","r":2,"c":[[0,"Hosting"],[1,"=ROUND(12*5,2)",1],[2,"2026-04-19 13:30",3],[3,"0.0825",6]]}
{"t":"r","r":3,"c":[[0,"Domain"],[1,"14.00",1],[2,"2026-04-20 09:15",3],[3,"0.0825",6]]}
{"t":"r","r":40,"c":[[0,"Total",4],[1,"=SUM(B3:B40)",1]]}
```

## Open Questions For Expert Review

These are the main areas worth challenging before implementation planning:

1. Should native cell `rawInput` always be stored as strings, or is there enough value in typed JSON scalars to justify the extra ambiguity and conversion rules?
2. Should SQLite-backed sheets allow formulas at all in v1, or should that wait for a separate overlay model?
3. Are the compact format codes such as `$2`, `%1`, `#2`, and `dt` sufficient for the expected early use cases?
4. Should merged cells be included in v1 of the native schema or deferred even if the record type is reserved?
5. Is one row record per non-empty row the right long-term balance, or will very wide sheets push the design toward chunked rows later?
6. Should the style mark vocabulary stay Markdown-like, or should it use more explicit semantic tokens even if that is slightly longer?

## Recommended Next Step

If this direction is accepted, the next document should be a detailed implementation plan covering:

- backend session and source adapter types
- `IronCalc` integration strategy
- native JSONL parser and serializer behavior
- capability-driven UI behavior
- CSV and SQLite save rules
- migration path from the current CSV-only MVP
