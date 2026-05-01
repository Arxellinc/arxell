import type { FilesListDirectoryEntry } from "../../contracts";
import { renderFilesToolActions, renderFilesToolBody } from "../files";
import type { FilesColumnWidths } from "../files/index";
import {
  renderMemoryToolActions,
  renderMemoryToolBody,
  type MemoryContextItem,
  type MemoryPersistentItem,
  type MemoryToolState
} from "../memory";
import { renderChartToolActions, renderChartToolBody } from "../chart";
import { renderTasksToolActions, renderTasksToolBody } from "../tasks";
import type { TaskFolder, TaskSortDirection, TaskSortKey, TaskRecord, TaskRunRecord } from "../tasks/state";
import type { ProjectRecord } from "../../projectsStore";
import { renderWebToolActions, renderWebToolBody } from "../webSearch";
import type { WebSearchHistoryItem, WebTabState } from "../webSearch/state";
import { renderOpenCodeToolActions, renderOpenCodeToolBody, renderOpenCodeInstallModal, renderOpenCodeSpawnModal } from "../opencode";
import type { OpenCodeToolState } from "../opencode/state";
import { renderLooperToolActions, renderLooperToolBody } from "../looper";
import type { LooperToolState } from "../looper/state";
import { renderNotepadToolActions, renderNotepadToolBody } from "../notepad";
import { renderSheetsToolActions, renderSheetsToolBody } from "../sheets";
import type { SheetsToolState } from "../sheets/state";
import { renderDocsToolActions, renderDocsToolBody } from "../docs";

export interface ToolViewHtml {
  actionsHtml: string;
  bodyHtml: string;
}

export interface WorkspaceToolViewInput {
  chartSource: string;
  chartRenderSource: string;
  chartError: string | null;
  activeWebTab: WebTabState | null;
  webTabs: WebTabState[];
  activeWebTabId: string;
  webHistoryOpen: boolean;
  webHistoryClearConfirmOpen: boolean;
  webHistory: WebSearchHistoryItem[];
  webSetupModalOpen: boolean;
  webSetupAccount: string;
  webSetupApiKey: string;
  webSetupMessage: string | null;
  webSetupBusy: boolean;
  filesRootPath: string | null;
  filesScopeRootPath: string | null;
  filesRootSelectorOpen: boolean;
  filesSelectedPath: string | null;
  filesSelectedEntryPath: string | null;
  filesOpenTabs: string[];
  filesActiveTabPath: string | null;
  filesContentByPath: Record<string, string>;
  filesDirtyByPath: Record<string, boolean>;
  filesLoadingFileByPath: Record<string, boolean>;
  filesSavingFileByPath: Record<string, boolean>;
  filesReadOnlyByPath: Record<string, boolean>;
  filesSizeByPath: Record<string, number>;
  filesExpandedByPath: Record<string, boolean>;
  filesEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  filesLoadingByPath: Record<string, boolean>;
  filesColumnWidths: Partial<FilesColumnWidths>;
  filesSidebarWidth: number;
  filesSidebarCollapsed: boolean;
  filesFindOpen: boolean;
  filesFindQuery: string;
  filesReplaceQuery: string;
  filesFindCaseSensitive: boolean;
  filesLineWrap: boolean;
  filesSelectedPaths: string[];
  filesContextMenuOpen: boolean;
  filesContextMenuX: number;
  filesContextMenuY: number;
  filesContextMenuTargetPath: string | null;
  filesContextMenuTargetIsDir: boolean;
  filesClipboardMode: "copy" | "cut" | null;
  filesClipboardPaths: string[];
  filesUndoDeleteAvailable: boolean;
  filesConflictModalOpen: boolean;
  filesConflictName: string;
  filesSelectionAnchorPath: string | null;
  filesSelectionDragActive: boolean;
  filesSelectionJustDragged: boolean;
  filesSelectionGesture: "single" | "toggle" | "range" | null;
  filesError: string | null;
  tasksById: Record<string, TaskRecord>;
  tasksRunsByTaskId: Record<string, TaskRunRecord[]>;
  tasksSelectedId: string | null;
  tasksFolder: TaskFolder;
  tasksSortKey: TaskSortKey;
  tasksSortDirection: TaskSortDirection;
  tasksDetailsCollapsed: boolean;
  tasksJsonDraft: string;
  projectsById: Record<string, ProjectRecord>;
  flowRuns: Array<{ runId: string }>;
  flowActiveRunId: string | null;
  flowMode: "plan" | "build";
  flowMaxIterations: number;
  flowDryRun: boolean;
  flowAutoPush: boolean;
  flowPromptPlanPath: string;
  flowPromptBuildPath: string;
  flowPlanPath: string;
  flowSpecsGlob: string;
  flowImplementCommand: string;
  flowBackpressureCommands: string;
  flowEventFilter: string;
  flowValidationResults: unknown[];
  flowBusy: boolean;
  flowMessage: string | null;
  flowAdvancedOpen: boolean;
  flowBottomPanel: "terminal" | "validate" | "events";
  flowWorkspaceSplit: number;
  flowActiveTerminalPhase: string;
  flowPhaseSessionByName: Record<string, string>;
  flowTerminalPhases: string[];
  flowAutoFocusPhaseTerminal: boolean;
  flowPhaseTranscriptsByRun: Record<string, Record<string, unknown[]>>;
  flowProjectSetupOpen: boolean;
  flowProjectNameDraft: string;
  flowProjectTypeDraft: string;
  flowProjectIconDraft: string;
  flowProjectDescriptionDraft: string;
  flowPhaseModels: Record<string, string>;
  flowAvailableModels: Array<{ id: string; label: string }>;
  flowPaused: boolean;
  flowUseAgent: boolean;
  flowModelUnavailableOpen: boolean;
  flowModelUnavailablePhase: string;
  flowModelUnavailableModel: string;
  flowModelUnavailableFallbackModel: string;
  flowModelUnavailableReason: string;
  flowModelUnavailableAttempt: number;
  flowModelUnavailableMaxAttempts: number;
  flowModelUnavailableStatus: string;
  terminalSessions: Array<{ sessionId: string }>;
  filteredFlowEvents: unknown[];
  opencodeState: OpenCodeToolState;
  looperState: LooperToolState;
  notepadOpenTabs: string[];
  notepadActiveTabId: string | null;
  notepadPathByTabId: Record<string, string | null>;
  notepadTitleByTabId: Record<string, string>;
  notepadContentByTabId: Record<string, string>;
  notepadDirtyByTabId: Record<string, boolean>;
  notepadLoadingByTabId: Record<string, boolean>;
  notepadSavingByTabId: Record<string, boolean>;
  notepadReadOnlyByTabId: Record<string, boolean>;
  notepadSizeByTabId: Record<string, number>;
  notepadFindOpen: boolean;
  notepadFindQuery: string;
  notepadReplaceQuery: string;
  notepadFindCaseSensitive: boolean;
  notepadLineWrap: boolean;
  notepadError: string | null;
  sheetsState: SheetsToolState;
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
  memoryContextItems: MemoryContextItem[];
  memoryChatHistory: MemoryToolState["chatHistory"];
  memoryPersistentItems: MemoryPersistentItem[];
  memorySkillsItems: MemoryContextItem[];
  memoryToolsItems: MemoryContextItem[];
  memoryAlwaysLoadToolKeys: string[];
  memoryAlwaysLoadSkillKeys: string[];
  memoryModalOpen: boolean;
  memoryModalMode: MemoryToolState["modalMode"];
  memoryModalSection: MemoryToolState["modalSection"];
  memoryModalTitle: string;
  memoryModalValue: string;
  memoryModalEditable: boolean;
  memoryModalTarget: MemoryToolState["modalTarget"];
  memoryModalNamespace: string | null;
  memoryModalKey: string | null;
  memoryModalSourcePath: string | null;
  memoryModalConversationId: string | null;
  memoryModalDraftKey: string;
  memoryModalDraftCategory: string;
  memoryModalDraftDescription: string;
  memoryActiveTab: MemoryToolState["activeTab"];
  memoryRouteMode: string;
  memoryTotalTokenEstimate: number;
  memoryLoading: boolean;
  memoryError: string | null;
}

export function buildWorkspaceToolViews(input: WorkspaceToolViewInput): Record<string, ToolViewHtml> {
  const filesBodyHtml = renderFilesToolBody({
    rootPath: input.filesRootPath,
    scopeRootPath: input.filesScopeRootPath,
    rootSelectorOpen: input.filesRootSelectorOpen,
    selectedPath: input.filesSelectedPath,
    selectedEntryPath: input.filesSelectedEntryPath,
    openTabs: input.filesOpenTabs,
    activeTabPath: input.filesActiveTabPath,
    contentByPath: input.filesContentByPath,
    dirtyByPath: input.filesDirtyByPath,
    loadingFileByPath: input.filesLoadingFileByPath,
    savingFileByPath: input.filesSavingFileByPath,
    readOnlyByPath: input.filesReadOnlyByPath,
    sizeByPath: input.filesSizeByPath,
    expandedByPath: input.filesExpandedByPath,
    entriesByPath: input.filesEntriesByPath,
    loadingByPath: input.filesLoadingByPath,
    columnWidths: input.filesColumnWidths,
    sidebarWidth: input.filesSidebarWidth,
    sidebarCollapsed: input.filesSidebarCollapsed,
    findOpen: input.filesFindOpen,
    findQuery: input.filesFindQuery,
    replaceQuery: input.filesReplaceQuery,
    findCaseSensitive: input.filesFindCaseSensitive,
    lineWrap: input.filesLineWrap,
    selectedPaths: input.filesSelectedPaths,
    contextMenuOpen: input.filesContextMenuOpen,
    contextMenuX: input.filesContextMenuX,
    contextMenuY: input.filesContextMenuY,
    contextMenuTargetPath: input.filesContextMenuTargetPath,
    contextMenuTargetIsDir: input.filesContextMenuTargetIsDir,
    clipboardMode: input.filesClipboardMode,
    clipboardPaths: input.filesClipboardPaths,
    undoDeleteAvailable: input.filesUndoDeleteAvailable,
    conflictModalOpen: input.filesConflictModalOpen,
    conflictModalName: input.filesConflictName,
    selectionAnchorPath: input.filesSelectionAnchorPath,
    selectionDragActive: input.filesSelectionDragActive,
    selectionJustDragged: input.filesSelectionJustDragged,
    selectionGesture: input.filesSelectionGesture,
    error: input.filesError
  });

  return {
    chart: {
      actionsHtml: renderChartToolActions(),
      bodyHtml: renderChartToolBody({
        source: input.chartSource,
        renderSource: input.chartRenderSource,
        error: input.chartError
      })
    },
    webSearch: {
      actionsHtml: renderWebToolActions(
        input.webTabs.map((tab) => ({
          id: tab.id,
          label: tab.title,
          active: tab.id === input.activeWebTabId
        })),
        input.activeWebTab?.viewMode ?? "markdown",
        input.webHistoryOpen,
        input.activeWebTab?.busy ?? false
      ),
      bodyHtml: renderWebToolBody({
        tabId: input.activeWebTab?.id ?? "",
        title: input.activeWebTab?.title ?? "Search",
        query: input.activeWebTab?.query ?? "",
        mode: input.activeWebTab?.mode ?? "search",
        viewMode: input.activeWebTab?.viewMode ?? "markdown",
        num: input.activeWebTab?.num ?? 10,
        busy: input.activeWebTab?.busy ?? false,
        message: input.activeWebTab?.message ?? null,
        result: input.activeWebTab?.result ?? null,
        historyOpen: input.webHistoryOpen,
        historyClearConfirmOpen: input.webHistoryClearConfirmOpen,
        historyItems: input.webHistory,
        setupModalOpen: input.webSetupModalOpen,
        setupAccount: input.webSetupAccount,
        setupApiKey: input.webSetupApiKey,
        setupMessage: input.webSetupMessage,
        setupBusy: input.webSetupBusy
      })
    },
    files: {
      actionsHtml: renderFilesToolActions({
        rootPath: input.filesRootPath,
        scopeRootPath: input.filesScopeRootPath,
        rootSelectorOpen: input.filesRootSelectorOpen,
        selectedPath: input.filesSelectedPath,
        selectedEntryPath: input.filesSelectedEntryPath,
        openTabs: input.filesOpenTabs,
        activeTabPath: input.filesActiveTabPath,
        contentByPath: input.filesContentByPath,
        dirtyByPath: input.filesDirtyByPath,
        loadingFileByPath: input.filesLoadingFileByPath,
        savingFileByPath: input.filesSavingFileByPath,
        readOnlyByPath: input.filesReadOnlyByPath,
        sizeByPath: input.filesSizeByPath,
        expandedByPath: input.filesExpandedByPath,
        entriesByPath: input.filesEntriesByPath,
        loadingByPath: input.filesLoadingByPath,
        columnWidths: input.filesColumnWidths,
        sidebarWidth: input.filesSidebarWidth,
        sidebarCollapsed: input.filesSidebarCollapsed,
        findOpen: input.filesFindOpen,
        findQuery: input.filesFindQuery,
        replaceQuery: input.filesReplaceQuery,
        findCaseSensitive: input.filesFindCaseSensitive,
        lineWrap: input.filesLineWrap,
        selectedPaths: input.filesSelectedPaths,
        contextMenuOpen: input.filesContextMenuOpen,
        contextMenuX: input.filesContextMenuX,
        contextMenuY: input.filesContextMenuY,
        contextMenuTargetPath: input.filesContextMenuTargetPath,
        contextMenuTargetIsDir: input.filesContextMenuTargetIsDir,
        clipboardMode: input.filesClipboardMode,
        clipboardPaths: input.filesClipboardPaths,
        undoDeleteAvailable: input.filesUndoDeleteAvailable,
        conflictModalOpen: input.filesConflictModalOpen,
        conflictModalName: input.filesConflictName,
        selectionAnchorPath: input.filesSelectionAnchorPath,
        selectionDragActive: input.filesSelectionDragActive,
        selectionJustDragged: input.filesSelectionJustDragged,
        selectionGesture: input.filesSelectionGesture,
        error: input.filesError
      }),
      bodyHtml: filesBodyHtml
    },
    tasks: {
      actionsHtml: renderTasksToolActions({
        tasksById: input.tasksById,
        selectedId: input.tasksSelectedId,
        folder: input.tasksFolder,
        sortKey: input.tasksSortKey,
        sortDirection: input.tasksSortDirection,
        detailsCollapsed: input.tasksDetailsCollapsed,
        jsonDraft: input.tasksJsonDraft,
        projectsById: input.projectsById,
        runsByTaskId: input.tasksRunsByTaskId
      }),
      bodyHtml: renderTasksToolBody({
        tasksById: input.tasksById,
        selectedId: input.tasksSelectedId,
        folder: input.tasksFolder,
        sortKey: input.tasksSortKey,
        sortDirection: input.tasksSortDirection,
        detailsCollapsed: input.tasksDetailsCollapsed,
        jsonDraft: input.tasksJsonDraft,
        projectsById: input.projectsById,
        runsByTaskId: input.tasksRunsByTaskId
      })
    },
    memory: {
      actionsHtml: renderMemoryToolActions(input.memoryActiveTab),
      bodyHtml: renderMemoryToolBody({
        contextItems: input.memoryContextItems,
        chatHistory: input.memoryChatHistory,
        persistentItems: input.memoryPersistentItems,
        skillsItems: input.memorySkillsItems,
        toolsItems: input.memoryToolsItems,
        alwaysLoadToolKeys: input.memoryAlwaysLoadToolKeys,
        alwaysLoadSkillKeys: input.memoryAlwaysLoadSkillKeys,
        modalOpen: input.memoryModalOpen,
        modalMode: input.memoryModalMode,
        modalSection: input.memoryModalSection,
        modalTitle: input.memoryModalTitle,
        modalValue: input.memoryModalValue,
        modalEditable: input.memoryModalEditable,
        modalTarget: input.memoryModalTarget,
        modalNamespace: input.memoryModalNamespace,
        modalKey: input.memoryModalKey,
        modalSourcePath: input.memoryModalSourcePath,
        modalConversationId: input.memoryModalConversationId,
        modalDraftKey: input.memoryModalDraftKey,
        modalDraftCategory: input.memoryModalDraftCategory,
        modalDraftDescription: input.memoryModalDraftDescription,
        activeTab: input.memoryActiveTab,
        routeMode: input.memoryRouteMode,
        totalTokenEstimate: input.memoryTotalTokenEstimate,
        loading: input.memoryLoading,
        error: input.memoryError
      })
    },
    opencode: {
      actionsHtml: renderOpenCodeToolActions(input.opencodeState),
      bodyHtml: renderOpenCodeToolBody(input.opencodeState) +
        renderOpenCodeInstallModal(input.opencodeState) +
        renderOpenCodeSpawnModal(input.opencodeState)
    },
    looper: {
      actionsHtml: renderLooperToolActions(input.looperState),
      bodyHtml: renderLooperToolBody(input.looperState, input.projectsById)
    },
    notepad: {
      actionsHtml: renderNotepadToolActions({
        openTabs: input.notepadOpenTabs,
        activeTabId: input.notepadActiveTabId,
        pathByTabId: input.notepadPathByTabId,
        titleByTabId: input.notepadTitleByTabId,
        contentByTabId: input.notepadContentByTabId,
        dirtyByTabId: input.notepadDirtyByTabId,
        loadingByTabId: input.notepadLoadingByTabId,
        savingByTabId: input.notepadSavingByTabId,
        readOnlyByTabId: input.notepadReadOnlyByTabId,
        sizeByTabId: input.notepadSizeByTabId,
        findOpen: input.notepadFindOpen,
        findQuery: input.notepadFindQuery,
        replaceQuery: input.notepadReplaceQuery,
        findCaseSensitive: input.notepadFindCaseSensitive,
        lineWrap: input.notepadLineWrap,
        error: input.notepadError
      }),
      bodyHtml: renderNotepadToolBody({
        openTabs: input.notepadOpenTabs,
        activeTabId: input.notepadActiveTabId,
        pathByTabId: input.notepadPathByTabId,
        titleByTabId: input.notepadTitleByTabId,
        contentByTabId: input.notepadContentByTabId,
        dirtyByTabId: input.notepadDirtyByTabId,
        loadingByTabId: input.notepadLoadingByTabId,
        savingByTabId: input.notepadSavingByTabId,
        readOnlyByTabId: input.notepadReadOnlyByTabId,
        sizeByTabId: input.notepadSizeByTabId,
        findOpen: input.notepadFindOpen,
        findQuery: input.notepadFindQuery,
        replaceQuery: input.notepadReplaceQuery,
        findCaseSensitive: input.notepadFindCaseSensitive,
        lineWrap: input.notepadLineWrap,
        error: input.notepadError
      })
    },
    sheets: {
      actionsHtml: renderSheetsToolActions(input.sheetsState),
      bodyHtml: renderSheetsToolBody(input.sheetsState)
    },
    docs: {
      actionsHtml: renderDocsToolActions({
        docsRootPath: input.docsRootPath,
        docsSelectedPath: input.docsSelectedPath,
        docsSelectedEntryPath: input.docsSelectedEntryPath,
        docsExpandedByPath: input.docsExpandedByPath,
        docsEntriesByPath: input.docsEntriesByPath,
        docsLoadingByPath: input.docsLoadingByPath,
        docsOpenTabs: input.docsOpenTabs,
        docsActiveTabPath: input.docsActiveTabPath,
        docsContentByPath: input.docsContentByPath,
        docsSavedContentByPath: input.docsSavedContentByPath,
        docsDirtyByPath: input.docsDirtyByPath,
        docsLoadingFileByPath: input.docsLoadingFileByPath,
        docsSavingFileByPath: input.docsSavingFileByPath,
        docsReadOnlyByPath: input.docsReadOnlyByPath,
        docsSizeByPath: input.docsSizeByPath,
        docsSidebarWidth: input.docsSidebarWidth,
        docsSidebarCollapsed: input.docsSidebarCollapsed,
        docsFindOpen: input.docsFindOpen,
        docsFindQuery: input.docsFindQuery,
        docsReplaceQuery: input.docsReplaceQuery,
        docsFindCaseSensitive: input.docsFindCaseSensitive,
        docsLineWrap: input.docsLineWrap,
        docsError: input.docsError
      }),
      bodyHtml: renderDocsToolBody({
        docsRootPath: input.docsRootPath,
        docsSelectedPath: input.docsSelectedPath,
        docsSelectedEntryPath: input.docsSelectedEntryPath,
        docsExpandedByPath: input.docsExpandedByPath,
        docsEntriesByPath: input.docsEntriesByPath,
        docsLoadingByPath: input.docsLoadingByPath,
        docsOpenTabs: input.docsOpenTabs,
        docsActiveTabPath: input.docsActiveTabPath,
        docsContentByPath: input.docsContentByPath,
        docsSavedContentByPath: input.docsSavedContentByPath,
        docsDirtyByPath: input.docsDirtyByPath,
        docsLoadingFileByPath: input.docsLoadingFileByPath,
        docsSavingFileByPath: input.docsSavingFileByPath,
        docsReadOnlyByPath: input.docsReadOnlyByPath,
        docsSizeByPath: input.docsSizeByPath,
        docsSidebarWidth: input.docsSidebarWidth,
        docsSidebarCollapsed: input.docsSidebarCollapsed,
        docsFindOpen: input.docsFindOpen,
        docsFindQuery: input.docsFindQuery,
        docsReplaceQuery: input.docsReplaceQuery,
        docsFindCaseSensitive: input.docsFindCaseSensitive,
        docsLineWrap: input.docsLineWrap,
        docsError: input.docsError
      })
    }
  };
}
