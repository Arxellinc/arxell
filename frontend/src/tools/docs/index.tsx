import type { FilesListDirectoryEntry } from "../../contracts";
import { resolveFileTabIcon } from "../ui/fileTabIcons";
import { renderToolToolbar } from "../ui/toolbar";
import { renderFilesTreeEditorBody } from "../files";

export interface DocsToolViewState {
  docsRootPath: string | null;
  docsSelectedPath: string | null;
  docsSelectedEntryPath: string | null;
  docsExpandedByPath: Record<string, boolean>;
  docsEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  docsLoadingByPath: Record<string, boolean>;
  docsOpenTabs: string[];
  docsActiveTabPath: string | null;
  docsContentByPath: Record<string, string>;
  docsSavedContentByPath: Record<string, string>;
  docsDirtyByPath: Record<string, boolean>;
  docsLoadingFileByPath: Record<string, boolean>;
  docsSavingFileByPath: Record<string, boolean>;
  docsReadOnlyByPath: Record<string, boolean>;
  docsSizeByPath: Record<string, number>;
  docsSidebarWidth: number;
  docsSidebarCollapsed: boolean;
  docsFindOpen: boolean;
  docsFindQuery: string;
  docsReplaceQuery: string;
  docsFindCaseSensitive: boolean;
  docsLineWrap: boolean;
  docsError: string | null;
}

export function renderDocsToolActions(view: DocsToolViewState): string {
  const active = view.docsActiveTabPath;
  return renderToolToolbar({
    tabsMode: "dynamic",
    tabs: view.docsOpenTabs.map((path) => ({
      id: path,
      label: `${path.split(/[\\/]/).filter(Boolean).pop() || path}${view.docsDirtyByPath[path] ? " *" : ""}`,
      icon: resolveFileTabIcon(path, "file-text"),
      mutedIcon: view.docsReadOnlyByPath[path] === true,
      active: active === path,
      buttonAttrs: {
        "data-files-action": "activate-tab",
        "data-files-path": path
      },
      closeAttrs: {
        "data-files-action": "close-tab",
        "data-files-path": path
      }
    })),
    tabAction: {
      title: "New File",
      icon: "plus",
      buttonAttrs: {
        "data-files-action": "new-file"
      }
    },
    actions: [
      {
        id: "docs-save",
        title: "Save file",
        icon: "save",
        disabled: !active || view.docsReadOnlyByPath[active] === true || !view.docsDirtyByPath[active],
        buttonAttrs: {
          "data-files-action": "save-file"
        }
      },
      {
        id: "docs-search",
        title: "Find / Replace",
        icon: "search",
        disabled: !active,
        buttonAttrs: {
          "data-files-action": "search-in-file"
        }
      },
      {
        id: "docs-wrap",
        title: view.docsLineWrap ? "Disable line wrap" : "Enable line wrap",
        icon: "list",
        disabled: !active,
        buttonAttrs: {
          "data-files-action": "toggle-wrap"
        }
      }
    ]
  });
}

export function renderDocsToolBody(view: DocsToolViewState): string {
  return renderFilesTreeEditorBody(
    {
      rootPath: view.docsRootPath,
      selectedPath: view.docsSelectedPath,
      selectedEntryPath: view.docsSelectedEntryPath,
      activeTabPath: view.docsActiveTabPath,
      contentByPath: view.docsContentByPath,
      dirtyByPath: view.docsDirtyByPath,
      loadingFileByPath: view.docsLoadingFileByPath,
      savingFileByPath: view.docsSavingFileByPath,
      readOnlyByPath: view.docsReadOnlyByPath,
      sizeByPath: view.docsSizeByPath,
      expandedByPath: view.docsExpandedByPath,
      entriesByPath: view.docsEntriesByPath,
      loadingByPath: view.docsLoadingByPath,
      sidebarWidth: view.docsSidebarWidth,
      sidebarCollapsed: view.docsSidebarCollapsed,
      findOpen: view.docsFindOpen,
      findQuery: view.docsFindQuery,
      replaceQuery: view.docsReplaceQuery,
      findCaseSensitive: view.docsFindCaseSensitive,
      lineWrap: view.docsLineWrap,
      error: view.docsError
    },
    {
      title: "Docs",
      emptyStateMessage: "Select a document to view or edit."
    }
  );
}
