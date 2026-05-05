import { iconHtml } from "../../icons";
import { renderToolToolbar } from "../ui/toolbar";
import { resolveFileTabIcon } from "../ui/fileTabIcons";
import { NOTEPAD_DATA_ATTR } from "../ui/constants";
import {
  computeNotepadFindStats,
  escapeAttr,
  escapeHtml,
  renderNotepadEditorPane,
  renderNotepadFindBar
} from "./shared";
import "./styles.css";

export interface NotepadToolViewState {
  openTabs: string[];
  activeTabId: string | null;
  pathByTabId: Record<string, string | null>;
  titleByTabId: Record<string, string>;
  contentByTabId: Record<string, string>;
  dirtyByTabId: Record<string, boolean>;
  loadingByTabId: Record<string, boolean>;
  savingByTabId: Record<string, boolean>;
  readOnlyByTabId: Record<string, boolean>;
  sizeByTabId: Record<string, number>;
  findOpen: boolean;
  findQuery: string;
  replaceQuery: string;
  findCaseSensitive: boolean;
  lineWrap: boolean;
  error: string | null;
  unsavedModalTabId: string | null;
}

export function renderNotepadToolActions(view: NotepadToolViewState): string {
  const tabs = view.openTabs.map((tabId) => {
    const dirty = view.dirtyByTabId[tabId] ? " *" : "";
    const loading = view.loadingByTabId[tabId] ? " (loading)" : "";
    return {
      id: tabId,
      label: `${view.titleByTabId[tabId] || "Untitled"}${dirty}${loading}`,
      icon: resolveFileTabIcon(view.pathByTabId[tabId] || view.titleByTabId[tabId], "file-text"),
      mutedIcon: view.readOnlyByTabId[tabId] === true,
      active: view.activeTabId === tabId,
      buttonAttrs: {
        [NOTEPAD_DATA_ATTR.action]: "activate-tab",
        [NOTEPAD_DATA_ATTR.tabId]: tabId
      },
      closeAttrs: {
        [NOTEPAD_DATA_ATTR.action]: "close-tab",
        [NOTEPAD_DATA_ATTR.tabId]: tabId
      }
    };
  });
  const active = view.activeTabId;
  const activeDirty = active ? view.dirtyByTabId[active] === true : false;
  const activeSaving = active ? view.savingByTabId[active] === true : false;
  const activeReadOnly = active ? view.readOnlyByTabId[active] === true : false;
  const lineWrap = view.lineWrap === true;
  return renderToolToolbar({
    tabsMode: "dynamic",
    tabs,
    tabAction: {
      title: "New File",
      icon: "plus",
      buttonAttrs: {
        [NOTEPAD_DATA_ATTR.action]: "new-file"
      }
    },
    actions: [
      {
        id: "notepad-save",
        title: activeSaving ? "Saving..." : activeReadOnly ? "Read-only file" : "Save file",
        icon: "save",
        disabled: !active || activeReadOnly || activeSaving || !activeDirty,
        buttonAttrs: {
          [NOTEPAD_DATA_ATTR.action]: "save-file"
        }
      },
      {
        id: "notepad-save-as",
        title: "Save As",
        icon: "save",
        disabled: !active || activeSaving,
        buttonAttrs: {
          [NOTEPAD_DATA_ATTR.action]: "save-file-as"
        }
      },
      {
        id: "notepad-save-all",
        title: "Save All",
        icon: "save-all",
        disabled: activeSaving || !view.openTabs.some((tabId) => view.dirtyByTabId[tabId]),
        buttonAttrs: {
          [NOTEPAD_DATA_ATTR.action]: "save-all-files"
        }
      },
      {
        id: "notepad-open",
        title: "Open File",
        icon: "folder-open",
        buttonAttrs: {
          [NOTEPAD_DATA_ATTR.action]: "open-file"
        }
      },
      {
        id: "notepad-duplicate",
        title: "Duplicate File",
        icon: "copy-plus",
        disabled: !active,
        buttonAttrs: {
          [NOTEPAD_DATA_ATTR.action]: "duplicate-file"
        }
      },
      {
        id: "notepad-delete",
        title: "Delete File",
        icon: "trash-2",
        disabled: !active || !view.pathByTabId[active],
        buttonAttrs: {
          [NOTEPAD_DATA_ATTR.action]: "delete-file"
        }
      },
      {
        id: "notepad-search",
        title: "Find / Replace",
        icon: "search",
        disabled: !active,
        buttonAttrs: {
          [NOTEPAD_DATA_ATTR.action]: "search-in-file"
        }
      },
      {
        id: "notepad-wrap",
        title: lineWrap ? "Disable line wrap (Alt+Z)" : "Enable line wrap (Alt+Z)",
        icon: "list",
        disabled: !active,
        buttonAttrs: {
          [NOTEPAD_DATA_ATTR.action]: "toggle-wrap"
        }
      }
    ]
  });
}

export function renderNotepadToolBody(view: NotepadToolViewState): string {
  const activeTabId = view.activeTabId;
  const activeContent = activeTabId ? view.contentByTabId[activeTabId] ?? "" : "";
  const activeLoading = activeTabId ? view.loadingByTabId[activeTabId] === true : false;
  const activeReadOnly = activeTabId ? view.readOnlyByTabId[activeTabId] === true : false;
  const activeLineCount = Math.max(1, activeContent.split("\n").length);
  const findStats = activeTabId
    ? computeNotepadFindStats(activeContent, view.findQuery ?? "", view.findCaseSensitive === true)
    : { count: 0 };
  return `<div class="notepad-tool primary-pane-body">
    ${
      activeTabId
        ? renderNotepadEditorPane({
          documentId: activeTabId,
            filePath: view.pathByTabId[activeTabId] ?? null,
            content: activeContent,
            lineCount: activeLineCount,
            wrap: view.lineWrap === true,
            readOnly: activeReadOnly,
            loading: activeLoading,
            sizeBytes: view.sizeByTabId[activeTabId] ?? 0,
            dataAttrs: {
              action: NOTEPAD_DATA_ATTR.action,
              document: NOTEPAD_DATA_ATTR.tabId,
              path: NOTEPAD_DATA_ATTR.path
            }
          })
        : `<div class="notepad-empty-state">
            <div>No file open.</div>
            <div class="notepad-empty-actions">
              <button type="button" class="tool-action-btn" ${NOTEPAD_DATA_ATTR.action}="new-file">New File</button>
              <button type="button" class="tool-action-btn" ${NOTEPAD_DATA_ATTR.action}="open-file">Open File</button>
            </div>
          </div>`
    }
    ${
      activeTabId && view.findOpen
        ? renderNotepadFindBar({
            query: view.findQuery ?? "",
            replace: view.replaceQuery ?? "",
            caseSensitive: view.findCaseSensitive === true,
            matchCount: findStats.count,
            dataAttrs: {
              action: NOTEPAD_DATA_ATTR.action,
              document: NOTEPAD_DATA_ATTR.tabId,
              path: NOTEPAD_DATA_ATTR.path
            }
          })
        : ""
    }
    ${view.error ? `<div class="notepad-error">${escapeHtml(view.error)}</div>` : ""}
    ${renderNotepadUnsavedModal(view)}
  </div>`;
}

export function renderNotepadUnsavedModal(view: NotepadToolViewState): string {
  if (!view.unsavedModalTabId) return "";
  const title = view.titleByTabId[view.unsavedModalTabId] || "Untitled";
  return `<div class="notepad-unsaved-modal-overlay">
    <div class="notepad-unsaved-modal-box">
      <div class="notepad-unsaved-modal-title">Unsaved Changes</div>
      <div class="notepad-unsaved-modal-message">${escapeHtml(title)} has unsaved changes. Would you like to save before closing?</div>
      <div class="notepad-unsaved-modal-actions">
        <button type="button" class="mm-modal-btn" ${NOTEPAD_DATA_ATTR.action}="unsaved-discard" ${NOTEPAD_DATA_ATTR.tabId}="${escapeAttr(view.unsavedModalTabId)}">Discard Draft</button>
        <button type="button" class="mm-modal-btn" ${NOTEPAD_DATA_ATTR.action}="unsaved-cancel">Cancel</button>
        <button type="button" class="mm-modal-btn" style="background:var(--accent);color:var(--accent-ink);border-color:var(--accent);" ${NOTEPAD_DATA_ATTR.action}="unsaved-save-as" ${NOTEPAD_DATA_ATTR.tabId}="${escapeAttr(view.unsavedModalTabId)}">Save As</button>
      </div>
    </div>
  </div>`;
}
