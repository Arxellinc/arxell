import type { ApiConnectionRecord, FilesListDirectoryEntry } from "../../contracts";
import type { ChatIpcClient } from "../../ipcClient";
import {
  activateFilesTab,
  closeFilesTab,
  createNewFilesFolder,
  createNewFilesFile,
  deleteFilesPath,
  duplicateActiveFilesTab,
  ensureFilesExplorerLoaded,
  listFilesDirectory,
  openFilesFile,
  pasteFilesClipboard,
  renameFilesPath,
  undoLastFilesDelete,
  saveActiveFilesTab,
  saveActiveFilesTabAs,
  saveAllFilesTabs,
  selectFilesPath,
  toggleFilesNode,
  updateFilesBuffer
} from "../files/actions";
import type { FilesConflictResolution } from "../files/actions";
import {
  nudgeFlowRun,
  setFlowRunPaused,
  rerunFlowValidation,
  resumeFlowRun,
  retryFlowRun,
  startFlowRun,
  stopFlowRun
} from "../flow/actions";
import type { FlowRunView, FlowRuntimeSlice } from "../flow/state";
import {
  createAndActivateWebTab,
  ensureWebTabs,
  getActiveWebTab,
  hasVerifiedSearchConnection,
  runWebSearch,
  saveWebSearchSetup,
  withActiveWebTab
} from "../webSearch/actions";
import type { WebSearchHistoryItem, WebSearchSlice, WebTabState } from "../webSearch/state";
import {
  activateNotepadTab,
  closeNotepadTab,
  createUntitledNotepadTab,
  deleteActiveNotepadFile,
  duplicateActiveNotepadTab,
  ensureNotepadReady,
  openNotepadFile,
  saveActiveNotepadTab,
  saveActiveNotepadTabAs,
  saveAllNotepadTabs,
  updateNotepadBuffer
} from "../notepad/actions";
import { createNewDocsFile } from "../docs/actions";
import { createNewSkillsFile } from "../skills/actions";
import {
  createNewSheet,
  deleteColumns as deleteSheetsColumns,
  deleteRows as deleteSheetsRows,
  insertColumns as insertSheetsColumns,
  insertRows as insertSheetsRows,
  openSheetWithDialog,
  readVisibleRange as readSheetsVisibleRange,
  refreshSheetSnapshot,
  saveSheetCurrent,
  saveSheetWithDialog,
  setCellInput as setSheetsCellInput,
  writeRange as writeSheetsRange
} from "../sheets/actions";
import type { SheetsToolState } from "../sheets/state";

interface FilesRuntimeSlice {
  filesRootPath: string | null;
  filesSelectedPath: string | null;
  filesSelectedEntryPath: string | null;
  filesExpandedByPath: Record<string, boolean>;
  filesEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  filesLoadingByPath: Record<string, boolean>;
  filesOpenTabs: string[];
  filesActiveTabPath: string | null;
  filesContentByPath: Record<string, string>;
  filesSavedContentByPath: Record<string, string>;
  filesDirtyByPath: Record<string, boolean>;
  filesLoadingFileByPath: Record<string, boolean>;
  filesSavingFileByPath: Record<string, boolean>;
  filesReadOnlyByPath: Record<string, boolean>;
  filesSizeByPath: Record<string, number>;
  filesSidebarCollapsed: boolean;
  filesError: string | null;
  filesLineWrap: boolean;
}

interface NotepadRuntimeSlice {
  notepadOpenTabs: string[];
  notepadActiveTabId: string | null;
  notepadPathByTabId: Record<string, string | null>;
  notepadTitleByTabId: Record<string, string>;
  notepadContentByTabId: Record<string, string>;
  notepadSavedContentByTabId: Record<string, string>;
  notepadDirtyByTabId: Record<string, boolean>;
  notepadLoadingByTabId: Record<string, boolean>;
  notepadSavingByTabId: Record<string, boolean>;
  notepadReadOnlyByTabId: Record<string, boolean>;
  notepadSizeByTabId: Record<string, number>;
  notepadNextUntitledIndex: number;
  notepadError: string | null;
}

interface DocsRuntimeSlice {
  docsRootPath: string | null;
  docsSelectedPath: string | null;
  docsExpandedByPath: Record<string, boolean>;
  docsEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  docsLoadingByPath: Record<string, boolean>;
  docsSidebarWidth: number;
  docsSidebarCollapsed: boolean;
}

export interface WorkspaceToolsRuntimeState
  extends FlowRuntimeSlice,
    FilesRuntimeSlice,
    NotepadRuntimeSlice,
    DocsRuntimeSlice,
    Omit<WebSearchSlice, "apiConnections"> {
  apiConnections: ApiConnectionRecord[];
  sheetsState: SheetsToolState;
}

export interface WorkspaceToolsRuntimeDeps {
  getClient: () => ChatIpcClient | null;
  nextCorrelationId: () => string;
  refreshFlowRuns: () => Promise<void>;
  refreshTools: () => Promise<void>;
  refreshApiConnections: () => Promise<void>;
  createWebTab: (index: number) => WebTabState;
  persistWebSearchHistory: (entries: WebSearchHistoryItem[]) => void;
}

export interface WorkspaceToolsRuntime {
  startFlowRun: () => Promise<void>;
  retryFlowRun: (baseRun: FlowRunView) => Promise<void>;
  resumeFlowRun: (baseRun: FlowRunView) => Promise<void>;
  rerunFlowValidation: (baseRun: FlowRunView) => Promise<void>;
  stopFlowRun: () => Promise<void>;
  setFlowPaused: (paused: boolean) => Promise<void>;
  nudgeFlowRun: (message: string) => Promise<void>;
  getActiveWebTab: () => WebTabState | null;
  withActiveWebTab: (mutator: (tab: WebTabState) => void) => void;
  ensureWebTabs: () => void;
  hasVerifiedSearchConnection: () => boolean;
  listFilesDirectory: (path?: string) => Promise<void>;
  ensureFilesExplorerLoaded: () => Promise<void>;
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
  ensureNotepadReady: () => Promise<void>;
  createUntitledNotepadTab: () => string;
  openNotepadFile: (path: string) => Promise<void>;
  activateNotepadTab: (tabId: string) => void;
  closeNotepadTab: (tabId: string) => void;
  updateNotepadBuffer: (tabId: string, content: string) => void;
  saveActiveNotepadTab: () => Promise<void>;
  saveActiveNotepadTabAs: (path: string) => Promise<void>;
  saveAllNotepadTabs: () => Promise<void>;
  duplicateActiveNotepadTab: (path: string) => Promise<void>;
  deleteActiveNotepadFile: () => Promise<void>;
  createNewSheet: () => Promise<void>;
  ensureSheetReady: () => Promise<void>;
  openSheetWithDialog: () => Promise<void>;
  saveSheetCurrent: () => Promise<void>;
  saveSheetWithDialog: () => Promise<void>;
  refreshSheetSnapshot: () => Promise<void>;
  readVisibleRange: () => Promise<void>;
  setCellInput: (row: number, col: number, input: string) => Promise<void>;
  writeRange: (startRow: number, startCol: number, values: string[][]) => Promise<void>;
  insertRows: (index: number, count?: number) => Promise<void>;
  insertColumns: (index: number, count?: number) => Promise<void>;
  deleteRows: (index: number, count?: number) => Promise<void>;
  deleteColumns: (index: number, count?: number) => Promise<void>;
  createNewDocsFile: (path: string) => Promise<void>;
  createNewSkillsFile: (path: string) => Promise<void>;
  createAndActivateWebTab: () => void;
  runWebSearch: () => Promise<void>;
  saveWebSearchSetup: () => Promise<void>;
}

export function createWorkspaceToolsRuntime(
  state: WorkspaceToolsRuntimeState,
  deps: WorkspaceToolsRuntimeDeps
): WorkspaceToolsRuntime {
  const flowDeps = {
    get client() {
      return deps.getClient();
    },
    nextCorrelationId: deps.nextCorrelationId,
    refreshFlowRuns: deps.refreshFlowRuns
  };

  const filesDeps = {
    get client() {
      return deps.getClient();
    },
    nextCorrelationId: deps.nextCorrelationId
  };

  const webDeps = {
    get client() {
      return deps.getClient();
    },
    nextCorrelationId: deps.nextCorrelationId,
    refreshApiConnections: deps.refreshApiConnections,
    persistWebSearchHistory: deps.persistWebSearchHistory,
    createWebTab: deps.createWebTab
  };

  const notepadDeps = {
    get client() {
      return deps.getClient();
    },
    nextCorrelationId: deps.nextCorrelationId
  };

  const sheetsDeps = {
    get client() {
      return deps.getClient();
    },
    nextCorrelationId: deps.nextCorrelationId
  };

  return {
    startFlowRun: async () => {
      await startFlowRun(state, flowDeps);
    },
    retryFlowRun: async (baseRun) => {
      await retryFlowRun(state, flowDeps, baseRun);
    },
    resumeFlowRun: async (baseRun) => {
      await resumeFlowRun(state, flowDeps, baseRun);
    },
    rerunFlowValidation: async (baseRun) => {
      await rerunFlowValidation(state, flowDeps, baseRun);
    },
    stopFlowRun: async () => {
      await stopFlowRun(state, flowDeps);
    },
    setFlowPaused: async (paused) => {
      await setFlowRunPaused(state, flowDeps, paused);
    },
    nudgeFlowRun: async (message) => {
      await nudgeFlowRun(state, flowDeps, message);
    },
    getActiveWebTab: () => getActiveWebTab(state),
    withActiveWebTab: (mutator) => {
      withActiveWebTab(state, mutator);
    },
    ensureWebTabs: () => {
      ensureWebTabs(state, { createWebTab: deps.createWebTab });
    },
    hasVerifiedSearchConnection: () => hasVerifiedSearchConnection(state),
    listFilesDirectory: async (path) => {
      await listFilesDirectory(state, filesDeps, path);
    },
    ensureFilesExplorerLoaded: async () => {
      await ensureFilesExplorerLoaded(state, filesDeps);
    },
    selectFilesPath: async (path) => {
      await selectFilesPath(state, filesDeps, path);
    },
    toggleFilesNode: async (path) => {
      await toggleFilesNode(state, filesDeps, path);
    },
    openFilesFile: async (path) => {
      await openFilesFile(state, filesDeps, path);
    },
    activateFilesTab: (path) => {
      activateFilesTab(state, path);
    },
    closeFilesTab: (path) => {
      closeFilesTab(state, path);
    },
    updateFilesBuffer: (path, content) => {
      updateFilesBuffer(state, path, content);
    },
    saveActiveFilesTab: async () => {
      await saveActiveFilesTab(state, filesDeps);
    },
    saveActiveFilesTabAs: async (path) => {
      await saveActiveFilesTabAs(state, filesDeps, path);
    },
    saveAllFilesTabs: async () => {
      await saveAllFilesTabs(state, filesDeps);
    },
    createNewFilesFile: async (path) => {
      await createNewFilesFile(state, filesDeps, path);
    },
    createNewFilesFolder: async (path) => {
      await createNewFilesFolder(state, filesDeps, path);
    },
    duplicateActiveFilesTab: async (path) => {
      await duplicateActiveFilesTab(state, filesDeps, path);
    },
    deleteFilesPath: async (path, recursive = false) => {
      await deleteFilesPath(state, filesDeps, path, recursive);
    },
    renameFilesPath: async (from, to) => {
      await renameFilesPath(state, filesDeps, from, to);
    },
    pasteFilesClipboard: async (targetDirectory, resolveConflictChoice) => {
      await pasteFilesClipboard(state, filesDeps, targetDirectory, resolveConflictChoice);
    },
    undoLastFilesDelete: async () => {
      await undoLastFilesDelete(state, filesDeps);
    },
    ensureNotepadReady: async () => {
      await ensureNotepadReady(state);
    },
    createUntitledNotepadTab: () => createUntitledNotepadTab(state),
    openNotepadFile: async (path) => {
      await openNotepadFile(state, notepadDeps, path);
    },
    activateNotepadTab: (tabId) => {
      activateNotepadTab(state, tabId);
    },
    closeNotepadTab: (tabId) => {
      closeNotepadTab(state, tabId);
    },
    updateNotepadBuffer: (tabId, content) => {
      updateNotepadBuffer(state, tabId, content);
    },
    saveActiveNotepadTab: async () => {
      await saveActiveNotepadTab(state, notepadDeps);
    },
    saveActiveNotepadTabAs: async (path) => {
      await saveActiveNotepadTabAs(state, notepadDeps, path);
    },
    saveAllNotepadTabs: async () => {
      await saveAllNotepadTabs(state, notepadDeps);
    },
    duplicateActiveNotepadTab: async (path) => {
      await duplicateActiveNotepadTab(state, notepadDeps, path);
    },
    deleteActiveNotepadFile: async () => {
      await deleteActiveNotepadFile(state, notepadDeps);
    },
    createNewSheet: async () => {
      await createNewSheet(state.sheetsState, sheetsDeps);
    },
    ensureSheetReady: async () => {
      await refreshSheetSnapshot(state.sheetsState, sheetsDeps);
    },
    openSheetWithDialog: async () => {
      await openSheetWithDialog(state.sheetsState, sheetsDeps);
    },
    saveSheetCurrent: async () => {
      await saveSheetCurrent(state.sheetsState, sheetsDeps);
    },
    saveSheetWithDialog: async () => {
      await saveSheetWithDialog(state.sheetsState, sheetsDeps);
    },
    refreshSheetSnapshot: async () => {
      await refreshSheetSnapshot(state.sheetsState, sheetsDeps);
    },
    readVisibleRange: async () => {
      await readSheetsVisibleRange(state.sheetsState, sheetsDeps);
    },
    setCellInput: async (row, col, input) => {
      await setSheetsCellInput(state.sheetsState, sheetsDeps, row, col, input);
    },
    writeRange: async (startRow, startCol, values) => {
      await writeSheetsRange(state.sheetsState, sheetsDeps, startRow, startCol, values);
    },
    insertRows: async (index, count = 1) => {
      await insertSheetsRows(state.sheetsState, sheetsDeps, index, count);
    },
    insertColumns: async (index, count = 1) => {
      await insertSheetsColumns(state.sheetsState, sheetsDeps, index, count);
    },
    deleteRows: async (index, count = 1) => {
      await deleteSheetsRows(state.sheetsState, sheetsDeps, index, count);
    },
    deleteColumns: async (index, count = 1) => {
      await deleteSheetsColumns(state.sheetsState, sheetsDeps, index, count);
    },
    createNewDocsFile: async (path) => {
      await createNewDocsFile(state as never, notepadDeps as never, path);
    },
    createNewSkillsFile: async (path) => {
      await createNewSkillsFile(state as never, notepadDeps as never, path);
    },
    createAndActivateWebTab: () => {
      createAndActivateWebTab(state, { createWebTab: deps.createWebTab });
    },
    runWebSearch: async () => {
      await runWebSearch(state, webDeps);
    },
    saveWebSearchSetup: async () => {
      await saveWebSearchSetup(state, webDeps);
    }
  };
}
