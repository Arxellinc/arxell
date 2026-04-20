import type { FilesListDirectoryEntry } from "../../contracts";
import { resolveFileTabIcon } from "../ui/fileTabIcons";
import { renderToolToolbar } from "../ui/toolbar";
import { renderFilesTreeEditorBody } from "../files";

export interface SkillsToolViewState {
  skillsRootPath: string | null;
  skillsSelectedPath: string | null;
  skillsSelectedEntryPath: string | null;
  skillsExpandedByPath: Record<string, boolean>;
  skillsEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  skillsLoadingByPath: Record<string, boolean>;
  skillsOpenTabs: string[];
  skillsActiveTabPath: string | null;
  skillsContentByPath: Record<string, string>;
  skillsSavedContentByPath: Record<string, string>;
  skillsDirtyByPath: Record<string, boolean>;
  skillsLoadingFileByPath: Record<string, boolean>;
  skillsSavingFileByPath: Record<string, boolean>;
  skillsReadOnlyByPath: Record<string, boolean>;
  skillsSizeByPath: Record<string, number>;
  skillsSidebarWidth: number;
  skillsSidebarCollapsed: boolean;
  skillsFindOpen: boolean;
  skillsFindQuery: string;
  skillsReplaceQuery: string;
  skillsFindCaseSensitive: boolean;
  skillsLineWrap: boolean;
  skillsError: string | null;
}

export function renderSkillsToolActions(view: SkillsToolViewState): string {
  const active = view.skillsActiveTabPath;
  return renderToolToolbar({
    tabsMode: "dynamic",
    tabs: view.skillsOpenTabs.map((path) => ({
      id: path,
      label: `${path.split(/[\\/]/).filter(Boolean).pop() || path}${view.skillsDirtyByPath[path] ? " *" : ""}`,
      icon: resolveFileTabIcon(path, "file-text"),
      mutedIcon: view.skillsReadOnlyByPath[path] === true,
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
        id: "skills-save",
        title: "Save file",
        icon: "save",
        disabled: !active || view.skillsReadOnlyByPath[active] === true || !view.skillsDirtyByPath[active],
        buttonAttrs: {
          "data-files-action": "save-file"
        }
      },
      {
        id: "skills-search",
        title: "Find / Replace",
        icon: "search",
        disabled: !active,
        buttonAttrs: {
          "data-files-action": "search-in-file"
        }
      },
      {
        id: "skills-wrap",
        title: view.skillsLineWrap ? "Disable line wrap" : "Enable line wrap",
        icon: "list",
        disabled: !active,
        buttonAttrs: {
          "data-files-action": "toggle-wrap"
        }
      }
    ]
  });
}

export function renderSkillsToolBody(view: SkillsToolViewState): string {
  return renderFilesTreeEditorBody(
    {
      rootPath: view.skillsRootPath,
      selectedPath: view.skillsSelectedPath,
      selectedEntryPath: view.skillsSelectedEntryPath,
      activeTabPath: view.skillsActiveTabPath,
      contentByPath: view.skillsContentByPath,
      dirtyByPath: view.skillsDirtyByPath,
      loadingFileByPath: view.skillsLoadingFileByPath,
      savingFileByPath: view.skillsSavingFileByPath,
      readOnlyByPath: view.skillsReadOnlyByPath,
      sizeByPath: view.skillsSizeByPath,
      expandedByPath: view.skillsExpandedByPath as Record<string, boolean>,
      entriesByPath: view.skillsEntriesByPath,
      loadingByPath: view.skillsLoadingByPath,
      sidebarWidth: view.skillsSidebarWidth,
      sidebarCollapsed: view.skillsSidebarCollapsed,
      findOpen: view.skillsFindOpen,
      findQuery: view.skillsFindQuery,
      replaceQuery: view.skillsReplaceQuery,
      findCaseSensitive: view.skillsFindCaseSensitive,
      lineWrap: view.skillsLineWrap,
      error: view.skillsError
    },
    {
      title: "Skills",
      emptyStateMessage: "Select a skill file to view or edit."
    }
  );
}
