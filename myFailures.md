# Sheets Bug Debugging Failures

This file records attempted fixes for the sheets tool layout-jump bug that did **not** solve the issue, so they are not retried blindly.

## Bug Summary

- Symptom: the sheet jumps horizontally by roughly 20-40px.
- Observed behavior: the row-number gutter appears to expand while other cells contract.
- Trigger: often happens when switching cells with `Tab`, `Enter`, or mouse click after editing.
- Additional observation: can also happen randomly even when nothing has been edited.

## Attempted Fixes That Failed

### 1. Stabilize grid props with memoization

Files touched:
- `frontend/src/tools/sheets/runtime.ts`

Attempt:
- Memoized `rows` and `columns` with `useMemo`.
- Memoized `gutterColumn`.
- Pinned gutter width with `basis`, `minWidth`, and `maxWidth`.

Why it was tried:
- Suspected `react-datasheet-grid` was recalculating gutter width because props were recreated on each render.

Result:
- Failed. The jitter still occurred after app restart.

### 2. Disable grid transitions/animation

Files touched:
- `frontend/src/tools/sheets/styles.css`

Attempt:
- Set `--dsg-transition-duration: 0s`.
- Disabled transitions on `.dsg-active-cell`, `.dsg-selection-rect`, `.dsg-cell-header`, `.dsg-cell-gutter`, and `.dsg-scrollable-view`.

Why it was tried:
- Suspected the visual movement was only an animated overlay/selection transition.

Result:
- Failed. The sheet still jumped.

### 3. Reserve scrollbar gutter space in CSS

Files touched:
- `frontend/src/tools/sheets/styles.css`

Attempt:
- Added `scrollbar-gutter: stable` to the grid container.
- Also set explicit `overflow-x: auto` alongside the existing scrolling behavior.

Why it was tried:
- Suspected container width was oscillating when scrollbar space appeared/disappeared, causing columns to recompute.

Result:
- Failed. Restarting the app did not change the behavior.

### 4. Make sheet columns fixed-width

Files touched:
- `frontend/src/tools/sheets/gridMapping.ts`

Attempt:
- Changed data columns from flexible sizing to fixed sizing.
- Set `grow: 0`, `shrink: 0`, `minWidth: 124`, and `maxWidth: 124`.

Why it was tried:
- Suspected transient container width changes were causing all sheet columns to contract/expand.

Result:
- Failed. No visible improvement.

### 5. Remove sheets runtime dependency on full-app rerender

Files touched:
- `frontend/src/tools/sheets/runtime.ts`
- `frontend/src/main.ts`

Attempt:
- Removed the sheets runtime `rerender` callback that was wired to `renderAndBind(sendMessage)`.
- Added a local React-root rerender path inside the sheets runtime instead.

Why it was tried:
- Suspected sheet-local interactions were indirectly triggering a full app rebuild via `app.innerHTML = ...`, causing DOM teardown/recreation and a visible snap.

Result:
- Failed. User confirmed this was not the problem.

### 6. Stabilize DSG container scrollbar/transform behavior

Files touched:
- `frontend/src/tools/sheets/styles.css`
- `frontend/src/tools/sheets/runtime.ts`
- `frontend/src/tools/sheets/gridMapping.ts`

Attempt:
- Applied `overflow-x: auto`, `scrollbar-gutter: stable`, and `will-change: auto` to `.sheets-grid > .dsg-container`.
- Added `rowKey: "__rowIndex"` to `DataSheetGrid`.
- Removed temporary debug logging from the sheets runtime and grid mapping.

Why it was tried:
- Suspected the visible left-right jump was caused by the real DSG scroll container changing its measured viewport or by sticky gutter jitter related to the library's `will-change: transform` on `.dsg-container`.
- Added explicit row identity in case virtualization churn during commit was contributing to the snap.

Result:
- Failed. The bug still occurred, and it introduced a noticeable pause after cell edits were committed.

## Current Conclusion

The bug has **not** been fixed by:

- stabilizing React props
- disabling grid transitions
- reserving scrollbar gutter space
- forcing fixed column widths
- removing the sheets-local full-app rerender hook
- stabilizing the DSG container scrollbar/transform behavior and adding explicit row keys

Future debugging should avoid repeating these exact fixes unless new evidence suggests one was only partially implemented or later reverted.

## Investigation Findings (Not Fixes)

### Investigation 1: Gutter Column Resizing Hypothesis (2026-04-20)

#### Files Investigated
- `frontend/src/tools/sheets/runtime.ts` - grid configuration with `gutterColumn: { basis: 48, grow: 0, shrink: 0, minWidth: 48 }`
- `frontend/src/tools/sheets/gridMapping.ts` - column definitions with `basis: 124, grow: 1, shrink: 0, minWidth: 88`
- `frontend/src/tools/sheets/state.ts` - cell state management
- `frontend/node_modules/react-datasheet-grid/dist/style.css` - library CSS
- `frontend/node_modules/react-datasheet-grid/dist/components/DataSheetGrid.js` - main grid component
- `frontend/node_modules/react-datasheet-grid/dist/components/Grid.js` - virtualized grid rendering
- `frontend/node_modules/react-datasheet-grid/dist/hooks/useColumnWidths.js` - column width calculation
- `frontend/node_modules/react-datasheet-grid/dist/hooks/useRowHeights.js` - row height calculation
- `frontend/node_modules/react-datasheet-grid/dist/components/SelectionRect.js` - selection rectangle rendering

#### Key Findings

1. **Gutter column is statically sized** - `gutterColumn: { basis: 48, grow: 0, shrink: 0, minWidth: 48 }` is fixed and does not change based on cell content.

2. **Column widths are stable** - `getColumnWidths()` uses a hash of `[basis,minWidth,maxWidth,grow,shrink]` to memoize calculations. Unless these values change, widths won't recalculate.

3. **Row heights are stable** - `useRowHeights` uses `useMemo` with `[rowHeight, value]` dependencies. With a fixed `rowHeight=30`, only the `value` (rows array) triggers recalculation.

4. **CSS transitions exist but are short** - `transition: all var(--dsg-transition-duration)` where `--dsg-transition-duration: 0.1s` by default.

5. **`continuousUpdates: false` in gridMapping.ts** - This setting in `createTextColumn` should prevent continuous column updates.

6. **Scroll-to behavior** - When editing ends (Enter/Tab/click), `stopEditing()` → `setActiveCell()` → `scrollTo(activeCell)` is called. The `scrollTo` function can return early if `height` or `width` from `useResizeDetector` is undefined.

7. **`will-change: transform` on `.dsg-container`** - This CSS property hints the browser to optimize for transform changes.

8. **Selection rectangle positioning** - The `SelectionRect` component calculates absolute positions for the selection overlay based on `columnWidths`, `columnRights`, `rowHeight`, and `headerRowHeight`.

#### Hypothesis (Not Confirmed)

The issue may be related to the interaction between:
- The `scrollTo` effect firing when `activeCell` changes after editing ends
- The `useResizeDetector` potentially returning `undefined` dimensions momentarily
- The `rerenderRuntime()` call after `onGridChange` causing a full parent re-render with new `rows` data
- The virtualized grid recalculating visible items when `rows` reference changes

#### User Clarification
- Issue occurs on **every cell edit completion** (Enter, Tab, or click-away), not during typing
- Issue persists after app restart
- Issue happens even with few rows (5) and even on first edit

### Investigation 2: Notepad Gutter Comparison (2026-04-20)

#### Files Investigated
- `frontend/src/tools/notepad/shared.ts` - custom line number gutter implementation
- `frontend/src/tools/notepad/styles.css` - gutter CSS with `--notepad-editor-gutter-width` CSS variable

#### Comparison Findings

The notepad tool uses a completely different, manual gutter implementation:
- Gutter width is computed as `Math.max(4, String(Math.max(1, lineCount)).length + 2)` characters
- Width is set via CSS variable `--notepad-editor-gutter-width`
- The gutter uses CSS Grid: `grid-template-columns: var(--notepad-editor-gutter-width, 4ch) minmax(0, 1fr)`
- Gutter width is refreshed via `panel.style.setProperty("--notepad-editor-gutter-width", ...)` when line count changes

**Key difference**: The notepad gutter dynamically adjusts its width based on line count (number of digits). The sheets gutter is fixed at 48px. This suggests the notepad approach could experience similar jitter if the width changed, but it's implemented differently.

### Investigation 3: Library-Level Scroll and Selection Behavior (2026-04-20)

#### Key Library Code Paths

1. **When editing ends via Enter** (`DataSheetGrid.js`):
   - `stopEditing()` is called
   - If not at last row: `setEditing(false)` + `setActiveCell((a) => a && { col: a.col, row: a.row + 1 })`
   - This triggers `onChange(nextRows, operations)` with the edited data
   - The `scrollTo` effect runs with new `activeCell`

2. **The scrollTo function** (lines 255-308):
   ```javascript
   const scrollTo = useCallback((cell) => {
       if (!height || !width) { return; }  // Early return if dimensions unavailable
       // ... scroll calculations ...
   }, [height, width, headerRowHeight, columnRights, columnWidths, getRowSize, hasStickyRightColumn]);
   ```

3. **The activeCell effect** (lines 316-320):
   ```javascript
   useEffect(() => {
       if (activeCell) { scrollTo(activeCell); }
   }, [activeCell, scrollTo]);
   ```

4. **The selectionCell effect** (lines 310-314):
   ```javascript
   useEffect(() => {
       if (selectionCell) { scrollTo(selectionCell); }
   }, [selectionCell, scrollTo]);
   ```

#### Observation

The `scrollTo` function has an **early return guard**: `if (!height || !width) { return; }`. This could cause the scroll effect to not execute properly if `useResizeDetector` hasn't provided dimensions yet.

### Investigation 4: The Virtualizer's `rangeExtractor` (2026-04-20)

#### Key Finding

In `Grid.js`, the column virtualizer has a custom `rangeExtractor`:

```javascript
rangeExtractor: (range) => {
    const result = defaultRangeExtractor(range);
    if (result[0] !== 0) {
        result.unshift(0);  // Always include column 0 (gutter)
    }
    if (hasStickyRightColumn && result[result.length - 1] !== columns.length - 1) {
        result.push(columns.length - 1);  // Always include last column
    }
    return result;
}
```

This ensures:
1. Column 0 (the gutter) is always in the visible range
2. The last column (if sticky right) is always in the visible range

This is relevant because it means the gutter column is always rendered.

### Open Questions

1. **Why does the sheet "jump back and forth"?** The visual effect suggests the gutter moves left while content moves right (or vice versa), creating a 20-40px oscillation.

2. **Is there a CSS transition on the gutter itself?** The library CSS shows transitions on color (`transition: color var(--dsg-transition-duration)`) but not on width or position for `.dsg-cell-gutter`.

3. **Could `will-change: transform` interact poorly with absolute-positioned selection overlays?** The transform hint combined with the absolutely-positioned selection rect might cause layering issues.

4. **What is the exact DOM structure during the jump?** Adding DOM inspection during the bug would help identify whether:
   - The gutter element actually changes width
   - The grid container's scrollLeft changes
   - CSS transforms are being applied unexpectedly
   - The selection overlay jumps to different coordinates
