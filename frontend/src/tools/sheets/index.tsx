import { renderToolToolbar } from "../ui/toolbar";
import { resolveFileTabIcon } from "../ui/fileTabIcons";
import { SHEETS_DATA_ATTR, SHEETS_UI_ID } from "../ui/constants";
import type { SheetsToolState } from "./state.js";
import "./styles.css";

export function renderSheetsToolActions(view: SheetsToolState): string {
  const tabLabel = `${getSheetTabLabel(view)}${view.dirty ? " *" : ""}`;
  const can = view.capabilities;
  const canInsertRows = can?.insertRows !== false;
  const canInsertCols = can?.insertCols !== false;
  const canDeleteRows = can?.deleteRows !== false;
  const canDeleteCols = can?.deleteCols !== false;
  const disabled = !view.hasWorkbook || view.pending;
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
        icon: "file-output",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "save-sheet-as"
        }
      },
      {
        id: "sheets-undo",
        title: "Undo",
        icon: "undo",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "undo"
        }
      },
      {
        id: "sheets-redo",
        title: "Redo",
        icon: "redo",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "redo"
        }
      },
      {
        id: "sheets-format-currency",
        title: "Currency Format",
        icon: "dollar-sign",
        className: "sheets-toolbar-divider-before",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-currency"
        }
      },
      {
        id: "sheets-format-percent",
        title: "Percent Format",
        icon: "percent",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-percent"
        }
      },
      {
        id: "sheets-format-number",
        title: "Number Format",
        icon: "hash",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-number"
        }
      },
      {
        id: "sheets-format-date",
        title: "Date Format",
        icon: "calendar",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-date"
        }
      },
      {
        id: "sheets-format-datetime",
        title: "Date Time Format",
        icon: "calendar-clock",
        className: "sheets-toolbar-divider-after",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "format-datetime"
        }
      },
      {
        id: "sheets-style-bold",
        title: "Bold",
        icon: "bold",
        className: "sheets-toolbar-divider-before",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "style-bold"
        }
      },
      {
        id: "sheets-style-italic",
        title: "Italic",
        icon: "italic",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "style-italic"
        }
      },
      {
        id: "sheets-style-strikethrough",
        title: "Strikethrough",
        icon: "strikethrough",
        className: "sheets-toolbar-divider-after",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "style-strikethrough"
        }
      },
      {
        id: "sheets-create-filter",
        title: "Create Filter",
        icon: "list-filter-plus",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "create-filter"
        }
      },
      {
        id: "sheets-freeze-first-row",
        title: "Freeze First Row",
        icon: "panel-top",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "freeze-first-row"
        }
      },
      {
        id: "sheets-hyperlink",
        title: "Hyperlink",
        icon: "link",
        disabled,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "hyperlink"
        }
      },
      {
        id: "sheets-add-row",
        title: "Add Row",
        icon: "plus",
        disabled: disabled || !canInsertRows,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "add-row"
        }
      },
      {
        id: "sheets-add-column",
        title: "Add Column",
        icon: "plus",
        disabled: disabled || !canInsertCols,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "add-column"
        }
      },
      {
        id: "sheets-delete-row",
        title: "Delete Selected Row",
        icon: "minus",
        disabled: disabled || !canDeleteRows,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "delete-row"
        }
      },
      {
        id: "sheets-delete-column",
        title: "Delete Selected Column",
        icon: "minus",
        disabled: disabled || !canDeleteCols,
        buttonAttrs: {
          [SHEETS_DATA_ATTR.action]: "delete-column"
        }
      }
    ]
  });
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
