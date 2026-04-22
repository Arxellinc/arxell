import { renderToolToolbar } from "../ui/toolbar";
import { resolveFileTabIcon } from "../ui/fileTabIcons";
import { SHEETS_DATA_ATTR, SHEETS_UI_ID } from "../ui/constants";
import { areSheetsColumnsFiltered, getSelectedSheetColumns, type SheetsToolState } from "./state.js";
import "./styles.css";

export function renderSheetsToolActions(view: SheetsToolState): string {
  const tabLabel = `${getSheetTabLabel(view)}${view.dirty ? " *" : ""}`;
  const can = view.capabilities;
  const canInsertRows = can?.insertRows !== false;
  const canInsertCols = can?.insertCols !== false;
  const canDeleteRows = can?.deleteRows !== false;
  const canDeleteCols = can?.deleteCols !== false;
  const canUndo = view.canUndo;
  const canRedo = view.canRedo;
  const canFormat = can?.formats === true;
  const canStyle = can?.styles === true;
  const canFilter = can?.formats === true;
  const canFreeze = can?.frozenPanes === true;
  const canHyperlink = can?.styles === true;
  const disabled = !view.hasWorkbook || view.pending;
  const selectedColumns = getSelectedSheetColumns(view);
  const canToggleFilter = selectedColumns.length > 0;
  const selectedColumnsFiltered = areSheetsColumnsFiltered(view, selectedColumns);
  return renderToolToolbar({
    tabsMode: "static",
    tabs: [
      {
        id: "sheets-sheet-tab",
        label: tabLabel,
        icon: resolveFileTabIcon(view.fileName || "New Sheet", "file-spreadsheet"),
        active: true,
        closable: false,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "focus-sheet"
        }
      }
    ],
    tabAction: {
      title: "New Sheet",
      icon: "plus",
      buttonAttrs: {
        [SHEETS_DATA_ATTR.action]: "new-sheet"
      }
    },
    actions: [
      {
        id: "sheets-open",
        title: "Open Sheet",
        icon: "folder-open",
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "open-sheet"
        }
      },
      {
        id: "sheets-save",
        title: view.pending ? "Saving..." : "Save Sheet",
        icon: "save",
        disabled: !view.hasWorkbook || view.pending,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "save-sheet"
        }
      },
      {
        id: "sheets-save-as",
        title: "Save Sheet As",
        icon: "save-all",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "save-sheet-as"
        }
      },
      {
        id: "sheets-undo",
        title: "Undo",
        icon: "undo",
        disabled: disabled || !canUndo,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "undo"
        }
      },
      {
        id: "sheets-redo",
        title: "Redo",
        icon: "redo",
        disabled: disabled || !canRedo,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "redo"
        }
      },
      {
        id: "sheets-format-currency",
        title: toolbarTitle("Currency Format", view.hasWorkbook, canFormat),
        icon: "dollar-sign",
        className: "sheets-toolbar-divider-before",
        disabled: disabled || !canFormat,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-currency"
        }
      },
      {
        id: "sheets-format-percent",
        title: toolbarTitle("Percent Format", view.hasWorkbook, canFormat),
        icon: "percent",
        disabled: disabled || !canFormat,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-percent"
        }
      },
      {
        id: "sheets-format-number",
        title: toolbarTitle("Number Format", view.hasWorkbook, canFormat),
        icon: "hash",
        disabled: disabled || !canFormat,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-number"
        }
      },
      {
        id: "sheets-format-date",
        title: toolbarTitle("Date Format", view.hasWorkbook, canFormat),
        icon: "calendar",
        disabled: disabled || !canFormat,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-date"
        }
      },
      {
        id: "sheets-format-datetime",
        title: toolbarTitle("Date Time Format", view.hasWorkbook, canFormat),
        icon: "calendar-clock",
        className: "sheets-toolbar-divider-after",
        disabled: disabled || !canFormat,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-datetime"
        }
      },
      {
        id: "sheets-style-bold",
        title: toolbarTitle("Bold", view.hasWorkbook, canStyle),
        icon: "bold",
        className: "sheets-toolbar-divider-before",
        disabled: disabled || !canStyle,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "style-bold"
        }
      },
      {
        id: "sheets-style-italic",
        title: toolbarTitle("Italic", view.hasWorkbook, canStyle),
        icon: "italic",
        disabled: disabled || !canStyle,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "style-italic"
        }
      },
      {
        id: "sheets-style-strikethrough",
        title: toolbarTitle("Strikethrough", view.hasWorkbook, canStyle),
        icon: "strikethrough",
        className: "sheets-toolbar-divider-after",
        disabled: disabled || !canStyle,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "style-strikethrough"
        }
      },
      {
        id: "sheets-create-filter",
        title: selectedColumnsFiltered ? "Remove Filter" : toolbarTitle("Add Filter", view.hasWorkbook, canFilter),
        icon: "funnel-plus",
        active: selectedColumnsFiltered,
        disabled: disabled || !canFilter || !canToggleFilter,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "create-filter"
        }
      },
      {
        id: "sheets-freeze-first-row",
        title: toolbarTitle("Freeze First Row", view.hasWorkbook, canFreeze),
        icon: "panel-top",
        disabled: disabled || !canFreeze,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "freeze-first-row"
        }
      },
      {
        id: "sheets-hyperlink",
        title: toolbarTitle("Hyperlink", view.hasWorkbook, canHyperlink),
        icon: "link",
        disabled: disabled || !canHyperlink,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "hyperlink"
        }
      },
      {
        id: "sheets-add-row",
        title: "Add Row",
        icon: "between-horizontal-start",
        disabled: disabled || !canInsertRows,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "add-row"
        }
      },
      {
        id: "sheets-add-column",
        title: "Add Column",
        icon: "between-vertical-start",
        disabled: disabled || !canInsertCols,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "add-column"
        }
      },
      {
        id: "sheets-delete-row",
        title: "Delete Selected Row",
        icon: "fold-vertical",
        disabled: disabled || !canDeleteRows,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "delete-row"
        }
      },
      {
        id: "sheets-delete-column",
        title: "Delete Selected Column",
        icon: "fold-horizontal",
        disabled: disabled || !canDeleteCols,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "delete-column"
        }
      }
    ]
  });
}

function toolbarTitle(label: string, hasWorkbook: boolean, supported: boolean): string {
  if (!hasWorkbook) return label;
  return supported ? label : `${label} (Not supported in this format)`;
}

function getSheetTabLabel(view: SheetsToolState): string {
  const baseName = view.fileName || "New Sheet";
  if (/\.[^./\\]+$/.test(baseName)) {
    return baseName;
  }

  return `${baseName}${sheetExtension(view.sourceKind)}`;
}

function sheetExtension(sourceKind: string): string {
  if (sourceKind === "csv") return ".csv";
  if (sourceKind === "sqliteTable") return ".sqlite";
  return ".jsonl";
}

export function renderSheetsToolBody(view: SheetsToolState): string {
  const dirty = view.dirty ? "is-dirty" : "";
  return `<div class="sheets-tool primary-pane-body ${dirty}">
    <div id="${SHEETS_UI_ID.host}" class="sheets-runtime-host"></div>
    ${view.lastError ? `<div class="sheets-error-banner">${escapeHtml(view.lastError)}</div>` : ""}
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
