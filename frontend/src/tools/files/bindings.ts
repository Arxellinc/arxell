import { FILES_DATA_ATTR, FILES_UI_ID } from "../ui/constants";
import { handleToolSidebarResize } from "../ui/sidebarResize";
import type { FilesListDirectoryEntry } from "../../contracts";
import {
  closeFilesContextMenu,
  openFilesContextMenu,
  type FilesConflictResolution,
  selectAllFilesInDirectory,
  setFilesClipboard
} from "./actions";
import {
  copyText,
  duplicatePathWithCopySuffix,
  focusNotepadMatch,
  getSelectedNotepadText,
  pickOpenFilePath,
  pickSaveFilePath,
  scheduleNotepadEditorRefresh,
  refreshNotepadEditorDecorations,
  replaceAllInNotepad,
  replaceOneInNotepad,
  type NotepadDataAttrs
} from "../notepad/shared";

type FilesColumnKey = "name" | "type" | "size" | "modified";

interface FilesColumnWidths {
  name: number;
  type: number;
  size: number;
  modified: number;
}

const FILES_COLUMN_DEFAULT_WIDTHS: FilesColumnWidths = {
  name: 260,
  type: 120,
  size: 96,
  modified: 132
};

const FILES_COLUMN_MIN_WIDTHS: FilesColumnWidths = {
  name: 160,
  type: 84,
  size: 72,
  modified: 108
};

interface FilesSlice {
  filesRootPath: string | null;
  filesScopeRootPath?: string | null;
  filesRootSelectorOpen?: boolean;
  filesSelectedPath: string | null;
  filesSelectedEntryPath?: string | null;
  filesExpandedByPath: Record<string, boolean>;
  filesEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  filesLoadingByPath: Record<string, boolean>;
  filesOpenTabs: string[];
  filesActiveTabPath: string | null;
  filesContentByPath: Record<string, string>;
  filesSavedContentByPath: Record<string, string>;
  filesDirtyByPath: Record<string, boolean>;
  filesReadOnlyByPath: Record<string, boolean>;
  filesLoadingFileByPath: Record<string, boolean>;
  filesSavingFileByPath: Record<string, boolean>;
  filesSizeByPath: Record<string, number>;
  filesError: string | null;
  filesColumnWidths?: Partial<FilesColumnWidths>;
  filesSidebarWidth?: number;
  filesSidebarCollapsed?: boolean;
  filesFindOpen?: boolean;
  filesFindQuery?: string;
  filesReplaceQuery?: string;
  filesFindCaseSensitive?: boolean;
  filesLineWrap?: boolean;
  filesSelectedPaths?: string[];
  filesContextMenuOpen?: boolean;
  filesContextMenuTargetPath?: string | null;
  filesContextMenuTargetIsDir?: boolean;
  filesContextMenuPointerInside?: boolean;
  filesConflictModalOpen?: boolean;
  filesConflictName?: string;
  filesSelectionAnchorPath?: string | null;
  filesSelectionDragActive?: boolean;
  filesSelectionJustDragged?: boolean;
  filesSelectionGesture?: "single" | "toggle" | "range" | null;
}

interface FilesDeps {
  listFilesDirectory: (path?: string) => Promise<void>;
  selectFilesPath: (path: string) => Promise<void>;
  toggleFilesNode: (path: string) => Promise<void>;
  openFilesFile: (path: string) => Promise<void>;
  activateFilesTab: (path: string) => void;
  closeFilesTab: (path: string) => void;
  updateFilesBuffer: (path: string, content: string) => void;
  saveActiveFilesTab: () => Promise<void>;
  saveActiveFilesTabAs: (path: string) => Promise<void>;
  saveAllFilesTabs: () => Promise<void>;
  createNewFilesFile: (path: string) => Promise<void>;
  createNewFilesFolder: (path: string) => Promise<void>;
  duplicateActiveFilesTab: (path: string) => Promise<void>;
  deleteFilesPath: (path: string, recursive?: boolean) => Promise<void>;
  renameFilesPath: (from: string, to: string) => Promise<void>;
  pasteFilesClipboard: (
    targetDirectory: string,
    resolveConflictChoice?: (name: string) => Promise<FilesConflictResolution>
  ) => Promise<void>;
  undoLastFilesDelete: () => Promise<void>;
  openPathInTerminal: (path: string) => Promise<void>;
}

type FilesConflictChoice = "replace" | "copy" | "cancel";
let pendingConflictResolver: ((resolution: FilesConflictResolution) => void) | null = null;
const FILES_EDITOR_ATTRS: NotepadDataAttrs = {
  action: FILES_DATA_ATTR.action,
  document: FILES_DATA_ATTR.path,
  path: FILES_DATA_ATTR.path
};

function requestConflictChoice(slice: FilesSlice, name: string): Promise<FilesConflictResolution> {
  if (pendingConflictResolver) {
    pendingConflictResolver({ choice: "cancel", applyToAll: false });
    pendingConflictResolver = null;
  }
  slice.filesConflictModalOpen = true;
  slice.filesConflictName = name;
  return new Promise<FilesConflictResolution>((resolve) => {
    pendingConflictResolver = (resolution) => {
      pendingConflictResolver = null;
      slice.filesConflictModalOpen = false;
      slice.filesConflictName = "";
      resolve(resolution);
    };
  });
}

export async function handleFilesClick(
  target: HTMLElement,
  slice: FilesSlice,
  deps: FilesDeps
): Promise<boolean> {
  if (slice.filesContextMenuOpen && !target.closest(".files-context-menu")) {
    closeFilesContextMenu(slice);
  }
  if (
    slice.filesRootSelectorOpen &&
    !target.closest(".files-root-selector") &&
    target.closest(".files-tool")
  ) {
    slice.filesRootSelectorOpen = false;
  }

  if (target.id === FILES_UI_ID.refreshButton) {
    const selected = slice.filesSelectedPath || slice.filesRootPath || undefined;
    await deps.listFilesDirectory(selected);
    return true;
  }

  const filesAction = target.getAttribute(FILES_DATA_ATTR.action);
  const filesPath = target.getAttribute(FILES_DATA_ATTR.path);
  if (
    filesAction === "conflict-choice-replace" ||
    filesAction === "conflict-choice-copy" ||
    filesAction === "conflict-choice-cancel" ||
    filesAction === "conflict-choice-replace-all" ||
    filesAction === "conflict-choice-copy-all"
  ) {
    const resolution: FilesConflictResolution =
      filesAction === "conflict-choice-replace"
        ? { choice: "replace", applyToAll: false }
        : filesAction === "conflict-choice-copy"
          ? { choice: "copy", applyToAll: false }
          : filesAction === "conflict-choice-replace-all"
            ? { choice: "replace", applyToAll: true }
            : filesAction === "conflict-choice-copy-all"
              ? { choice: "copy", applyToAll: true }
              : { choice: "cancel", applyToAll: false };
    if (pendingConflictResolver) {
      const resolve = pendingConflictResolver;
      pendingConflictResolver = null;
      slice.filesConflictModalOpen = false;
      slice.filesConflictName = "";
      resolve(resolution);
    }
    return true;
  }
  if (filesAction === "toggle-node" && filesPath) {
    await deps.toggleFilesNode(filesPath);
    return true;
  }
  if (filesAction === "select-node" && filesPath) {
    slice.filesSelectedEntryPath = null;
    await deps.toggleFilesNode(filesPath);
    await deps.selectFilesPath(filesPath);
    return true;
  }
  if (filesAction === "select-entry" && filesPath) {
    if (slice.filesSelectionJustDragged) {
      slice.filesSelectionJustDragged = false;
      return true;
    }
    const isDir = target.getAttribute(FILES_DATA_ATTR.isDir) === "true";
    if (isDir) {
      slice.filesSelectedEntryPath = filesPath;
      slice.filesSelectedPaths = [];
      slice.filesSelectionAnchorPath = filesPath;
      slice.filesSelectionGesture = null;
      return true;
    } else {
      const gesture = slice.filesSelectionGesture;
      const visibleFilePaths = listVisibleFilePaths(slice);
      if (gesture === "range") {
        applyRangeSelection(slice, visibleFilePaths, filesPath);
        slice.filesSelectionGesture = null;
        return true;
      }
      if (gesture === "toggle") {
        toggleSelectionPath(slice, filesPath);
        slice.filesSelectionAnchorPath = filesPath;
        slice.filesSelectionGesture = null;
        return true;
      }
      const parent = parentDir(filesPath);
      slice.filesSelectedEntryPath = filesPath;
      slice.filesSelectedPaths = [filesPath];
      slice.filesSelectionAnchorPath = filesPath;
      if (parent && slice.filesSelectedPath !== parent) {
        await deps.selectFilesPath(parent);
      }
    }
    slice.filesSelectionGesture = null;
    return true;
  }
  if (filesAction === "activate-tab" && filesPath) {
    deps.activateFilesTab(filesPath);
    return true;
  }
  if (filesAction === "close-tab" && filesPath) {
    if (slice.filesDirtyByPath[filesPath]) {
      const confirmed = window.confirm(
        "This file has unsaved changes. Close this tab and discard changes?"
      );
      if (!confirmed) return true;
    }
    deps.closeFilesTab(filesPath);
    return true;
  }
  if (filesAction === "save-file") {
    await deps.saveActiveFilesTab();
    return true;
  }
  if (filesAction === "save-file-as") {
    const active = slice.filesActiveTabPath;
    if (!active) return true;
    const requested = await pickSaveFilePath(active);
    if (!requested) return true;
    await deps.saveActiveFilesTabAs(requested);
    return true;
  }
  if (filesAction === "save-all-files") {
    await deps.saveAllFilesTabs();
    return true;
  }
  if (filesAction === "undo-delete") {
    await deps.undoLastFilesDelete();
    return true;
  }
  if (filesAction === "close-active-file") {
    const active = slice.filesActiveTabPath;
    if (!active) return true;
    if (slice.filesDirtyByPath[active]) {
      const confirmed = window.confirm(
        "This file has unsaved changes. Close this tab and discard changes?"
      );
      if (!confirmed) return true;
    }
    deps.closeFilesTab(active);
    return true;
  }
  if (filesAction === "open-file") {
    const seed = slice.filesSelectedPath || slice.filesRootPath || undefined;
    const requested = await pickOpenFilePath(seed);
    if (!requested) return true;
    await deps.openFilesFile(requested);
    return true;
  }
  if (filesAction === "copy-file-path") {
    const active = slice.filesActiveTabPath;
    if (!active) return true;
    await copyText(active);
    return true;
  }
  if (filesAction === "copy-path") {
    const requested = filesPath || slice.filesContextMenuTargetPath || slice.filesSelectedEntryPath;
    if (!requested) return true;
    await copyText(requested);
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "duplicate-file") {
    const active = slice.filesActiveTabPath;
    if (!active) return true;
    const requested = window
      .prompt("Duplicate file to", duplicatePathWithCopySuffix(active))
      ?.trim();
    if (!requested) return true;
    await deps.duplicateActiveFilesTab(requested);
    return true;
  }
  if (filesAction === "new-file") {
    const folder = slice.filesSelectedPath || slice.filesRootPath || "";
    const entered = window.prompt("Create file", "untitled.txt")?.trim();
    if (!entered) return true;
    const requested =
      entered.includes("/") || entered.includes("\\") || entered.startsWith(".")
        ? entered
        : folder
          ? `${folder}/${entered}`
          : entered;
    await deps.createNewFilesFile(requested);
    return true;
  }
  if (filesAction === "select-all") {
    selectAllFilesInDirectory(slice);
    const selected = slice.filesSelectedPaths ?? [];
    slice.filesSelectionAnchorPath = selected[selected.length - 1] ?? null;
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "open-with") {
    const requested = filesPath || slice.filesContextMenuTargetPath || slice.filesSelectedEntryPath;
    if (!requested) return true;
    const targetIsDir = slice.filesContextMenuTargetIsDir === true;
    const mode = window.prompt("Open with (files|terminal)", "files")?.trim().toLowerCase();
    if (mode === "terminal") {
      await deps.openPathInTerminal(requested);
    } else {
      if (targetIsDir) {
        await deps.selectFilesPath(requested);
      } else {
        await deps.openFilesFile(requested);
      }
    }
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "open-in-terminal") {
    const fallback =
      slice.filesContextMenuTargetPath ||
      slice.filesSelectedPath ||
      slice.filesRootPath ||
      "";
    if (!fallback) return true;
    const terminalPath =
      slice.filesContextMenuTargetIsDir === false ? parentDir(fallback) : fallback;
    await deps.openPathInTerminal(terminalPath || fallback);
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "copy") {
    const requested = filesPath || slice.filesContextMenuTargetPath || slice.filesSelectedEntryPath || "";
    const selected = (slice.filesSelectedPaths ?? []).filter(Boolean);
    const paths = selected.includes(requested) ? selected : requested ? [requested] : selected;
    if (!paths.length) return true;
    setFilesClipboard(slice, "copy", paths);
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "cut") {
    const requested = filesPath || slice.filesContextMenuTargetPath || slice.filesSelectedEntryPath || "";
    const selected = (slice.filesSelectedPaths ?? []).filter(Boolean);
    const paths = selected.includes(requested) ? selected : requested ? [requested] : selected;
    if (!paths.length) return true;
    setFilesClipboard(slice, "cut", paths);
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "paste") {
    const toDir =
      slice.filesSelectedPath ||
      slice.filesRootPath ||
      "";
    if (!toDir) return true;
    await deps.pasteFilesClipboard(toDir, (name) => requestConflictChoice(slice, name));
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "delete-path") {
    const targetIsDir = slice.filesContextMenuTargetIsDir === true;
    if (targetIsDir) {
      const folderPath = filesPath || slice.filesContextMenuTargetPath || "";
      if (!folderPath) return true;
      const confirmed = window.confirm(`Delete folder '${folderPath}' and all contents?`);
      if (!confirmed) return true;
      await deps.deleteFilesPath(folderPath, true);
      if (slice.filesSelectedPath === folderPath) {
        const parent = parentDir(folderPath);
        slice.filesSelectedPath = parent || slice.filesRootPath;
      }
      closeFilesContextMenu(slice);
      return true;
    }
    const requested = filesPath || slice.filesContextMenuTargetPath || slice.filesSelectedEntryPath || "";
    const selected = (slice.filesSelectedPaths ?? []).filter(Boolean);
    const paths = selected.includes(requested) ? selected : requested ? [requested] : selected;
    if (!paths.length) return true;
    const confirmed = window.confirm(
      paths.length === 1 ? `Delete '${paths[0]}'?` : `Delete ${paths.length} selected files?`
    );
    if (!confirmed) return true;
    for (const path of paths) {
      await deps.deleteFilesPath(path, false);
    }
    slice.filesSelectedPaths = [];
    slice.filesSelectedEntryPath = null;
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "rename-path") {
    const requested = filesPath || slice.filesContextMenuTargetPath || slice.filesSelectedEntryPath;
    if (!requested) return true;
    if ((slice.filesSelectedPaths ?? []).length > 1) {
      window.alert("Rename supports one file at a time.");
      return true;
    }
    const parent = parentDir(requested);
    const name = requested.slice(parent.length ? parent.length + 1 : 0);
    const promptLabel =
      slice.filesContextMenuTargetIsDir === true ? "Rename folder" : "Rename file";
    const renamed = window.prompt(promptLabel, name)?.trim();
    if (!renamed || renamed === name) return true;
    const nextPath = `${parent}/${renamed}`;
    await deps.renameFilesPath(requested, nextPath);
    closeFilesContextMenu(slice);
    return true;
  }
  if (filesAction === "new-folder") {
    const folder = slice.filesSelectedPath || slice.filesRootPath || "";
    const entered = window.prompt("Create folder", "new-folder")?.trim();
    if (!entered) return true;
    const requested =
      entered.includes("/") || entered.includes("\\") || entered.startsWith(".")
        ? entered
        : folder
          ? `${folder}/${entered}`
          : entered;
    await deps.createNewFilesFolder(requested);
    return true;
  }
  if (filesAction === "search-in-file") {
    openFindBar(slice, false);
    return true;
  }
  if (filesAction === "replace-in-file") {
    openFindBar(slice, true);
    return true;
  }
  if (filesAction === "find-next") {
    runFindStep(slice, false);
    return true;
  }
  if (filesAction === "find-prev") {
    runFindStep(slice, true);
    return true;
  }
  if (filesAction === "replace-one") {
    runReplaceOne(slice, deps.updateFilesBuffer);
    return true;
  }
  if (filesAction === "replace-all") {
    runReplaceAll(slice, deps.updateFilesBuffer);
    return true;
  }
  if (filesAction === "find-close") {
    slice.filesFindOpen = false;
    return true;
  }
  if (filesAction === "toggle-sidebar-collapse") {
    slice.filesSidebarCollapsed = slice.filesSidebarCollapsed !== true;
    return true;
  }
  if (filesAction === "toggle-wrap") {
    slice.filesLineWrap = slice.filesLineWrap !== true;
    return true;
  }
  if (filesAction === "toggle-root-selector") {
    slice.filesRootSelectorOpen = slice.filesRootSelectorOpen !== true;
    if (slice.filesRootSelectorOpen) {
      await preloadRootPickerTree(slice, deps);
    }
    return true;
  }
  if (filesAction === "root-tree-toggle" && filesPath) {
    await deps.toggleFilesNode(filesPath);
    return true;
  }
  if (filesAction === "root-tree-select" && filesPath) {
    const requested = filesPath.trim();
    if (!requested) return true;
    if (hasUnsavedTabs(slice)) {
      const confirmed = window.confirm(
        "You have unsaved file changes. Switch root directory anyway?"
      );
      if (!confirmed) return true;
    }
    slice.filesScopeRootPath = requested;
    slice.filesRootSelectorOpen = false;
    slice.filesSelectedEntryPath = null;
    await deps.selectFilesPath(requested);
    return true;
  }
  if (filesAction === "refresh") {
    const selected = slice.filesSelectedPath || slice.filesRootPath || undefined;
    await deps.listFilesDirectory(selected);
    return true;
  }

  return false;
}

export async function handleFilesDoubleClick(
  target: HTMLElement,
  slice: FilesSlice,
  deps: Pick<FilesDeps, "selectFilesPath" | "openFilesFile">
): Promise<boolean> {
  const node = target.closest<HTMLElement>(
    `[${FILES_DATA_ATTR.action}="${"select-entry"}"][${FILES_DATA_ATTR.path}]`
  );
  if (!node) return false;
  const path = node.getAttribute(FILES_DATA_ATTR.path);
  const isDir = node.getAttribute(FILES_DATA_ATTR.isDir) === "true";
  if (!path) return false;
  if (isDir) {
    slice.filesExpandedByPath[path] = true;
    await deps.selectFilesPath(path);
    return true;
  }
  await deps.openFilesFile(path);
  return true;
}

export function handleFilesContextMenu(
  event: MouseEvent,
  target: HTMLElement,
  slice: FilesSlice
): boolean {
  const withinFilesTool = target.closest<HTMLElement>(".files-tool");
  if (!withinFilesTool) return false;

  const row = target.closest<HTMLElement>(
    `[${FILES_DATA_ATTR.action}="select-entry"][${FILES_DATA_ATTR.path}]`
  );
  const path = row?.getAttribute(FILES_DATA_ATTR.path) ?? null;
  const isDir = row?.getAttribute(FILES_DATA_ATTR.isDir) === "true";

  event.preventDefault();
  event.stopPropagation();
  const rect = withinFilesTool.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  openFilesContextMenu(slice, localX, localY, path, isDir);
  if (path && !isDir) {
    slice.filesSelectedEntryPath = path;
  }
  return true;
}

export function handleFilesMouseMove(target: HTMLElement, slice: FilesSlice): boolean {
  if (!slice.filesContextMenuOpen) return false;
  if (target.closest(".files-context-menu")) {
    slice.filesContextMenuPointerInside = true;
    return false;
  }
  if (!slice.filesContextMenuPointerInside) {
    return false;
  }
  closeFilesContextMenu(slice);
  return true;
}

export function handleFilesInput(
  target: HTMLElement,
  slice: FilesSlice
): { handled: boolean; rerender: boolean } {
  const editorInput = target.closest<HTMLTextAreaElement>(
    `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}]`
  );
  if (editorInput) {
    const path = editorInput.getAttribute(FILES_DATA_ATTR.path);
    if (!path) return { handled: true, rerender: false };
    const content = editorInput.value;
    slice.filesContentByPath[path] = content;
    const saved = slice.filesSavedContentByPath[path] ?? "";
    slice.filesDirtyByPath[path] = saved !== content;
    scheduleNotepadEditorRefresh(editorInput, content, FILES_EDITOR_ATTRS);
    return { handled: true, rerender: false };
  }

  const findQuery = target.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="find-query-input"]`
  );
  if (findQuery) {
    slice.filesFindQuery = findQuery.value;
    slice.filesFindOpen = true;
    return { handled: true, rerender: true };
  }
  const replaceQuery = target.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="replace-query-input"]`
  );
  if (replaceQuery) {
    slice.filesReplaceQuery = replaceQuery.value;
    slice.filesFindOpen = true;
    return { handled: true, rerender: true };
  }
  const caseSensitive = target.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="find-case-sensitive"]`
  );
  if (caseSensitive) {
    slice.filesFindCaseSensitive = caseSensitive.checked;
    slice.filesFindOpen = true;
    return { handled: true, rerender: true };
  }
  return { handled: false, rerender: false };
}

export async function handleFilesKeyDown(
  event: KeyboardEvent,
  slice: FilesSlice,
  deps: Pick<
    FilesDeps,
    | "saveActiveFilesTab"
    | "saveActiveFilesTabAs"
    | "saveAllFilesTabs"
    | "openFilesFile"
    | "updateFilesBuffer"
    | "closeFilesTab"
    | "pasteFilesClipboard"
    | "undoLastFilesDelete"
  >
): Promise<boolean> {
  const target = event.target as HTMLElement | null;
  const withinFilesTool =
    Boolean(target?.closest(".files-tool")) ||
    Boolean(document.activeElement?.closest?.(".files-tool"));
  if (!withinFilesTool) return false;
    if (slice.filesConflictModalOpen) {
    if (event.key === "Escape" && pendingConflictResolver) {
      const resolve = pendingConflictResolver;
      pendingConflictResolver = null;
      slice.filesConflictModalOpen = false;
      slice.filesConflictName = "";
      resolve({ choice: "cancel", applyToAll: false });
      return true;
    }
    return false;
  }

  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (event.shiftKey) {
        const active = slice.filesActiveTabPath;
        if (!active) return true;
        const requested = await pickSaveFilePath(active);
        if (!requested) return true;
        await deps.saveActiveFilesTabAs(requested);
      } else {
        await deps.saveActiveFilesTab();
      }
      return true;
    }
    if (key === "o") {
      event.preventDefault();
      const seed = slice.filesSelectedPath || slice.filesRootPath || undefined;
      const requested = await pickOpenFilePath(seed);
      if (!requested) return true;
      await deps.openFilesFile(requested);
      return true;
    }
    if (key === "f") {
      event.preventDefault();
      openFindBar(slice, false);
      return true;
    }
    if (key === "h") {
      event.preventDefault();
      openFindBar(slice, true);
      return true;
    }
    if (key === "w") {
      event.preventDefault();
      const active = slice.filesActiveTabPath;
      if (!active) return true;
      if (slice.filesDirtyByPath[active]) {
        const confirmed = window.confirm(
          "This file has unsaved changes. Close this tab and discard changes?"
        );
        if (!confirmed) return true;
      }
      deps.closeFilesTab(active);
      return true;
    }
    if (key === "a") {
      const inEditor = Boolean(
        (event.target as HTMLElement | null)?.closest(
          `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}]`
        )
      );
      if (inEditor) {
        return false;
      }
      event.preventDefault();
      selectAllFilesInDirectory(slice);
      return true;
    }
    if (key === "v") {
      event.preventDefault();
      const toDir = slice.filesSelectedPath || slice.filesRootPath || "";
      if (toDir) {
        await deps.pasteFilesClipboard(toDir, (name) => requestConflictChoice(slice, name));
      }
      return true;
    }
    if (key === "c") {
      const active = slice.filesSelectedEntryPath;
      if (active) {
        event.preventDefault();
        setFilesClipboard(slice, "copy", [active]);
        return true;
      }
    }
    if (key === "x") {
      const active = slice.filesSelectedEntryPath;
      if (active) {
        event.preventDefault();
        setFilesClipboard(slice, "cut", [active]);
        return true;
      }
    }
    if (key === "z") {
      const inEditor = Boolean(
        (event.target as HTMLElement | null)?.closest(
          `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}]`
        )
      );
      if (inEditor) {
        return false;
      }
      event.preventDefault();
      await deps.undoLastFilesDelete();
      return true;
    }
  }

  if (!event.metaKey && !event.ctrlKey && event.altKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    slice.filesLineWrap = slice.filesLineWrap !== true;
    return true;
  }

  if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await deps.saveAllFilesTabs();
    return true;
  }

  if (event.key === "Escape") {
    closeFilesContextMenu(slice);
  }

  const editorInput = (event.target as HTMLElement | null)?.closest<HTMLTextAreaElement>(
    `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}]`
  );
  const findInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="find-query-input"]`
  );
  const replaceInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="replace-query-input"]`
  );
  if (!editorInput) {
    if (slice.filesFindOpen && event.key === "Escape") {
      slice.filesFindOpen = false;
      return true;
    }
    if (findInput && event.key === "Enter") {
      runFindStep(slice, event.shiftKey);
      return true;
    }
    if (replaceInput && event.key === "Enter") {
      runReplaceOne(slice, deps.updateFilesBuffer);
      return true;
    }
    return false;
  }
  const path = editorInput.getAttribute(FILES_DATA_ATTR.path);
  if (!path) return true;
  if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const start = editorInput.selectionStart;
    const end = editorInput.selectionEnd;
    const value = editorInput.value;
    const next = `${value.slice(0, start)}\t${value.slice(end)}`;
    editorInput.value = next;
    editorInput.selectionStart = editorInput.selectionEnd = start + 1;
    deps.updateFilesBuffer(path, next);
    scheduleNotepadEditorRefresh(editorInput, next, FILES_EDITOR_ATTRS);
    return true;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await deps.saveActiveFilesTab();
    const latest = slice.filesContentByPath[path] ?? editorInput.value;
    deps.updateFilesBuffer(path, latest);
    return true;
  }
  return false;
}

function openFindBar(slice: FilesSlice, preferReplace: boolean): void {
  const active = slice.filesActiveTabPath;
  if (!active) return;
  slice.filesFindOpen = true;
  if (!slice.filesFindQuery) {
    const selectedText = getSelectedEditorText(active);
    if (selectedText) {
      slice.filesFindQuery = selectedText;
    }
  }
  if (preferReplace && !slice.filesReplaceQuery) {
    slice.filesReplaceQuery = "";
  }
  if (slice.filesFindQuery) {
    runFindStep(slice, false, true);
  }
}

function runFindStep(slice: FilesSlice, backwards: boolean, selectFromStart = false): void {
  const active = slice.filesActiveTabPath;
  const query = slice.filesFindQuery ?? "";
  if (!active || !query) return;
  const matched = focusNotepadMatch(
    active,
    query,
    FILES_EDITOR_ATTRS,
    backwards,
    selectFromStart,
    slice.filesFindCaseSensitive === true
  );
  slice.filesError = matched ? null : `No matches for "${query}"`;
}

function runReplaceOne(
  slice: FilesSlice,
  updateFilesBuffer: (path: string, content: string) => void
): void {
  const active = slice.filesActiveTabPath;
  if (!active) return;
  const find = slice.filesFindQuery ?? "";
  if (!find) return;
  const source = slice.filesContentByPath[active] ?? "";
  const result = replaceOneInNotepad(
    active,
    source,
    find,
    slice.filesReplaceQuery ?? "",
    FILES_EDITOR_ATTRS,
    slice.filesFindCaseSensitive === true
  );
  if (!result.replaced) {
    slice.filesError = `No matches for "${find}"`;
    return;
  }
  updateFilesBuffer(active, result.content);
  slice.filesError = null;
  runFindStep(slice, false, true);
}

function runReplaceAll(
  slice: FilesSlice,
  updateFilesBuffer: (path: string, content: string) => void
): void {
  const active = slice.filesActiveTabPath;
  if (!active) return;
  const find = slice.filesFindQuery ?? "";
  if (!find) return;
  const source = slice.filesContentByPath[active] ?? "";
  const result = replaceAllInNotepad(
    active,
    source,
    find,
    slice.filesReplaceQuery ?? "",
    FILES_EDITOR_ATTRS,
    slice.filesFindCaseSensitive === true
  );
  if (!result.replaced) {
    slice.filesError = `No matches for "${find}"`;
    return;
  }
  updateFilesBuffer(active, result.content);
  slice.filesError = null;
  runFindStep(slice, false, true);
}

export function handleFilesPointerDown(
  event: MouseEvent,
  target: HTMLElement,
  slice: FilesSlice
): boolean {
  const fileRow = target.closest<HTMLElement>(
    `[${FILES_DATA_ATTR.action}="select-entry"][${FILES_DATA_ATTR.path}]`
  );
  if (event.button === 0 && fileRow) {
    const rowPath = fileRow.getAttribute(FILES_DATA_ATTR.path)?.trim() || "";
    const isDir = fileRow.getAttribute(FILES_DATA_ATTR.isDir) === "true";
    if (!isDir && rowPath) {
      const visibleFilePaths = listVisibleFilePaths(slice);
      if (event.shiftKey) {
        slice.filesSelectionGesture = "range";
        applyRangeSelection(slice, visibleFilePaths, rowPath);
        slice.filesSelectionDragActive = false;
        return true;
      }
      if (event.metaKey || event.ctrlKey) {
        slice.filesSelectionGesture = "toggle";
        toggleSelectionPath(slice, rowPath);
        slice.filesSelectionAnchorPath = rowPath;
        slice.filesSelectionDragActive = false;
        return true;
      }
      slice.filesSelectionGesture = "single";
      slice.filesSelectionAnchorPath = rowPath;
      slice.filesSelectionDragActive = true;
      slice.filesSelectionJustDragged = false;
      const startPath = rowPath;
      let currentHoverPath = startPath;
      slice.filesSelectedPaths = [startPath];
      const onMove = (moveEvent: MouseEvent) => {
        if ((moveEvent.buttons & 1) !== 1) return;
        const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
        const row = element?.closest<HTMLElement>(
          `[${FILES_DATA_ATTR.action}="select-entry"][${FILES_DATA_ATTR.path}]`
        );
        const hoverPath = row?.getAttribute(FILES_DATA_ATTR.path)?.trim() || "";
        const hoverIsDir = row?.getAttribute(FILES_DATA_ATTR.isDir) === "true";
        if (!hoverPath || hoverIsDir || hoverPath === currentHoverPath) return;
        currentHoverPath = hoverPath;
        const before = JSON.stringify(slice.filesSelectedPaths ?? []);
        applyRangeSelection(slice, visibleFilePaths, hoverPath);
        const after = JSON.stringify(slice.filesSelectedPaths ?? []);
        if (before !== after) {
          slice.filesSelectionJustDragged = true;
        }
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        slice.filesSelectionDragActive = false;
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
      return false;
    }
  }

  const sidebarResult = handleToolSidebarResize({
    event,
    target,
    rootSelector: ".files-tool",
    panelSelector: ".files-tool-left",
    collapsed: slice.filesSidebarCollapsed ?? false,
    minWidth: 180,
    maxWidth: 600,
    widthCssVar: "--files-sidebar-width",
    onWidthChange: (width) => { slice.filesSidebarWidth = width; },
    onResizeStart: () => {},
    onResizeEnd: () => {}
  });
  if (sidebarResult) return true;

  const resizeHandle = target.closest<HTMLElement>(
    `[${FILES_DATA_ATTR.action}="resize-column"][${FILES_DATA_ATTR.column}]`
  );
  if (!resizeHandle) return false;
  const key = resizeHandle.getAttribute(FILES_DATA_ATTR.column);
  if (!isFilesColumnKey(key)) return true;
  const grid = resizeHandle.closest<HTMLElement>(".files-tool-grid");
  const headerCell = resizeHandle.closest<HTMLElement>(".files-tool-header-cell");
  if (!grid || !headerCell) return true;

  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startWidth = Math.max(1, Math.round(headerCell.getBoundingClientRect().width));

  const onMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX;
    const nextWidth = Math.max(
      FILES_COLUMN_MIN_WIDTHS[key],
      Math.round(startWidth + delta)
    );
    if (!slice.filesColumnWidths) {
      slice.filesColumnWidths = { ...FILES_COLUMN_DEFAULT_WIDTHS };
    }
    slice.filesColumnWidths[key] = nextWidth;
    applyColumnWidth(grid, key, nextWidth);
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    const root = grid.closest<HTMLElement>(".files-tool");
    root?.classList.remove("is-resizing");
  };

  const root = grid.closest<HTMLElement>(".files-tool");
  root?.classList.add("is-resizing");
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp, { once: true });
  return true;
}

function isFilesColumnKey(value: string | null): value is FilesColumnKey {
  return value === "name" || value === "type" || value === "size" || value === "modified";
}

function listVisibleFilePaths(slice: FilesSlice): string[] {
  const selected = slice.filesSelectedPath || slice.filesRootPath;
  if (!selected) return [];
  const entries = slice.filesEntriesByPath[selected] ?? [];
  return entries.filter((entry) => !entry.isDir).map((entry) => entry.path);
}

function applyRangeSelection(slice: FilesSlice, visibleFilePaths: string[], targetPath: string): void {
  if (!visibleFilePaths.length) {
    slice.filesSelectedPaths = [];
    return;
  }
  const anchor = slice.filesSelectionAnchorPath?.trim() || targetPath;
  const a = visibleFilePaths.indexOf(anchor);
  const b = visibleFilePaths.indexOf(targetPath);
  if (a < 0 || b < 0) {
    slice.filesSelectedPaths = [targetPath];
    slice.filesSelectedEntryPath = targetPath;
    slice.filesSelectionAnchorPath = targetPath;
    return;
  }
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  slice.filesSelectedPaths = visibleFilePaths.slice(from, to + 1);
  slice.filesSelectedEntryPath = targetPath;
}

function toggleSelectionPath(slice: FilesSlice, path: string): void {
  const current = new Set(slice.filesSelectedPaths ?? []);
  if (current.has(path)) {
    current.delete(path);
  } else {
    current.add(path);
  }
  slice.filesSelectedPaths = Array.from(current);
  slice.filesSelectedEntryPath = path;
}

function applyColumnWidth(grid: HTMLElement, key: FilesColumnKey, width: number): void {
  if (key === "name") {
    grid.style.setProperty("--files-col-name", `${width}px`);
    return;
  }
  if (key === "type") {
    grid.style.setProperty("--files-col-type", `${width}px`);
    return;
  }
  if (key === "size") {
    grid.style.setProperty("--files-col-size", `${width}px`);
    return;
  }
  grid.style.setProperty("--files-col-modified", `${width}px`);
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

function getSelectedEditorText(path: string): string {
  return getSelectedNotepadText(path, FILES_EDITOR_ATTRS);
}

function hasUnsavedTabs(slice: FilesSlice): boolean {
  return slice.filesOpenTabs.some((path) => slice.filesDirtyByPath[path] === true);
}

async function preloadRootPickerTree(slice: FilesSlice, deps: FilesDeps): Promise<void> {
  const root = slice.filesRootPath?.trim();
  if (!root) return;
  await ensurePathListed(root, slice, deps);
  const plugins = findChildDirPath(slice, root, "plugins");
  const frontend = findChildDirPath(slice, root, "frontend");
  if (plugins) {
    await ensurePathListed(plugins, slice, deps);
  }
  if (frontend) {
    await ensurePathListed(frontend, slice, deps);
    const src = findChildDirPath(slice, frontend, "src");
    if (src) {
      await ensurePathListed(src, slice, deps);
      const tools = findChildDirPath(slice, src, "tools");
      if (tools) {
        await ensurePathListed(tools, slice, deps);
      }
    }
  }
}

async function ensurePathListed(path: string, slice: FilesSlice, deps: FilesDeps): Promise<void> {
  if (slice.filesEntriesByPath[path]) return;
  await deps.listFilesDirectory(path);
}

function findChildDirPath(slice: FilesSlice, parentPath: string, name: string): string | null {
  const entries = slice.filesEntriesByPath[parentPath] ?? [];
  const match = entries.find((entry) => entry.isDir && entry.name.toLowerCase() === name.toLowerCase());
  return match?.path ?? null;
}
