import type { AppEvent, FilesListDirectoryEntry, FlowRerunValidationResult } from "../../contracts";
import { renderFilesToolActions, renderFilesToolBody } from "../files";
import type { FilesColumnWidths } from "../files/index";
import { renderFlowToolActions, renderFlowToolBody, type FlowTerminalSessionView } from "../flow";
import type { FlowPhaseTranscriptEntry, FlowRunView } from "../flow/state";
import { renderMemoryToolActions, renderMemoryToolBody, type MemoryToolState } from "../memory";
import { renderSkillsToolActions, renderSkillsToolBody } from "../skills";
import { renderCreateToolActions, renderCreateToolBody } from "../createTool";
import { renderChartToolActions, renderChartToolBody } from "../chart";
import type { CreateToolRuntimeSlice } from "../createTool/state";
import { renderTasksToolActions, renderTasksToolBody } from "../tasks";
import type { TaskFolder, TaskSortDirection, TaskSortKey, TaskRecord } from "../tasks/state";
import { renderWebToolActions, renderWebToolBody } from "../webSearch";
import type { WebSearchHistoryItem, WebTabState } from "../webSearch/state";

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
  tasksSelectedId: string | null;
  tasksFolder: TaskFolder;
  tasksSortKey: TaskSortKey;
  tasksSortDirection: TaskSortDirection;
  tasksDetailsCollapsed: boolean;
  tasksJsonDraft: string;
  createToolSpec: CreateToolRuntimeSlice["createToolSpec"];
  createToolStage: CreateToolRuntimeSlice["createToolStage"];
  createToolModelOptions: CreateToolRuntimeSlice["createToolModelOptions"];
  createToolSelectedModelId: CreateToolRuntimeSlice["createToolSelectedModelId"];
  createToolPrdUiPreset: CreateToolRuntimeSlice["createToolPrdUiPreset"];
  createToolLayoutModifiers: CreateToolRuntimeSlice["createToolLayoutModifiers"];
  createToolPrdUiNotes: string;
  createToolPrdInputs: string;
  createToolPrdProcess: string;
  createToolPrdConnections: string;
  createToolPrdDependencies: string;
  createToolPrdExpectedBehavior: string;
  createToolPrdOutputs: string;
  createToolDevPlan: string;
  createToolBuildViewMode: CreateToolRuntimeSlice["createToolBuildViewMode"];
  createToolUiPreviewHtml: string;
  createToolFixNotes: string;
  createToolIconBrowserOpen: boolean;
  createToolIconBrowserQuery: string;
  createToolIconBrowserAppliedQuery: string;
  createToolIconLibrary: Array<{ name: string; svg: string }>;
  createToolWorkspaceRoot: string;
  createToolPreviewFiles: Record<string, string>;
  createToolPreviewOrder: string[];
  createToolSelectedPreviewPath: string;
  createToolValidationErrors: string[];
  createToolValidationWarnings: string[];
  createToolStatusMessage: string | null;
  createToolLastResultJson: string;
  createToolPrdGeneratingSection: CreateToolRuntimeSlice["createToolPrdGeneratingSection"];
  createToolPrdGeneratingAll: CreateToolRuntimeSlice["createToolPrdGeneratingAll"];
  createToolPrdReviewBusy: CreateToolRuntimeSlice["createToolPrdReviewBusy"];
  createToolPrdReviewFindings: CreateToolRuntimeSlice["createToolPrdReviewFindings"];
  createToolBusy: boolean;
  flowRuns: FlowRunView[];
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
  flowValidationResults: FlowRerunValidationResult[];
  flowBusy: boolean;
  flowMessage: string | null;
  flowAdvancedOpen: boolean;
  flowBottomPanel: "terminal" | "validate" | "events";
  flowWorkspaceSplit: number;
  flowActiveTerminalPhase: string;
  flowPhaseSessionByName: Record<string, string>;
  flowTerminalPhases: string[];
  flowAutoFocusPhaseTerminal: boolean;
  flowPhaseTranscriptsByRun: Record<string, Record<string, FlowPhaseTranscriptEntry[]>>;
  flowProjectSetupOpen: boolean;
  flowProjectNameDraft: string;
  flowProjectTypeDraft: string;
  flowProjectDescriptionDraft: string;
  flowPhaseModels: Record<string, string>;
  flowAvailableModels: Array<{ id: string; label: string }>;
  flowPaused: boolean;
  flowModelUnavailableOpen: boolean;
  flowModelUnavailablePhase: string;
  flowModelUnavailableModel: string;
  flowModelUnavailableFallbackModel: string;
  flowModelUnavailableReason: string;
  flowModelUnavailableAttempt: number;
  flowModelUnavailableMaxAttempts: number;
  flowModelUnavailableStatus: string;
  terminalSessions: FlowTerminalSessionView[];
  filteredFlowEvents: AppEvent[];
}

export function buildWorkspaceToolViews(input: WorkspaceToolViewInput): Record<string, ToolViewHtml> {
  const activeFlowRunId = input.flowActiveRunId ?? input.flowRuns[0]?.runId ?? null;
  const activePhaseTranscript =
    (activeFlowRunId
      ? input.flowPhaseTranscriptsByRun[activeFlowRunId]?.[input.flowActiveTerminalPhase]
      : null) ?? [];
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
    flow: {
      actionsHtml: renderFlowToolActions({
        runs: input.flowRuns,
        activeRunId: activeFlowRunId,
        mode: input.flowMode,
        maxIterations: input.flowMaxIterations,
        dryRun: input.flowDryRun,
        autoPush: input.flowAutoPush,
        promptPlanPath: input.flowPromptPlanPath,
        promptBuildPath: input.flowPromptBuildPath,
        planPath: input.flowPlanPath,
        specsGlob: input.flowSpecsGlob,
        implementCommand: input.flowImplementCommand,
        backpressureCommands: input.flowBackpressureCommands,
        eventFilter: input.flowEventFilter,
        filteredEvents: input.filteredFlowEvents,
        validationResults: input.flowValidationResults,
        busy: input.flowBusy,
        message: input.flowMessage,
        advancedOpen: input.flowAdvancedOpen,
        bottomPanel: input.flowBottomPanel,
        workspaceSplit: input.flowWorkspaceSplit,
        activeTerminalPhase: input.flowActiveTerminalPhase,
        terminalPhases: input.flowTerminalPhases,
        phaseSessionByName: input.flowPhaseSessionByName,
        terminalSessions: input.terminalSessions,
        autoFocusPhaseTerminal: input.flowAutoFocusPhaseTerminal,
        activePhaseTranscript,
        projectSetupOpen: input.flowProjectSetupOpen,
        projectNameDraft: input.flowProjectNameDraft,
        projectTypeDraft: input.flowProjectTypeDraft,
        projectDescriptionDraft: input.flowProjectDescriptionDraft,
        phaseModels: input.flowPhaseModels,
        availableModels: input.flowAvailableModels,
        paused: input.flowPaused,
        modelUnavailableOpen: input.flowModelUnavailableOpen,
        modelUnavailablePhase: input.flowModelUnavailablePhase,
        modelUnavailableModel: input.flowModelUnavailableModel,
        modelUnavailableFallbackModel: input.flowModelUnavailableFallbackModel,
        modelUnavailableReason: input.flowModelUnavailableReason,
        modelUnavailableAttempt: input.flowModelUnavailableAttempt,
        modelUnavailableMaxAttempts: input.flowModelUnavailableMaxAttempts,
        modelUnavailableStatus: input.flowModelUnavailableStatus,
        embeddedFilesHtml: filesBodyHtml
      }),
      bodyHtml: renderFlowToolBody({
        runs: input.flowRuns,
        activeRunId: activeFlowRunId,
        mode: input.flowMode,
        maxIterations: input.flowMaxIterations,
        dryRun: input.flowDryRun,
        autoPush: input.flowAutoPush,
        promptPlanPath: input.flowPromptPlanPath,
        promptBuildPath: input.flowPromptBuildPath,
        planPath: input.flowPlanPath,
        specsGlob: input.flowSpecsGlob,
        implementCommand: input.flowImplementCommand,
        backpressureCommands: input.flowBackpressureCommands,
        eventFilter: input.flowEventFilter,
        filteredEvents: input.filteredFlowEvents,
        validationResults: input.flowValidationResults,
        busy: input.flowBusy,
        message: input.flowMessage,
        advancedOpen: input.flowAdvancedOpen,
        bottomPanel: input.flowBottomPanel,
        workspaceSplit: input.flowWorkspaceSplit,
        activeTerminalPhase: input.flowActiveTerminalPhase,
        terminalPhases: input.flowTerminalPhases,
        phaseSessionByName: input.flowPhaseSessionByName,
        terminalSessions: input.terminalSessions,
        autoFocusPhaseTerminal: input.flowAutoFocusPhaseTerminal,
        activePhaseTranscript,
        projectSetupOpen: input.flowProjectSetupOpen,
        projectNameDraft: input.flowProjectNameDraft,
        projectTypeDraft: input.flowProjectTypeDraft,
        projectDescriptionDraft: input.flowProjectDescriptionDraft,
        phaseModels: input.flowPhaseModels,
        availableModels: input.flowAvailableModels,
        paused: input.flowPaused,
        modelUnavailableOpen: input.flowModelUnavailableOpen,
        modelUnavailablePhase: input.flowModelUnavailablePhase,
        modelUnavailableModel: input.flowModelUnavailableModel,
        modelUnavailableFallbackModel: input.flowModelUnavailableFallbackModel,
        modelUnavailableReason: input.flowModelUnavailableReason,
        modelUnavailableAttempt: input.flowModelUnavailableAttempt,
        modelUnavailableMaxAttempts: input.flowModelUnavailableMaxAttempts,
        modelUnavailableStatus: input.flowModelUnavailableStatus,
        embeddedFilesHtml: filesBodyHtml
      })
    },
    tasks: {
      actionsHtml: renderTasksToolActions({
        tasksById: input.tasksById,
        selectedId: input.tasksSelectedId,
        folder: input.tasksFolder,
        sortKey: input.tasksSortKey,
        sortDirection: input.tasksSortDirection,
        detailsCollapsed: input.tasksDetailsCollapsed,
        jsonDraft: input.tasksJsonDraft
      }),
      bodyHtml: renderTasksToolBody({
        tasksById: input.tasksById,
        selectedId: input.tasksSelectedId,
        folder: input.tasksFolder,
        sortKey: input.tasksSortKey,
        sortDirection: input.tasksSortDirection,
        detailsCollapsed: input.tasksDetailsCollapsed,
        jsonDraft: input.tasksJsonDraft
      })
    },
    createTool: {
      actionsHtml: renderCreateToolActions({
        createToolStage: input.createToolStage,
        createToolModelOptions: input.createToolModelOptions,
        createToolSelectedModelId: input.createToolSelectedModelId,
        createToolPrdUiPreset: input.createToolPrdUiPreset,
        createToolLayoutModifiers: input.createToolLayoutModifiers,
        createToolPrdUiNotes: input.createToolPrdUiNotes,
        createToolPrdInputs: input.createToolPrdInputs,
        createToolPrdProcess: input.createToolPrdProcess,
        createToolPrdConnections: input.createToolPrdConnections,
        createToolPrdDependencies: input.createToolPrdDependencies,
        createToolPrdExpectedBehavior: input.createToolPrdExpectedBehavior,
        createToolPrdOutputs: input.createToolPrdOutputs,
        createToolDevPlan: input.createToolDevPlan,
        createToolBuildViewMode: input.createToolBuildViewMode,
        createToolUiPreviewHtml: input.createToolUiPreviewHtml,
        createToolFixNotes: input.createToolFixNotes,
        createToolIconBrowserOpen: input.createToolIconBrowserOpen,
        createToolIconBrowserQuery: input.createToolIconBrowserQuery,
        createToolIconBrowserAppliedQuery: input.createToolIconBrowserAppliedQuery,
        createToolIconLibrary: input.createToolIconLibrary,
        createToolSpec: input.createToolSpec,
        createToolWorkspaceRoot: input.createToolWorkspaceRoot,
        createToolPreviewFiles: input.createToolPreviewFiles,
        createToolPreviewOrder: input.createToolPreviewOrder,
        createToolSelectedPreviewPath: input.createToolSelectedPreviewPath,
        createToolValidationErrors: input.createToolValidationErrors,
        createToolValidationWarnings: input.createToolValidationWarnings,
        createToolStatusMessage: input.createToolStatusMessage,
        createToolLastResultJson: input.createToolLastResultJson,
        createToolPrdGeneratingSection: input.createToolPrdGeneratingSection,
        createToolPrdGeneratingAll: input.createToolPrdGeneratingAll,
        createToolPrdReviewBusy: input.createToolPrdReviewBusy,
        createToolPrdReviewFindings: input.createToolPrdReviewFindings,
        createToolBusy: input.createToolBusy
      }),
      bodyHtml: renderCreateToolBody({
        createToolStage: input.createToolStage,
        createToolModelOptions: input.createToolModelOptions,
        createToolSelectedModelId: input.createToolSelectedModelId,
        createToolPrdUiPreset: input.createToolPrdUiPreset,
        createToolLayoutModifiers: input.createToolLayoutModifiers,
        createToolPrdUiNotes: input.createToolPrdUiNotes,
        createToolPrdInputs: input.createToolPrdInputs,
        createToolPrdProcess: input.createToolPrdProcess,
        createToolPrdConnections: input.createToolPrdConnections,
        createToolPrdDependencies: input.createToolPrdDependencies,
        createToolPrdExpectedBehavior: input.createToolPrdExpectedBehavior,
        createToolPrdOutputs: input.createToolPrdOutputs,
        createToolDevPlan: input.createToolDevPlan,
        createToolBuildViewMode: input.createToolBuildViewMode,
        createToolUiPreviewHtml: input.createToolUiPreviewHtml,
        createToolFixNotes: input.createToolFixNotes,
        createToolIconBrowserOpen: input.createToolIconBrowserOpen,
        createToolIconBrowserQuery: input.createToolIconBrowserQuery,
        createToolIconBrowserAppliedQuery: input.createToolIconBrowserAppliedQuery,
        createToolIconLibrary: input.createToolIconLibrary,
        createToolSpec: input.createToolSpec,
        createToolWorkspaceRoot: input.createToolWorkspaceRoot,
        createToolPreviewFiles: input.createToolPreviewFiles,
        createToolPreviewOrder: input.createToolPreviewOrder,
        createToolSelectedPreviewPath: input.createToolSelectedPreviewPath,
        createToolValidationErrors: input.createToolValidationErrors,
        createToolValidationWarnings: input.createToolValidationWarnings,
        createToolStatusMessage: input.createToolStatusMessage,
        createToolLastResultJson: input.createToolLastResultJson,
        createToolPrdGeneratingSection: input.createToolPrdGeneratingSection,
        createToolPrdGeneratingAll: input.createToolPrdGeneratingAll,
        createToolPrdReviewBusy: input.createToolPrdReviewBusy,
        createToolPrdReviewFindings: input.createToolPrdReviewFindings,
        createToolBusy: input.createToolBusy
      })
    },
    memory: {
      actionsHtml: renderMemoryToolActions(),
      bodyHtml: renderMemoryToolBody({
        contextItems: [],
        chatHistory: [],
        persistentItems: [],
        loading: false,
        error: null
      })
    },
    skills: {
      actionsHtml: renderSkillsToolActions(),
      bodyHtml: renderSkillsToolBody()
    }
  };
}
