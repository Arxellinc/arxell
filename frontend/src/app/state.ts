import type { ApiConnectionDraft, DevicesState } from "../panels/types";
import type { AppEvent, ChatContextBreakdownItem, ConversationSummaryRecord } from "../contracts";
import type { DocsToolState } from "../tools/docs/state";
import type { FilesToolStateSlice } from "../tools/files/state";
import type { NotepadToolStateSlice } from "../tools/notepad/state";
import { loadPersistedTasksById } from "../tools/tasks/actions";
import type { TasksRuntimeSlice } from "../tools/tasks/state";

export interface MemoryToolStateSlice {
  memoryContextItems: ChatContextBreakdownItem[];
  memoryChatHistory: Array<ConversationSummaryRecord & {
    fullBody: string;
    charCount: number;
    wordCount: number;
    tokenEstimate: number;
  }>;
  memoryPersistentItems: ChatContextBreakdownItem[];
  memorySkillsItems: ChatContextBreakdownItem[];
  memoryToolsItems: ChatContextBreakdownItem[];
  memoryAlwaysLoadToolKeys: string[];
  memoryAlwaysLoadSkillKeys: string[];
  memoryModalOpen: boolean;
  memoryModalMode: "edit" | "create";
  memoryModalSection: "context" | "history" | "memory" | "skills" | "tools" | null;
  memoryModalTitle: string;
  memoryModalValue: string;
  memoryModalEditable: boolean;
  memoryModalTarget: "memory" | "system-prompt" | "custom-item" | null;
  memoryModalNamespace: string | null;
  memoryModalKey: string | null;
  memoryModalSourcePath: string | null;
  memoryModalConversationId: string | null;
  memoryModalDraftKey: string;
  memoryModalDraftCategory: string;
  memoryModalDraftDescription: string;
  memoryActiveTab: "context" | "history" | "memory" | "skills" | "tools";
  memoryRouteMode: string;
  memoryTotalTokenEstimate: number;
  memoryLoading: boolean;
  memoryError: string | null;
}

export type FlowRunView = { runId: string; status?: string; phaseSessionByName?: Record<string, string> };
export type FlowPhaseTranscriptEntry = unknown;
export type FlowRerunValidationResult = unknown;

export interface FlowToolStateSlice {
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
  flowFilteredEvents: AppEvent[];
  flowValidationResults: FlowRerunValidationResult[];
  flowMessage: string | null;
  flowBusy: boolean;
  flowAdvancedOpen: boolean;
  flowBottomPanel: "terminal" | "validate" | "events";
  flowWorkspaceSplit: number;
  flowActiveTerminalPhase: string;
  flowPhaseSessionByName: Record<string, string>;
  flowAutoFocusPhaseTerminal: boolean;
  flowPhaseTranscriptsByRun: Record<string, Record<string, FlowPhaseTranscriptEntry[]>>;
  flowProjectSetupOpen: boolean;
  flowProjectSetupDismissed: boolean;
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
}

export interface FlowToolViewState extends Omit<FlowToolStateSlice, "flowFilteredEvents" | "flowProjectSetupDismissed"> {}

export interface MemoryToolViewState {
  memoryContextItems: Array<{
    key: string;
    value: string;
    category: string;
    loadMethod: string;
    loadReason: string;
    tokenEstimate: number;
    charCount: number;
    wordCount: number;
  }>;
  memoryChatHistory: MemoryToolStateSlice["memoryChatHistory"];
  memoryPersistentItems: Array<{
    key: string;
    value: string;
    type: "fact" | "personality" | "directive" | "other";
    loadMethod: string;
    loadReason: string;
    tokenEstimate: number;
    charCount: number;
    wordCount: number;
  }>;
  memorySkillsItems: MemoryToolViewState["memoryContextItems"];
  memoryToolsItems: MemoryToolViewState["memoryContextItems"];
  memoryAlwaysLoadToolKeys: string[];
  memoryAlwaysLoadSkillKeys: string[];
  memoryModalOpen: boolean;
  memoryModalMode: MemoryToolStateSlice["memoryModalMode"];
  memoryModalSection: MemoryToolStateSlice["memoryModalSection"];
  memoryModalTitle: string;
  memoryModalValue: string;
  memoryModalEditable: boolean;
  memoryModalTarget: MemoryToolStateSlice["memoryModalTarget"];
  memoryModalNamespace: string | null;
  memoryModalKey: string | null;
  memoryModalSourcePath: string | null;
  memoryModalConversationId: string | null;
  memoryModalDraftKey: string;
  memoryModalDraftCategory: string;
  memoryModalDraftDescription: string;
  memoryActiveTab: MemoryToolStateSlice["memoryActiveTab"];
  memoryRouteMode: string;
  memoryTotalTokenEstimate: number;
  memoryLoading: boolean;
  memoryError: string | null;
}

export function createInitialFilesState(): FilesToolStateSlice {
  return {
    filesRootPath: null,
    filesScopeRootPath: null,
    filesRootSelectorOpen: false,
    filesSelectedPath: null,
    filesSelectedEntryPath: null,
    filesOpenTabs: [],
    filesActiveTabPath: null,
    filesContentByPath: {},
    filesSavedContentByPath: {},
    filesDirtyByPath: {},
    filesLoadingFileByPath: {},
    filesSavingFileByPath: {},
    filesReadOnlyByPath: {},
    filesSizeByPath: {},
    filesExpandedByPath: {},
    filesEntriesByPath: {},
    filesLoadingByPath: {},
    filesColumnWidths: {
      name: 260,
      type: 120,
      size: 96,
      modified: 132
    },
    filesSidebarWidth: 320,
    filesSidebarCollapsed: false,
    filesFindOpen: false,
    filesFindQuery: "",
    filesReplaceQuery: "",
    filesFindCaseSensitive: false,
    filesLineWrap: false,
    filesSelectedPaths: [],
    filesContextMenuOpen: false,
    filesContextMenuX: 16,
    filesContextMenuY: 16,
    filesContextMenuTargetPath: null,
    filesContextMenuTargetIsDir: false,
    filesClipboardMode: null,
    filesClipboardPaths: [],
    filesDeleteUndoStack: [],
    filesConflictModalOpen: false,
    filesConflictName: "",
    filesSelectionAnchorPath: null,
    filesSelectionDragActive: false,
    filesSelectionJustDragged: false,
    filesSelectionGesture: null,
    filesError: null
  };
}

export function createInitialNotepadState(): NotepadToolStateSlice {
  return {
    notepadOpenTabs: [],
    notepadActiveTabId: null,
    notepadPathByTabId: {},
    notepadTitleByTabId: {},
    notepadContentByTabId: {},
    notepadSavedContentByTabId: {},
    notepadDirtyByTabId: {},
    notepadLoadingByTabId: {},
    notepadSavingByTabId: {},
    notepadReadOnlyByTabId: {},
    notepadSizeByTabId: {},
    notepadNextUntitledIndex: 1,
    notepadFindOpen: false,
    notepadFindQuery: "",
    notepadReplaceQuery: "",
    notepadFindCaseSensitive: false,
    notepadLineWrap: false,
    notepadError: null,
    notepadUnsavedModalTabId: null
  };
}

export function createInitialDocsState(): DocsToolState {
  return {
    docsRootPath: null,
    docsSelectedPath: null,
    docsSelectedEntryPath: null,
    docsExpandedByPath: {},
    docsEntriesByPath: {},
    docsLoadingByPath: {},
    docsOpenTabs: [],
    docsActiveTabPath: null,
    docsContentByPath: {},
    docsSavedContentByPath: {},
    docsDirtyByPath: {},
    docsLoadingFileByPath: {},
    docsSavingFileByPath: {},
    docsReadOnlyByPath: {},
    docsSizeByPath: {},
    docsSidebarWidth: 280,
    docsSidebarCollapsed: false,
    docsFindOpen: false,
    docsFindQuery: "",
    docsReplaceQuery: "",
    docsFindCaseSensitive: false,
    docsLineWrap: false,
    docsError: null
  };
}

export function createInitialMemoryState(options: {
  alwaysLoadToolKeys: string[];
  alwaysLoadSkillKeys: string[];
}): MemoryToolStateSlice {
  return {
    memoryContextItems: [],
    memoryChatHistory: [],
    memoryPersistentItems: [],
    memorySkillsItems: [],
    memoryToolsItems: [],
    memoryAlwaysLoadToolKeys: options.alwaysLoadToolKeys,
    memoryAlwaysLoadSkillKeys: options.alwaysLoadSkillKeys,
    memoryModalOpen: false,
    memoryModalMode: "edit",
    memoryModalSection: null,
    memoryModalTitle: "",
    memoryModalValue: "",
    memoryModalEditable: false,
    memoryModalTarget: null,
    memoryModalNamespace: null,
    memoryModalKey: null,
    memoryModalSourcePath: null,
    memoryModalConversationId: null,
    memoryModalDraftKey: "",
    memoryModalDraftCategory: "fact",
    memoryModalDraftDescription: "",
    memoryActiveTab: "context",
    memoryRouteMode: "auto",
    memoryTotalTokenEstimate: 0,
    memoryLoading: false,
    memoryError: null
  };
}

export function createInitialTasksState(): TasksRuntimeSlice {
  return {
    tasksById: loadPersistedTasksById(),
    tasksRunsByTaskId: {},
    tasksSelectedId: null,
    tasksFolder: "inbox",
    tasksSortKey: "createdAt",
    tasksSortDirection: "desc",
    tasksDetailsCollapsed: false,
    tasksJsonDraft: "",
    taskNotifications: []
  };
}

export function createInitialFlowState(options: {
  advancedOpen: boolean;
  bottomPanel: FlowToolStateSlice["flowBottomPanel"];
  workspaceSplit: number;
  activeTerminalPhase: string;
  phaseSessionByName: Record<string, string>;
  autoFocusPhaseTerminal: boolean;
}): FlowToolStateSlice {
  return {
    flowRuns: [],
    flowActiveRunId: null,
    flowMode: "plan",
    flowMaxIterations: 1,
    flowDryRun: true,
    flowAutoPush: false,
    flowPromptPlanPath: "PROMPT_plan.md",
    flowPromptBuildPath: "PROMPT_build.md",
    flowPlanPath: "IMPLEMENTATION_PLAN.md",
    flowSpecsGlob: "specs/*.md",
    flowImplementCommand: "",
    flowBackpressureCommands: "",
    flowEventFilter: "",
    flowFilteredEvents: [],
    flowValidationResults: [],
    flowMessage: null,
    flowBusy: false,
    flowAdvancedOpen: options.advancedOpen,
    flowBottomPanel: options.bottomPanel,
    flowWorkspaceSplit: options.workspaceSplit,
    flowActiveTerminalPhase: options.activeTerminalPhase,
    flowPhaseSessionByName: options.phaseSessionByName,
    flowAutoFocusPhaseTerminal: options.autoFocusPhaseTerminal,
    flowPhaseTranscriptsByRun: {},
    flowProjectSetupOpen: false,
    flowProjectSetupDismissed: false,
    flowProjectNameDraft: "",
    flowProjectTypeDraft: "app-tool",
    flowProjectIconDraft: "wrench",
    flowProjectDescriptionDraft: "",
    flowPhaseModels: {},
    flowAvailableModels: [],
    flowPaused: false,
    flowUseAgent: false,
    flowModelUnavailableOpen: false,
    flowModelUnavailablePhase: "",
    flowModelUnavailableModel: "",
    flowModelUnavailableFallbackModel: "",
    flowModelUnavailableReason: "",
    flowModelUnavailableAttempt: 0,
    flowModelUnavailableMaxAttempts: 0,
    flowModelUnavailableStatus: ""
  };
}

function selectMemoryContextItems(items: ChatContextBreakdownItem[]): MemoryToolViewState["memoryContextItems"] {
  return items.map((item) => ({
    key: item.key,
    value: item.value,
    category: item.category,
    loadMethod: item.loadMethod,
    loadReason: item.loadReason,
    tokenEstimate: item.tokenEstimate,
    charCount: item.charCount,
    wordCount: item.wordCount
  }));
}

export function selectMemoryToolState(state: MemoryToolStateSlice): MemoryToolViewState {
  return {
    memoryContextItems: selectMemoryContextItems(state.memoryContextItems),
    memoryChatHistory: state.memoryChatHistory.map((item) => ({
      conversationId: item.conversationId,
      title: item.title,
      messageCount: item.messageCount,
      lastMessagePreview: item.lastMessagePreview,
      updatedAtMs: item.updatedAtMs,
      fullBody: item.fullBody,
      charCount: item.charCount,
      wordCount: item.wordCount,
      tokenEstimate: item.tokenEstimate
    })),
    memoryPersistentItems: state.memoryPersistentItems.map((item) => ({
      key: item.key,
      value: item.value,
      type:
        item.category === "fact" || item.category === "personality" || item.category === "directive"
          ? item.category
          : "other",
      loadMethod: item.loadMethod,
      loadReason: item.loadReason,
      tokenEstimate: item.tokenEstimate,
      charCount: item.charCount,
      wordCount: item.wordCount
    })),
    memorySkillsItems: selectMemoryContextItems(state.memorySkillsItems),
    memoryToolsItems: selectMemoryContextItems(state.memoryToolsItems),
    memoryAlwaysLoadToolKeys: state.memoryAlwaysLoadToolKeys,
    memoryAlwaysLoadSkillKeys: state.memoryAlwaysLoadSkillKeys,
    memoryModalOpen: state.memoryModalOpen,
    memoryModalMode: state.memoryModalMode,
    memoryModalSection: state.memoryModalSection,
    memoryModalTitle: state.memoryModalTitle,
    memoryModalValue: state.memoryModalValue,
    memoryModalEditable: state.memoryModalEditable,
    memoryModalTarget: state.memoryModalTarget,
    memoryModalNamespace: state.memoryModalNamespace,
    memoryModalKey: state.memoryModalKey,
    memoryModalSourcePath: state.memoryModalSourcePath,
    memoryModalConversationId: state.memoryModalConversationId,
    memoryModalDraftKey: state.memoryModalDraftKey,
    memoryModalDraftCategory: state.memoryModalDraftCategory,
    memoryModalDraftDescription: state.memoryModalDraftDescription,
    memoryActiveTab: state.memoryActiveTab,
    memoryRouteMode: state.memoryRouteMode,
    memoryTotalTokenEstimate: state.memoryTotalTokenEstimate,
    memoryLoading: state.memoryLoading,
    memoryError: state.memoryError
  };
}

export function selectFilesToolState(
  state: FilesToolStateSlice
): FilesToolStateSlice & { filesUndoDeleteAvailable: boolean } {
  return {
    filesRootPath: state.filesRootPath,
    filesScopeRootPath: state.filesScopeRootPath,
    filesRootSelectorOpen: state.filesRootSelectorOpen,
    filesSelectedPath: state.filesSelectedPath,
    filesSelectedEntryPath: state.filesSelectedEntryPath,
    filesOpenTabs: state.filesOpenTabs,
    filesActiveTabPath: state.filesActiveTabPath,
    filesContentByPath: state.filesContentByPath,
    filesSavedContentByPath: state.filesSavedContentByPath,
    filesDirtyByPath: state.filesDirtyByPath,
    filesLoadingFileByPath: state.filesLoadingFileByPath,
    filesSavingFileByPath: state.filesSavingFileByPath,
    filesReadOnlyByPath: state.filesReadOnlyByPath,
    filesSizeByPath: state.filesSizeByPath,
    filesExpandedByPath: state.filesExpandedByPath,
    filesEntriesByPath: state.filesEntriesByPath,
    filesLoadingByPath: state.filesLoadingByPath,
    filesColumnWidths: state.filesColumnWidths,
    filesSidebarWidth: state.filesSidebarWidth,
    filesSidebarCollapsed: state.filesSidebarCollapsed,
    filesFindOpen: state.filesFindOpen,
    filesFindQuery: state.filesFindQuery,
    filesReplaceQuery: state.filesReplaceQuery,
    filesFindCaseSensitive: state.filesFindCaseSensitive,
    filesLineWrap: state.filesLineWrap,
    filesSelectedPaths: state.filesSelectedPaths,
    filesContextMenuOpen: state.filesContextMenuOpen,
    filesContextMenuX: state.filesContextMenuX,
    filesContextMenuY: state.filesContextMenuY,
    filesContextMenuTargetPath: state.filesContextMenuTargetPath,
    filesContextMenuTargetIsDir: state.filesContextMenuTargetIsDir,
    filesClipboardMode: state.filesClipboardMode,
    filesClipboardPaths: state.filesClipboardPaths,
    filesDeleteUndoStack: state.filesDeleteUndoStack,
    filesConflictModalOpen: state.filesConflictModalOpen,
    filesConflictName: state.filesConflictName,
    filesSelectionAnchorPath: state.filesSelectionAnchorPath,
    filesSelectionDragActive: state.filesSelectionDragActive,
    filesSelectionJustDragged: state.filesSelectionJustDragged,
    filesSelectionGesture: state.filesSelectionGesture,
    filesError: state.filesError,
    filesUndoDeleteAvailable: state.filesDeleteUndoStack.length > 0
  };
}

export function selectNotepadToolState(state: NotepadToolStateSlice): NotepadToolStateSlice {
  return {
    notepadOpenTabs: state.notepadOpenTabs,
    notepadActiveTabId: state.notepadActiveTabId,
    notepadPathByTabId: state.notepadPathByTabId,
    notepadTitleByTabId: state.notepadTitleByTabId,
    notepadContentByTabId: state.notepadContentByTabId,
    notepadSavedContentByTabId: state.notepadSavedContentByTabId,
    notepadDirtyByTabId: state.notepadDirtyByTabId,
    notepadLoadingByTabId: state.notepadLoadingByTabId,
    notepadSavingByTabId: state.notepadSavingByTabId,
    notepadReadOnlyByTabId: state.notepadReadOnlyByTabId,
    notepadSizeByTabId: state.notepadSizeByTabId,
    notepadNextUntitledIndex: state.notepadNextUntitledIndex,
    notepadFindOpen: state.notepadFindOpen,
    notepadFindQuery: state.notepadFindQuery,
    notepadReplaceQuery: state.notepadReplaceQuery,
    notepadFindCaseSensitive: state.notepadFindCaseSensitive,
    notepadLineWrap: state.notepadLineWrap,
    notepadError: state.notepadError,
    notepadUnsavedModalTabId: state.notepadUnsavedModalTabId
  };
}

export function selectDocsToolState(state: DocsToolState): DocsToolState {
  return {
    docsRootPath: state.docsRootPath,
    docsSelectedPath: state.docsSelectedPath,
    docsSelectedEntryPath: state.docsSelectedEntryPath,
    docsExpandedByPath: state.docsExpandedByPath,
    docsEntriesByPath: state.docsEntriesByPath,
    docsLoadingByPath: state.docsLoadingByPath,
    docsOpenTabs: state.docsOpenTabs,
    docsActiveTabPath: state.docsActiveTabPath,
    docsContentByPath: state.docsContentByPath,
    docsSavedContentByPath: state.docsSavedContentByPath,
    docsDirtyByPath: state.docsDirtyByPath,
    docsLoadingFileByPath: state.docsLoadingFileByPath,
    docsSavingFileByPath: state.docsSavingFileByPath,
    docsReadOnlyByPath: state.docsReadOnlyByPath,
    docsSizeByPath: state.docsSizeByPath,
    docsSidebarWidth: state.docsSidebarWidth,
    docsSidebarCollapsed: state.docsSidebarCollapsed,
    docsFindOpen: state.docsFindOpen,
    docsFindQuery: state.docsFindQuery,
    docsReplaceQuery: state.docsReplaceQuery,
    docsFindCaseSensitive: state.docsFindCaseSensitive,
    docsLineWrap: state.docsLineWrap,
    docsError: state.docsError
  };
}

export function selectTasksToolState(state: TasksRuntimeSlice): TasksRuntimeSlice {
  return {
    tasksById: state.tasksById,
    tasksRunsByTaskId: state.tasksRunsByTaskId,
    tasksSelectedId: state.tasksSelectedId,
    tasksFolder: state.tasksFolder,
    tasksSortKey: state.tasksSortKey,
    tasksSortDirection: state.tasksSortDirection,
    tasksDetailsCollapsed: state.tasksDetailsCollapsed,
    tasksJsonDraft: state.tasksJsonDraft,
    taskNotifications: state.taskNotifications
  };
}

export function selectFlowToolState(state: FlowToolStateSlice): FlowToolViewState {
  return {
    flowRuns: state.flowRuns,
    flowActiveRunId: state.flowActiveRunId,
    flowMode: state.flowMode,
    flowMaxIterations: state.flowMaxIterations,
    flowDryRun: state.flowDryRun,
    flowAutoPush: state.flowAutoPush,
    flowPromptPlanPath: state.flowPromptPlanPath,
    flowPromptBuildPath: state.flowPromptBuildPath,
    flowPlanPath: state.flowPlanPath,
    flowSpecsGlob: state.flowSpecsGlob,
    flowImplementCommand: state.flowImplementCommand,
    flowBackpressureCommands: state.flowBackpressureCommands,
    flowEventFilter: state.flowEventFilter,
    flowValidationResults: state.flowValidationResults,
    flowBusy: state.flowBusy,
    flowMessage: state.flowMessage,
    flowAdvancedOpen: state.flowAdvancedOpen,
    flowBottomPanel: state.flowBottomPanel,
    flowWorkspaceSplit: state.flowWorkspaceSplit,
    flowActiveTerminalPhase: state.flowActiveTerminalPhase,
    flowPhaseSessionByName: state.flowPhaseSessionByName,
    flowAutoFocusPhaseTerminal: state.flowAutoFocusPhaseTerminal,
    flowPhaseTranscriptsByRun: state.flowPhaseTranscriptsByRun,
    flowProjectSetupOpen: state.flowProjectSetupOpen,
    flowProjectNameDraft: state.flowProjectNameDraft,
    flowProjectTypeDraft: state.flowProjectTypeDraft,
    flowProjectIconDraft: state.flowProjectIconDraft,
    flowProjectDescriptionDraft: state.flowProjectDescriptionDraft,
    flowPhaseModels: state.flowPhaseModels,
    flowAvailableModels: state.flowAvailableModels,
    flowPaused: state.flowPaused,
    flowUseAgent: state.flowUseAgent,
    flowModelUnavailableOpen: state.flowModelUnavailableOpen,
    flowModelUnavailablePhase: state.flowModelUnavailablePhase,
    flowModelUnavailableModel: state.flowModelUnavailableModel,
    flowModelUnavailableFallbackModel: state.flowModelUnavailableFallbackModel,
    flowModelUnavailableReason: state.flowModelUnavailableReason,
    flowModelUnavailableAttempt: state.flowModelUnavailableAttempt,
    flowModelUnavailableMaxAttempts: state.flowModelUnavailableMaxAttempts,
    flowModelUnavailableStatus: state.flowModelUnavailableStatus
  };
}

export function defaultDevicesState(): DevicesState {
  return {
    microphonePermission: "not_enabled",
    speakerPermission: "not_enabled",
    defaultAudioInput: "Unknown",
    defaultAudioOutput: "Unknown",
    audioInputCount: 0,
    audioOutputCount: 0,
    webcamCount: 0,
    keyboardDetected: true,
    mouseDetected: false,
    lastUpdatedLabel: "Not checked"
  };
}

export function defaultApiConnectionDraft(): ApiConnectionDraft {
  return {
    apiType: "llm",
    apiUrl: "",
    name: "",
    apiKey: "",
    modelName: "",
    costPerMonthUsd: "",
    apiStandardPath: ""
  };
}
