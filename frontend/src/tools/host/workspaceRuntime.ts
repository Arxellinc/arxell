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
  createToolScaffold,
  browseCreateToolIcons,
  generateCreateToolDevPlanFromModel,
  generateCreateToolPrdFromModel,
  generateCreateToolPrdSectionFromModel,
  runCreateToolPrdReview,
  registerCreateToolInWorkspace
} from "../createTool/actions";
import type { CreateToolPrdSection, CreateToolRuntimeSlice } from "../createTool/state";

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

export interface WorkspaceToolsRuntimeState
  extends FlowRuntimeSlice,
    FilesRuntimeSlice,
    Omit<WebSearchSlice, "apiConnections">,
    CreateToolRuntimeSlice {
  apiConnections: ApiConnectionRecord[];
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
  createAndActivateWebTab: () => void;
  runWebSearch: () => Promise<void>;
  saveWebSearchSetup: () => Promise<void>;
  createToolScaffold: () => Promise<void>;
  browseCreateToolIcons: () => Promise<void>;
  generateCreateToolPrd: () => Promise<void>;
  generateCreateToolPrdSection: (
    section: CreateToolPrdSection,
    onUpdate?: () => void
  ) => Promise<void>;
  runCreateToolPrdReview: () => Promise<void>;
  generateCreateToolDevPlan: () => Promise<void>;
  registerCreateToolInWorkspace: () => Promise<void>;
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
    createAndActivateWebTab: () => {
      createAndActivateWebTab(state, { createWebTab: deps.createWebTab });
    },
    runWebSearch: async () => {
      await runWebSearch(state, webDeps);
    },
    saveWebSearchSetup: async () => {
      await saveWebSearchSetup(state, webDeps);
    },
    createToolScaffold: async () => {
      await createToolScaffold(state, {
        client: deps.getClient(),
        nextCorrelationId: deps.nextCorrelationId,
        refreshTools: deps.refreshTools
      });
    },
    browseCreateToolIcons: async () => {
      await browseCreateToolIcons(state, {
        client: deps.getClient(),
        nextCorrelationId: deps.nextCorrelationId,
        refreshTools: deps.refreshTools
      });
    },
    generateCreateToolPrd: async () => {
      await generateCreateToolPrdFromModel(state, {
        client: deps.getClient(),
        nextCorrelationId: deps.nextCorrelationId,
        refreshTools: deps.refreshTools
      });
    },
    generateCreateToolPrdSection: async (section, onUpdate) => {
      await generateCreateToolPrdSectionFromModel(state, {
        client: deps.getClient(),
        nextCorrelationId: deps.nextCorrelationId,
        refreshTools: deps.refreshTools,
        onUpdate
      }, section);
    },
    runCreateToolPrdReview: async () => {
      await runCreateToolPrdReview(state, {
        client: deps.getClient(),
        nextCorrelationId: deps.nextCorrelationId,
        refreshTools: deps.refreshTools
      });
    },
    generateCreateToolDevPlan: async () => {
      await generateCreateToolDevPlanFromModel(state, {
        client: deps.getClient(),
        nextCorrelationId: deps.nextCorrelationId,
        refreshTools: deps.refreshTools
      });
    },
    registerCreateToolInWorkspace: async () => {
      await registerCreateToolInWorkspace(state, {
        client: deps.getClient(),
        nextCorrelationId: deps.nextCorrelationId,
        refreshTools: deps.refreshTools
      });
    }
  };
}
