import "./styles.css";
import "xterm/css/xterm.css";
import type {
  ApiConnectionProbeRequest,
  ApiConnectionRecord,
  AppResourceUsageResponse,
  AppEvent,
  ChatAttachment,
  ChatStreamChunkPayload,
  ChatStreamReasoningChunkPayload,
  ConversationSummaryRecord,
  FilesListDirectoryEntry,
  FlowRerunValidationResult,
  LlamaRuntimeStatusResponse,
  ModelManagerHfCandidate,
  ModelManagerInstalledModel,
  TtsSpeakResponse,
  WorkspaceToolRecord
} from "./contracts";
import { iconHtml } from "./icons";
import type { IconName } from "./icons";
import { APP_ICON } from "./icons/map";
import type { ChatIpcClient } from "./ipcClient";
import { createChatIpcClient } from "./ipcClient";
import {
  BOTTOMBAR_RESOURCE_IDS,
  isWorkspaceTab,
  renderGlobalBottombar,
  renderGlobalTopbar,
  renderSidebarRail,
  renderWorkspacePane
} from "./layout";
import { attachPrimaryPanelInteractions, getPanelDefinition } from "./panels";
import type {
  ApiConnectionDraft,
  ChatToolEventRow,
  DevicesState,
  SidebarTab,
  UiMessage
} from "./panels/types";
import type { DisplayMode, LayoutOrientation, WorkspaceTab } from "./layout";
import { escapeHtml } from "./panels/utils";
import { TerminalManager, renderTerminalToolbar, renderTerminalWorkspace } from "./tools/terminal/index";
import type { TerminalShellProfile } from "./tools/terminal/types";
import {
  CONSOLE_DATA_ATTR,
  MANAGER_DATA_ATTR,
  TERMINAL_UI_ID,
  WEB_UI_ID
} from "./tools/ui/constants";
import { renderWorkspaceToolsActions, renderWorkspaceToolsBody } from "./tools/manager/index";
import { renderToolToolbar } from "./tools/ui/toolbar";
import { DEFAULT_CHART_SOURCE } from "./tools/chart/bindings";
import { renderMermaidInto } from "./tools/chart/runtime";
import {
  filterFlowEvents,
  normalizeFlowRun as normalizeFlowRunView
} from "./tools/flow/runtime";
import type { FlowPhaseTranscriptEntry, FlowRunView } from "./tools/flow/state";
import { applyFlowRuntimeEvent } from "./tools/host/flowEvents";
import {
  dispatchWorkspaceToolChange,
  dispatchWorkspaceToolClick,
  dispatchWorkspaceToolContextMenu,
  dispatchWorkspaceToolDoubleClick,
  dispatchWorkspaceToolInput,
  dispatchWorkspaceToolKeyDown,
  dispatchWorkspaceToolMouseMove,
  dispatchWorkspaceToolPointerDown,
  dispatchWorkspaceToolSubmit,
  WORKSPACE_TOOL_TARGET_SELECTOR
} from "./tools/host/workspaceDispatch";
import {
  createFlowRunsRefreshScheduler,
  refreshFlowRunsFromToolInvoke
} from "./tools/host/flowRefresh";
import { handleWorkspaceToolTabActivation } from "./tools/host/workspaceLifecycle";
import { createWorkspaceToolsRuntime } from "./tools/host/workspaceRuntime";
import { buildWorkspaceToolViews } from "./tools/host/viewBuilder";
import {
  createWebTab,
  loadPersistedWebSearchHistory,
  persistWebSearchHistory
} from "./tools/webSearch/runtime";
import type { WebSearchHistoryItem, WebTabState } from "./tools/webSearch/state";
import { loadPersistedTasksById } from "./tools/tasks/actions";
import type { TaskFolder, TaskSortDirection, TaskSortKey, TaskRecord } from "./tools/tasks/state";
import {
  DEFAULT_CREATE_TOOL_SPEC,
  DEFAULT_CREATE_TOOL_UI_PREVIEW_HTML,
  type CreateToolModelOption,
  type CreateToolPrdSection
} from "./tools/createTool/state";
import { resetTtsStateForEngine, type TtsEngine } from "./tts/engineRules";
import { getAllToolManifests } from "./tools/registry";
import { renderChatMessages } from "./panels/chatPanel";
import { APP_BUILD_VERSION, normalizeVersionLabel } from "./version";
import {
  closeTerminalSessionAndPickNext,
  createTerminalSessionForProfile,
  ensureTerminalSessionForProfile
} from "./workspace/controller";
import {
  inferChatModelCapabilities,
  type ChatModelCapabilities
} from "./modelCapabilities";
import { destroyOverlayScrollbars, syncOverlayScrollbars } from "./scrollbars";
import {
  BOTTOM_BAR_PREF_KEYS,
  FLOW_TERMINAL_PHASES,
  loadMicBubbleDismissed,
  loadPersistedBottomItem,
  loadPersistedChatModelId,
  loadPersistedChatRoutePreference,
  loadPersistedCreateToolDraft,
  loadPersistedFlowActivePhase,
  loadPersistedFlowAdvancedOpen,
  loadPersistedFlowAutoFollow,
  loadPersistedFlowBottomPanel,
  loadPersistedFlowPhaseSessionMap,
  loadPersistedFlowSplit,
  loadPersistedLlamaMaxTokens,
  loadPersistedLlamaModelPath,
  loadPersistedShowAppResourcesCpu,
  loadPersistedShowAppResourcesMemory,
  loadPersistedShowAppResourcesNetwork,
  loadPersistedSttBackend,
  loadPersistedSttLanguage,
  loadPersistedSttModel,
  loadPersistedSttThreads,
  persistBottomItem,
  persistChatRoutePreference,
  persistChatModelId,
  persistCreateToolDraft,
  persistFlowPhaseSessionMap,
  persistFlowActivePhase,
  persistFlowWorkspacePrefs,
  persistLlamaMaxTokens,
  persistLlamaModelPath,
  persistMicBubbleDismissed,
  persistShowAppResourcesCpu,
  persistShowAppResourcesMemory,
  persistShowAppResourcesNetwork,
  persistSttBackend,
  persistSttLanguage,
  persistSttModel,
  persistSttThreads,
  resolveSystemDisplayMode,
  type ChatRoutePreference,
  type CreateToolLayoutModifier,
  type PersistedCreateToolDraft,
  type SttBackend
} from "./app/persistence";
import { createAppResourcePolling } from "./app/polling";
import { runCoreBootstrapSteps } from "./app/bootstrap";
import { defaultApiConnectionDraft, defaultDevicesState } from "./app/state";
import {
  buildBottomStatus,
  buildConversationMarkdown,
  composeAppBodyHtml,
  composeAppFrameHtml,
  composePrimaryPaneHtml,
  conversationMarkdownFilename,
  formatConsoleEntryLine,
  getVisibleConsoleEntries,
  modelNameFromPath,
  renderMicPermissionBubble,
  renderConsoleToolbar,
  renderPanelTitleIcon
} from "./app/render";
import {
  handleChatStreamEvent,
  handleCoreAppEvent,
  isNoisyChatStreamEvent,
  isNoisyRuntimeStatusEvent,
  isNoisyTerminalControlEvent,
  parseTerminalExit,
  parseTerminalOutput,
  payloadAsRecord
} from "./app/events";
import { createSendMessageHandler } from "./app/chatSend";
import { installTauriSttListeners, registerClientEventBridge } from "./app/bootstrapEvents";
import { createFlowPhaseTerminalEventHandler } from "./app/bootstrapFlowBridge";
import { syncBootstrapRuntime, type TauriWindowHandle } from "./app/bootstrapRuntime";
import { initializeSendMessageBinding } from "./app/sendMessageBootstrap";
import { createWorkspaceToolManagerActions } from "./app/workspaceToolManagerActions";
import {
  bindWorkspaceToolDelegatedEvents,
  bindConsoleInteractions,
  handleWorkspacePaneClickPrelude,
  handleManagerAndTerminalClick,
  mountWorkspaceTerminalHosts
} from "./app/workspaceInteractions";

const terminalManager = new TerminalManager();
const MAX_CONSOLE_ENTRIES = 600;
const CHAT_ID_ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let chatStreamDomUpdateScheduled = false;
let chatThinkingDelegationInstalled = false;
let customToolBridgeInstalled = false;
let tauriWindowHandle: TauriWindowHandle | null = null;
const FALLBACK_APP_VERSION = normalizeVersionLabel(APP_BUILD_VERSION);
let preferredChatModelId = loadPersistedChatModelId();
type ConsoleView = "all" | "errors-warnings" | "security-events";
type DisplayModePreference = DisplayMode | "system" | "terminal";
type ChatModelOption = {
  id: string;
  label: string;
  source: "api" | "local";
  modelName: string;
  detail: string;
};
type ApiConnectionPortableRecord = {
  id?: string;
  apiType: "llm" | "search" | "stt" | "tts" | "image" | "other";
  apiUrl: string;
  name?: string | null;
  apiKey: string;
  modelName?: string | null;
  costPerMonthUsd?: number | null;
  apiStandardPath?: string | null;
  createdMs?: number;
};
type ApiConnectionsPortableSnapshot = {
  version: number;
  exportedAtMs?: number;
  connections: ApiConnectionPortableRecord[];
};

function generateChatConversationId(): string {
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += CHAT_ID_ALPHANUM[Math.floor(Math.random() * CHAT_ID_ALPHANUM.length)] ?? "A";
  }
  return `C${suffix}`;
}
const persistedCreateToolDraft = loadPersistedCreateToolDraft();
const persistedCreateToolPrdMarkdownDoc = persistedCreateToolDraft?.createToolPrdMarkdownDoc ?? "";

const state: {
  conversationId: string;
  messages: UiMessage[];
  chatReasoningByCorrelation: Record<string, string>;
  chatThinkingPlacementByCorrelation: Record<string, "before" | "after">;
  chatThinkingExpandedByCorrelation: Record<string, boolean>;
  chatToolRowsByCorrelation: Record<string, ChatToolEventRow[]>;
  chatToolRowExpandedById: Record<string, boolean>;
  chatStreamCompleteByCorrelation: Record<string, boolean>;
  chatToolIntentByCorrelation: Record<string, boolean>;
  chatFirstAssistantChunkMsByCorrelation: Record<string, number>;
  chatFirstReasoningChunkMsByCorrelation: Record<string, number>;
  chatTtsLatencyMs: number | null;
  chatStreaming: boolean;
  chatDraft: string;
  chatAttachedFileName: string | null;
  chatAttachedFileContent: string | null;
  chatActiveModelId: string;
  chatActiveModelLabel: string;
  chatActiveModelCapabilities: ChatModelCapabilities;
  chatModelOptions: ChatModelOption[];
  chatTtsEnabled: boolean;
  chatTtsPlaying: boolean;
  activeChatCorrelationId: string | null;
  devices: DevicesState;
  apiConnections: ApiConnectionRecord[];
  apiFormOpen: boolean;
  apiDraft: ApiConnectionDraft;
  apiEditingId: string | null;
  apiMessage: string | null;
  apiProbeBusy: boolean;
  apiProbeStatus: "verified" | "warning" | "pending" | null;
  apiProbeMessage: string | null;
  apiDetectedModels: string[];
  micPermissionBubbleDismissed: boolean;
  events: AppEvent[];
  consoleEntries: Array<{
    timestampMs: number;
    level: "log" | "info" | "warn" | "error" | "debug";
    source: "browser" | "app";
    message: string;
  }>;
  consoleView: ConsoleView;
  runtimeMode: "tauri" | "mock" | "unknown";
  chatPanePercent: number;
  portraitWorkspacePercent: number;
  sidebarTab: SidebarTab;
  workspaceTab: WorkspaceTab;
  layoutOrientation: LayoutOrientation;
  activeTerminalSessionId: string | null;
  terminalShellProfile: TerminalShellProfile;
  conversations: ConversationSummaryRecord[];
  workspaceTools: WorkspaceToolRecord[];
  chartSource: string;
  chartRenderSource: string;
  chartError: string | null;
  webTabs: WebTabState[];
  activeWebTabId: string;
  nextWebTabIndex: number;
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
  filesSavedContentByPath: Record<string, string>;
  filesDirtyByPath: Record<string, boolean>;
  filesLoadingFileByPath: Record<string, boolean>;
  filesSavingFileByPath: Record<string, boolean>;
  filesReadOnlyByPath: Record<string, boolean>;
  filesSizeByPath: Record<string, number>;
  filesExpandedByPath: Record<string, boolean>;
  filesEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  filesLoadingByPath: Record<string, boolean>;
  filesColumnWidths: {
    name?: number;
    type?: number;
    size?: number;
    modified?: number;
  };
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
  filesDeleteUndoStack: Array<{ deletedAtMs: number; snapshots: Array<Record<string, unknown>> }>;
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
  createToolStage: "meta" | "prd" | "build" | "fix";
  createToolModelOptions: CreateToolModelOption[];
  createToolSelectedModelId: string;
  createToolPrdUiPreset: "left-sidebar" | "right-sidebar" | "both-sidebars" | "no-sidebar";
  createToolLayoutModifiers: CreateToolLayoutModifier[];
  createToolPrdUiNotes: string;
  createToolPrdInputs: string;
  createToolPrdProcess: string;
  createToolPrdConnections: string;
  createToolPrdDependencies: string;
  createToolPrdExpectedBehavior: string;
  createToolPrdOutputs: string;
  createToolDevPlan: string;
  createToolBuildViewMode: "code" | "preview";
  createToolUiPreviewHtml: string;
  createToolFixNotes: string;
  createToolIconBrowserOpen: boolean;
  createToolIconBrowserQuery: string;
  createToolIconBrowserAppliedQuery: string;
  createToolIconLibrary: Array<{ name: string; svg: string }>;
  createToolSpec: typeof DEFAULT_CREATE_TOOL_SPEC;
  createToolWorkspaceRoot: string;
  createToolPreviewFiles: Record<string, string>;
  createToolPreviewOrder: string[];
  createToolSelectedPreviewPath: string;
  createToolValidationErrors: string[];
  createToolValidationWarnings: string[];
  createToolStatusMessage: string | null;
  createToolLastResultJson: string;
  createToolPrdGeneratingSection:
    | "UI"
    | "INPUTS"
    | "PROCESS"
    | "CONNECTIONS"
    | "DEPENDENCIES"
    | "EXPECTED_BEHAVIOR"
    | "OUTPUTS"
    | null;
  createToolPrdGeneratingAll: boolean;
  createToolPrdReviewBusy: boolean;
  createToolPrdReviewFindings: Array<{
    severity: "critical" | "high" | "medium";
    section: "INPUTS" | "PROCESS" | "CONNECTIONS" | "DEPENDENCIES" | "EXPECTED_BEHAVIOR" | "OUTPUTS";
    title: string;
    detail: string;
    suggestion: string;
  }>;
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
  displayMode: DisplayMode;
  displayModePreference: DisplayModePreference;
  appVersion: string;
  chatThinkingEnabled: boolean;
  chatRoutePreference: ChatRoutePreference;
  showAppResourceCpu: boolean;
  showAppResourceMemory: boolean;
  showAppResourceNetwork: boolean;
  showBottomEngine: boolean;
  showBottomModel: boolean;
  showBottomContext: boolean;
  showBottomSpeed: boolean;
  showBottomTtsLatency: boolean;
  appResourceCpuPercent: number | null;
  appResourceMemoryBytes: number | null;
  appResourceNetworkRxBytesPerSec: number | null;
  appResourceNetworkTxBytesPerSec: number | null;
  llamaRuntime: LlamaRuntimeStatusResponse | null;
  llamaRuntimeSelectedEngineId: string;
  llamaRuntimeModelPath: string;
  llamaRuntimePort: number;
  llamaRuntimeCtxSize: number;
  llamaRuntimeGpuLayers: number;
  llamaRuntimeThreads: number | null;
  llamaRuntimeBatchSize: number | null;
  llamaRuntimeUbatchSize: number | null;
  llamaRuntimeTemperature: number;
  llamaRuntimeTopP: number;
  llamaRuntimeTopK: number;
  llamaRuntimeRepeatPenalty: number;
  llamaRuntimeFlashAttn: boolean;
  llamaRuntimeMmap: boolean;
  llamaRuntimeMlock: boolean;
  llamaRuntimeSeed: number | null;
  llamaRuntimeMaxTokens: number | null;
  llamaRuntimeBusy: boolean;
  llamaRuntimeLogs: string[];
  llamaRuntimeContextTokens: number | null;
  llamaRuntimeContextCapacity: number | null;
  llamaRuntimeTokensPerSecond: number | null;
  modelManagerInstalled: ModelManagerInstalledModel[];
  modelManagerQuery: string;
  modelManagerCollection: string;
  modelManagerSearchResults: ModelManagerHfCandidate[];
  modelManagerBusy: boolean;
  modelManagerMessage: string | null;
  modelManagerUnslothUdCatalog: Array<{
    repoId: string;
    modelName: string;
    parameterCount: string;
    udAssets: Array<{
      fileName: string;
      quant: string;
      sizeGb: string;
    }>;
    selectedAssetFileName: string;
  }>;
  modelManagerUnslothUdLoading: boolean;
  stt: {
    status: "idle" | "starting" | "running" | "error";
    message: string | null;
    backend: SttBackend;
    isListening: boolean;
    isSpeaking: boolean;
    lastTranscript: string | null;
    microphonePermission: "not_enabled" | "enabled" | "no_device";
    vadBaseThreshold: number;
    vadStartFrames: number;
    vadEndFrames: number;
    vadDynamicMultiplier: number;
    vadNoiseAdaptationAlpha: number;
    vadPreSpeechMs: number;
    vadMinUtteranceMs: number;
    vadMaxUtteranceS: number;
    vadForceFlushS: number;
    selectedModel: string;
    availableModels: string[];
    language: string;
    threads: number;
    showAdvancedSettings: boolean;
    modelDownloadProgress: number | null;
    modelDownloadError: string | null;
  };
  tts: {
    status: "idle" | "ready" | "busy" | "error";
    message: string | null;
    engineId: string;
    engine: "kokoro" | "piper" | "matcha" | "kitten" | "pocket";
    ready: boolean;
    runtimeArchivePresent: boolean;
    availableModelPaths: string[];
    modelPath: string;
    secondaryPath: string;
    voicesPath: string;
    tokensPath: string;
    dataDir: string;
    pythonPath: string;
    scriptPath: string;
    voices: string[];
    selectedVoice: string;
    speed: number;
    testText: string;
    lastDurationMs: number | null;
    lastBytes: number | null;
    lastSampleRate: number | null;
  };
} = {
  conversationId: generateChatConversationId(),
  messages: [],
  chatReasoningByCorrelation: {},
  chatThinkingPlacementByCorrelation: {},
  chatThinkingExpandedByCorrelation: {},
  chatToolRowsByCorrelation: {},
  chatToolRowExpandedById: {},
  chatStreamCompleteByCorrelation: {},
  chatToolIntentByCorrelation: {},
  chatFirstAssistantChunkMsByCorrelation: {},
  chatFirstReasoningChunkMsByCorrelation: {},
  chatTtsLatencyMs: null,
  chatStreaming: false,
  chatDraft: "",
  chatAttachedFileName: null,
  chatAttachedFileContent: null,
  chatActiveModelId: preferredChatModelId,
  chatActiveModelLabel: "local-model",
  chatActiveModelCapabilities: inferChatModelCapabilities("local-model"),
  chatModelOptions: [],
  chatTtsEnabled: false,
  chatTtsPlaying: false,
  activeChatCorrelationId: null,
  devices: defaultDevicesState(),
  apiConnections: [],
  apiFormOpen: false,
  apiDraft: defaultApiConnectionDraft(),
  apiEditingId: null,
  apiMessage: null,
  apiProbeBusy: false,
  apiProbeStatus: null,
  apiProbeMessage: null,
  apiDetectedModels: [],
  micPermissionBubbleDismissed: loadMicBubbleDismissed(),
  events: [],
  consoleEntries: [],
  consoleView: "all",
  runtimeMode: "unknown",
  chatPanePercent: 35,
  portraitWorkspacePercent: 46,
  sidebarTab: "chat",
  workspaceTab: "events",
  layoutOrientation: "landscape",
  activeTerminalSessionId: null,
  terminalShellProfile: "default",
  conversations: [],
  workspaceTools: [],
  chartSource: DEFAULT_CHART_SOURCE,
  chartRenderSource: DEFAULT_CHART_SOURCE,
  chartError: null,
  webTabs: [createWebTab(1)],
  activeWebTabId: "",
  nextWebTabIndex: 2,
  webHistoryOpen: false,
  webHistoryClearConfirmOpen: false,
  webHistory: loadPersistedWebSearchHistory(),
  webSetupModalOpen: false,
  webSetupAccount: "Serper",
  webSetupApiKey: "",
  webSetupMessage: null,
  webSetupBusy: false,
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
  filesError: null,
  tasksById: loadPersistedTasksById(),
  tasksSelectedId: null,
  tasksFolder: "inbox",
  tasksSortKey: "createdAt",
  tasksSortDirection: "desc",
  tasksDetailsCollapsed: false,
  tasksJsonDraft: "",
  createToolStage: persistedCreateToolDraft?.createToolStage ?? "meta",
  createToolModelOptions: [],
  createToolSelectedModelId: persistedCreateToolDraft?.createToolSelectedModelId ?? "primary-agent",
  createToolPrdUiPreset: persistedCreateToolDraft?.createToolPrdUiPreset ?? "left-sidebar",
  createToolLayoutModifiers: persistedCreateToolDraft?.createToolLayoutModifiers ?? [],
  createToolPrdUiNotes: persistedCreateToolDraft?.createToolPrdUiNotes ?? "",
  createToolPrdInputs: persistedCreateToolDraft?.createToolPrdInputs ?? "",
  createToolPrdProcess: persistedCreateToolDraft?.createToolPrdProcess ?? "",
  createToolPrdConnections: persistedCreateToolDraft?.createToolPrdConnections ?? "",
  createToolPrdDependencies: persistedCreateToolDraft?.createToolPrdDependencies ?? "",
  createToolPrdExpectedBehavior: persistedCreateToolDraft?.createToolPrdExpectedBehavior ?? "",
  createToolPrdOutputs: persistedCreateToolDraft?.createToolPrdOutputs ?? "",
  createToolDevPlan: persistedCreateToolDraft?.createToolDevPlan ?? "",
  createToolBuildViewMode: persistedCreateToolDraft?.createToolBuildViewMode ?? "code",
  createToolUiPreviewHtml: DEFAULT_CREATE_TOOL_UI_PREVIEW_HTML,
  createToolFixNotes: persistedCreateToolDraft?.createToolFixNotes ?? "",
  createToolIconBrowserOpen: false,
  createToolIconBrowserQuery: "",
  createToolIconBrowserAppliedQuery: "",
  createToolIconLibrary: [],
  createToolSpec: {
    ...(persistedCreateToolDraft?.createToolSpec || DEFAULT_CREATE_TOOL_SPEC)
  },
  createToolWorkspaceRoot: "",
  createToolPreviewFiles: persistedCreateToolPrdMarkdownDoc
    ? {
        "PRD.md": persistedCreateToolPrdMarkdownDoc
      }
    : {},
  createToolPreviewOrder: persistedCreateToolPrdMarkdownDoc ? ["PRD.md"] : [],
  createToolSelectedPreviewPath: persistedCreateToolPrdMarkdownDoc ? "PRD.md" : "",
  createToolValidationErrors: [],
  createToolValidationWarnings: [],
  createToolStatusMessage: null,
  createToolLastResultJson: "",
  createToolPrdGeneratingSection: null,
  createToolPrdGeneratingAll: false,
  createToolPrdReviewBusy: false,
  createToolPrdReviewFindings: [],
  createToolBusy: false,
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
  flowAdvancedOpen: loadPersistedFlowAdvancedOpen(),
  flowBottomPanel: loadPersistedFlowBottomPanel(),
  flowWorkspaceSplit: loadPersistedFlowSplit(),
  flowActiveTerminalPhase: loadPersistedFlowActivePhase(),
  flowPhaseSessionByName: loadPersistedFlowPhaseSessionMap(),
  flowAutoFocusPhaseTerminal: loadPersistedFlowAutoFollow(),
  flowPhaseTranscriptsByRun: {},
  flowProjectSetupOpen: false,
  flowProjectSetupDismissed: false,
  flowProjectNameDraft: "",
  flowProjectTypeDraft: "app-tool",
  flowProjectDescriptionDraft: "",
  flowPhaseModels: {},
  flowAvailableModels: [],
  flowPaused: false,
  flowModelUnavailableOpen: false,
  flowModelUnavailablePhase: "",
  flowModelUnavailableModel: "",
  flowModelUnavailableFallbackModel: "",
  flowModelUnavailableReason: "",
  flowModelUnavailableAttempt: 0,
  flowModelUnavailableMaxAttempts: 0,
  flowModelUnavailableStatus: "",
  displayMode: "dark",
  displayModePreference: "dark",
  appVersion: FALLBACK_APP_VERSION,
  chatThinkingEnabled: false,
  chatRoutePreference: loadPersistedChatRoutePreference(),
  showAppResourceCpu: loadPersistedShowAppResourcesCpu(),
  showAppResourceMemory: loadPersistedShowAppResourcesMemory(),
  showAppResourceNetwork: loadPersistedShowAppResourcesNetwork(),
  showBottomEngine: loadPersistedBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomEngine, true),
  showBottomModel: loadPersistedBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomModel, true),
  showBottomContext: loadPersistedBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomContext, true),
  showBottomSpeed: loadPersistedBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomSpeed, true),
  showBottomTtsLatency: loadPersistedBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomTtsLatency, true),
  appResourceCpuPercent: null,
  appResourceMemoryBytes: null,
  appResourceNetworkRxBytesPerSec: null,
  appResourceNetworkTxBytesPerSec: null,
  llamaRuntime: null,
  llamaRuntimeSelectedEngineId: "",
  llamaRuntimeModelPath: loadPersistedLlamaModelPath(),
  llamaRuntimePort: 1420,
  llamaRuntimeCtxSize: 8192,
  llamaRuntimeGpuLayers: 999,
  llamaRuntimeThreads: null,
  llamaRuntimeBatchSize: 512,
  llamaRuntimeUbatchSize: 512,
  llamaRuntimeTemperature: 0.7,
  llamaRuntimeTopP: 0.95,
  llamaRuntimeTopK: 40,
  llamaRuntimeRepeatPenalty: 1.1,
  llamaRuntimeFlashAttn: false,
  llamaRuntimeMmap: true,
  llamaRuntimeMlock: false,
  llamaRuntimeSeed: null,
  llamaRuntimeMaxTokens: loadPersistedLlamaMaxTokens(),
  llamaRuntimeBusy: false,
  llamaRuntimeLogs: [],
  llamaRuntimeContextTokens: null,
  llamaRuntimeContextCapacity: null,
  llamaRuntimeTokensPerSecond: null,
  modelManagerInstalled: [],
  modelManagerQuery: "",
  modelManagerCollection: "unsloth_ud",
  modelManagerSearchResults: [],
  modelManagerBusy: false,
  modelManagerMessage: null,
  modelManagerUnslothUdCatalog: [],
  modelManagerUnslothUdLoading: false,
  stt: {
    status: "idle",
    message: null,
    backend: loadPersistedSttBackend(),
    isListening: false,
    isSpeaking: false,
    lastTranscript: null,
    microphonePermission: "not_enabled",
    vadBaseThreshold: 0.0012,
    vadStartFrames: 2,
    vadEndFrames: 8,
    vadDynamicMultiplier: 2.4,
    vadNoiseAdaptationAlpha: 0.03,
    vadPreSpeechMs: 200,
    vadMinUtteranceMs: 200,
    vadMaxUtteranceS: 30,
    vadForceFlushS: 3,
    selectedModel: loadPersistedSttModel(),
    availableModels: [],
    language: loadPersistedSttLanguage(),
    threads: loadPersistedSttThreads(),
    showAdvancedSettings: false,
    modelDownloadProgress: null,
    modelDownloadError: null
  },
  tts: {
    status: "idle",
    message: null,
    engineId: "kokoro",
    engine: "kokoro",
    ready: false,
    runtimeArchivePresent: false,
    availableModelPaths: [],
    modelPath: "",
    secondaryPath: "",
    voicesPath: "",
    tokensPath: "",
    dataDir: "",
    pythonPath: "",
    scriptPath: "",
    voices: ["af_heart"],
    selectedVoice: "af_heart",
    speed: 1,
    testText: "Hello from Arxell Lite text to speech.",
    lastDurationMs: null,
    lastBytes: null,
    lastSampleRate: null
  }
};
state.activeWebTabId = state.webTabs[0]?.id ?? "";
type AppState = typeof state;
type VoicePipelineState = "idle" | "user_speaking" | "processing" | "agent_speaking" | "interrupted";
let voicePipelineState: VoicePipelineState = "idle";
let lastTranscriptDispatch = { text: "", atMs: 0 };
let voicePrefillWarmupTimerId: number | null = null;
let voicePrefillStableSinceMs = 0;
let voicePrefillLastPartial = "";
let voicePrefillWarmedPartial = "";

function setVoicePipelineState(next: VoicePipelineState): void {
  if (voicePipelineState === next) return;
  voicePipelineState = next;
  pushConsoleEntry("debug", "browser", `Voice pipeline state=${next}`);
}

let clientRef: ChatIpcClient | null = null;
let deferredWorkspaceSelectionRenderTimerId: number | null = null;
let consoleCaptureInstalled = false;
let warnedMissingBundleEngineId: string | null = null;
let flowSplitDragActive = false;
let ttsActiveAudio: HTMLAudioElement | null = null;
let ttsActiveAudioUrl: string | null = null;
let ttsActivePlaybackResolve: (() => void) | null = null;
let chatTtsStreamAudioContext: AudioContext | null = null;
let chatTtsStreamNextStartAtSec = 0;
let chatTtsStreamFinalizeTimerId: number | null = null;
const chatTtsRequestToChatCorrelation = new Map<string, string | null>();
const chatTtsStreamSeenByRequest = new Set<string>();
const chatTtsStreamDoneWaiters = new Map<string, Array<() => void>>();
type ChatTtsQueueItem = {
  text: string;
  correlationId: string | null;
};

let chatTtsQueue: ChatTtsQueueItem[] = [];
let chatTtsQueueWaiters: Array<() => void> = [];
let chatTtsQueueRunning = false;
let chatTtsStopRequested = false;
let chatTtsSpeakingSinceMs = 0;
let chatTtsActiveCorrelationId: string | null = null;
let chatTtsSawStreamDeltaByCorrelation = new Set<string>();
let chatTtsLatencyCapturedByCorrelation = new Set<string>();
let chatTtsWarmSignature = "";
let chatTtsPrewarmPromise: Promise<void> | null = null;
let chatTtsStreamBuffer = "";
let chatTtsPendingTicks = "";
let chatTtsInInlineCode = false;
let chatTtsInFencedCode = false;
let chatTtsFlushTimerId: number | null = null;
const CHAT_TTS_MIN_SENTENCE_CHARS = 24;
const CHAT_TTS_FIRST_CHUNK_TARGET = 110;
const CHAT_TTS_STEADY_CHUNK_TARGET = 260;
const CHAT_TTS_MIN_FLUSH_CHARS = 90;
const CHAT_TTS_FLUSH_INTERVAL_MS = 180;
const CHAT_TTS_MERGE_TARGET = 320;
const VOICE_BARGE_IN_GRACE_MS = 900;
const VOICE_BARGE_IN_MIN_RMS = 0.0035;
const VOICE_BARGE_IN_DYNAMIC_MULTIPLIER = 1.35;
const VOICE_PREFILL_STABLE_MS = 900;
const VOICE_PREFILL_MIN_CHARS = 14;

function applyAppResourceUsageSnapshot(snapshot: AppResourceUsageResponse): void {
  state.appResourceCpuPercent = typeof snapshot.cpuPercent === "number" ? snapshot.cpuPercent : null;
  state.appResourceMemoryBytes =
    typeof snapshot.memoryBytes === "number" ? snapshot.memoryBytes : null;
  state.appResourceNetworkRxBytesPerSec =
    typeof snapshot.networkRxBytesPerSec === "number" ? snapshot.networkRxBytesPerSec : null;
  state.appResourceNetworkTxBytesPerSec =
    typeof snapshot.networkTxBytesPerSec === "number" ? snapshot.networkTxBytesPerSec : null;
}

function isAnyAppResourceVisible(): boolean {
  return state.showAppResourceCpu || state.showAppResourceMemory || state.showAppResourceNetwork;
}

function nextCorrelationId(): string {
  return `corr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

let appResourceRenderSendMessageRef: ((text: string) => Promise<void>) | null = null;
function updateBottomBarResourceNodesInPlace(): void {
  const status = currentBottomStatus();
  const containerNode = document.querySelector<HTMLElement>(`#${BOTTOMBAR_RESOURCE_IDS.container}`);
  const cpuNode = document.querySelector<HTMLElement>(`#${BOTTOMBAR_RESOURCE_IDS.cpu}`);
  const memoryNode = document.querySelector<HTMLElement>(`#${BOTTOMBAR_RESOURCE_IDS.memory}`);
  const networkNode = document.querySelector<HTMLElement>(`#${BOTTOMBAR_RESOURCE_IDS.network}`);
  if (!containerNode || !cpuNode || !memoryNode || !networkNode) return;

  const setResourceNode = (node: HTMLElement, value: string | null | undefined): void => {
    const text = value?.trim() ?? "";
    node.hidden = !text;
    node.textContent = text;
  };

  setResourceNode(cpuNode, status.appResourceCpuText);
  setResourceNode(memoryNode, status.appResourceMemoryText);
  setResourceNode(networkNode, status.appResourceNetworkText);
  containerNode.hidden = cpuNode.hidden && memoryNode.hidden && networkNode.hidden;
}

function isEditableElementActive(active: HTMLElement | null): boolean {
  if (!active) return false;
  if (active.isContentEditable) return true;
  const tag = active.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const input = active as HTMLInputElement;
    const type = (input.type || "text").toLowerCase();
    const nonTextLike = new Set([
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit"
    ]);
    return !nonTextLike.has(type);
  }
  return Boolean(active.closest('[contenteditable="true"]'));
}

const appResourcePolling = createAppResourcePolling({
  getClient: () => clientRef,
  isRuntimeTauri: () => state.runtimeMode === "tauri",
  isAnyVisible: () => isAnyAppResourceVisible(),
  nextCorrelationId: () => nextCorrelationId(),
  applySnapshot: (snapshot) => {
    applyAppResourceUsageSnapshot(snapshot);
  },
  hasSnapshotChanged: (() => {
    let prevCpu: number | null = null;
    let prevMem: number | null = null;
    let prevRx: number | null = null;
    let prevTx: number | null = null;
    return () => {
      const changed =
        prevCpu !== state.appResourceCpuPercent ||
        prevMem !== state.appResourceMemoryBytes ||
        prevRx !== state.appResourceNetworkRxBytesPerSec ||
        prevTx !== state.appResourceNetworkTxBytesPerSec;
      prevCpu = state.appResourceCpuPercent;
      prevMem = state.appResourceMemoryBytes;
      prevRx = state.appResourceNetworkRxBytesPerSec;
      prevTx = state.appResourceNetworkTxBytesPerSec;
      return changed;
    };
  })(),
  shouldSkipRender: () => {
    const active = document.activeElement as HTMLElement | null;
    return isEditableElementActive(active);
  },
  onRenderNeeded: () => {
    updateBottomBarResourceNodesInPlace();
  }
});

function formatTtsError(error: unknown): string {
  const raw = String(error ?? "Unknown TTS error");
  const text = raw.toLowerCase();
  if (text.includes("missing required metadata key 'sample_rate'")) {
    return "Selected ONNX is not sherpa-compatible (missing sample_rate metadata). Use a sherpa Kokoro model bundle.";
  }
  if (text.includes("incompatible kokoro bundle")) {
    return "Model/voices bundle mismatch. Use model, voices.bin, tokens.txt, and espeak-ng-data from the same release.";
  }
  if (text.includes("missing tokens.txt") || text.includes("missing espeak-ng-data")) {
    return "Model bundle incomplete: tokens.txt and espeak-ng-data are required.";
  }
  if (text.includes("selected model file does not exist") || text.includes("missing model file")) {
    return "Selected model file is missing or invalid. Re-select a valid ONNX model file.";
  }
  return raw;
}

function releaseTtsAudioUrl(): void {
  if (!ttsActiveAudioUrl) return;
  URL.revokeObjectURL(ttsActiveAudioUrl);
  ttsActiveAudioUrl = null;
}

function clearChatTtsFlushTimer(): void {
  if (chatTtsFlushTimerId === null) return;
  window.clearTimeout(chatTtsFlushTimerId);
  chatTtsFlushTimerId = null;
}

function clearVoicePrefillWarmupTimer(): void {
  if (voicePrefillWarmupTimerId === null) return;
  window.clearTimeout(voicePrefillWarmupTimerId);
  voicePrefillWarmupTimerId = null;
}

function maybeTriggerVoicePrefillWarmup(partialRaw: string): void {
  const partial = partialRaw.trim();
  if (!partial || partial.length < VOICE_PREFILL_MIN_CHARS) return;
  if (state.chatStreaming || !state.chatTtsEnabled || voicePipelineState !== "user_speaking") return;

  const now = Date.now();
  if (partial !== voicePrefillLastPartial) {
    voicePrefillLastPartial = partial;
    voicePrefillStableSinceMs = now;
    clearVoicePrefillWarmupTimer();
  }

  const elapsed = now - voicePrefillStableSinceMs;
  const remaining = Math.max(0, VOICE_PREFILL_STABLE_MS - elapsed);
  clearVoicePrefillWarmupTimer();
  voicePrefillWarmupTimerId = window.setTimeout(() => {
    if (
      state.chatStreaming ||
      !state.chatTtsEnabled ||
      voicePipelineState !== "user_speaking" ||
      partial !== voicePrefillLastPartial ||
      Date.now() - voicePrefillStableSinceMs < VOICE_PREFILL_STABLE_MS
    ) {
      return;
    }
    if (voicePrefillWarmedPartial === partial) return;
    voicePrefillWarmedPartial = partial;
    pushConsoleEntry("debug", "browser", `Voice prefill warmup: stable partial (${partial.length} chars)`);
    void prewarmChatTtsIfNeeded();
  }, remaining);
}

function notifyChatTtsQueueAvailable(): void {
  if (!chatTtsQueueWaiters.length) return;
  const waiters = chatTtsQueueWaiters.slice();
  chatTtsQueueWaiters = [];
  for (const waiter of waiters) {
    waiter();
  }
}

function stopTtsPlaybackLocal(): void {
  if (ttsActiveAudio) {
    try {
      ttsActiveAudio.pause();
    } catch {
      // Ignore pause failures.
    }
    ttsActiveAudio.src = "";
    ttsActiveAudio = null;
  }
  if (ttsActivePlaybackResolve) {
    const resolve = ttsActivePlaybackResolve;
    ttsActivePlaybackResolve = null;
    resolve();
  }
  releaseTtsAudioUrl();
  if (chatTtsStreamFinalizeTimerId !== null) {
    window.clearTimeout(chatTtsStreamFinalizeTimerId);
    chatTtsStreamFinalizeTimerId = null;
  }
  if (chatTtsStreamAudioContext) {
    void chatTtsStreamAudioContext.close();
    chatTtsStreamAudioContext = null;
  }
  chatTtsStreamNextStartAtSec = 0;
  for (const [, waiters] of chatTtsStreamDoneWaiters) {
    for (const resolve of waiters) resolve();
  }
  chatTtsStreamDoneWaiters.clear();
  chatTtsStreamSeenByRequest.clear();
  chatTtsRequestToChatCorrelation.clear();
  state.chatTtsPlaying = false;
  chatTtsSpeakingSinceMs = 0;
  if (voicePipelineState === "agent_speaking") {
    setVoicePipelineState("idle");
  }
}

let sttBargeInInFlight = false;

function requestVoiceBargeInInterrupt(): void {
  if (sttBargeInInFlight) return;
  sttBargeInInFlight = true;
  const targetCorrelationId = state.activeChatCorrelationId;
  chatTtsStopRequested = true;
  resetChatTtsQueue();
  stopTtsPlaybackLocal();
  state.chatStreaming = false;
  state.activeChatCorrelationId = null;
  setVoicePipelineState("interrupted");
  void (async () => {
    try {
      if (clientRef) {
        try {
          await clientRef.ttsStop({ correlationId: nextCorrelationId() });
        } catch (error) {
          pushConsoleEntry("warn", "browser", `Barge-in TTS stop failed: ${String(error)}`);
        }
        if (targetCorrelationId) {
          await clientRef.cancelMessage({
            correlationId: nextCorrelationId(),
            targetCorrelationId
          });
        }
      }
      pushConsoleEntry("info", "browser", "Voice barge-in: interrupted agent speech.");
    } catch (error) {
      pushConsoleEntry("warn", "browser", `Voice barge-in cancel failed: ${String(error)}`);
    } finally {
      sttBargeInInFlight = false;
    }
  })();
}

function resolveChatTtsStreamWaiters(requestCorrelationId: string): void {
  const waiters = chatTtsStreamDoneWaiters.get(requestCorrelationId);
  if (!waiters?.length) return;
  chatTtsStreamDoneWaiters.delete(requestCorrelationId);
  for (const resolve of waiters) resolve();
}

function waitForChatTtsStreamDone(requestCorrelationId: string, timeoutMs = 12000): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      const waiters = chatTtsStreamDoneWaiters.get(requestCorrelationId) ?? [];
      chatTtsStreamDoneWaiters.set(
        requestCorrelationId,
        waiters.filter((fn) => fn !== onDone)
      );
      resolve();
    }, timeoutMs);
    const onDone = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const waiters = chatTtsStreamDoneWaiters.get(requestCorrelationId) ?? [];
    waiters.push(onDone);
    chatTtsStreamDoneWaiters.set(requestCorrelationId, waiters);
  });
}

function onChatTtsStreamChunkEvent(event: AppEvent): void {
  if (chatTtsStopRequested) {
    resolveChatTtsStreamWaiters(event.correlationId);
    return;
  }
  if (!state.chatTtsEnabled || event.action !== "tts.stream.chunk") return;
  // Chat voice mode currently uses full WAV playback from ttsSpeak responses.
  // Ignore incremental stream chunks to avoid renderer-side chunk timing dropouts.
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : null;
  if (payload?.final === true) {
    resolveChatTtsStreamWaiters(event.correlationId);
  }
}

function decodeTtsAudioBytes(audioBytes: unknown): Uint8Array {
  if (audioBytes instanceof Uint8Array) return audioBytes;
  if (Array.isArray(audioBytes)) return Uint8Array.from(audioBytes.map((v) => Number(v) || 0));
  if (audioBytes && typeof audioBytes === "object" && "data" in (audioBytes as Record<string, unknown>)) {
    const nested = (audioBytes as { data?: unknown }).data;
    if (Array.isArray(nested)) return Uint8Array.from(nested.map((v) => Number(v) || 0));
  }
  return new Uint8Array();
}

function postprocessSpeakableText(raw: string): string {
  if (!raw) return "";
  const withLinkLabels = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const withoutUrls = withLinkLabels.replace(/\bhttps?:\/\/\S+/gi, " ");
  const withoutToolMarkers = withoutUrls.replace(/\[(tool|command|stdout|stderr|result)[^\]]*\]/gi, " ");
  const withoutEmojiShortcodes = withoutToolMarkers.replace(/:[a-z0-9_+\-]+:/gi, " ");
  const withoutEmojiGlyphs = withoutEmojiShortcodes
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/gu, " ");
  return withoutEmojiGlyphs.replace(/\s+/g, " ").trim();
}

function resetChatTtsStreamParser(correlationId: string | null): void {
  clearChatTtsFlushTimer();
  chatTtsActiveCorrelationId = correlationId;
  chatTtsStreamBuffer = "";
  chatTtsPendingTicks = "";
  chatTtsInInlineCode = false;
  chatTtsInFencedCode = false;
}

function resetChatTtsQueue(): void {
  clearChatTtsFlushTimer();
  chatTtsQueue = [];
  notifyChatTtsQueueAvailable();
  resetChatTtsStreamParser(null);
}

function extractSpeakableStreamDelta(delta: string): string {
  if (!delta) return "";
  let input = `${chatTtsPendingTicks}${delta}`;
  chatTtsPendingTicks = "";
  let output = "";
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char !== "`") {
      if (!chatTtsInInlineCode && !chatTtsInFencedCode) {
        output += char;
      }
      index += 1;
      continue;
    }
    let run = 1;
    while (index + run < input.length && input[index + run] === "`") {
      run += 1;
    }
    const atEnd = index + run >= input.length;
    if (atEnd && !chatTtsInInlineCode && !chatTtsInFencedCode && run < 3) {
      chatTtsPendingTicks = "`".repeat(run);
      break;
    }
    if (chatTtsInFencedCode) {
      if (run >= 3) {
        chatTtsInFencedCode = false;
      }
      index += run;
      continue;
    }
    if (chatTtsInInlineCode) {
      chatTtsInInlineCode = false;
      index += run;
      continue;
    }
    if (run >= 3) {
      chatTtsInFencedCode = true;
      index += run;
      continue;
    }
    chatTtsInInlineCode = true;
    index += run;
  }
  return output;
}

function nextSpeakableBoundary(text: string, finalFlush = false): number {
  const trimmedLength = text.trim().length;
  if (!trimmedLength) return -1;
  let boundary = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
      boundary = i;
    }
  }
  if (boundary >= 0 && boundary + 1 >= CHAT_TTS_MIN_SENTENCE_CHARS) {
    return boundary + 1;
  }
  const backlogActive = chatTtsQueueRunning || chatTtsQueue.length > 0 || state.chatTtsPlaying;
  const eagerTarget = backlogActive ? CHAT_TTS_STEADY_CHUNK_TARGET : CHAT_TTS_FIRST_CHUNK_TARGET;
  if (!backlogActive && text.length >= 80) {
    const softSplit = findSafeWordBoundary(text, Math.min(text.length, 120), 55);
    if (softSplit >= 55) return softSplit;
  }
  if (text.length >= eagerTarget) {
    const split = findSafeWordBoundary(text, eagerTarget - 4, 55);
    if (split >= 55) return split;
    if (finalFlush) return text.length;
    return -1;
  }
  if (finalFlush) {
    return text.length;
  }
  return -1;
}

function findSafeWordBoundary(text: string, target: number, minIndex = 0): number {
  const clampedTarget = Math.max(minIndex, Math.min(target, text.length));
  if (!text.length) return -1;
  const isBoundary = (ch: string): boolean =>
    ch === " " || ch === "\n" || ch === "\t" || ch === "." || ch === "!" || ch === "?" || ch === "," || ch === ";" || ch === ":";

  for (let i = clampedTarget; i >= minIndex; i -= 1) {
    const ch = text[i - 1] ?? "";
    if (isBoundary(ch)) return i;
  }
  for (let i = clampedTarget; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (isBoundary(ch)) return i + 1;
  }
  return -1;
}

function tryLowLatencyBufferFlush(): boolean {
  if (!chatTtsStreamBuffer.trim()) return false;
  const speakableCandidate = postprocessSpeakableText(chatTtsStreamBuffer);
  if (speakableCandidate.length < CHAT_TTS_MIN_FLUSH_CHARS) return false;
  const backlogActive = chatTtsQueueRunning || chatTtsQueue.length > 0 || state.chatTtsPlaying;
  const target = backlogActive ? CHAT_TTS_STEADY_CHUNK_TARGET : CHAT_TTS_FIRST_CHUNK_TARGET;
  const boundary = findSafeWordBoundary(
    chatTtsStreamBuffer,
    Math.min(chatTtsStreamBuffer.length, target),
    55
  );
  if (boundary < 55) return false;
  const part = chatTtsStreamBuffer.slice(0, boundary);
  chatTtsStreamBuffer = chatTtsStreamBuffer.slice(boundary);
  const speakable = postprocessSpeakableText(part);
  if (!speakable) return false;
  chatTtsQueue.push({ text: speakable, correlationId: chatTtsActiveCorrelationId });
  notifyChatTtsQueueAvailable();
  return true;
}

function scheduleLowLatencyBufferFlush(sendMessage: (text: string) => Promise<void>): void {
  if (chatTtsFlushTimerId !== null || !state.chatTtsEnabled) return;
  if (!chatTtsStreamBuffer.trim()) return;
  chatTtsFlushTimerId = window.setTimeout(() => {
    chatTtsFlushTimerId = null;
    if (!state.chatTtsEnabled) return;
    const flushed = tryLowLatencyBufferFlush();
    if (flushed) {
      void runChatTtsQueue(sendMessage);
    }
    if (chatTtsStreamBuffer.trim()) {
      scheduleLowLatencyBufferFlush(sendMessage);
    }
  }, CHAT_TTS_FLUSH_INTERVAL_MS);
}

function enqueueSpeakableChunk(
  rawChunk: string,
  finalFlush = false,
  correlationId: string | null = chatTtsActiveCorrelationId
): void {
  if (!rawChunk) {
    if (!finalFlush) return;
  }
  chatTtsStreamBuffer += rawChunk;
  while (chatTtsStreamBuffer.length > 0) {
    const boundary = nextSpeakableBoundary(chatTtsStreamBuffer, finalFlush);
    if (boundary < 0) break;
    const part = chatTtsStreamBuffer.slice(0, boundary);
    chatTtsStreamBuffer = chatTtsStreamBuffer.slice(boundary);
    const speakable = postprocessSpeakableText(part);
    if (speakable) {
      chatTtsQueue.push({ text: speakable, correlationId });
      notifyChatTtsQueueAvailable();
    }
    if (!finalFlush) continue;
    if (!chatTtsStreamBuffer.trim()) {
      chatTtsStreamBuffer = "";
      break;
    }
  }
}

async function playTtsAudio(audioBytes: unknown, correlationId: string | null): Promise<void> {
  const bytes = decodeTtsAudioBytes(audioBytes);
  if (!bytes.length) {
    throw new Error("No audio bytes returned from TTS.");
  }
  stopTtsPlaybackLocal();
  const blobBytes = new Uint8Array(bytes);
  const blob = new Blob([blobBytes], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  ttsActiveAudioUrl = url;
  const audio = new Audio(url);
  ttsActiveAudio = audio;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      if (ttsActiveAudio === audio) {
        ttsActiveAudio = null;
      }
      ttsActivePlaybackResolve = null;
      releaseTtsAudioUrl();
    };
    ttsActivePlaybackResolve = () => {
      cleanup();
      resolve();
    };
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Failed to play generated TTS audio."));
    };
    void audio
      .play()
      .then(() => {
        if (correlationId) {
          const firstTokenMs = state.chatFirstAssistantChunkMsByCorrelation[correlationId];
          if (firstTokenMs && !chatTtsLatencyCapturedByCorrelation.has(correlationId)) {
            state.chatTtsLatencyMs = Math.max(0, Date.now() - firstTokenMs);
            chatTtsLatencyCapturedByCorrelation.add(correlationId);
          }
        }
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}

function shiftChatTtsQueueText(): ChatTtsQueueItem | null {
  const next = chatTtsQueue.shift();
  if (!next || typeof next.text !== "string" || next.text.length === 0) return null;
  let merged = next.text.trim();
  const correlationId = next.correlationId;
  while (chatTtsQueue.length > 0 && merged.length < CHAT_TTS_MERGE_TARGET) {
    const peek = chatTtsQueue[0];
    if (!peek || typeof peek.text !== "string" || peek.text.trim().length === 0) {
      chatTtsQueue.shift();
      continue;
    }
    if (peek.correlationId !== correlationId) break;
    if (/[.!?]\s*$/.test(merged) && merged.length >= CHAT_TTS_FIRST_CHUNK_TARGET) {
      break;
    }
    const tail = chatTtsQueue.shift();
    if (!tail) break;
    merged = `${merged} ${tail.text}`.replace(/\s+/g, " ").trim();
  }
  return merged ? { text: merged, correlationId } : null;
}

async function waitForChatTtsQueueText(timeoutMs: number): Promise<ChatTtsQueueItem | null> {
  const immediate = shiftChatTtsQueueText();
  if (immediate) return immediate;
  await new Promise<void>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      chatTtsQueueWaiters = chatTtsQueueWaiters.filter((waiter) => waiter !== onReady);
      resolve();
    }, timeoutMs);
    const onReady = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    chatTtsQueueWaiters.push(onReady);
  });
  return shiftChatTtsQueueText();
}

type ChatTtsSynthResult = {
  requestCorrelationId: string;
  chatCorrelationId: string | null;
  response: TtsSpeakResponse;
};

async function synthesizeChatTtsChunk(
  text: string,
  chatCorrelationId: string | null
): Promise<ChatTtsSynthResult> {
  if (!clientRef) {
    throw new Error("TTS backend unavailable.");
  }
  const requestCorrelationId = nextCorrelationId();
  chatTtsRequestToChatCorrelation.set(requestCorrelationId, chatCorrelationId);
  const startedAt = performance.now();
  const response = await clientRef.ttsSpeak({
    correlationId: requestCorrelationId,
    text,
    voice: state.tts.selectedVoice,
    speed: state.tts.speed
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  pushConsoleEntry(
    "debug",
    "browser",
    `Chat TTS synth ${elapsedMs}ms for ${text.length} chars -> ${response.durationMs}ms audio`
  );
  state.tts.status = "ready";
  state.tts.message = `Reading with ${response.voice}`;
  state.tts.selectedVoice = response.voice;
  state.tts.speed = response.speed;
  state.tts.lastBytes = response.audioBytes.length;
  state.tts.lastDurationMs = response.durationMs;
  state.tts.lastSampleRate = response.sampleRate;
  return {
    requestCorrelationId,
    chatCorrelationId,
    response
  };
}

function currentChatTtsSignature(): string {
  return [
    state.tts.engine,
    state.tts.modelPath,
    state.tts.selectedVoice,
    state.tts.speed.toFixed(2)
  ].join("|");
}

async function prewarmChatTtsIfNeeded(): Promise<void> {
  if (!clientRef || !state.tts.ready || !state.chatTtsEnabled) return;
  const signature = currentChatTtsSignature();
  if (signature === chatTtsWarmSignature) return;
  if (chatTtsPrewarmPromise) {
    await chatTtsPrewarmPromise;
    return;
  }
  const startedAt = performance.now();
  chatTtsPrewarmPromise = (async () => {
    try {
      await clientRef.ttsSpeak({
        correlationId: nextCorrelationId(),
        text: "Hi there, what would you like to work on?",
        voice: state.tts.selectedVoice,
        speed: state.tts.speed
      });
      chatTtsWarmSignature = signature;
      pushConsoleEntry(
        "debug",
        "browser",
        `Chat TTS prewarm ${Math.round(performance.now() - startedAt)}ms`
      );
    } catch (error) {
      pushConsoleEntry("warn", "browser", `Chat TTS prewarm failed: ${String(error)}`);
    } finally {
      chatTtsPrewarmPromise = null;
    }
  })();
  await chatTtsPrewarmPromise;
}

async function runChatTtsQueue(sendMessage: (text: string) => Promise<void>): Promise<void> {
  if (chatTtsQueueRunning || !clientRef || !state.chatTtsEnabled || chatTtsStopRequested) return;
  chatTtsQueueRunning = true;
  try {
    let nextItem = await waitForChatTtsQueueText(80);
    if (!nextItem) {
      return;
    }
    let currentItem = nextItem;
    let currentSynth = await synthesizeChatTtsChunk(currentItem.text, currentItem.correlationId);
    state.chatTtsPlaying = true;
    if (!chatTtsSpeakingSinceMs) {
      chatTtsSpeakingSinceMs = Date.now();
    }
    setVoicePipelineState("agent_speaking");
    state.tts.status = "busy";
    state.tts.message = "Auto-speaking response...";
    renderAndBind(sendMessage);
    while (state.chatTtsEnabled) {
      const playbackPromise = playTtsAudio(
        currentSynth.response.audioBytes,
        currentItem.correlationId
      );
      let prefetchedResponsePromise: Promise<ChatTtsSynthResult> | null = null;
      const queuedItem = shiftChatTtsQueueText();
      if (queuedItem) {
        currentItem = queuedItem;
        prefetchedResponsePromise = synthesizeChatTtsChunk(
          queuedItem.text,
          queuedItem.correlationId
        );
      }

      await playbackPromise;
      if (!state.chatTtsEnabled) break;

      if (prefetchedResponsePromise) {
        currentSynth = await prefetchedResponsePromise;
        continue;
      }

      nextItem = await waitForChatTtsQueueText(60);
      if (!nextItem) {
        break;
      }
      currentItem = nextItem;
      currentSynth = await synthesizeChatTtsChunk(currentItem.text, currentItem.correlationId);
    }
  } catch (error) {
    state.tts.status = "error";
    state.tts.message = `Chat TTS failed: ${String(error)}`;
  } finally {
    chatTtsQueueRunning = false;
    state.chatTtsPlaying = false;
    chatTtsSpeakingSinceMs = 0;
    if (voicePipelineState === "agent_speaking") {
      setVoicePipelineState("idle");
    }
    renderAndBind(sendMessage);
  }
}

function ingestChatStreamForTts(
  sendMessage: (text: string) => Promise<void>,
  correlationId: string,
  delta: string
): void {
  if (chatTtsStopRequested) return;
  if (!state.chatTtsEnabled) return;
  if (!chatTtsActiveCorrelationId) {
    resetChatTtsStreamParser(correlationId);
  }
  if (chatTtsActiveCorrelationId !== correlationId) {
    return;
  }
  chatTtsSawStreamDeltaByCorrelation.add(correlationId);
  const speakableDelta = extractSpeakableStreamDelta(delta);
  enqueueSpeakableChunk(speakableDelta, false, correlationId);
  // Eagerly flush first chunk to reduce time-to-first-audio.
  if (!state.chatTtsPlaying) {
    const flushed = tryLowLatencyBufferFlush();
    if (flushed) {
      void runChatTtsQueue(sendMessage);
      return;
    }
  }
  scheduleLowLatencyBufferFlush(sendMessage);
  void runChatTtsQueue(sendMessage);
}

function flushChatStreamForTts(
  sendMessage: (text: string) => Promise<void>,
  correlationId: string
): void {
  if (chatTtsStopRequested) return;
  if (!state.chatTtsEnabled || chatTtsActiveCorrelationId !== correlationId) return;
  clearChatTtsFlushTimer();
  chatTtsPendingTicks = "";
  enqueueSpeakableChunk("", true, correlationId);
  resetChatTtsStreamParser(null);
  void runChatTtsQueue(sendMessage);
}

function formatLastUpdated(ts: number): string {
  return `Updated ${new Date(ts).toLocaleTimeString()}`;
}

function nextDisplayMode(mode: DisplayMode): DisplayMode {
  if (mode === "terminal") return "dark";
  if (mode === "dark") return "light";
  return "terminal";
}

async function detectMicrophonePermission(): Promise<DevicesState["microphonePermission"]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "no_device";
  }
  const state = await queryPermissionState("microphone");
  return state === "granted" ? "enabled" : "not_enabled";
}

async function detectSpeakerPermission(): Promise<DevicesState["speakerPermission"]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return "not_enabled";
  }
  const state = await queryPermissionState("speaker-selection");
  return state === "granted" ? "enabled" : "not_enabled";
}

async function queryPermissionState(
  name: PermissionName | "speaker-selection"
): Promise<PermissionState | null> {
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return status.state;
    }
  } catch {
    // Permission API may be unavailable or unsupported for this name.
  }
  return null;
}

function defaultAudioDeviceLabel(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceInfo["kind"],
  fallback: string
): string {
  const kindDevices = devices.filter((device) => device.kind === kind);
  if (!kindDevices.length) return fallback;
  const explicitDefault = kindDevices.find((device) => device.deviceId === "default");
  const chosen = explicitDefault ?? kindDevices[0];
  return chosen?.label?.trim() || `${fallback} (name hidden until permission granted)`;
}

async function refreshDevicesState(): Promise<void> {
  const next = defaultDevicesState();
  next.microphonePermission = await detectMicrophonePermission();
  next.speakerPermission = await detectSpeakerPermission();
  next.lastUpdatedLabel = formatLastUpdated(Date.now());
  next.mouseDetected =
    typeof window !== "undefined" && window.matchMedia("(pointer:fine)").matches;
  next.keyboardDetected = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    state.devices = next;
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === "audioinput");
    const audioOutputs = devices.filter((device) => device.kind === "audiooutput");
    const videoInputs = devices.filter((device) => device.kind === "videoinput");

    next.audioInputCount = audioInputs.length;
    next.audioOutputCount = audioOutputs.length;
    next.webcamCount = videoInputs.length;
    next.defaultAudioInput = defaultAudioDeviceLabel(
      devices,
      "audioinput",
      audioInputs.length ? "Default microphone" : "No microphone detected"
    );
    next.defaultAudioOutput = defaultAudioDeviceLabel(
      devices,
      "audiooutput",
      audioOutputs.length ? "Default speaker" : "System default output"
    );

    if (audioInputs.length === 0) {
      next.microphonePermission = "no_device";
    } else {
      if (state.runtimeMode === "tauri" && clientRef) {
        try {
          const probe = await clientRef.probeMicrophoneDevice({
            correlationId: nextCorrelationId(),
            attemptOpen: false
          });
          if (probe.status === "no_device") {
            next.microphonePermission = "no_device";
          } else if (
            probe.status === "enabled" ||
            state.devices.microphonePermission === "enabled"
          ) {
            // Keep enabled state stable after a successful explicit enable action.
            next.microphonePermission = "enabled";
          } else {
            next.microphonePermission = "not_enabled";
          }
          if (probe.defaultInputName?.trim()) {
            next.defaultAudioInput = probe.defaultInputName.trim();
          }
          next.audioInputCount = Math.max(next.audioInputCount, probe.inputDeviceCount);
        } catch (error) {
          next.microphonePermission = "not_enabled";
          pushConsoleEntry(
            "warn",
            "browser",
            `Native microphone probe failed: ${String(error)}`
          );
        }
      } else {
        const hasLabeledInput = audioInputs.some((device) => device.label.trim().length > 0);
        if (
          next.microphonePermission === "enabled" ||
          hasLabeledInput ||
          state.devices.microphonePermission === "enabled"
        ) {
          next.microphonePermission = "enabled";
        } else {
          next.microphonePermission = "not_enabled";
        }
      }
    }

    if (next.speakerPermission === "enabled" || state.devices.speakerPermission === "enabled") {
      next.speakerPermission = "enabled";
    } else {
      next.speakerPermission = "not_enabled";
    }
  } catch (error) {
    pushConsoleEntry("warn", "browser", `Device enumeration failed: ${String(error)}`);
  }

  state.devices = next;
}

async function requestMicrophoneAccess(): Promise<void> {
  // Always try to get browser permission first to trigger the prompt
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Success - we have permission
      stream.getTracks().forEach((track) => track.stop());
      state.devices.microphonePermission = "enabled";
      state.micPermissionBubbleDismissed = true;
      persistMicBubbleDismissed(true);
      pushConsoleEntry("info", "browser", "Microphone access enabled via browser prompt.");
      await refreshDevicesState();
      return;
    } catch (error) {
      const details = await buildMicrophoneAccessErrorDetails(error);
      pushConsoleEntry("warn", "browser", `Microphone access denied: ${details}`);
      state.devices.microphonePermission = "not_enabled";
      state.micPermissionBubbleDismissed = false;
      persistMicBubbleDismissed(false);
      await refreshDevicesState();
      return;
    }
  }

  // Fallback: try native probe if in tauri mode
  if (state.runtimeMode === "tauri" && clientRef) {
    try {
      const probe = await clientRef.probeMicrophoneDevice({
        correlationId: nextCorrelationId(),
        attemptOpen: true
      });
      state.devices.microphonePermission = probe.status;
      if (probe.defaultInputName?.trim()) {
        state.devices.defaultAudioInput = probe.defaultInputName.trim();
      }
      state.devices.audioInputCount = Math.max(state.devices.audioInputCount, probe.inputDeviceCount);

      if (probe.status === "enabled") {
        state.micPermissionBubbleDismissed = true;
        persistMicBubbleDismissed(true);
        pushConsoleEntry("info", "browser", "Microphone access enabled via native probe.");
      } else if (probe.status === "no_device") {
        state.micPermissionBubbleDismissed = true;
        persistMicBubbleDismissed(true);
        pushConsoleEntry("warn", "browser", "Microphone probe failed: no input device detected.");
      } else {
        state.micPermissionBubbleDismissed = false;
        persistMicBubbleDismissed(false);
        pushConsoleEntry("warn", "browser", `Microphone not enabled: ${probe.message}`);
      }
    } catch (error) {
      state.devices.microphonePermission = "not_enabled";
      state.micPermissionBubbleDismissed = false;
      persistMicBubbleDismissed(false);
      pushConsoleEntry("warn", "browser", `Microphone probe failed: ${String(error)}`);
    }
    await refreshDevicesState();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    state.devices.microphonePermission = "no_device";
    state.micPermissionBubbleDismissed = false;
    persistMicBubbleDismissed(false);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });
    stream.getTracks().forEach((track) => track.stop());
    state.devices.microphonePermission = "enabled";
    state.micPermissionBubbleDismissed = true;
    persistMicBubbleDismissed(true);
    pushConsoleEntry("info", "browser", "Microphone permission granted.");
  } catch (error) {
    const details = await buildMicrophoneAccessErrorDetails(error);
    pushConsoleEntry("warn", "browser", details);
    state.devices.microphonePermission = "not_enabled";
    state.micPermissionBubbleDismissed = false;
    persistMicBubbleDismissed(false);
  }
  await refreshDevicesState();
}

async function buildMicrophoneAccessErrorDetails(error: unknown): Promise<string> {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error);
  const base = `Microphone permission not granted: ${name ? `${name}: ` : ""}${message}`;

  if (!window.isSecureContext) {
    return `${base} | blocked: insecure context (${window.location.protocol}).`;
  }

  const notEnabled =
    name === "NotAllowedError" || /not allowed by the user agent|denied/i.test(message);
  if (!notEnabled) {
    return base;
  }

  const isLinux = /Linux/i.test(navigator.userAgent);
  if (!isLinux) {
    return `${base} | check OS/browser privacy settings and re-enable microphone for this app.`;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputCount = devices.filter((device) => device.kind === "audioinput").length;
    if (inputCount === 0) {
      return `${base} | no audio input devices were detected by the runtime.`;
    }
  } catch {
    // Keep generic Linux guidance if enumeration fails.
  }

  return `${base} | Linux WebKit runtime denied the request; allow microphone in system privacy/portal settings and restart the app.`;
}

async function requestSpeakerAccess(): Promise<void> {
  if (!navigator.mediaDevices) {
    state.devices.speakerPermission = "not_enabled";
    await refreshDevicesState();
    return;
  }
  try {
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput?: () => Promise<MediaDeviceInfo>;
    };
    if (typeof mediaDevices.selectAudioOutput === "function") {
      await mediaDevices.selectAudioOutput();
      state.devices.speakerPermission = "enabled";
      pushConsoleEntry("info", "browser", "Speaker access granted.");
    } else {
      state.devices.speakerPermission = "enabled";
      pushConsoleEntry(
        "info",
        "browser",
        "Speaker permission prompt is not supported on this platform/runtime. Using default output."
      );
    }
  } catch (error) {
    state.devices.speakerPermission = "not_enabled";
    pushConsoleEntry("warn", "browser", `Speaker permission not granted: ${String(error)}`);
  }
  await refreshDevicesState();
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  document.documentElement.setAttribute("data-theme", state.displayMode);
  const llamaRuntimeOnline = Boolean(
    state.llamaRuntime &&
      state.llamaRuntime.state === "healthy" &&
      state.llamaRuntime.activeEngineId &&
      state.llamaRuntime.endpoint &&
      state.llamaRuntime.pid
  );

  const visibleConsoleEntries = getVisibleConsoleEntries(state.consoleEntries, state.consoleView);
  const consoleText = visibleConsoleEntries.length
    ? visibleConsoleEntries
        .map((entry) => formatConsoleEntryLine(entry))
        .join("\n")
    : "No console output yet.";
  const consoleHtml = `
    <div class="console-panel">
      <pre class="console-text ${visibleConsoleEntries.length ? "" : "is-empty"}">${escapeHtml(
        consoleText
      )}</pre>
    </div>
  `;
  const consoleActionsHtml = `
    ${renderConsoleToolbar(state.consoleView, CONSOLE_DATA_ATTR)}
  `;

  const terminalUiHtml = renderTerminalWorkspace(
    terminalManager.listSessions(),
    state.activeTerminalSessionId
  );
  const terminalActionsHtml = renderTerminalToolbar(
    terminalManager.listSessions(),
    state.activeTerminalSessionId,
    state.terminalShellProfile
  );
  const toolsUiHtml = renderWorkspaceToolsBody(state.workspaceTools);
  const toolsActionsHtml = renderWorkspaceToolsActions();
  const activeWebTab = workspaceToolsRuntime.getActiveWebTab();
  const filteredFlow = filterFlowEvents(state.events, state.flowEventFilter, 120);
  state.flowFilteredEvents = filteredFlow.forInspector;
  state.flowAvailableModels = state.chatModelOptions.map((item) => ({
    id: item.id,
    label: item.label
  }));
  const toolViews = buildWorkspaceToolViews({
    chartSource: state.chartSource,
    chartRenderSource: state.chartRenderSource,
    chartError: state.chartError,
    activeWebTab,
    webTabs: state.webTabs,
    activeWebTabId: state.activeWebTabId,
    webHistoryOpen: state.webHistoryOpen,
    webHistoryClearConfirmOpen: state.webHistoryClearConfirmOpen,
    webHistory: state.webHistory,
    webSetupModalOpen: state.webSetupModalOpen,
    webSetupAccount: state.webSetupAccount,
    webSetupApiKey: state.webSetupApiKey,
    webSetupMessage: state.webSetupMessage,
    webSetupBusy: state.webSetupBusy,
    filesRootPath: state.filesRootPath,
    filesScopeRootPath: state.filesScopeRootPath,
    filesRootSelectorOpen: state.filesRootSelectorOpen,
    filesSelectedPath: state.filesSelectedPath,
    filesSelectedEntryPath: state.filesSelectedEntryPath,
    filesOpenTabs: state.filesOpenTabs,
    filesActiveTabPath: state.filesActiveTabPath,
    filesContentByPath: state.filesContentByPath,
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
    filesUndoDeleteAvailable: state.filesDeleteUndoStack.length > 0,
    filesConflictModalOpen: state.filesConflictModalOpen,
    filesConflictName: state.filesConflictName,
    filesSelectionAnchorPath: state.filesSelectionAnchorPath,
    filesSelectionDragActive: state.filesSelectionDragActive,
    filesSelectionJustDragged: state.filesSelectionJustDragged,
    filesSelectionGesture: state.filesSelectionGesture,
    filesError: state.filesError,
    tasksById: state.tasksById,
    tasksSelectedId: state.tasksSelectedId,
    tasksFolder: state.tasksFolder,
    tasksSortKey: state.tasksSortKey,
    tasksSortDirection: state.tasksSortDirection,
    tasksDetailsCollapsed: state.tasksDetailsCollapsed,
    tasksJsonDraft: state.tasksJsonDraft,
    createToolStage: state.createToolStage,
    createToolModelOptions: state.createToolModelOptions,
    createToolSelectedModelId: state.createToolSelectedModelId,
    createToolPrdUiPreset: state.createToolPrdUiPreset,
    createToolLayoutModifiers: state.createToolLayoutModifiers,
    createToolPrdUiNotes: state.createToolPrdUiNotes,
    createToolPrdInputs: state.createToolPrdInputs,
    createToolPrdProcess: state.createToolPrdProcess,
    createToolPrdConnections: state.createToolPrdConnections,
    createToolPrdDependencies: state.createToolPrdDependencies,
    createToolPrdExpectedBehavior: state.createToolPrdExpectedBehavior,
    createToolPrdOutputs: state.createToolPrdOutputs,
    createToolDevPlan: state.createToolDevPlan,
    createToolBuildViewMode: state.createToolBuildViewMode,
    createToolUiPreviewHtml: state.createToolUiPreviewHtml,
    createToolFixNotes: state.createToolFixNotes,
    createToolIconBrowserOpen: state.createToolIconBrowserOpen,
    createToolIconBrowserQuery: state.createToolIconBrowserQuery,
    createToolIconBrowserAppliedQuery: state.createToolIconBrowserAppliedQuery,
    createToolIconLibrary: state.createToolIconLibrary,
    createToolSpec: state.createToolSpec,
    createToolWorkspaceRoot: state.createToolWorkspaceRoot,
    createToolPreviewFiles: state.createToolPreviewFiles,
    createToolPreviewOrder: state.createToolPreviewOrder,
    createToolSelectedPreviewPath: state.createToolSelectedPreviewPath,
    createToolValidationErrors: state.createToolValidationErrors,
    createToolValidationWarnings: state.createToolValidationWarnings,
    createToolStatusMessage: state.createToolStatusMessage,
    createToolLastResultJson: state.createToolLastResultJson,
    createToolPrdGeneratingSection: state.createToolPrdGeneratingSection,
    createToolPrdGeneratingAll: state.createToolPrdGeneratingAll,
    createToolPrdReviewBusy: state.createToolPrdReviewBusy,
    createToolPrdReviewFindings: state.createToolPrdReviewFindings,
    createToolBusy: state.createToolBusy,
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
    flowProjectDescriptionDraft: state.flowProjectDescriptionDraft,
    flowPhaseModels: state.flowPhaseModels,
    flowAvailableModels: state.flowAvailableModels,
    flowPaused: state.flowPaused,
    flowModelUnavailableOpen: state.flowModelUnavailableOpen,
    flowModelUnavailablePhase: state.flowModelUnavailablePhase,
    flowModelUnavailableModel: state.flowModelUnavailableModel,
    flowModelUnavailableFallbackModel: state.flowModelUnavailableFallbackModel,
    flowModelUnavailableReason: state.flowModelUnavailableReason,
    flowModelUnavailableAttempt: state.flowModelUnavailableAttempt,
    flowModelUnavailableMaxAttempts: state.flowModelUnavailableMaxAttempts,
    flowModelUnavailableStatus: state.flowModelUnavailableStatus,
    flowTerminalPhases: [...FLOW_TERMINAL_PHASES],
    terminalSessions: terminalManager.listSessions().map((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      status: session.status
    })),
    filteredFlowEvents: filteredFlow.forRender
  });

  const panel = getPanelDefinition(state.sidebarTab, {
    displayMode: state.displayMode,
    displayModePreference: state.displayModePreference,
    chatRoutePreference: state.chatRoutePreference,
    showAppResourceCpu: state.showAppResourceCpu,
    showAppResourceMemory: state.showAppResourceMemory,
    showAppResourceNetwork: state.showAppResourceNetwork,
    showBottomEngine: state.showBottomEngine,
    showBottomModel: state.showBottomModel,
    showBottomContext: state.showBottomContext,
    showBottomSpeed: state.showBottomSpeed,
    showBottomTtsLatency: state.showBottomTtsLatency,
    conversationId: state.conversationId,
    messages: state.messages,
    chatReasoningByCorrelation: state.chatReasoningByCorrelation,
    chatThinkingPlacementByCorrelation: state.chatThinkingPlacementByCorrelation,
    chatThinkingExpandedByCorrelation: state.chatThinkingExpandedByCorrelation,
    chatToolRowsByCorrelation: state.chatToolRowsByCorrelation,
    chatToolRowExpandedById: state.chatToolRowExpandedById,
    chatStreamCompleteByCorrelation: state.chatStreamCompleteByCorrelation,
    chatStreaming: state.chatStreaming,
    chatDraft: state.chatDraft,
    chatAttachedFileName: state.chatAttachedFileName,
    chatAttachedFileContent: state.chatAttachedFileContent,
    chatActiveModelId: state.chatActiveModelId,
    chatActiveModelLabel: state.chatActiveModelLabel,
    chatActiveModelCapabilities: state.chatActiveModelCapabilities,
    chatTtsEnabled: state.chatTtsEnabled,
    chatTtsPlaying: state.chatTtsPlaying,
    devices: state.devices,
    apiConnections: state.apiConnections,
    apiFormOpen: state.apiFormOpen,
    apiDraft: state.apiDraft,
    apiEditingId: state.apiEditingId,
    apiMessage: state.apiMessage,
    apiProbeBusy: state.apiProbeBusy,
    apiProbeStatus: state.apiProbeStatus,
    apiProbeMessage: state.apiProbeMessage,
    apiDetectedModels: state.apiDetectedModels,
    conversations: state.conversations,
    chatThinkingEnabled: state.chatThinkingEnabled,
    llamaRuntime: state.llamaRuntime,
    llamaRuntimeSelectedEngineId: state.llamaRuntimeSelectedEngineId,
    llamaRuntimeModelPath: state.llamaRuntimeModelPath,
    llamaRuntimePort: state.llamaRuntimePort,
    llamaRuntimeCtxSize: state.llamaRuntimeCtxSize,
    llamaRuntimeGpuLayers: state.llamaRuntimeGpuLayers,
    llamaRuntimeThreads: state.llamaRuntimeThreads,
    llamaRuntimeBatchSize: state.llamaRuntimeBatchSize,
    llamaRuntimeUbatchSize: state.llamaRuntimeUbatchSize,
    llamaRuntimeTemperature: state.llamaRuntimeTemperature,
    llamaRuntimeTopP: state.llamaRuntimeTopP,
    llamaRuntimeTopK: state.llamaRuntimeTopK,
    llamaRuntimeRepeatPenalty: state.llamaRuntimeRepeatPenalty,
    llamaRuntimeFlashAttn: state.llamaRuntimeFlashAttn,
    llamaRuntimeMmap: state.llamaRuntimeMmap,
    llamaRuntimeMlock: state.llamaRuntimeMlock,
    llamaRuntimeSeed: state.llamaRuntimeSeed,
    llamaRuntimeMaxTokens: state.llamaRuntimeMaxTokens,
    llamaRuntimeBusy: state.llamaRuntimeBusy,
    llamaRuntimeLogs: state.llamaRuntimeLogs,
    modelManagerInstalled: state.modelManagerInstalled,
    modelManagerQuery: state.modelManagerQuery,
    modelManagerCollection: state.modelManagerCollection,
    modelManagerSearchResults: state.modelManagerSearchResults,
    modelManagerBusy: state.modelManagerBusy,
    modelManagerMessage: state.modelManagerMessage,
    modelManagerUnslothUdCatalog: state.modelManagerUnslothUdCatalog,
    modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading,
    stt: state.stt,
    tts: state.tts,
    consoleEntries: state.consoleEntries
  });

  const primaryPaneHtml = composePrimaryPaneHtml({
    isChatTab: state.sidebarTab === "chat",
    paneTitleHtml: renderPanelTitleIcon({
      icon: panel.icon,
      title: panel.title,
      sidebarTab: state.sidebarTab,
      chatModelOptions: state.chatModelOptions,
      chatActiveModelId: state.chatActiveModelId,
      ttsReady: state.tts.ready,
      ttsEngine: state.tts.engine
    }),
    panelActionsHtml: panel.renderActions(),
    panelBodyHtml: panel.renderBody()
  });

  const workspacePaneHtml = renderWorkspacePane(
    consoleHtml,
    consoleActionsHtml,
    terminalUiHtml,
    terminalActionsHtml,
    toolsUiHtml,
    toolsActionsHtml,
    toolViews,
    state.workspaceTools,
    state.workspaceTab
  );

  const sidebarRailHtml = renderSidebarRail(
    state.sidebarTab,
    llamaRuntimeOnline,
    state.stt.status === "running",
    state.chatTtsEnabled,
    state.apiConnections.some(
      (connection) => connection.apiType === "llm" && connection.status === "verified"
    )
  );
  const appBodyHtml = composeAppBodyHtml({
    layoutOrientation: state.layoutOrientation,
    sidebarRailHtml,
    primaryPaneHtml,
    workspacePaneHtml
  });

  app.innerHTML = composeAppFrameHtml({
    chatPanePercent: state.chatPanePercent,
    portraitWorkspacePercent: state.portraitWorkspacePercent,
    topbarHtml: renderGlobalTopbar(
      state.displayMode,
      state.layoutOrientation,
      state.appVersion,
      state.runtimeMode
    ),
    micPermissionBubbleHtml: renderMicPermissionBubble({
      microphonePermission: state.devices.microphonePermission,
      micPermissionBubbleDismissed: state.micPermissionBubbleDismissed
    }),
    appBodyHtml,
    bottombarHtml: renderGlobalBottombar(currentBottomStatus())
  });
}

function pushConsoleEntry(
  level: "log" | "info" | "warn" | "error" | "debug",
  source: "browser" | "app",
  message: string
): void {
  state.consoleEntries.push({
    timestampMs: Date.now(),
    level,
    source,
    message
  });
  if (state.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
    state.consoleEntries.splice(0, state.consoleEntries.length - MAX_CONSOLE_ENTRIES);
  }
}

function updateAssistantDraft(correlationId: string, delta: string): void {
  if (!state.chatFirstAssistantChunkMsByCorrelation[correlationId]) {
    state.chatFirstAssistantChunkMsByCorrelation[correlationId] = Date.now();
    syncThinkingPlacement(correlationId);
  }
  const existing = state.messages.find(
    (m) => m.role === "assistant" && m.correlationId === correlationId
  );

  if (existing) {
    existing.text = normalizeChatText(`${existing.text}${delta}`);
    return;
  }

  state.messages.push({ role: "assistant", text: normalizeChatText(delta), correlationId });
}

function updateReasoningDraft(correlationId: string, delta: string): void {
  if (!state.chatFirstReasoningChunkMsByCorrelation[correlationId]) {
    state.chatFirstReasoningChunkMsByCorrelation[correlationId] = Date.now();
    syncThinkingPlacement(correlationId);
  }
  if (state.chatThinkingExpandedByCorrelation[correlationId] === undefined) {
    state.chatThinkingExpandedByCorrelation[correlationId] = false;
  }
  const current = state.chatReasoningByCorrelation[correlationId] ?? "";
  state.chatReasoningByCorrelation[correlationId] = normalizeChatText(`${current}${delta}`);
}

function syncThinkingPlacement(correlationId: string): void {
  const assistantTs = state.chatFirstAssistantChunkMsByCorrelation[correlationId];
  const reasoningTs = state.chatFirstReasoningChunkMsByCorrelation[correlationId];
  if (assistantTs && reasoningTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] =
      reasoningTs <= assistantTs ? "before" : "after";
    return;
  }
  if (reasoningTs && !assistantTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] = "before";
    return;
  }
  if (assistantTs && !reasoningTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] = "after";
  }
}

function resetCurrentConversationUiState(): void {
  state.messages = [];
  state.chatDraft = "";
  state.chatAttachedFileName = null;
  state.chatAttachedFileContent = null;
  state.chatReasoningByCorrelation = {};
  state.chatThinkingPlacementByCorrelation = {};
  state.chatThinkingExpandedByCorrelation = {};
  state.chatToolRowsByCorrelation = {};
  state.chatToolRowExpandedById = {};
  state.chatStreamCompleteByCorrelation = {};
  state.chatToolIntentByCorrelation = {};
  state.chatFirstAssistantChunkMsByCorrelation = {};
  state.chatFirstReasoningChunkMsByCorrelation = {};
  state.chatTtsLatencyMs = null;
  chatTtsLatencyCapturedByCorrelation.clear();
  state.chatStreaming = false;
  state.activeChatCorrelationId = null;
}

function normalizeChatText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseStreamChunk(payload: AppEvent["payload"]): ChatStreamChunkPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.conversationId !== "string" ||
    typeof value.delta !== "string" ||
    typeof value.done !== "boolean"
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId,
    delta: value.delta,
    done: value.done
  };
}

function parseReasoningStreamChunk(
  payload: AppEvent["payload"]
): ChatStreamReasoningChunkPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.conversationId !== "string" ||
    typeof value.delta !== "string" ||
    typeof value.done !== "boolean"
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId,
    delta: value.delta,
    done: value.done
  };
}

function parseAgentToolPayload(
  payload: AppEvent["payload"]
): { toolCallId: string; toolName: string; display: string; success: boolean | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") {
    return null;
  }
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    display: typeof value.display === "string" ? value.display : "",
    success: typeof value.success === "boolean" ? value.success : null
  };
}

function toolTitleName(rawToolName: string): string {
  const raw = rawToolName.trim();
  if (!raw) return "Tool";
  if (raw === "web_search") return "Web Search";
  if (raw === "bash") return "Terminal";
  if (["read", "write", "edit", "move_file", "mkdir", "find", "grep", "chmod", "ls"].includes(raw)) {
    return "Files";
  }
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function toolIconName(rawToolName: string): IconName {
  const raw = rawToolName.trim();
  if (raw === "web_search") return "globe";
  if (raw === "bash") return "square-terminal";
  if (["read", "write", "edit", "move_file", "mkdir", "find", "grep", "chmod", "ls"].includes(raw)) {
    return "file-badge";
  }
  return "wrench";
}

function ensureAssistantMessageForCorrelation(correlationId: string): void {
  const existing = state.messages.find(
    (m) => m.role === "assistant" && m.correlationId === correlationId
  );
  if (existing) return;
  state.messages.push({ role: "assistant", text: "", correlationId });
}

function isCurrentChatCorrelation(correlationId: string): boolean {
  if (state.activeChatCorrelationId === correlationId) return true;
  return state.messages.some(
    (message) => message.role === "assistant" && message.correlationId === correlationId
  );
}

function appendChatToolRow(
  correlationId: string,
  row: Omit<ChatToolEventRow, "rowId">
): void {
  const existing = state.chatToolRowsByCorrelation[correlationId] ?? [];
  const rowId = `tool-row-${correlationId}-${existing.length + 1}`;
  state.chatToolRowsByCorrelation[correlationId] = [...existing, { rowId, ...row }];
  if (state.chatToolRowExpandedById[rowId] === undefined) {
    state.chatToolRowExpandedById[rowId] = false;
  }
}

function ensureToolIntentRow(correlationId: string, toolName: string): void {
  const key = `${correlationId}:${toolName}`;
  if (state.chatToolIntentByCorrelation[key]) return;
  state.chatToolIntentByCorrelation[key] = true;
  appendChatToolRow(correlationId, {
    icon: toolIconName(toolName),
    title: `Use ${toolTitleName(toolName)} tool`,
    details: `Agent confirmed it will use the ${toolTitleName(toolName)} tool.`,
  });
}


function formatRuntimeEventLine(event: AppEvent): string {
  const payloadText =
    event.payload && typeof event.payload === "object"
      ? JSON.stringify(event.payload)
      : String(event.payload);
  const payloadObj =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : null;
  const lineText =
    payloadObj && typeof payloadObj.line === "string" ? payloadObj.line : null;

  if (event.action === "llama.runtime.process.stdout" && lineText) {
    return `${new Date(event.timestampMs).toLocaleTimeString()} [stdout] ${lineText}`;
  }
  if (event.action === "llama.runtime.process.stderr" && lineText) {
    return `${new Date(event.timestampMs).toLocaleTimeString()} [stderr] ${lineText}`;
  }
  return `${new Date(event.timestampMs).toLocaleTimeString()} ${event.action} ${event.stage} ${payloadText}`;
}

function formatAgentEventLine(event: AppEvent): string | null {
  const payload = payloadAsRecord(event.payload);
  if (event.action === "chat.agent.request") {
    const model = typeof payload?.model === "string" ? payload.model : "unknown";
    const maxTokens =
      typeof payload?.maxTokens === "number" ? String(payload.maxTokens) : "n/a";
    const baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl : "n/a";
    return `${event.action} ${event.stage} model=${model} maxTokens=${maxTokens} baseUrl=${baseUrl}`;
  }
  if (event.action === "chat.agent.tool.start") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const callId =
      typeof payload?.toolCallId === "string" ? payload.toolCallId : "unknown";
    return `tool.start ${tool} call=${callId}`;
  }
  if (event.action === "chat.agent.tool.end") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const display =
      typeof payload?.display === "string" ? payload.display : "";
    return display ? `tool.end ${tool} ${display}` : `tool.end ${tool}`;
  }
  if (event.action === "chat.agent.tool.result") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const success = payload?.success === true;
    const display =
      typeof payload?.display === "string" ? payload.display : "";
    const status = success ? "ok" : "error";
    return display ? `tool.result ${tool} ${status} ${display}` : `tool.result ${tool} ${status}`;
  }
  if (event.action === "chat.agent.fallback") {
    const message =
      typeof payload?.message === "string" ? payload.message : safePayloadPreview(event.payload);
    return `${event.action} ${event.stage} ${message}`;
  }
  return null;
}

function extractRuntimeProcessLine(event: AppEvent): string | null {
  if (
    event.action !== "llama.runtime.process.stderr" &&
    event.action !== "llama.runtime.process.stdout"
  ) {
    return null;
  }
  if (!event.payload || typeof event.payload !== "object") return null;
  const payloadObj = event.payload as Record<string, unknown>;
  return typeof payloadObj.line === "string" ? payloadObj.line : null;
}

function updateRuntimeMetricsFromLine(line: string): void {
  const ctxMatch = line.match(/n_ctx_slot\s*=\s*(\d+)/i);
  const ctxValue = ctxMatch?.[1];
  if (ctxValue) {
    state.llamaRuntimeContextCapacity = Number.parseInt(ctxValue, 10);
  }

  const tokensMatch = line.match(/n_tokens\s*=\s*(\d+)/i);
  const tokenValue = tokensMatch?.[1];
  if (tokenValue) {
    state.llamaRuntimeContextTokens = Number.parseInt(tokenValue, 10);
  }

  const tpsMatch = line.match(/([0-9]+(?:\.[0-9]+)?)\s+tokens per second/i);
  const tpsValue = tpsMatch?.[1];
  if (tpsValue) {
    state.llamaRuntimeTokensPerSecond = Number.parseFloat(tpsValue);
  }
}

function prettifyRepoName(repoId: string): string {
  const slug = repoId.split("/").at(-1) ?? repoId;
  const cleaned = slug.replace(/-GGUF(?:-UD)?$/i, "");
  return cleaned.replace(/-/g, " ");
}

function extractParamCountLabel(repoId: string): string {
  const match = repoId.match(/(\d+(?:\.\d+)?B(?:-A\d+B)?)/i);
  const label = match?.[1];
  return label ? label.toUpperCase() : "n/a";
}

function currentBottomStatus() {
  const activeEngineId = state.llamaRuntime?.activeEngineId ?? null;
  const activeEngine =
    (activeEngineId
      ? state.llamaRuntime?.engines.find((engine) => engine.engineId === activeEngineId)
      : undefined) ??
    (state.llamaRuntimeSelectedEngineId
      ? state.llamaRuntime?.engines.find((engine) => engine.engineId === state.llamaRuntimeSelectedEngineId)
      : undefined);
  return buildBottomStatus({
    activeEngineBackend: activeEngine?.backend ?? null,
    showBottomEngine: state.showBottomEngine,
    showBottomModel: state.showBottomModel,
    showBottomContext: state.showBottomContext,
    showBottomSpeed: state.showBottomSpeed,
    showBottomTtsLatency: state.showBottomTtsLatency,
    showAppResourceCpu: state.showAppResourceCpu,
    showAppResourceMemory: state.showAppResourceMemory,
    showAppResourceNetwork: state.showAppResourceNetwork,
    modelPath: state.llamaRuntimeModelPath,
    contextTokens: state.llamaRuntimeContextTokens,
    contextCapacity: state.llamaRuntimeContextCapacity,
    tokensPerSecond: state.llamaRuntimeTokensPerSecond,
    ttsLatencyMs: state.chatTtsLatencyMs,
    appResourceCpuPercent: state.appResourceCpuPercent,
    appResourceMemoryBytes: state.appResourceMemoryBytes,
    appResourceNetworkRxBytesPerSec: state.appResourceNetworkRxBytesPerSec,
    appResourceNetworkTxBytesPerSec: state.appResourceNetworkTxBytesPerSec
  });
}

async function refreshConversations(): Promise<void> {
  if (!clientRef) return;
  const list = await clientRef.listConversations({ correlationId: nextCorrelationId() });
  state.conversations = list.conversations;
}

async function loadConversation(conversationId: string): Promise<void> {
  if (!clientRef) return;
  state.conversationId = conversationId;
  const history = await clientRef.getMessages({
    conversationId,
    correlationId: nextCorrelationId()
  });
  state.messages = history.messages.map((m) => ({
    role: m.role,
    text: m.content,
    correlationId: m.correlationId
  }));
  state.chatReasoningByCorrelation = {};
  state.chatThinkingPlacementByCorrelation = {};
  state.chatThinkingExpandedByCorrelation = {};
  state.chatToolRowsByCorrelation = {};
  state.chatToolRowExpandedById = {};
  state.chatStreamCompleteByCorrelation = {};
  state.chatToolIntentByCorrelation = {};
  state.chatFirstAssistantChunkMsByCorrelation = {};
  state.chatFirstReasoningChunkMsByCorrelation = {};
  state.chatTtsLatencyMs = null;
  chatTtsLatencyCapturedByCorrelation.clear();
}

async function refreshTools(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.listWorkspaceTools({ correlationId: nextCorrelationId() });
  const byId = new Map(response.tools.map((tool) => [tool.toolId, tool]));
  for (const manifest of getAllToolManifests()) {
    if (byId.has(manifest.id)) continue;
      byId.set(manifest.id, {
        toolId: manifest.id,
        title: manifest.title,
        description: manifest.description,
        category: manifest.category,
      core: manifest.core,
      optional: !manifest.core,
      version: manifest.version,
        source: manifest.source,
        enabled: manifest.defaultEnabled,
        icon: true,
        status: manifest.defaultEnabled ? "ready" : "disabled",
        entry: null
      });
  }
  state.workspaceTools = Array.from(byId.values()).sort((a, b) => a.toolId.localeCompare(b.toolId));
}

async function refreshFlowRuns(): Promise<void> {
  await refreshFlowRunsFromToolInvoke(state, {
    client: clientRef,
    nextCorrelationId,
    normalizeRun: normalizeFlowRunView
  });
}

async function refreshApiConnections(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.listApiConnections({ correlationId: nextCorrelationId() });
  state.apiConnections = response.connections;
  refreshChatModelProfile();
  refreshCreateToolModelOptions();
}

function downloadTextFile(fileName: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    const cleanup = () => {
      if (input.parentElement) {
        document.body.removeChild(input);
      }
    };
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    window.setTimeout(cleanup, 60_000);
    input.onchange = () => {
      void (async () => {
        try {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          const text = await file.text();
          resolve({ name: file.name, text });
        } catch {
          resolve(null);
        } finally {
          cleanup();
        }
      })();
    };
    input.click();
  });
}

function normalizePortableApiType(raw: string | null | undefined): ApiConnectionPortableRecord["apiType"] {
  if (raw === "llm" || raw === "search" || raw === "stt" || raw === "tts" || raw === "image" || raw === "other") {
    return raw;
  }
  return "llm";
}

function parsePortableSnapshot(payloadJson: string): ApiConnectionsPortableSnapshot {
  const parsed = JSON.parse(payloadJson) as Partial<ApiConnectionsPortableSnapshot> | ApiConnectionPortableRecord[];
  const rawConnections = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.connections)
      ? parsed.connections
      : [];
  return {
    version: typeof (parsed as ApiConnectionsPortableSnapshot).version === "number"
      ? (parsed as ApiConnectionsPortableSnapshot).version
      : 1,
    exportedAtMs: Date.now(),
    connections: rawConnections
      .map((item) => {
        const normalized: ApiConnectionPortableRecord = {
          apiType: normalizePortableApiType(item.apiType),
          apiUrl: String(item.apiUrl || "").trim(),
          apiKey: String(item.apiKey || "").trim()
        };
        const id = typeof item.id === "string" ? item.id.trim() : "";
        const name = typeof item.name === "string" ? item.name.trim() : "";
        const modelName = typeof item.modelName === "string" ? item.modelName.trim() : "";
        const apiStandardPath =
          typeof item.apiStandardPath === "string" ? item.apiStandardPath.trim() : "";
        if (id) normalized.id = id;
        if (name) normalized.name = name;
        if (modelName) normalized.modelName = modelName;
        if (apiStandardPath) normalized.apiStandardPath = apiStandardPath;
        if (typeof item.costPerMonthUsd === "number") normalized.costPerMonthUsd = item.costPerMonthUsd;
        if (typeof item.createdMs === "number") normalized.createdMs = item.createdMs;
        return normalized;
      })
      .filter((item) => Boolean(item.apiUrl) && Boolean(item.apiKey))
  };
}

function csvEscapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toApiConnectionsCsv(snapshot: ApiConnectionsPortableSnapshot): string {
  const header = [
    "id",
    "apiType",
    "apiUrl",
    "name",
    "apiKey",
    "modelName",
    "costPerMonthUsd",
    "apiStandardPath",
    "createdMs"
  ];
  const lines = [header.join(",")];
  for (const item of snapshot.connections) {
    const row = [
      item.id || "",
      item.apiType,
      item.apiUrl,
      item.name || "",
      item.apiKey,
      item.modelName || "",
      typeof item.costPerMonthUsd === "number" ? String(item.costPerMonthUsd) : "",
      item.apiStandardPath || "",
      typeof item.createdMs === "number" ? String(item.createdMs) : ""
    ].map(csvEscapeCell);
    lines.push(row.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (ch === ",") {
      out.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  out.push(current);
  return out;
}

function fromApiConnectionsCsv(csvText: string): ApiConnectionsPortableSnapshot {
  const lines = csvText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!lines.length) {
    return { version: 1, exportedAtMs: Date.now(), connections: [] };
  }
  const header = parseCsvLine(lines[0] ?? "").map((cell) => cell.trim());
  const index = new Map(header.map((name, i) => [name, i]));
  const connections: ApiConnectionPortableRecord[] = [];
  for (let rowIdx = 1; rowIdx < lines.length; rowIdx += 1) {
    const line = lines[rowIdx];
    if (line === undefined) continue;
    const cells = parseCsvLine(line);
    const get = (name: string) => {
      const cellIndex = index.get(name);
      if (cellIndex === undefined) return "";
      return (cells[cellIndex] || "").trim();
    };
    const apiUrl = get("apiUrl");
    const apiKey = get("apiKey");
    if (!apiUrl || !apiKey) continue;
    const costRaw = get("costPerMonthUsd");
    const createdRaw = get("createdMs");
    const cost = costRaw ? Number.parseFloat(costRaw) : undefined;
    const createdMs = createdRaw ? Number.parseInt(createdRaw, 10) : undefined;
    const record: ApiConnectionPortableRecord = {
      apiType: normalizePortableApiType(get("apiType")),
      apiUrl,
      apiKey
    };
    const id = get("id");
    const name = get("name");
    const modelName = get("modelName");
    const apiStandardPath = get("apiStandardPath");
    if (id) record.id = id;
    if (name) record.name = name;
    if (modelName) record.modelName = modelName;
    if (apiStandardPath) record.apiStandardPath = apiStandardPath;
    if (Number.isFinite(cost ?? NaN) && cost !== undefined) record.costPerMonthUsd = cost;
    if (Number.isFinite(createdMs ?? NaN) && createdMs !== undefined) record.createdMs = createdMs;
    connections.push(record);
  }
  return { version: 1, exportedAtMs: Date.now(), connections };
}

async function refreshTtsState(): Promise<void> {
  if (!clientRef) return;
  const [status, settings, voices] = await Promise.all([
    clientRef.ttsStatus({ correlationId: nextCorrelationId() }),
    clientRef.ttsSettingsGet({ correlationId: nextCorrelationId() }),
    clientRef.ttsListVoices({ correlationId: nextCorrelationId() })
  ]);
  state.tts.engineId = status.engineId;
  state.tts.engine = (status.engine as "kokoro" | "piper" | "matcha" | "kitten" | "pocket") || "kokoro";
  state.tts.ready = status.ready;
  state.tts.runtimeArchivePresent = status.runtimeArchivePresent;
  state.tts.availableModelPaths = status.availableModelPaths || [];
  state.tts.modelPath = status.modelPath;
  state.tts.secondaryPath = status.secondaryPath || status.voicesPath || "";
  state.tts.voicesPath = status.voicesPath;
  state.tts.tokensPath = status.tokensPath || settings.tokensPath || "";
  state.tts.dataDir = status.dataDir || settings.dataDir || "";
  state.tts.pythonPath = status.pythonPath || settings.pythonPath;
  state.tts.scriptPath = status.scriptPath;
  state.tts.voices = voices.voices.length ? voices.voices : status.availableVoices;
  state.tts.selectedVoice = status.selectedVoice || voices.selectedVoice || settings.voice;
  state.tts.speed = settings.speed || status.speed || state.tts.speed;
  state.tts.status = status.ready ? "ready" : "idle";
  state.tts.message = status.message;
}

function refreshChatModelProfile(): void {
  state.chatModelOptions = buildChatModelOptions();
  if (!state.chatModelOptions.length) {
    const previousId = state.chatActiveModelId;
    const fallback = "local-model";
    state.chatActiveModelId = "local:fallback";
    state.chatActiveModelLabel = fallback;
    state.chatActiveModelCapabilities = inferChatModelCapabilities(fallback);
    if (previousId !== state.chatActiveModelId) {
      pushConsoleEntry("warn", "browser", "No chat models available; switched to local fallback model.");
    }
    return;
  }
  const selectedFromCurrent = state.chatModelOptions.find(
    (option) => option.id === state.chatActiveModelId
  );
  if (selectedFromCurrent) {
    applyChatModelSelection(selectedFromCurrent, false);
    return;
  }

  const selectedFromPreferred = state.chatModelOptions.find(
    (option) => option.id === preferredChatModelId
  );
  if (selectedFromPreferred) {
    applyChatModelSelection(selectedFromPreferred, false);
    return;
  }

  const preferredApi = state.chatModelOptions.find((option) => option.source === "api");
  const selected = preferredApi ?? state.chatModelOptions[0];
  if (!selected) return;
  const previousId = state.chatActiveModelId;
  applyChatModelSelection(selected, false);
  if (previousId !== selected.id) {
    pushConsoleEntry(
      "info",
      "browser",
      `Chat model auto-switched to ${selected.label} (${selected.id}) because the previous selection was unavailable.`
    );
  }
}

function applyChatModelSelection(option: ChatModelOption, persistSelection = true): void {
  state.chatActiveModelId = option.id;
  state.chatActiveModelLabel = option.label;
  state.chatActiveModelCapabilities = inferChatModelCapabilities(option.modelName);
  if (persistSelection) {
    preferredChatModelId = option.id;
    persistChatModelId(option.id);
  }
}

function buildChatModelOptions(): ChatModelOption[] {
  const options: ChatModelOption[] = [];
  const seen = new Set<string>();

  const localModel = modelNameFromPath(state.llamaRuntimeModelPath);
  const localRuntimeStarting =
    state.llamaRuntimeBusy || state.llamaRuntime?.state === "starting";
  if (localModel && localModel !== "-") {
    options.push({
      id: "local:runtime",
      label: `local/${localModel}`,
      source: "local",
      modelName: localModel,
      detail: "llama.cpp runtime"
    });
    seen.add(`local:${localModel.toLowerCase()}`);
  } else if (localRuntimeStarting) {
    const previousLocalModel =
      state.chatActiveModelId.startsWith("local:") && state.chatActiveModelLabel.startsWith("local/")
        ? state.chatActiveModelLabel.slice("local/".length).trim()
        : "loading";
    options.push({
      id: "local:runtime",
      label: `local/${previousLocalModel || "loading"}`,
      source: "local",
      modelName: previousLocalModel || "loading",
      detail: "llama.cpp runtime starting"
    });
    seen.add(`local:${(previousLocalModel || "loading").toLowerCase()}`);
  }

  for (const connection of state.apiConnections) {
    if (connection.apiType !== "llm" || connection.status !== "verified") continue;
    const provider = resolveApiProviderLabel(connection.name, connection.apiUrl);
    const models = (connection.availableModels || []).map((m) => m.trim()).filter(Boolean);
    const fallback = (connection.modelName || "").trim();
    const candidates = models.length ? models : (fallback ? [fallback] : []);
    const apiUrlKey = connection.apiUrl.trim().toLowerCase();
    const apiPathKey = (connection.apiStandardPath || "").trim().toLowerCase();
    for (const model of candidates) {
      // Deduplicate endpoint/model repeats when users add multiple records
      // for the same provider URL and each record carries discovered model lists.
      const key = `api:${apiUrlKey}:${apiPathKey}:${model.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        id: `api:${connection.id}:${model}`,
        label: `${provider}/${model}`,
        source: "api",
        modelName: model,
        detail: connection.name || connection.apiUrl
      });
    }
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function resolveApiProviderLabel(name: string | null, apiUrl: string): string {
  try {
    const parsed = new URL(apiUrl);
    const host = (parsed.hostname || "").trim();
    if (isSameMachineHost(host)) {
      return "local";
    }
    if (looksLikeIpv4(host)) {
      return host.slice(0, 15);
    }
    return extractProviderLabelFromHost(host).slice(0, 15);
  } catch {
    const raw = (name || "").trim();
    return (raw || "api").slice(0, 15);
  }
}

function extractProviderLabelFromHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.+$/g, "");
  if (!normalized) return "api";
  const parts = normalized.split(".").filter(Boolean);
  if (!parts.length) return "api";

  const first = parts[0];
  if (parts.length >= 3 && (first === "api" || first === "www" || first === "m")) {
    return parts[1] || first;
  }
  if (parts.length >= 2) {
    const secondLevel = parts[parts.length - 2];
    return secondLevel ?? parts[0] ?? "api";
  }
  return parts[0] ?? "api";
}

function isSameMachineHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function looksLikeIpv4(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return false;
  }
  return host.split(".").every((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function refreshCreateToolModelOptions(): void {
  const options: CreateToolModelOption[] = [
    {
      id: "primary-agent",
      label: "Primary Agent",
      source: "primary",
      detail: "default routing"
    }
  ];
  const seen = new Set<string>(["primary-agent"]);

  for (const connection of state.apiConnections) {
    if (connection.apiType !== "llm") continue;
    if (connection.status !== "verified" && connection.status !== "warning") continue;
    const discovered = (connection.availableModels || []).map((model) => model.trim()).filter(Boolean);
    const fallback = (connection.modelName || "").trim();
    const candidates = discovered.length ? discovered : (fallback ? [fallback] : []);
    for (const candidate of candidates) {
      const key = `api:${connection.id}:${candidate.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        id: key,
        label: candidate,
        source: "api",
        detail: connection.name || connection.apiUrl
      });
    }
  }

  for (const model of state.modelManagerInstalled) {
    const name = model.name.trim() || model.id.trim();
    if (!name) continue;
    const key = `mm:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: key,
      label: name,
      source: "model-manager",
      detail: "installed"
    });
  }

  for (const row of state.modelManagerUnslothUdCatalog) {
    const name = row.modelName.trim();
    if (!name) continue;
    const key = `mm:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: key,
      label: name,
      source: "model-manager",
      detail: "catalog"
    });
  }

  state.createToolModelOptions = options;
  if (!options.some((item) => item.id === state.createToolSelectedModelId)) {
    state.createToolSelectedModelId = "primary-agent";
  }
}

const workspaceToolsRuntime = createWorkspaceToolsRuntime(state, {
  getClient: () => clientRef,
  nextCorrelationId,
  refreshFlowRuns,
  refreshTools,
  refreshApiConnections,
  createWebTab,
  persistWebSearchHistory
});

async function refreshModelManagerInstalled(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.modelManagerListInstalled({
    correlationId: nextCorrelationId()
  });
  state.modelManagerInstalled = response.models;
  refreshCreateToolModelOptions();
}

async function refreshModelManagerUnslothUdCatalog(): Promise<void> {
  if (!clientRef) return;
  state.modelManagerUnslothUdLoading = true;
  try {
    const csv = await clientRef.modelManagerListCatalogCsv({
      correlationId: nextCorrelationId(),
      listName: "Unsloth Dynamic Quants"
    });
    const grouped = new Map<
      string,
      {
        repoId: string;
        modelName: string;
        parameterCount: string;
        udAssets: Array<{ fileName: string; quant: string; sizeGb: string }>;
      }
    >();
    for (const row of csv.rows) {
      if (!row.quant || !row.fileName) continue;
      const key = row.repoId;
      const current = grouped.get(key) ?? {
        repoId: row.repoId,
        modelName: row.modelName || prettifyRepoName(row.repoId),
        parameterCount: row.parameterCount || extractParamCountLabel(row.repoId),
        udAssets: []
      };
      current.udAssets.push({
        fileName: row.fileName,
        quant: row.quant.replace(/^UD[-_]?/i, ""),
        sizeGb:
          typeof row.sizeMb === "number" && Number.isFinite(row.sizeMb)
            ? `${(row.sizeMb / 1024).toFixed(1)} GB`
            : "n/a"
      });
      grouped.set(key, current);
    }
    const rows = [...grouped.values()]
      .map((row) => {
        row.udAssets.sort((a, b) => a.quant.localeCompare(b.quant));
        const preferred = row.udAssets.find((asset) =>
          asset.quant.toUpperCase().includes("Q4_K_XL")
        );
        return {
          repoId: row.repoId,
          modelName: row.modelName,
          parameterCount: row.parameterCount,
          udAssets: row.udAssets,
          selectedAssetFileName: preferred?.fileName ?? row.udAssets[0]?.fileName ?? ""
        };
      })
      .sort((a, b) => a.modelName.localeCompare(b.modelName));
    if (rows.length > 0) {
      state.modelManagerUnslothUdCatalog = rows;
      state.modelManagerUnslothUdLoading = false;
      state.modelManagerMessage = `Loaded ${rows.length} UD model(s) from CSV.`;
      return;
    }
    state.modelManagerUnslothUdCatalog = [];
    state.modelManagerMessage = "No UD models found in CSV catalog.";
  } catch {
    state.modelManagerUnslothUdCatalog = [];
    state.modelManagerMessage = "Failed to load UD CSV catalog.";
  }
  state.modelManagerUnslothUdLoading = false;
  refreshCreateToolModelOptions();
}

async function refreshLlamaRuntime(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.getLlamaRuntimeStatus({ correlationId: nextCorrelationId() });
  state.llamaRuntime = response;
  let current = response.engines.find(
    (engine) => engine.engineId === state.llamaRuntimeSelectedEngineId
  );

  const isSelectableGpu = (engine: (typeof response.engines)[number]): boolean => {
    if (engine.backend === "cpu") return false;
    if (!engine.isApplicable) return false;
    return engine.isReady || engine.isInstalled || engine.prerequisites.some((item) => item.ok);
  };

  // Prefer Linux GPU backends in this order when detected and applicable.
  const preferredRocm = response.engines.find(
    (engine) => engine.backend === "rocm" && isSelectableGpu(engine)
  );
  const preferredVulkan = response.engines.find(
    (engine) => engine.backend === "vulkan" && isSelectableGpu(engine)
  );
  const preferredAnyGpu = response.engines.find(
    (engine) => isSelectableGpu(engine)
  );
  const preferredGpu = preferredRocm ?? preferredVulkan ?? preferredAnyGpu ?? null;

  if (preferredGpu) {
    const isCurrentCpu = current?.backend === "cpu";
    if (!current || isCurrentCpu || !current.isReady) {
      state.llamaRuntimeSelectedEngineId = preferredGpu.engineId;
      current = response.engines.find(
        (engine) => engine.engineId === state.llamaRuntimeSelectedEngineId
      );
    }
  }

  if (!current) {
    const firstEngine = response.engines.at(0);
    if (firstEngine) {
      state.llamaRuntimeSelectedEngineId = firstEngine.engineId;
      current = firstEngine;
    }
  }

  const selectedEngine = current;
  if (
    selectedEngine &&
    selectedEngine.isApplicable &&
    !selectedEngine.isBundled &&
    !selectedEngine.isInstalled
  ) {
    if (warnedMissingBundleEngineId !== selectedEngine.engineId) {
      pushConsoleEntry(
        "warn",
        "browser",
        `Selected engine ${selectedEngine.label} is not bundled in this build. Install will require local PATH or runtime download fallback.`
      );
      warnedMissingBundleEngineId = selectedEngine.engineId;
    }
  } else {
    warnedMissingBundleEngineId = null;
  }
  refreshChatModelProfile();
}

async function browseModelPath(): Promise<string | null> {
  const currentValue = state.llamaRuntimeModelPath.trim();
  if (state.runtimeMode === "tauri") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
          title: "Select GGUF Model",
          directory: false,
          multiple: false,
          filters: [
            { name: "GGUF", extensions: ["gguf"] },
            { name: "All files", extensions: ["*"] }
          ]
        }
      });
      if (Array.isArray(selected)) {
        return selected[0] ?? null;
      }
      return selected;
    } catch (error) {
      pushConsoleEntry(
        "warn",
        "browser",
        `Native model picker unavailable, falling back to manual entry: ${String(error)}`
      );
    }
  }

  const manual = window.prompt("Enter absolute model path (GGUF file)", currentValue);
  if (!manual) return null;
  const normalized = manual.trim();
  return normalized ? normalized : null;
}

async function browseTtsModelPath(currentValue: string): Promise<string | null> {
  const resolveParentDir = (path: string): string => {
    const normalized = path.trim().replace(/\\/g, "/");
    if (!normalized) return "";
    const slash = normalized.lastIndexOf("/");
    if (slash <= 0) return "";
    return normalized.slice(0, slash);
  };

  const trimmedCurrent = currentValue.trim();
  const defaultPath =
    resolveParentDir(trimmedCurrent) ||
    resolveParentDir(state.tts.modelPath) ||
    resolveParentDir(state.tts.secondaryPath) ||
    resolveParentDir(state.tts.voicesPath);
  if (state.runtimeMode === "tauri") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
          title: "Select TTS ONNX Model",
          directory: false,
          multiple: false,
          defaultPath: defaultPath || undefined,
          filters: [
            { name: "ONNX", extensions: ["onnx"] },
            { name: "All files", extensions: ["*"] }
          ]
        }
      });
      if (Array.isArray(selected)) {
        return selected[0] ?? null;
      }
      return selected;
    } catch (error) {
      pushConsoleEntry(
        "warn",
        "browser",
        `Native TTS model picker unavailable, falling back to manual entry: ${String(error)}`
      );
    }
  }

  const manual = window.prompt("Enter absolute TTS model path (ONNX file)", trimmedCurrent);
  if (!manual) return null;
  const normalized = manual.trim();
  return normalized ? normalized : null;
}

async function browseTtsSecondaryPath(currentValue: string): Promise<string | null> {
  const trimmedCurrent = currentValue.trim();
  if (state.runtimeMode === "tauri") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
          title: "Select TTS secondary asset",
          directory: false,
          multiple: false,
          filters: [
            { name: "Common assets", extensions: ["bin", "onnx", "txt"] },
            { name: "All files", extensions: ["*"] }
          ],
          defaultPath: trimmedCurrent || undefined
        }
      });
      if (Array.isArray(selected)) return selected[0] ?? null;
      return selected;
    } catch (error) {
      pushConsoleEntry(
        "warn",
        "browser",
        `Native TTS secondary picker unavailable, falling back to manual entry: ${String(error)}`
      );
    }
  }
  const manual = window.prompt("Enter absolute TTS secondary asset path", trimmedCurrent);
  if (!manual) return null;
  const normalized = manual.trim();
  return normalized ? normalized : null;
}

async function autoStartLlamaRuntimeIfConfigured(): Promise<void> {
  if (!clientRef) return;
  const modelPath = state.llamaRuntimeModelPath.trim();
  if (!modelPath) {
    return;
  }

  await refreshLlamaRuntime();
  if (
    state.llamaRuntime &&
    state.llamaRuntime.state === "healthy" &&
    state.llamaRuntime.activeEngineId &&
    state.llamaRuntime.endpoint &&
    state.llamaRuntime.pid
  ) {
    return;
  }

  const engineId =
    state.llamaRuntimeSelectedEngineId || state.llamaRuntime?.engines[0]?.engineId || "";
  if (!engineId) {
    pushConsoleEntry("warn", "browser", "Auto-start skipped: no llama runtime engine available.");
    return;
  }

  state.llamaRuntimeBusy = true;
  try {
    const selectedEngine = state.llamaRuntime?.engines.find((engine) => engine.engineId === engineId);
    if (!selectedEngine) {
      throw new Error(`Runtime engine not found: ${engineId}`);
    }

    const shouldVerifyInstall =
      selectedEngine.backend !== "cpu" || !selectedEngine.isInstalled || !selectedEngine.isReady;
    if (shouldVerifyInstall) {
      pushConsoleEntry(
        "info",
        "browser",
        `Auto-start: verifying runtime files for ${selectedEngine.label}...`
      );
      await clientRef.installLlamaRuntimeEngine({
        correlationId: nextCorrelationId(),
        engineId
      });
      await refreshLlamaRuntime();
    }

    const refreshedEngine = state.llamaRuntime?.engines.find((engine) => engine.engineId === engineId);
    if (!refreshedEngine?.isReady) {
      const canProceedWithGpu =
        refreshedEngine?.backend !== "cpu" &&
        refreshedEngine?.isApplicable &&
        refreshedEngine?.isInstalled;
      if (!canProceedWithGpu) {
        const blocking = refreshedEngine?.prerequisites
          .filter((item) => !item.ok)
          .map((item) => `${item.key}: ${item.message}`)
          .join(" | ");
        throw new Error(
          blocking
            ? `Auto-start blocked: ${blocking}`
            : `Auto-start blocked: runtime engine is not ready (${engineId})`
        );
      }
    }

    await clientRef.startLlamaRuntime({
      correlationId: nextCorrelationId(),
      engineId,
      modelPath,
      port: state.llamaRuntimePort,
      ctxSize: state.llamaRuntimeCtxSize,
      nGpuLayers: state.llamaRuntimeGpuLayers
    });
    await refreshLlamaRuntime();
    pushConsoleEntry("info", "browser", `Auto-started llama runtime using ${engineId}.`);
  } catch (error) {
    pushConsoleEntry("warn", "browser", `Auto-start failed: ${String(error)}`);
    await refreshLlamaRuntime();
  } finally {
    state.llamaRuntimeBusy = false;
  }
}

function renderAndBind(sendMessage: (text: string) => Promise<void>): void {
  const selection = window.getSelection?.() ?? null;
  const hasWorkspaceTextSelection =
    Boolean(selection) &&
    !selection!.isCollapsed &&
    Boolean(selection!.toString().trim()) &&
    Boolean(
      selection!.anchorNode &&
        selection!.focusNode &&
        document.querySelector(".workspace-pane")?.contains(selection!.anchorNode) &&
        document.querySelector(".workspace-pane")?.contains(selection!.focusNode)
    );
  if (hasWorkspaceTextSelection) {
    if (deferredWorkspaceSelectionRenderTimerId === null) {
      deferredWorkspaceSelectionRenderTimerId = window.setTimeout(() => {
        deferredWorkspaceSelectionRenderTimerId = null;
        renderAndBind(sendMessage);
      }, 220);
    }
    return;
  }
  if (deferredWorkspaceSelectionRenderTimerId !== null) {
    window.clearTimeout(deferredWorkspaceSelectionRenderTimerId);
    deferredWorkspaceSelectionRenderTimerId = null;
  }

  const toggleChatAutoSpeak = async (): Promise<void> => {
    if (!clientRef) return;
    state.chatTtsEnabled = !state.chatTtsEnabled;
    if (!state.chatTtsEnabled) {
      resetChatTtsQueue();
      stopTtsPlaybackLocal();
      state.tts.message = "Auto-speak disabled.";
      renderAndBind(sendMessage);
      return;
    }
    state.tts.message = "Auto-speak enabled.";
    renderAndBind(sendMessage);
    void prewarmChatTtsIfNeeded();
    if (state.activeChatCorrelationId) {
      const existing = state.messages.find(
        (message) =>
          message.role === "assistant" && message.correlationId === state.activeChatCorrelationId
      );
      if (existing?.text) {
        resetChatTtsStreamParser(state.activeChatCorrelationId);
        const seed = extractSpeakableStreamDelta(existing.text);
        enqueueSpeakableChunk(seed, false);
        void runChatTtsQueue(sendMessage);
      }
    }
  };

  const toggleSttRuntime = async (): Promise<void> => {
    if (!clientRef) return;
    if (sttToggleInFlight) return;
    sttToggleInFlight = true;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (state.stt.status === "idle" || state.stt.status === "error") {
        // First check and request microphone permission if needed
        await refreshDevicesState();
        const micPermission = state.devices.microphonePermission;
        // Sync to STT state for UI display
        state.stt.microphonePermission = micPermission;
        if (micPermission !== "enabled") {
          // Request microphone access - this will show permission prompt
          await requestMicrophoneAccess();
          // Check again after requesting
          await refreshDevicesState();
          const micPermissionAfter = state.devices.microphonePermission;
          // Sync to STT state for UI display
          state.stt.microphonePermission = micPermissionAfter;
          if (micPermissionAfter !== "enabled") {
            state.stt.status = "error";
            state.stt.message = "Microphone access denied";
            renderAndBind(sendMessage);
            return;
          }
        }
        // Start STT only after permission is confirmed
        state.stt.status = "starting";
        state.stt.message = state.stt.backend === "sherpa_onnx" ? "Starting sherpa-onnx..." : "Starting whisper server...";
        state.stt.isListening = false;
        renderAndBind(sendMessage);
        await invoke("stt_set_backend", { backend: state.stt.backend });
        await invoke("start_stt");
        state.stt.status = "running";
        state.stt.message = state.stt.backend === "sherpa_onnx" ? "Sherpa backend ready" : "Server started";
        await setupSttTranscriptListener(sendMessage);
        await startSttAudioCapture(invoke);
      } else if (state.stt.status === "running" || state.stt.status === "starting") {
        stopSttAudioCapture();
        await sttIngestQueue.catch(() => undefined);
        await sttTranscriptionQueue.catch(() => undefined);
        await sttPartialTranscriptionQueue.catch(() => undefined);
        await invoke("stt_stream_reset");
        await invoke("stop_stt");
        await teardownSttTranscriptListener();
        setVoicePipelineState("idle");
        state.stt.status = "idle";
        state.stt.message = null;
        state.stt.isListening = false;
      }
      renderAndBind(sendMessage);
    } catch (error) {
      stopSttAudioCapture();
      await teardownSttTranscriptListener();
      state.stt.status = "error";
      state.stt.message = String(error);
      state.stt.isListening = false;
      renderAndBind(sendMessage);
    } finally {
      sttToggleInFlight = false;
    }
  };

  const toggleVoiceMode = async (): Promise<void> => {
    if (voiceModeToggleInFlight) return;
    voiceModeToggleInFlight = true;
    try {
    const sttRunning = state.stt.status === "running" || state.stt.status === "starting";
    const ttsActive = state.chatTtsEnabled;
    const voiceModeActive = sttRunning && ttsActive;

    if (voiceModeActive) {
      await toggleSttRuntime();
      if (state.chatTtsEnabled) {
        await toggleChatAutoSpeak();
      }
      return;
    }

    if (!state.tts.ready) {
      state.tts.status = "error";
      state.tts.message = "Voice mode requires a ready TTS bundle. Configure TTS first.";
      renderAndBind(sendMessage);
      return;
    }

    if (!state.chatTtsEnabled) {
      await toggleChatAutoSpeak();
    }
    if (state.stt.status !== "running" && state.stt.status !== "starting") {
      await toggleSttRuntime();
    }

    const enabled = state.chatTtsEnabled;
    const running = state.stt.status === "running" || state.stt.status === "starting";
    if (!enabled || !running) {
      if (state.chatTtsEnabled) {
        await toggleChatAutoSpeak();
      }
      state.tts.message = "Voice mode failed to fully enable. Check microphone permission and STT status.";
      renderAndBind(sendMessage);
    }
    } finally {
      voiceModeToggleInFlight = false;
    }
  };

  persistCreateToolDraft(state);
  render();
  syncOverlayScrollbars();
  scrollConsoleToBottom();
  attachDividerResize();
  attachTopbarInteractions(sendMessage);
  attachChatHeaderModelInteractions(sendMessage);
  attachSidebarInteractions(sendMessage);
  attachWorkspaceInteractions(sendMessage);
  bindCustomToolIframes();
  attachPrimaryPanelInteractions(state.sidebarTab, state, {
    onSendMessage: sendMessage,
    onUpdateChatDraft: (text: string) => {
      state.chatDraft = text;
    },
    onSetChatAttachment: (fileName: string, content: string) => {
      state.chatAttachedFileName = fileName;
      state.chatAttachedFileContent = content;
    },
    onClearChatAttachment: () => {
      state.chatAttachedFileName = null;
      state.chatAttachedFileContent = null;
    },
    onStopCurrentResponse: async () => {
      const targetCorrelationId = state.activeChatCorrelationId;
      chatTtsStopRequested = true;
      setVoicePipelineState("interrupted");
      resetChatTtsQueue();
      stopTtsPlaybackLocal();
      if (clientRef) {
        try {
          await clientRef.ttsStop({ correlationId: nextCorrelationId() });
        } catch (error) {
          pushConsoleEntry("warn", "browser", `TTS stop request failed: ${String(error)}`);
        }
      }
      state.chatStreaming = false;
      state.activeChatCorrelationId = null;
      if (!clientRef || !targetCorrelationId) {
        renderAndBind(sendMessage);
        return;
      }
      await clientRef.cancelMessage({
        correlationId: nextCorrelationId(),
        targetCorrelationId
      });
      pushConsoleEntry("info", "browser", `Requested stop for ${targetCorrelationId}.`);
      setVoicePipelineState("idle");
      renderAndBind(sendMessage);
    },
    onSpeakLatestAssistantTts: toggleChatAutoSpeak,
    onToggleVoiceMode: toggleVoiceMode,
    onToggleThinkingPanel: async (correlationId: string) => {
      const current = state.chatThinkingExpandedByCorrelation[correlationId] === true;
      state.chatThinkingExpandedByCorrelation[correlationId] = !current;
      renderAndBind(sendMessage);
    },
    onCreateConversation: async () => {
      const id = generateChatConversationId();
      state.conversationId = id;
      resetCurrentConversationUiState();
      state.sidebarTab = "chat";
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onClearChat: async () => {
      const currentId = state.conversationId;
      if (clientRef) {
        try {
          await clientRef.deleteConversation({
            conversationId: currentId,
            correlationId: nextCorrelationId()
          });
        } catch (error) {
          pushConsoleEntry("warn", "browser", `Failed to clear persisted conversation: ${String(error)}`);
        }
      }
      state.conversationId = generateChatConversationId();
      resetCurrentConversationUiState();
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onToggleChatThinking: async () => {
      state.chatThinkingEnabled = !state.chatThinkingEnabled;
      pushConsoleEntry(
        "info",
        "browser",
        `Thinking mode ${state.chatThinkingEnabled ? "enabled" : "disabled"}`
      );
      renderAndBind(sendMessage);
    },
    onDevicesRefresh: async () => {
      await refreshDevicesState();
      renderAndBind(sendMessage);
    },
    onRequestMicrophoneAccess: async () => {
      await requestMicrophoneAccess();
      // Sync microphone permission to STT state for UI display
      state.stt.microphonePermission = state.devices.microphonePermission;
      renderAndBind(sendMessage);
    },
    onRequestSpeakerAccess: async () => {
      await requestSpeakerAccess();
      renderAndBind(sendMessage);
    },
    onApiConnectionsRefresh: async () => {
      await refreshApiConnections();
      renderAndBind(sendMessage);
    },
    onApiConnectionsExportJson: async () => {
      if (!clientRef) return;
      try {
        const exported = await clientRef.exportApiConnections({
          correlationId: nextCorrelationId()
        });
        downloadTextFile(
          exported.fileName,
          exported.payloadJson,
          "application/json;charset=utf-8"
        );
        state.apiMessage = `Exported API connections to ${exported.fileName}.`;
      } catch (error) {
        state.apiMessage = `Failed exporting API connections: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionsExportCsv: async () => {
      if (!clientRef) return;
      try {
        const exported = await clientRef.exportApiConnections({
          correlationId: nextCorrelationId()
        });
        const snapshot = parsePortableSnapshot(exported.payloadJson);
        const csv = toApiConnectionsCsv(snapshot);
        downloadTextFile("arxell-api-connections.csv", csv, "text/csv;charset=utf-8");
        state.apiMessage = "Exported API connections to arxell-api-connections.csv.";
      } catch (error) {
        state.apiMessage = `Failed exporting API connections CSV: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionsImportJson: async () => {
      if (!clientRef) return;
      const selected = await pickTextFile("application/json,.json");
      if (!selected) return;
      try {
        const imported = await clientRef.importApiConnections({
          correlationId: nextCorrelationId(),
          payloadJson: selected.text
        });
        state.apiConnections = imported.connections;
        refreshChatModelProfile();
        refreshCreateToolModelOptions();
        state.apiMessage = `Imported API connections from ${selected.name}.`;
      } catch (error) {
        state.apiMessage = `Failed importing API connections JSON: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionsImportCsv: async () => {
      if (!clientRef) return;
      const selected = await pickTextFile("text/csv,.csv,text/plain,.txt");
      if (!selected) return;
      try {
        const snapshot = fromApiConnectionsCsv(selected.text);
        const payloadJson = `${JSON.stringify(snapshot, null, 2)}\n`;
        const imported = await clientRef.importApiConnections({
          correlationId: nextCorrelationId(),
          payloadJson
        });
        state.apiConnections = imported.connections;
        refreshChatModelProfile();
        refreshCreateToolModelOptions();
        state.apiMessage = `Imported API connections from ${selected.name}.`;
      } catch (error) {
        state.apiMessage = `Failed importing API connections CSV: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionsSetFormOpen: async (open: boolean) => {
      state.apiFormOpen = open;
      if (!open) {
        state.apiDraft = defaultApiConnectionDraft();
        state.apiProbeBusy = false;
        state.apiProbeStatus = null;
        state.apiProbeMessage = null;
        state.apiDetectedModels = [];
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionDraftChange: async (patch) => {
      const changingUrl = typeof patch.apiUrl === "string";
      state.apiDraft = {
        ...state.apiDraft,
        ...patch
      };
      if (changingUrl) {
        state.apiProbeStatus = null;
        state.apiProbeMessage = null;
        state.apiDetectedModels = [];
      }
    },
    onApiConnectionEdit: async (id: string) => {
      if (!clientRef) return;
      const connection = state.apiConnections.find((record) => record.id === id);
      if (!connection) return;
      let fullApiKey = "";
      try {
        const secret = await clientRef.getApiConnectionSecret({
          correlationId: nextCorrelationId(),
          id
        });
        fullApiKey = secret.apiKey;
      } catch (error) {
        state.apiMessage = `Failed loading API key for edit: ${String(error)}`;
      }
      state.apiEditingId = id;
      state.apiDraft = {
        apiType: connection.apiType,
        apiUrl: connection.apiUrl,
        name: connection.name ?? "",
        apiKey: fullApiKey,
        modelName: connection.modelName ?? "",
        costPerMonthUsd: typeof connection.costPerMonthUsd === "number"
          ? String(connection.costPerMonthUsd)
          : "",
        apiStandardPath: connection.apiStandardPath ?? ""
      };
      state.apiDetectedModels = connection.availableModels?.length
        ? [...connection.availableModels]
        : (connection.modelName ? [connection.modelName] : []);
      state.apiProbeBusy = false;
      state.apiProbeStatus = null;
      state.apiProbeMessage = null;
      state.apiFormOpen = true;
      renderAndBind(sendMessage);
    },
    onApiConnectionProbe: async () => {
      if (!clientRef) return;
      const apiUrl = state.apiDraft.apiUrl.trim();
      if (!apiUrl) {
        state.apiProbeBusy = false;
        state.apiProbeStatus = null;
        state.apiProbeMessage = "Enter API URL to auto-detect endpoint standard and available models.";
        state.apiDetectedModels = [];
        renderAndBind(sendMessage);
        return;
      }
      state.apiProbeBusy = true;
      state.apiProbeStatus = "pending";
      state.apiProbeMessage = "Testing endpoint...";
      renderAndBind(sendMessage);
      try {
        const probeRequest: ApiConnectionProbeRequest = {
          correlationId: nextCorrelationId(),
          apiUrl,
          apiType: state.apiDraft.apiType
        };
        const apiKey = state.apiDraft.apiKey.trim();
        const apiStandardPath = state.apiDraft.apiStandardPath.trim();
        if (apiKey) {
          probeRequest.apiKey = apiKey;
        }
        if (apiStandardPath) {
          probeRequest.apiStandardPath = apiStandardPath;
        }
        const probe = await clientRef.probeApiConnectionEndpoint(probeRequest);
        state.apiProbeBusy = false;
        state.apiProbeStatus = probe.status;
        state.apiProbeMessage = probe.statusMessage;
        state.apiDetectedModels = probe.models;
        if (probe.apiStandardPath && !state.apiDraft.apiStandardPath.trim()) {
          state.apiDraft.apiStandardPath = probe.apiStandardPath;
        }
        if (probe.detectedApiType !== state.apiDraft.apiType) {
          state.apiDraft.apiType = probe.detectedApiType;
        }
        const currentModel = state.apiDraft.modelName.trim();
        if (!currentModel && probe.selectedModel) {
          state.apiDraft.modelName = probe.selectedModel;
        } else if (currentModel && probe.models.length && !probe.models.includes(currentModel)) {
          state.apiDraft.modelName = probe.selectedModel ?? currentModel;
        }
      } catch (error) {
        state.apiProbeBusy = false;
        state.apiProbeStatus = "warning";
        state.apiProbeMessage = `Probe failed: ${String(error)}`;
        state.apiDetectedModels = [];
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionSave: async () => {
      if (!clientRef) return;
      const apiUrl = state.apiDraft.apiUrl.trim();
      const apiKey = state.apiDraft.apiKey.trim();
      if (!apiUrl) {
        state.apiMessage = "API URL is required.";
        renderAndBind(sendMessage);
        return;
      }
      const costRaw = state.apiDraft.costPerMonthUsd.trim();
      let costPerMonthUsd: number | undefined;
      if (costRaw) {
        const parsed = Number.parseFloat(costRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          state.apiMessage = "Cost must be a non-negative number.";
          renderAndBind(sendMessage);
          return;
        }
        costPerMonthUsd = Number.parseFloat(parsed.toFixed(2));
      }
      try {
        if (state.apiEditingId) {
          const includeApiKey =
            Boolean(apiKey) &&
            !(apiKey.includes("*") && /\*{2,}/.test(apiKey));
          // Update existing connection
          const updated = await clientRef.updateApiConnection({
            correlationId: nextCorrelationId(),
            id: state.apiEditingId,
            apiType: state.apiDraft.apiType,
            apiUrl,
            ...(state.apiDraft.name.trim() ? { name: state.apiDraft.name.trim() } : {}),
            ...(includeApiKey ? { apiKey } : {}),
            ...(state.apiDraft.modelName.trim() ? { modelName: state.apiDraft.modelName.trim() } : {}),
            ...(typeof costPerMonthUsd === "number" ? { costPerMonthUsd } : {}),
            ...(state.apiDraft.apiStandardPath.trim() ? { apiStandardPath: state.apiDraft.apiStandardPath.trim() } : {})
          });
          const verified = await clientRef.reverifyApiConnection({
            correlationId: nextCorrelationId(),
            id: updated.connection.id
          });
          state.apiConnections = state.apiConnections.map((record) =>
            record.id === state.apiEditingId ? verified.connection : record
          );
          refreshChatModelProfile();
          refreshCreateToolModelOptions();
          state.apiFormOpen = false;
          state.apiEditingId = null;
          state.apiDraft = defaultApiConnectionDraft();
          state.apiMessage = verified.connection.statusMessage;
        } else {
          // Create new connection
          const created = await clientRef.createApiConnection({
            correlationId: nextCorrelationId(),
            apiType: state.apiDraft.apiType,
            apiUrl,
            apiKey,
            ...(state.apiDraft.name.trim() ? { name: state.apiDraft.name.trim() } : {}),
            ...(state.apiDraft.modelName.trim() ? { modelName: state.apiDraft.modelName.trim() } : {}),
            ...(typeof costPerMonthUsd === "number" ? { costPerMonthUsd } : {}),
            ...(state.apiDraft.apiStandardPath.trim() ? { apiStandardPath: state.apiDraft.apiStandardPath.trim() } : {})
          });
          state.apiConnections = [created.connection, ...state.apiConnections];
          refreshChatModelProfile();
          refreshCreateToolModelOptions();
          state.apiFormOpen = false;
          state.apiEditingId = null;
          state.apiDraft = defaultApiConnectionDraft();
          state.apiMessage = created.connection.statusMessage;
        }
      } catch (error) {
        state.apiMessage = `Failed saving API: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionReverify: async (id: string) => {
      if (!clientRef) return;
      try {
        const verified = await clientRef.reverifyApiConnection({
          correlationId: nextCorrelationId(),
          id
        });
        state.apiConnections = state.apiConnections.map((record) =>
          record.id === id ? verified.connection : record
        );
        refreshChatModelProfile();
        refreshCreateToolModelOptions();
        state.apiMessage = verified.connection.statusMessage;
      } catch (error) {
        state.apiMessage = `Failed re-verifying API: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionDelete: async (id: string) => {
      if (!clientRef) return;
      const confirmed = window.confirm("Remove this API connection?");
      if (!confirmed) return;
      try {
        const response = await clientRef.deleteApiConnection({
          correlationId: nextCorrelationId(),
          id
        });
        if (response.deleted) {
          state.apiConnections = state.apiConnections.filter((record) => record.id !== id);
          refreshChatModelProfile();
          refreshCreateToolModelOptions();
          state.apiMessage = "API connection removed.";
        } else {
          state.apiMessage = "API connection was not found.";
        }
      } catch (error) {
        state.apiMessage = `Failed deleting API: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onSelectConversation: async (conversationId: string) => {
      await loadConversation(conversationId);
      state.sidebarTab = "chat";
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onExportConversation: async (conversationId: string) => {
      if (!clientRef) return;
      try {
        const history = await clientRef.getMessages({
          conversationId,
          correlationId: nextCorrelationId()
        });
        const summary = state.conversations.find((item) => item.conversationId === conversationId);
        const title = summary?.title?.trim() || summary?.lastMessagePreview || conversationId;
        const markdown = buildConversationMarkdown(
          conversationId,
          title,
          history.messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestampMs: m.timestampMs
          }))
        );
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = conversationMarkdownFilename(conversationId);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        pushConsoleEntry("info", "browser", `Saved conversation ${conversationId} as markdown.`);
      } catch (error) {
        pushConsoleEntry(
          "error",
          "browser",
          `Failed exporting conversation ${conversationId}: ${String(error)}`
        );
      }
      renderAndBind(sendMessage);
    },
    onDeleteConversation: async (conversationId: string) => {
      if (!clientRef) return;
      try {
        await clientRef.deleteConversation({
          conversationId,
          correlationId: nextCorrelationId()
        });
      } catch (error) {
        pushConsoleEntry("error", "browser", `Failed deleting conversation ${conversationId}: ${String(error)}`);
      }
      if (state.conversationId === conversationId) {
        state.conversationId = generateChatConversationId();
        resetCurrentConversationUiState();
      }
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeRefresh: async () => {
      state.llamaRuntimeBusy = true;
      try {
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeInstall: async (engineId: string) => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      state.llamaRuntimeSelectedEngineId = engineId;
      try {
        await clientRef.installLlamaRuntimeEngine({
          correlationId: nextCorrelationId(),
          engineId
        });
        await refreshLlamaRuntime();
      } catch (error) {
        pushConsoleEntry(
          "error",
          "browser",
          `Failed to install runtime engine ${engineId}: ${String(error)}`
        );
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeBrowseModelPath: async () => {
      const selectedPath = await browseModelPath();
      if (!selectedPath) return;
      state.llamaRuntimeModelPath = selectedPath;
      persistLlamaModelPath(selectedPath);
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeSetMaxTokens: async (maxTokens: number | null) => {
      state.llamaRuntimeMaxTokens = maxTokens === null ? null : Math.max(128, Math.min(4096, maxTokens));
      persistLlamaMaxTokens(state.llamaRuntimeMaxTokens);
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeClearLogs: async () => {
      state.llamaRuntimeLogs = [];
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeStart: async ({
      engineId,
      modelPath,
      port,
      ctxSize,
      nGpuLayers,
      threads,
      batchSize,
      ubatchSize,
      temperature,
      topP,
      topK,
      repeatPenalty,
      flashAttn,
      mmap,
      mlock,
      seed
    }) => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      state.llamaRuntimeSelectedEngineId = engineId;
      state.llamaRuntimeModelPath = modelPath;
      persistLlamaModelPath(modelPath);
      state.llamaRuntimePort = port;
      state.llamaRuntimeCtxSize = ctxSize;
      state.llamaRuntimeGpuLayers = nGpuLayers;
      state.llamaRuntimeThreads = threads;
      state.llamaRuntimeBatchSize = batchSize;
      state.llamaRuntimeUbatchSize = ubatchSize;
      state.llamaRuntimeTemperature = temperature;
      state.llamaRuntimeTopP = topP;
      state.llamaRuntimeTopK = topK;
      state.llamaRuntimeRepeatPenalty = repeatPenalty;
      state.llamaRuntimeFlashAttn = flashAttn;
      state.llamaRuntimeMmap = mmap;
      state.llamaRuntimeMlock = mlock;
      state.llamaRuntimeSeed = seed;
      try {
        await refreshLlamaRuntime();
        const selectedEngine = state.llamaRuntime?.engines.find(
          (engine) => engine.engineId === engineId
        );
        if (!selectedEngine) {
          throw new Error(`Runtime engine not found: ${engineId}`);
        }

        const shouldVerifyInstall =
          selectedEngine.backend !== "cpu" || !selectedEngine.isInstalled || !selectedEngine.isReady;
        if (shouldVerifyInstall) {
          pushConsoleEntry(
            "info",
            "browser",
            `Verifying runtime files for ${selectedEngine.label} before start...`
          );
          await clientRef.installLlamaRuntimeEngine({
            correlationId: nextCorrelationId(),
            engineId
          });
          await refreshLlamaRuntime();
        }

        const refreshedEngine = state.llamaRuntime?.engines.find(
          (engine) => engine.engineId === engineId
        );
        if (!refreshedEngine?.isReady) {
          const canProceedWithGpu =
            refreshedEngine?.backend !== "cpu" &&
            refreshedEngine?.isApplicable &&
            refreshedEngine?.isInstalled;
          if (canProceedWithGpu) {
            pushConsoleEntry(
              "warn",
              "browser",
              `Proceeding with ${refreshedEngine.label} even though prerequisite probes are inconclusive.`
            );
          } else {
          const blocking = refreshedEngine?.prerequisites
            .filter((item) => !item.ok)
            .map((item) => `${item.key}: ${item.message}`)
            .join(" | ");
            throw new Error(
              blocking
                ? `Runtime engine is not ready: ${blocking}`
                : `Runtime engine is not ready: ${engineId}`
            );
          }
        }

        const startRequest = {
          correlationId: nextCorrelationId(),
          engineId,
          modelPath,
          port,
          ctxSize,
          nGpuLayers,
          temperature,
          topP,
          topK,
          repeatPenalty,
          flashAttn,
          mmap,
          mlock,
          ...(threads !== null ? { threads } : {}),
          ...(batchSize !== null ? { batchSize } : {}),
          ...(ubatchSize !== null ? { ubatchSize } : {}),
          ...(seed !== null ? { seed } : {})
        };
        await clientRef.startLlamaRuntime(startRequest);
        await refreshLlamaRuntime();
      } catch (error) {
        pushConsoleEntry(
          "error",
          "browser",
          `Failed to start runtime ${engineId}: ${String(error)}`
        );
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeStop: async () => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      try {
        await clientRef.stopLlamaRuntime({ correlationId: nextCorrelationId() });
        await refreshLlamaRuntime();
      } catch (error) {
        pushConsoleEntry("error", "browser", `Failed to stop runtime: ${String(error)}`);
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerRefreshInstalled: async () => {
      state.modelManagerBusy = true;
      state.modelManagerMessage = "Refreshing installed models...";
      try {
        await refreshModelManagerInstalled();
        state.modelManagerMessage = `Found ${state.modelManagerInstalled.length} installed model(s).`;
      } catch (error) {
        state.modelManagerMessage = `Refresh failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerSetQuery: async (query: string) => {
      state.modelManagerQuery = query.trim();
      renderAndBind(sendMessage);
    },
    onModelManagerSetCollection: async (collection: string) => {
      state.modelManagerCollection = collection.trim() || "unsloth_ud";
      if (state.modelManagerCollection === "unsloth_ud" && !state.modelManagerUnslothUdCatalog.length) {
        state.modelManagerMessage = "Loading Unsloth UD quant catalog...";
        await refreshModelManagerUnslothUdCatalog();
        state.modelManagerMessage = `Loaded ${state.modelManagerUnslothUdCatalog.length} UD model(s).`;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerSearchHf: async () => {
      if (!clientRef) return;
      const query = state.modelManagerQuery.trim();
      const collectionPrefix: Record<string, string> = {
        all: "",
        unsloth_ud: "unsloth",
        arxell: "Arxell",
        qwen: "Qwen",
        glm: "GLM",
        ministral: "Ministral"
      };
      const prefix = collectionPrefix[state.modelManagerCollection] ?? "";
      const effectiveQuery = `${prefix} ${query}`.trim();
      if (!effectiveQuery) {
        state.modelManagerMessage = "Enter a Hugging Face search query.";
        renderAndBind(sendMessage);
        return;
      }
      state.modelManagerBusy = true;
      state.modelManagerMessage = `Searching Hugging Face for "${effectiveQuery}"...`;
      try {
        const response = await clientRef.modelManagerSearchHf({
          correlationId: nextCorrelationId(),
          query: effectiveQuery,
          limit: 8
        });
        state.modelManagerSearchResults = response.results;
        state.modelManagerMessage = `Search complete: ${response.results.length} candidate(s).`;
      } catch (error) {
        state.modelManagerMessage = `Search failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerDownloadHf: async ({ repoId, fileName }) => {
      if (!clientRef) return;
      state.modelManagerBusy = true;
      state.modelManagerMessage = `Downloading ${repoId}/${fileName}...`;
      try {
        const response = await clientRef.modelManagerDownloadHf({
          correlationId: nextCorrelationId(),
          repoId,
          fileName
        });
        await refreshModelManagerInstalled();
        state.modelManagerMessage = `Downloaded ${response.model.name}.`;
      } catch (error) {
        state.modelManagerMessage = `Download failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerSetUdQuant: async ({ repoId, fileName }) => {
      state.modelManagerUnslothUdCatalog = state.modelManagerUnslothUdCatalog.map((row) =>
        row.repoId === repoId ? { ...row, selectedAssetFileName: fileName } : row
      );
      renderAndBind(sendMessage);
    },
    onModelManagerUseAsLlamaPath: async (modelPath: string) => {
      state.llamaRuntimeModelPath = modelPath;
      persistLlamaModelPath(modelPath);
      state.modelManagerMessage = `Selected model for llama.cpp: ${modelPath}`;
      renderAndBind(sendMessage);
    },
    onModelManagerEjectActive: async () => {
      if (!clientRef) return;
      state.modelManagerBusy = true;
      state.modelManagerMessage = "Ejecting active model and stopping llama.cpp...";
      try {
        await clientRef.stopLlamaRuntime({ correlationId: nextCorrelationId() });
      } catch {
        // Ignore stop failure and still clear local model selection.
      }
      try {
        state.llamaRuntimeModelPath = "";
        persistLlamaModelPath("");
        await refreshLlamaRuntime();
        state.modelManagerMessage = "Active model ejected and llama.cpp stopped.";
      } catch (error) {
        state.modelManagerMessage = `Eject completed, refresh failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerDeleteInstalled: async (modelId: string) => {
      if (!clientRef) return;
      state.modelManagerBusy = true;
      state.modelManagerMessage = `Removing ${modelId}...`;
      try {
        await clientRef.modelManagerDeleteInstalled({
          correlationId: nextCorrelationId(),
          modelId
        });
        await refreshModelManagerInstalled();
        state.modelManagerMessage = `Removed ${modelId}.`;
      } catch (error) {
        state.modelManagerMessage = `Remove failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onTtsRefresh: async () => {
      if (!clientRef) return;
      state.tts.status = "busy";
      state.tts.message = "Refreshing TTS status...";
      renderAndBind(sendMessage);
      try {
        await refreshTtsState();
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `TTS refresh failed: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsStart: async () => {
      if (!clientRef) return;
      state.tts.status = "busy";
      state.tts.message = `Starting ${state.tts.engine} TTS engine...`;
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.ttsSelfTest({
          correlationId: nextCorrelationId()
        });
        await refreshTtsState();
        state.tts.status = response.ok ? "ready" : "error";
        state.tts.message = response.ok
          ? `${state.tts.engine} TTS engine ready.`
          : response.message || `${state.tts.engine} TTS engine failed to start.`;
        state.tts.lastBytes = response.bytes;
        state.tts.lastDurationMs = response.durationMs;
        state.tts.lastSampleRate = response.sampleRate;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `TTS start failed: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsSetVoice: async (voice: string) => {
      state.tts.selectedVoice = voice.trim() || state.tts.selectedVoice;
      if (!clientRef) {
        renderAndBind(sendMessage);
        return;
      }
      try {
        await clientRef.ttsSettingsSet({
          correlationId: nextCorrelationId(),
          voice: state.tts.selectedVoice
        });
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed saving voice: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsSetEngine: async (engine: TtsEngine) => {
      state.tts = resetTtsStateForEngine(state.tts, engine);
      if (!clientRef) {
        renderAndBind(sendMessage);
        return;
      }
      state.tts.status = "busy";
      state.tts.message = `Switching TTS engine to ${engine}...`;
      renderAndBind(sendMessage);
      try {
        await clientRef.ttsSettingsSet({
          correlationId: nextCorrelationId(),
          engine
        });
        await refreshTtsState();
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed switching engine: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsSetSpeed: async (speed: number) => {
      const normalized = Math.max(0.5, Math.min(2, speed));
      state.tts.speed = normalized;
      if (!clientRef) {
        renderAndBind(sendMessage);
        return;
      }
      try {
        await clientRef.ttsSettingsSet({
          correlationId: nextCorrelationId(),
          speed: normalized
        });
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed saving speed: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsSetTestText: async (text: string) => {
      state.tts.testText = text;
      renderAndBind(sendMessage);
    },
    onTtsSetModelBundle: async (modelPath: string) => {
      const selectedPath = modelPath.trim();
      if (!selectedPath) return;
      if (!clientRef) {
        state.tts.modelPath = selectedPath;
        state.tts.message = `Selected bundle model: ${selectedPath}`;
        renderAndBind(sendMessage);
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Switching model bundle...";
      renderAndBind(sendMessage);
      try {
        await clientRef.ttsSettingsSet({
          correlationId: nextCorrelationId(),
          modelPath: selectedPath
        });
        await refreshTtsState();
        state.tts.message = `Selected bundle model: ${selectedPath}`;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed selecting model bundle: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsBrowseModelPath: async () => {
      const selectedPath = await browseTtsModelPath(state.tts.modelPath);
      if (!selectedPath) return;
      if (!clientRef) {
        state.tts.modelPath = selectedPath;
        state.tts.message = `Selected model: ${selectedPath}`;
        renderAndBind(sendMessage);
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Saving TTS model path...";
      renderAndBind(sendMessage);
      try {
        await clientRef.ttsSettingsSet({
          correlationId: nextCorrelationId(),
          modelPath: selectedPath
        });
        await refreshTtsState();
        state.tts.message = `Selected model: ${selectedPath}`;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed setting model path: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsBrowseSecondaryPath: async () => {
      const selectedPath = await browseTtsSecondaryPath(state.tts.secondaryPath || state.tts.voicesPath);
      if (!selectedPath) return;
      if (!clientRef) {
        state.tts.secondaryPath = selectedPath;
        state.tts.message = `Selected secondary asset: ${selectedPath}`;
        renderAndBind(sendMessage);
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Saving secondary path...";
      renderAndBind(sendMessage);
      try {
        await clientRef.ttsSettingsSet({
          correlationId: nextCorrelationId(),
          secondaryPath: selectedPath
        });
        await refreshTtsState();
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed setting secondary path: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsDownloadModel: async () => {
      if (!clientRef) return;
      const trustedSourceUrl =
        state.tts.engine === "kokoro"
          ? "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models"
          : state.tts.engine === "piper"
          ? "https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html"
          : state.tts.engine === "matcha"
          ? "https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/matcha.html"
          : state.tts.engine === "pocket"
          ? "https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html"
          : "https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html";
      if (state.tts.engine !== "kokoro") {
        window.open(trustedSourceUrl, "_blank", "noopener,noreferrer");
        state.tts.message = `Opened trusted ${state.tts.engine} model source.`;
        renderAndBind(sendMessage);
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Downloading sherpa Kokoro model bundle...";
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.ttsDownloadModel({
          correlationId: nextCorrelationId()
        });
        state.tts.message = response.message;
        await refreshTtsState();
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Model download failed: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsDownloadModelWithUrl: async (url: string) => {
      if (!clientRef) return;
      if (state.tts.engine !== "kokoro") {
        state.tts.message = "Model download is only available for Kokoro engine.";
        renderAndBind(sendMessage);
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Downloading Kokoro model bundle...";
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.ttsDownloadModel({
          correlationId: nextCorrelationId(),
          url
        });
        state.tts.message = response.message;
        await refreshTtsState();
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Model download failed: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsSpeakTest: async () => {
      if (!clientRef) return;
      const text = state.tts.testText.trim();
      if (!text) {
        state.tts.status = "error";
        state.tts.message = "Enter text to speak.";
        renderAndBind(sendMessage);
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Synthesizing...";
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.ttsSpeak({
          correlationId: nextCorrelationId(),
          text,
          voice: state.tts.selectedVoice,
          speed: state.tts.speed
        });
        state.tts.status = "ready";
        state.tts.message = `Spoke with ${response.voice}`;
        state.tts.selectedVoice = response.voice;
        state.tts.speed = response.speed;
        state.tts.lastBytes = response.audioBytes.length;
        state.tts.lastDurationMs = response.durationMs;
        state.tts.lastSampleRate = response.sampleRate;
        await playTtsAudio(response.audioBytes, null);
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Speak failed: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsStop: async () => {
      stopTtsPlaybackLocal();
      if (!clientRef) {
        renderAndBind(sendMessage);
        return;
      }
      try {
        await clientRef.ttsStop({ correlationId: nextCorrelationId() });
        state.tts.status = state.tts.ready ? "ready" : "idle";
        state.tts.message = "Stopped.";
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Stop failed: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onTtsSelfTest: async () => {
      if (!clientRef) return;
      state.tts.status = "busy";
      state.tts.message = "Running self-test...";
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.ttsSelfTest({
          correlationId: nextCorrelationId()
        });
        state.tts.status = response.ok ? "ready" : "error";
        state.tts.message = response.message;
        state.tts.lastBytes = response.bytes;
        state.tts.lastDurationMs = response.durationMs;
        state.tts.lastSampleRate = response.sampleRate;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Self-test failed: ${formatTtsError(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onToggleStt: toggleSttRuntime,
    onSetSttBackend: async (backend) => {
      if (backend !== "whisper_cpp" && backend !== "sherpa_onnx") return;
      if (state.stt.isListening || state.stt.status === "starting" || state.stt.status === "running") {
        state.stt.message = "Stop STT before switching backend.";
        renderAndBind(sendMessage);
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stt_set_backend", { backend });
      state.stt.backend = backend;
      persistSttBackend(backend);
      state.stt.message = backend === "sherpa_onnx"
        ? "Sherpa backend selected. Requires local sherpa model files."
        : "Whisper backend selected.";
      renderAndBind(sendMessage);
    },
    onSetSttModel: async (model) => {
      if (state.runtimeMode === "tauri") {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stt_set_model", { model });
      }
      state.stt.selectedModel = model;
      persistSttModel(model);
      renderAndBind(sendMessage);
    },
    onSetSttLanguage: async (language) => {
      state.stt.language = language;
      persistSttLanguage(language);
      renderAndBind(sendMessage);
    },
    onSetSttThreads: async (threads) => {
      state.stt.threads = threads;
      persistSttThreads(threads);
      renderAndBind(sendMessage);
    },
    onToggleSttAdvancedSettings: async () => {
      state.stt.showAdvancedSettings = !state.stt.showAdvancedSettings;
      renderAndBind(sendMessage);
    },
    onDownloadSttModel: async (fileName) => {
      if (!fileName) return;
      state.stt.modelDownloadProgress = 0;
      state.stt.modelDownloadError = null;
      renderAndBind(sendMessage);
      
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<string>("stt_download_model", { fileName });
        const models = await invoke<string[]>("stt_list_models");
        state.stt.availableModels = Array.isArray(models) && models.length > 0 ? models : ["auto"];
        if (!state.stt.availableModels.includes(state.stt.selectedModel)) {
          state.stt.selectedModel = state.stt.availableModels[0] ?? "auto";
          persistSttModel(state.stt.selectedModel);
        }
        state.stt.modelDownloadProgress = null;
        state.stt.message = result;
        renderAndBind(sendMessage);
      } catch (error) {
        state.stt.modelDownloadError = `Download failed: ${String(error)}`;
        state.stt.modelDownloadProgress = null;
        renderAndBind(sendMessage);
      }
    },
    onUpdateSttVadSetting: async (key, value) => {
      let normalized = value;
      if (key === "vadBaseThreshold") normalized = clampSttSetting(value, 0, 0.2, 0.0012);
      if (key === "vadStartFrames") normalized = Math.round(clampSttSetting(value, 1, 100, 2));
      if (key === "vadEndFrames") normalized = Math.round(clampSttSetting(value, 1, 200, 8));
      if (key === "vadDynamicMultiplier") normalized = clampSttSetting(value, 1, 10, 2.4);
      if (key === "vadNoiseAdaptationAlpha") normalized = clampSttSetting(value, 0, 1, 0.03);
      if (key === "vadPreSpeechMs") normalized = Math.round(clampSttSetting(value, 0, 2000, 200));
      if (key === "vadMinUtteranceMs") normalized = Math.round(clampSttSetting(value, 0, 5000, 200));
      if (key === "vadMaxUtteranceS") normalized = Math.round(clampSttSetting(value, 1, 120, 30));
      if (key === "vadForceFlushS") normalized = clampSttSetting(value, 0.25, 30, 3);
      state.stt[key] = normalized;
      renderAndBind(sendMessage);
    },
    onSetDisplayMode: async (mode) => {
      state.displayMode = mode;
      state.displayModePreference = mode;
      terminalManager.setDisplayMode(state.displayMode);
      renderAndBind(sendMessage);
    },
    onSetDisplayModePreference: async (mode) => {
      state.displayModePreference = mode;
      state.displayMode = mode === "system" ? resolveSystemDisplayMode() : mode;
      terminalManager.setDisplayMode(state.displayMode);
      renderAndBind(sendMessage);
    },
    onSetChatRoutePreference: async (mode) => {
      state.chatRoutePreference = mode;
      persistChatRoutePreference(mode);
      pushConsoleEntry("info", "browser", `Chat route preference set to ${mode}.`);
      renderAndBind(sendMessage);
    },
    onSetShowAppResourceCpu: async (value) => {
      state.showAppResourceCpu = value;
      persistShowAppResourcesCpu(value);
      appResourcePolling.restart(1000);
      renderAndBind(sendMessage);
    },
    onSetShowAppResourceMemory: async (value) => {
      state.showAppResourceMemory = value;
      persistShowAppResourcesMemory(value);
      appResourcePolling.restart(1000);
      renderAndBind(sendMessage);
    },
    onSetShowAppResourceNetwork: async (value) => {
      state.showAppResourceNetwork = value;
      persistShowAppResourcesNetwork(value);
      appResourcePolling.restart(1000);
      renderAndBind(sendMessage);
    },
    onSetShowBottomEngine: async (value) => {
      state.showBottomEngine = value;
      persistBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomEngine, value);
      renderAndBind(sendMessage);
    },
    onSetShowBottomModel: async (value) => {
      state.showBottomModel = value;
      persistBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomModel, value);
      renderAndBind(sendMessage);
    },
    onSetShowBottomContext: async (value) => {
      state.showBottomContext = value;
      persistBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomContext, value);
      renderAndBind(sendMessage);
    },
    onSetShowBottomSpeed: async (value) => {
      state.showBottomSpeed = value;
      persistBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomSpeed, value);
      renderAndBind(sendMessage);
    },
    onSetShowBottomTtsLatency: async (value) => {
      state.showBottomTtsLatency = value;
      persistBottomItem(BOTTOM_BAR_PREF_KEYS.showBottomTtsLatency, value);
      renderAndBind(sendMessage);
    }
  });
}

function attachChatHeaderModelInteractions(sendMessage: (text: string) => Promise<void>): void {
  const select = document.querySelector<HTMLSelectElement>("#chatHeaderModelSelect");
  if (!select) return;
  select.onchange = () => {
    const nextId = select.value;
    const selected = state.chatModelOptions.find((option) => option.id === nextId);
    if (!selected) return;
    const previousId = state.chatActiveModelId;
    applyChatModelSelection(selected);
    if (previousId !== selected.id) {
      pushConsoleEntry("info", "browser", `Chat model changed to ${selected.label} (${selected.id}).`);
    }
    renderAndBind(sendMessage);
  };
}

window.addEventListener("beforeunload", () => {
  destroyOverlayScrollbars();
});

function bindCustomToolIframes(): void {
  const iframes = document.querySelectorAll<HTMLIFrameElement>(
    ".tool-custom-tool-iframe, .tool-plugin-iframe"
  );
  iframes.forEach((frame) => {
    if (frame.dataset.bridgeBound === "true") return;
    frame.dataset.bridgeBound = "true";
    frame.addEventListener("load", () => {
      postCustomToolInit(frame);
    });
    postCustomToolInit(frame);
  });
}

function getCustomToolIdFromFrame(frame: HTMLIFrameElement): string {
  return (
    frame.getAttribute("data-custom-tool-id")?.trim() ||
    frame.getAttribute("data-plugin-tool-id")?.trim() ||
    ""
  );
}

function postCustomToolInit(frame: HTMLIFrameElement): void {
  const customToolId = getCustomToolIdFromFrame(frame);
  if (!customToolId || !frame.contentWindow) return;
  frame.contentWindow.postMessage(
    {
      type: "customTool.init",
      customToolId,
      pluginId: customToolId,
      hostVersion: state.appVersion,
      timestampMs: Date.now()
    },
    "*"
  );
  frame.contentWindow.postMessage(
    {
      type: "plugin.init",
      customToolId,
      pluginId: customToolId,
      hostVersion: state.appVersion,
      timestampMs: Date.now()
    },
    "*"
  );
}

function installCustomToolBridge(sendMessage: (text: string) => Promise<void>): void {
  if (customToolBridgeInstalled) return;
  customToolBridgeInstalled = true;
  window.addEventListener("message", (event) => {
    void handleCustomToolBridgeMessage(event, sendMessage);
  });
}

async function handleCustomToolBridgeMessage(
  event: MessageEvent<unknown>,
  sendMessage: (text: string) => Promise<void>
): Promise<void> {
  const frame = resolveCustomToolIframeFromSource(event.source);
  if (!frame) return;
  const customToolId = getCustomToolIdFromFrame(frame);
  if (!customToolId) return;
  if (!event.data || typeof event.data !== "object") return;

  const message = event.data as Record<string, unknown>;
  const type = typeof message.type === "string" ? message.type : "";
  if (!type) return;

  if (type === "plugin.ready" || type === "customTool.ready") {
    postCustomToolInit(frame);
    return;
  }

  if (type === "plugin.log" || type === "customTool.log") {
    const level = typeof message.level === "string" ? message.level : "info";
    const text = typeof message.message === "string" ? message.message : "";
    if (text) {
      pushConsoleEntry(
        level === "error" ? "error" : "info",
        "app",
        `[custom-tool:${customToolId}] ${text}`
      );
      renderAndBind(sendMessage);
    }
    return;
  }

  if (type !== "capability.invoke") return;
  if (!clientRef) return;

  const requestId = typeof message.requestId === "string" ? message.requestId : nextCorrelationId();
  const capability = typeof message.capability === "string" ? message.capability : "";
  const payload =
    message.payload && typeof message.payload === "object"
      ? (message.payload as Record<string, unknown>)
      : {};
  if (!capability) return;

  const response = await clientRef.customToolCapabilityInvoke({
    correlationId: nextCorrelationId(),
    customToolId,
    requestId,
    capability,
    payload
  });

  const sourceWindow = event.source as WindowProxy | null;
  if (!sourceWindow) return;
  sourceWindow.postMessage(
    {
      type: "capability.result",
      requestId: response.requestId,
      customToolId: response.customToolId,
      pluginId: response.customToolId,
      capability: response.capability,
      ok: response.ok,
      data: response.data ?? {},
      error: response.error ?? null,
      code: response.code ?? null
    },
    "*"
  );
}

function resolveCustomToolIframeFromSource(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (!source || typeof source !== "object") return null;
  const iframes = document.querySelectorAll<HTMLIFrameElement>(
    ".tool-custom-tool-iframe, .tool-plugin-iframe"
  );
  for (const frame of iframes) {
    if (frame.contentWindow === source) return frame;
  }
  return null;
}

// Global state for STT audio capture
let sttAudioContext: AudioContext | null = null;
let sttMediaStream: MediaStream | null = null;
let sttScriptProcessor: ScriptProcessorNode | null = null;
let sttSilentGainNode: GainNode | null = null;
let sttLastWasSpeaking = false;
let sttTranscriptUnlisten: (() => void) | null = null;
let sttPartialUnlisten: (() => void) | null = null;
let sttPipelineErrorUnlisten: (() => void) | null = null;
let sttVadUnlisten: (() => void) | null = null;
let sttTranscriptionQueue: Promise<void> = Promise.resolve();
let sttPartialTranscriptionQueue: Promise<void> = Promise.resolve();
let sttIngestQueue: Promise<void> = Promise.resolve();
let sttFlushPendingUtterance: (() => void) | null = null;
let sttToggleInFlight = false;
let voiceModeToggleInFlight = false;
let sttListenerSetupPromise: Promise<void> | null = null;
let chartLastRenderedSource: string | null = null;

function updateChatVoiceInputIcons(): void {
  const iconName = state.stt.isSpeaking ? APP_ICON.sidebar.sttSpeaking : APP_ICON.sidebar.stt;
  const iconMarkup = iconHtml(iconName, { size: 16, tone: "dark" });

  const chatMicGlyph = document.querySelector<HTMLSpanElement>("#chatMicBtn .mic-icon-glyph");
  if (chatMicGlyph) {
    chatMicGlyph.innerHTML = iconMarkup;
  }

  const chatSttBtn = document.querySelector<HTMLButtonElement>("#chatSttBtn");
  if (chatSttBtn && state.stt.status !== "idle" && state.stt.status !== "error") {
    chatSttBtn.innerHTML = iconMarkup;
  }
}

async function renderChartCanvasIfNeeded(sendMessage: (text: string) => Promise<void>): Promise<void> {
  if (state.workspaceTab !== "chart-tool") return;
  const canvas = document.querySelector<HTMLElement>("#chartCanvas");
  if (!canvas) return;
  const source = state.chartRenderSource;
  if (chartLastRenderedSource === source) return;
  const result = await renderMermaidInto(canvas, source);
  chartLastRenderedSource = source;
  if (!result.ok) {
    if (state.chartError !== result.error) {
      state.chartError = result.error;
      renderAndBind(sendMessage);
    }
    return;
  }
  if (state.chartError) {
    state.chartError = null;
    renderAndBind(sendMessage);
  }
}

function appendFloat32(
  a: Float32Array<ArrayBufferLike>,
  b: Float32Array<ArrayBufferLike>
): Float32Array<ArrayBufferLike> {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function clampSttSetting(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isIgnorableSttTranscript(raw: string): boolean {
  const transcript = raw.trim();
  if (!transcript) return true;
  if (/^\[?\s*blank_audio\s*\]?$/i.test(transcript)) return true;

  // Strip non-verbal annotations commonly emitted by STT models:
  // [typing], [Music], (cough), *laughs*, etc.
  const stripped = transcript
    .replace(/[\[(][^\])\n]{1,80}[\])]/g, " ")
    .replace(/\*[^*\n]{1,80}\*/g, " ")
    .replace(/[\s,.;:!?'"`~\-_/\\|()\[\]*]+/g, "")
    .trim();

  if (!stripped) return true;
  return false;
}

function enqueueSttTranscription(
  invokeFn: typeof import("@tauri-apps/api/core").invoke,
  pcmSamples: Float32Array<ArrayBufferLike>,
  utteranceId: string
): void {
  const samples = Array.from(pcmSamples);
  pushConsoleEntry("info", "browser", "STT queue: enqueue utterance " + utteranceId.slice(0, 8) + " (" + samples.length + " samples)");
  sttTranscriptionQueue = sttTranscriptionQueue
    .then(async () => {
      pushConsoleEntry("debug", "browser", "STT queue: transcribing utterance " + utteranceId.slice(0, 8));
      await invokeFn("transcribe_chunk", {
        pcmSamples: samples,
        utteranceId
      });
      pushConsoleEntry("info", "browser", "STT queue: transcribe request sent for " + utteranceId.slice(0, 8));
    })
    .catch((error) => {
      console.error("Transcription error:", error);
      pushConsoleEntry("error", "browser", "STT queue: transcribe failed for " + utteranceId.slice(0, 8) + ": " + String(error));
    });
}

function enqueueSttPartialTranscription(
  invokeFn: typeof import("@tauri-apps/api/core").invoke,
  pcmSamples: Float32Array<ArrayBufferLike>,
  utteranceId: string
): void {
  const samples = Array.from(pcmSamples);
  sttPartialTranscriptionQueue = sttPartialTranscriptionQueue
    .then(async () => {
      await invokeFn("transcribe_partial_chunk", {
        pcmSamples: samples,
        utteranceId
      });
    })
    .catch((error) => {
      pushConsoleEntry(
        "debug",
        "browser",
        "STT partial transcribe failed for " + utteranceId.slice(0, 8) + ": " + String(error)
      );
    });
}

function enqueueSttStreamIngest(
  invokeFn: typeof import("@tauri-apps/api/core").invoke,
  pcmSamples: Float32Array<ArrayBufferLike>
): void {
  const samples = Array.from(pcmSamples);
  sttIngestQueue = sttIngestQueue
    .then(async () => {
      await invokeFn("stt_stream_ingest", { pcmSamples: samples });
    })
    .catch((error) => {
      pushConsoleEntry("debug", "browser", "STT stream ingest failed: " + String(error));
    });
}

async function setupSttTranscriptListener(onTranscript: (text: string) => Promise<void>): Promise<void> {
  if (sttTranscriptUnlisten) {
    pushConsoleEntry("debug", "browser", "STT listener: transcript listener already installed");
    return;
  }
  if (sttListenerSetupPromise) {
    await sttListenerSetupPromise;
    return;
  }
  sttListenerSetupPromise = (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    sttTranscriptUnlisten = await listen<{ text: string }>("stt://transcript", (event) => {
      const transcript = event.payload.text?.trim();
      if (!transcript) {
        pushConsoleEntry("debug", "browser", "STT event: received empty transcript payload");
        return;
      }
      if (isIgnorableSttTranscript(transcript)) {
        pushConsoleEntry("debug", "browser", "STT event: ignored non-speech transcript placeholder");
        return;
      }
      pushConsoleEntry("info", "browser", "STT event: transcript received (" + transcript.length + " chars)");
      state.stt.lastTranscript = transcript;
      state.chatDraft = transcript;
      const input = document.querySelector<HTMLTextAreaElement>("#msg");
      if (input) {
        input.value = transcript;
        input.focus();
      }
      const now = Date.now();
      if (lastTranscriptDispatch.text === transcript && now - lastTranscriptDispatch.atMs < 1500) {
        pushConsoleEntry("debug", "browser", "STT event: dropped duplicate transcript");
        return;
      }
      if (state.chatStreaming) {
        pushConsoleEntry("debug", "browser", "STT event: deferred while chat is streaming");
        return;
      }
      lastTranscriptDispatch = { text: transcript, atMs: now };
      clearVoicePrefillWarmupTimer();
      voicePrefillLastPartial = "";
      voicePrefillStableSinceMs = 0;
      voicePrefillWarmedPartial = transcript;
      void onTranscript(transcript).catch((error) => {
        pushConsoleEntry("error", "browser", "STT send failed: " + String(error));
      });
    });
    sttPartialUnlisten = await listen<{ text?: string; utterance_id?: string }>(
      "stt://partial",
      (event) => {
        const partial = event.payload.text?.trim();
        if (!partial || isIgnorableSttTranscript(partial)) return;
        state.chatDraft = partial;
        maybeTriggerVoicePrefillWarmup(partial);
        const input = document.querySelector<HTMLTextAreaElement>("#msg");
        if (input) {
          input.value = partial;
        }
      }
    );
  })();
  try {
    await sttListenerSetupPromise;
  } finally {
    sttListenerSetupPromise = null;
  }
  pushConsoleEntry("info", "browser", "STT listener: transcript listener installed");
}

async function teardownSttTranscriptListener(): Promise<void> {
  if (!sttTranscriptUnlisten) return;
  sttTranscriptUnlisten();
  sttTranscriptUnlisten = null;
  if (sttPartialUnlisten) {
    sttPartialUnlisten();
    sttPartialUnlisten = null;
  }
  pushConsoleEntry("info", "browser", "STT listener: transcript listener removed");
}

async function startSttAudioCapture(invokeFn: typeof import("@tauri-apps/api/core").invoke): Promise<void> {
  try {
    stopSttAudioCapture();
    sttTranscriptionQueue = Promise.resolve();
    sttPartialTranscriptionQueue = Promise.resolve();
    sttIngestQueue = Promise.resolve();
    await invokeFn("stt_stream_reset");
    pushConsoleEntry("info", "browser", "STT capture: requesting microphone stream");

    sttMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    const trackSettings = sttMediaStream.getAudioTracks()[0]?.getSettings?.();
    pushConsoleEntry("info", "browser", "STT capture: microphone stream granted " + (trackSettings ? JSON.stringify(trackSettings) : "(no track settings)"));

    sttAudioContext = new AudioContext({ sampleRate: 48000 });
    const source = sttAudioContext.createMediaStreamSource(sttMediaStream);
    sttScriptProcessor = sttAudioContext.createScriptProcessor(4096, 1, 1);

    if (sttAudioContext.state === "suspended") {
      await sttAudioContext.resume();
    }
    pushConsoleEntry("info", "browser", "STT capture: AudioContext state=" + sttAudioContext.state);

    sttSilentGainNode = sttAudioContext.createGain();
    sttSilentGainNode.gain.value = 0;

    const resample = (audioData: Float32Array, inputRate: number, outputRate: number): Float32Array => {
      if (inputRate === outputRate) return audioData;
      const ratio = inputRate / outputRate;
      const outputLength = Math.round(audioData.length / ratio);
      const output = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const inputIndex = i * ratio;
        const lowerIndex = Math.floor(inputIndex);
        const upperIndex = Math.min(lowerIndex + 1, audioData.length - 1);
        const fraction = inputIndex - lowerIndex;
        const lower = audioData[lowerIndex] ?? 0;
        const upper = audioData[upperIndex] ?? 0;
        output[i] = lower * (1 - fraction) + upper * fraction;
      }
      return output;
    };

    const computeEnergy = (samples: Float32Array): number => {
      if (samples.length === 0) return 0;
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i] ?? 0;
        sum += sample * sample;
      }
      return Math.sqrt(sum / samples.length);
    };

    const inputSampleRate = sttAudioContext.sampleRate;
    const outputSampleRate = 16000;
    const useBackendSegmenter = true;
    const readVadThreshold = (): number =>
      clampSttSetting(state.stt.vadBaseThreshold, 0, 0.2, 0.0012);
    const readVadStartFrames = (): number =>
      Math.round(clampSttSetting(state.stt.vadStartFrames, 1, 100, 2));
    const readVadEndFrames = (): number =>
      Math.round(clampSttSetting(state.stt.vadEndFrames, 1, 200, 8));
    const readVadDynamicMultiplier = (): number =>
      clampSttSetting(state.stt.vadDynamicMultiplier, 1, 10, 2.4);
    const readVadNoiseAdaptationAlpha = (): number =>
      clampSttSetting(state.stt.vadNoiseAdaptationAlpha, 0, 1, 0.03);
    const readPreSpeechSamples = (): number =>
      Math.round(clampSttSetting(state.stt.vadPreSpeechMs, 0, 2000, 200) * 16);
    const readMinUtteranceSamples = (): number =>
      Math.round(clampSttSetting(state.stt.vadMinUtteranceMs, 0, 5000, 200) * 16);
    const readMaxUtteranceSamples = (): number =>
      Math.round(clampSttSetting(state.stt.vadMaxUtteranceS, 1, 120, 30) * 16_000);
    const readForceFlushSamples = (): number =>
      Math.round(clampSttSetting(state.stt.vadForceFlushS, 0.25, 30, 3) * 16_000);

    let speechStartFrames = 0;
    let speechEndFrames = 0;
    let isSpeaking = false;
    let noiseFloor = 0.001;
    let preSpeechBuffer: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let utteranceBuffer: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let utteranceId: string | null = null;
    let audioFramesSeen = 0;
    let vadLogFrames = 0;
    let peakEnergy = 0;
    let lastVadLogMs = 0;
    let lastPartialEmitMs = 0;

    sttLastWasSpeaking = false;
    state.stt.isSpeaking = false;
    updateChatVoiceInputIcons();

    const flushUtterance = () => {
      const minUtteranceSamples = readMinUtteranceSamples();
      if (!utteranceId || utteranceBuffer.length < minUtteranceSamples) {
        if (utteranceId) {
          pushConsoleEntry("debug", "browser", "STT utterance: dropped short utterance " + utteranceId.slice(0, 8) + " (" + utteranceBuffer.length + " samples)");
        }
        utteranceBuffer = new Float32Array(0);
        utteranceId = null;
        return;
      }
      const samples = utteranceBuffer;
      const currentUtteranceId = utteranceId;
      pushConsoleEntry("info", "browser", "STT utterance: flush " + currentUtteranceId.slice(0, 8) + " (" + samples.length + " samples)");
      setVoicePipelineState("processing");
      utteranceBuffer = new Float32Array(0);
      utteranceId = null;
      enqueueSttTranscription(invokeFn, samples, currentUtteranceId);
    };

    sttFlushPendingUtterance = flushUtterance;

    window.setTimeout(() => {
      if (state.stt.isListening && audioFramesSeen === 0) {
        state.stt.status = "error";
        state.stt.message = "No audio frames from microphone (check PipeWire/portal permissions)";
        pushConsoleEntry("error", "browser", "STT capture failed: microphone stream produced zero audio frames.");
        render();
      } else if (state.stt.isListening) {
        pushConsoleEntry("info", "browser", "STT capture: audio frames flowing (" + audioFramesSeen + " frames in first 3s)");
      }
    }, 3000);

    sttScriptProcessor.onaudioprocess = (event) => {
      audioFramesSeen += 1;
      vadLogFrames += 1;
      const inputData = event.inputBuffer.getChannelData(0);
      const resampledData = resample(inputData, inputSampleRate, outputSampleRate);
      const energy = computeEnergy(resampledData);
      peakEnergy = Math.max(peakEnergy, energy);

      if (useBackendSegmenter) {
        enqueueSttStreamIngest(invokeFn, resampledData);
        const now = Date.now();
        if (now - lastVadLogMs >= 1000) {
          pushConsoleEntry(
            "debug",
            "browser",
            "STT stream: frames=" + vadLogFrames +
              " rms=" + energy.toFixed(5) +
              " peak=" + peakEnergy.toFixed(5) +
              " speaking=" + String(state.stt.isSpeaking)
          );
          lastVadLogMs = now;
          vadLogFrames = 0;
          peakEnergy = 0;
        }
        return;
      }

      if (!isSpeaking) {
        const noiseAdaptationAlpha = readVadNoiseAdaptationAlpha();
        noiseFloor = noiseFloor * (1 - noiseAdaptationAlpha) + energy * noiseAdaptationAlpha;
      }
      const dynamicThreshold = Math.max(readVadThreshold(), noiseFloor * readVadDynamicMultiplier());
      const aboveThreshold = energy > dynamicThreshold;

      const now = Date.now();
      if (now - lastVadLogMs >= 1000) {
        pushConsoleEntry(
          "debug",
          "browser",
          "STT VAD: frames=" + vadLogFrames +
            " rms=" + energy.toFixed(5) +
            " peak=" + peakEnergy.toFixed(5) +
            " floor=" + noiseFloor.toFixed(5) +
            " threshold=" + dynamicThreshold.toFixed(5) +
            " speaking=" + String(isSpeaking) +
            " above=" + String(aboveThreshold)
        );
        lastVadLogMs = now;
        vadLogFrames = 0;
        peakEnergy = 0;
      }

      if (aboveThreshold) {
        speechStartFrames += 1;
        speechEndFrames = 0;
      } else {
        speechEndFrames += 1;
        speechStartFrames = 0;
      }

      if (!isSpeaking) {
        const preSpeechSamples = readPreSpeechSamples();
        preSpeechBuffer = appendFloat32(preSpeechBuffer, resampledData);
        if (preSpeechBuffer.length > preSpeechSamples) {
          preSpeechBuffer = preSpeechBuffer.slice(preSpeechBuffer.length - preSpeechSamples);
        }
      }

      if (!isSpeaking && speechStartFrames >= readVadStartFrames()) {
        const playingAgentSpeech = state.chatTtsPlaying;
        const speakingElapsedMs = chatTtsSpeakingSinceMs ? Date.now() - chatTtsSpeakingSinceMs : 0;
        const adaptiveBargeInThreshold = Math.max(
          VOICE_BARGE_IN_MIN_RMS,
          dynamicThreshold * VOICE_BARGE_IN_DYNAMIC_MULTIPLIER
        );
        const confidentBargeIn =
          playingAgentSpeech &&
          speakingElapsedMs >= VOICE_BARGE_IN_GRACE_MS &&
          energy >= adaptiveBargeInThreshold;
        if (confidentBargeIn) {
          pushConsoleEntry(
            "info",
            "browser",
            "Voice barge-in trigger: interrupting playback/generation (rms=" +
              energy.toFixed(5) +
              ", threshold=" +
              adaptiveBargeInThreshold.toFixed(5) +
              ", elapsedMs=" +
              speakingElapsedMs +
              ")"
          );
          requestVoiceBargeInInterrupt();
        }
        isSpeaking = true;
        if (voicePipelineState !== "interrupted") {
          setVoicePipelineState("user_speaking");
        }
        utteranceId = crypto.randomUUID();
        lastPartialEmitMs = Date.now();
        pushConsoleEntry("info", "browser", "STT VAD: speech start (utterance=" + utteranceId.slice(0, 8) + ")");
        utteranceBuffer = appendFloat32(preSpeechBuffer, resampledData);
        preSpeechBuffer = new Float32Array(0);
      } else if (isSpeaking) {
        utteranceBuffer = appendFloat32(utteranceBuffer, resampledData);
        const nowMs = Date.now();
        const partialIntervalMs = 700;
        const minPartialSamples = 16_000; // ~1s @16kHz
        if (
          utteranceId &&
          utteranceBuffer.length >= minPartialSamples &&
          nowMs - lastPartialEmitMs >= partialIntervalMs
        ) {
          lastPartialEmitMs = nowMs;
          enqueueSttPartialTranscription(invokeFn, utteranceBuffer, utteranceId);
        }
      }

      if (isSpeaking && utteranceBuffer.length >= readForceFlushSamples()) {
        pushConsoleEntry("info", "browser", "STT VAD: force flush chunk buffered=" + utteranceBuffer.length + " samples");
        flushUtterance();
        utteranceId = crypto.randomUUID();
        utteranceBuffer = new Float32Array(0);
      }

      const vadEndFrames = readVadEndFrames();
      const maxUtteranceSamples = readMaxUtteranceSamples();
      if (isSpeaking && (speechEndFrames >= vadEndFrames || utteranceBuffer.length >= maxUtteranceSamples)) {
        const endReason = speechEndFrames >= vadEndFrames ? "silence" : "max_length";
        pushConsoleEntry("info", "browser", "STT VAD: speech end reason=" + endReason + " buffered=" + utteranceBuffer.length + " samples");
        isSpeaking = false;
        flushUtterance();
      }

      if (isSpeaking !== sttLastWasSpeaking) {
        sttLastWasSpeaking = isSpeaking;
        state.stt.isSpeaking = isSpeaking;
        pushConsoleEntry("info", "browser", "STT indicator: " + (isSpeaking ? "speaking" : "silence"));
        updateChatVoiceInputIcons();
      }
    };

    source.connect(sttScriptProcessor);
    if (sttSilentGainNode) {
      sttScriptProcessor.connect(sttSilentGainNode);
      sttSilentGainNode.connect(sttAudioContext.destination);
    }

    pushConsoleEntry("info", "browser", "STT capture ready (sampleRate=" + inputSampleRate + "Hz)");
    pushConsoleEntry(
      "info",
      "browser",
      "STT VAD config: baseThreshold=" + readVadThreshold() +
        ", startFrames=" + readVadStartFrames() +
        ", endFrames=" + readVadEndFrames()
    );
    state.stt.isListening = true;
  } catch (error) {
    console.error("Failed to start audio capture:", error);
    state.stt.status = "error";
    state.stt.message = "Microphone access denied";
    pushConsoleEntry("error", "browser", "STT capture start failed: " + String(error));
  }
}

function stopSttAudioCapture(): void {
  clearVoicePrefillWarmupTimer();
  voicePrefillLastPartial = "";
  voicePrefillStableSinceMs = 0;
  voicePrefillWarmedPartial = "";
  sttFlushPendingUtterance?.();
  sttFlushPendingUtterance = null;

  if (sttScriptProcessor) {
    sttScriptProcessor.disconnect();
    sttScriptProcessor.onaudioprocess = null;
    sttScriptProcessor = null;
  }
  if (sttSilentGainNode) {
    sttSilentGainNode.disconnect();
    sttSilentGainNode = null;
  }
  if (sttAudioContext) {
    sttAudioContext.close();
    sttAudioContext = null;
  }
  if (sttMediaStream) {
    sttMediaStream.getTracks().forEach(track => track.stop());
    sttMediaStream = null;
  }
  sttLastWasSpeaking = false;
  state.stt.isListening = false;
  state.stt.isSpeaking = false;
  pushConsoleEntry("info", "browser", "STT capture: stopped and state reset");
  updateChatVoiceInputIcons();
}

function currentPrimaryPanelRenderState() {
  return {
    displayMode: state.displayMode,
    displayModePreference: state.displayModePreference,
    chatRoutePreference: state.chatRoutePreference,
    showAppResourceCpu: state.showAppResourceCpu,
    showAppResourceMemory: state.showAppResourceMemory,
    showAppResourceNetwork: state.showAppResourceNetwork,
    showBottomEngine: state.showBottomEngine,
    showBottomModel: state.showBottomModel,
    showBottomContext: state.showBottomContext,
    showBottomSpeed: state.showBottomSpeed,
    showBottomTtsLatency: state.showBottomTtsLatency,
    conversationId: state.conversationId,
    messages: state.messages,
    chatReasoningByCorrelation: state.chatReasoningByCorrelation,
    chatThinkingPlacementByCorrelation: state.chatThinkingPlacementByCorrelation,
    chatThinkingExpandedByCorrelation: state.chatThinkingExpandedByCorrelation,
    chatToolRowsByCorrelation: state.chatToolRowsByCorrelation,
    chatToolRowExpandedById: state.chatToolRowExpandedById,
    chatStreamCompleteByCorrelation: state.chatStreamCompleteByCorrelation,
    chatStreaming: state.chatStreaming,
    chatDraft: state.chatDraft,
    chatAttachedFileName: state.chatAttachedFileName,
    chatAttachedFileContent: state.chatAttachedFileContent,
    chatActiveModelId: state.chatActiveModelId,
    chatActiveModelLabel: state.chatActiveModelLabel,
    chatActiveModelCapabilities: state.chatActiveModelCapabilities,
    chatTtsEnabled: state.chatTtsEnabled,
    chatTtsPlaying: state.chatTtsPlaying,
    devices: state.devices,
    apiConnections: state.apiConnections,
    apiFormOpen: state.apiFormOpen,
    apiDraft: state.apiDraft,
    apiEditingId: state.apiEditingId,
    apiMessage: state.apiMessage,
    apiProbeBusy: state.apiProbeBusy,
    apiProbeStatus: state.apiProbeStatus,
    apiProbeMessage: state.apiProbeMessage,
    apiDetectedModels: state.apiDetectedModels,
    conversations: state.conversations,
    chatThinkingEnabled: state.chatThinkingEnabled,
    llamaRuntime: state.llamaRuntime,
    llamaRuntimeSelectedEngineId: state.llamaRuntimeSelectedEngineId,
    llamaRuntimeModelPath: state.llamaRuntimeModelPath,
    llamaRuntimePort: state.llamaRuntimePort,
    llamaRuntimeCtxSize: state.llamaRuntimeCtxSize,
    llamaRuntimeGpuLayers: state.llamaRuntimeGpuLayers,
    llamaRuntimeThreads: state.llamaRuntimeThreads,
    llamaRuntimeBatchSize: state.llamaRuntimeBatchSize,
    llamaRuntimeUbatchSize: state.llamaRuntimeUbatchSize,
    llamaRuntimeTemperature: state.llamaRuntimeTemperature,
    llamaRuntimeTopP: state.llamaRuntimeTopP,
    llamaRuntimeTopK: state.llamaRuntimeTopK,
    llamaRuntimeRepeatPenalty: state.llamaRuntimeRepeatPenalty,
    llamaRuntimeFlashAttn: state.llamaRuntimeFlashAttn,
    llamaRuntimeMmap: state.llamaRuntimeMmap,
    llamaRuntimeMlock: state.llamaRuntimeMlock,
    llamaRuntimeSeed: state.llamaRuntimeSeed,
    llamaRuntimeMaxTokens: state.llamaRuntimeMaxTokens,
    llamaRuntimeBusy: state.llamaRuntimeBusy,
    llamaRuntimeLogs: state.llamaRuntimeLogs,
    modelManagerInstalled: state.modelManagerInstalled,
    modelManagerQuery: state.modelManagerQuery,
    modelManagerCollection: state.modelManagerCollection,
    modelManagerSearchResults: state.modelManagerSearchResults,
    modelManagerBusy: state.modelManagerBusy,
    modelManagerMessage: state.modelManagerMessage,
    modelManagerUnslothUdCatalog: state.modelManagerUnslothUdCatalog,
    modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading,
    stt: state.stt,
    tts: state.tts,
    consoleEntries: state.consoleEntries
  };
}

function renderChatMessagesOnly(): void {
  if (state.sidebarTab !== "chat") return;
  const messagesHost = document.querySelector<HTMLElement>(".messages");
  if (!messagesHost) return;
  const isNearBottom =
    messagesHost.scrollHeight - messagesHost.scrollTop - messagesHost.clientHeight < 36;
  messagesHost.innerHTML = renderChatMessages(currentPrimaryPanelRenderState());
  if (isNearBottom || state.chatStreaming) {
    messagesHost.scrollTop = messagesHost.scrollHeight;
  }
}

function scheduleChatStreamDomUpdate(): void {
  if (chatStreamDomUpdateScheduled) return;
  chatStreamDomUpdateScheduled = true;
  requestAnimationFrame(() => {
    chatStreamDomUpdateScheduled = false;
    renderChatMessagesOnly();
  });
}

function installThinkingToggleDelegation(sendMessage: (text: string) => Promise<void>): void {
  if (chatThinkingDelegationInstalled) return;
  chatThinkingDelegationInstalled = true;
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const toolToggle = target?.closest<HTMLButtonElement>("[data-tool-row-toggle-id]");
    if (toolToggle) {
      const rowId = toolToggle.dataset.toolRowToggleId;
      if (!rowId) return;
      const current = state.chatToolRowExpandedById[rowId] === true;
      state.chatToolRowExpandedById[rowId] = !current;
      if (state.sidebarTab === "chat") {
        renderChatMessagesOnly();
        return;
      }
      renderAndBind(sendMessage);
      return;
    }
    const toggle = target?.closest<HTMLButtonElement>("[data-thinking-toggle-corr]");
    if (!toggle) return;
    const correlationId = toggle.dataset.thinkingToggleCorr;
    if (!correlationId) return;
    const current = state.chatThinkingExpandedByCorrelation[correlationId] === true;
    state.chatThinkingExpandedByCorrelation[correlationId] = !current;
    if (state.sidebarTab === "chat") {
      renderChatMessagesOnly();
      return;
    }
    renderAndBind(sendMessage);
  });
}

function scrollConsoleToBottom(): void {
  const panel = document.querySelector<HTMLElement>(".console-panel");
  if (!panel) return;
  panel.scrollTop = panel.scrollHeight;
}

function attachTopbarInteractions(sendMessage: (text: string) => Promise<void>): void {
  const topbarDragRegion = document.querySelector<HTMLElement>(".topbar-drag-region");
  if (topbarDragRegion && state.runtimeMode === "tauri" && tauriWindowHandle) {
    topbarDragRegion.onpointerdown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      void tauriWindowHandle?.startDragging();
    };
  }
  const toggle = document.querySelector<HTMLButtonElement>("#displayModeToggle");
  if (toggle) {
    toggle.onclick = () => {
      state.displayMode = nextDisplayMode(state.displayMode);
      state.displayModePreference = state.displayMode;
      terminalManager.setDisplayMode(state.displayMode);
      renderAndBind(sendMessage);
    };
  }
  const layoutToggle = document.querySelector<HTMLButtonElement>("#layoutOrientationToggle");
  if (layoutToggle) {
    layoutToggle.onclick = () => {
      state.layoutOrientation =
        state.layoutOrientation === "landscape" ? "portrait" : "landscape";
      renderAndBind(sendMessage);
    };
  }
  const windowMinimizeBtn = document.querySelector<HTMLButtonElement>("#windowMinimizeBtn");
  if (windowMinimizeBtn) {
    windowMinimizeBtn.onclick = async () => {
      try {
        await tauriWindowHandle?.minimize();
      } catch {
        // Ignore in non-Tauri contexts.
      }
    };
  }
  const windowMaximizeBtn = document.querySelector<HTMLButtonElement>("#windowMaximizeBtn");
  if (windowMaximizeBtn) {
    windowMaximizeBtn.onclick = async () => {
      try {
        if (!tauriWindowHandle) return;
        const isMaximized = await tauriWindowHandle.isMaximized();
        if (isMaximized) {
          await tauriWindowHandle.unmaximize();
        } else {
          await tauriWindowHandle.maximize();
        }
      } catch {
        // Ignore in non-Tauri contexts.
      }
    };
  }
  const windowCloseBtn = document.querySelector<HTMLButtonElement>("#windowCloseBtn");
  if (windowCloseBtn) {
    windowCloseBtn.onclick = async () => {
      try {
        await tauriWindowHandle?.close();
      } catch {
        // Ignore in non-Tauri contexts.
      }
    };
  }

  const micEnableBtn = document.querySelector<HTMLButtonElement>("#micPermissionEnableBtn");
  if (micEnableBtn) {
    micEnableBtn.onclick = async () => {
      state.micPermissionBubbleDismissed = false;
      persistMicBubbleDismissed(false);
      await requestMicrophoneAccess();
      renderAndBind(sendMessage);
    };
  }

  const micDismissBtn = document.querySelector<HTMLButtonElement>("#micPermissionDismissBtn");
  if (micDismissBtn) {
    micDismissBtn.onclick = () => {
      state.micPermissionBubbleDismissed = true;
      persistMicBubbleDismissed(true);
      renderAndBind(sendMessage);
    };
  }
}

function attachSidebarInteractions(sendMessage: (text: string) => Promise<void>): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]");

  tabs.forEach((tab) => {
    tab.onclick = async () => {
      const nextTab = tab.dataset.sidebarTab as SidebarTab | undefined;
      if (!nextTab) return;
      state.sidebarTab = nextTab;
      if (nextTab === "llama_cpp") {
        await refreshLlamaRuntime();
      }
      if (nextTab === "apis") {
        await refreshApiConnections();
      }
      if (nextTab === "tts") {
        try {
          await refreshTtsState();
        } catch (error) {
          state.tts.status = "error";
          state.tts.message = `TTS refresh failed: ${String(error)}`;
        }
      }
      renderAndBind(sendMessage);
    };
  });
}

function attachWorkspaceInteractions(sendMessage: (text: string) => Promise<void>): void {
  const workspacePane = document.querySelector<HTMLElement>(".workspace-pane");
  const shellPopover = document.querySelector<HTMLElement>(`#${TERMINAL_UI_ID.shellPopover}`);
  if (workspacePane) {
    const setPrimarySelectionGuard = (enabled: boolean): void => {
      const primaryPane = document.querySelector<HTMLElement>(".primary-pane");
      if (!primaryPane) return;
      primaryPane.classList.toggle("selection-guard", enabled);
    };
    const toolInvokeOrThrow = async (
      toolId: string,
      action: string,
      payload: Record<string, unknown>
    ): Promise<Record<string, unknown>> => {
      if (!clientRef) throw new Error("IPC client unavailable.");
      const response = await clientRef.toolInvoke({
        correlationId: nextCorrelationId(),
        toolId,
        action,
        mode: "sandbox",
        payload
      });
      if (!response.ok) throw new Error(response.error || `${toolId}.${action} failed`);
      return response.data as Record<string, unknown>;
    };

    const readWorkspaceFile = async (path: string): Promise<string> => {
      const correlationId = nextCorrelationId();
      const data = await toolInvokeOrThrow("files", "read-file", {
        correlationId,
        path
      });
      return String(data.content ?? "");
    };

    const writeWorkspaceFile = async (path: string, content: string): Promise<void> => {
      const correlationId = nextCorrelationId();
      await toolInvokeOrThrow("files", "write-file", {
        correlationId,
        path,
        content
      });
    };

    const deleteWorkspacePath = async (path: string, recursive = false): Promise<void> => {
      const correlationId = nextCorrelationId();
      await toolInvokeOrThrow("files", "delete-path", {
        correlationId,
        path,
        recursive
      });
    };
    const workspaceToolManagerActions = createWorkspaceToolManagerActions({
      state,
      nextCorrelationId,
      toolInvokeOrThrow,
      deleteWorkspacePath,
      refreshTools,
      pushConsoleEntry
    });

    const openPathInTerminal = async (path: string): Promise<void> => {
      const trimmed = path.trim();
      if (!trimmed) return;
      const normalized = trimmed.replace(/\\/g, "/");
      const targetDir = normalized.includes(".")
        ? normalized.slice(0, normalized.lastIndexOf("/")) || normalized
        : normalized;
      await ensureTerminalSession();
      const sessionId = state.activeTerminalSessionId;
      if (!sessionId || !clientRef) return;
      await clientRef.sendTerminalInput({
        correlationId: nextCorrelationId(),
        sessionId,
        input: `cd "${targetDir.replaceAll('"', '\\"')}"\n`
      });
      state.workspaceTab = "terminal";
    };

    const flowPlanExists = async (): Promise<boolean> => {
      const candidate = state.flowPlanPath?.trim() || "IMPLEMENTATION_PLAN.md";
      try {
        const content = await readWorkspaceFile(candidate);
        return content.trim().length > 0;
      } catch {
        return false;
      }
    };

    const maybeOpenFlowProjectSetup = async (): Promise<void> => {
      if (state.flowProjectSetupDismissed) return;
      if (state.flowProjectSetupOpen) return;
      const exists = await flowPlanExists();
      if (exists) return;
      state.flowProjectSetupOpen = true;
      if (!state.flowProjectNameDraft.trim()) {
        const root = (state.filesRootPath || "").trim();
        const fallback = root.split("/").filter(Boolean).at(-1) || "new-project";
        state.flowProjectNameDraft = fallback;
      }
    };

    const workspaceToolDeps = {
      flow: {
        refreshRuns: refreshFlowRuns,
        startRun: workspaceToolsRuntime.startFlowRun,
        stopRun: workspaceToolsRuntime.stopFlowRun,
        setPaused: workspaceToolsRuntime.setFlowPaused,
        nudgeRun: workspaceToolsRuntime.nudgeFlowRun,
        resumeRun: workspaceToolsRuntime.resumeFlowRun,
        retryRun: workspaceToolsRuntime.retryFlowRun,
        rerunValidation: workspaceToolsRuntime.rerunFlowValidation,
        openPhaseTerminal: async (phase: string) => {
          if (!FLOW_TERMINAL_PHASES.includes(phase as (typeof FLOW_TERMINAL_PHASES)[number])) return;
          const existing = state.flowPhaseSessionByName[phase];
          const stillExists = existing
            ? terminalManager.listSessions().some((session) => session.sessionId === existing)
            : false;
          const sessionId =
            stillExists && existing
              ? existing
              : await createTerminalSessionForProfile(terminalManager, state.terminalShellProfile);
          state.flowPhaseSessionByName = {
            ...state.flowPhaseSessionByName,
            [phase]: sessionId
          };
          state.activeTerminalSessionId = sessionId;
          state.flowActiveTerminalPhase = phase;
          persistFlowPhaseSessionMap(state.flowPhaseSessionByName);
          persistFlowActivePhase(state.flowActiveTerminalPhase);
        },
        closePhaseTerminal: async (phase: string) => {
          const sessionId = state.flowPhaseSessionByName[phase];
          if (!sessionId) return;
          await terminalManager.closeSession(sessionId);
          const nextMap = { ...state.flowPhaseSessionByName };
          delete nextMap[phase];
          state.flowPhaseSessionByName = nextMap;
          if (state.activeTerminalSessionId === sessionId) {
            state.activeTerminalSessionId = terminalManager.listSessions()[0]?.sessionId ?? null;
          }
          persistFlowPhaseSessionMap(state.flowPhaseSessionByName);
        },
        createProjectSetup: async (name: string, projectType: string, description: string) => {
          const projectName = name.trim() || "new-project";
          const summary = description.trim();
          const planPath = state.flowPlanPath?.trim() || "IMPLEMENTATION_PLAN.md";
          const promptPlanPath = state.flowPromptPlanPath?.trim() || "PROMPT_plan.md";
          const promptBuildPath = state.flowPromptBuildPath?.trim() || "PROMPT_build.md";
          await workspaceToolsRuntime.createNewFilesFolder("specs").catch(() => undefined);

          const planBody = `# Implementation Plan\n\nProject: ${projectName}\nType: ${projectType}\n${summary ? `Description: ${summary}\n` : ""}\n## Initial Tasks\n- [ ] Define project scope and first milestone\n- [ ] Scaffold baseline structure and dependencies\n- [ ] Implement first end-to-end vertical slice\n- [ ] Add/verify validation command coverage\n`;
          const planPrompt = `You are planning implementation tasks for a ${projectType} project.\nProject name: ${projectName}\n${summary ? `Project description: ${summary}\n` : ""}Create concise, testable checklist items in ${planPath}.`;
          const buildPrompt = `You are executing implementation tasks for a ${projectType} project.\nProject name: ${projectName}\n${summary ? `Project description: ${summary}\n` : ""}Implement one unchecked task from ${planPath}, then validate and update the plan.`;
          const specSeed = `# ${projectName}\n\nType: ${projectType}\n\n${summary || "Describe goals, constraints, and first release scope."}\n`;
          const readme = `# ${projectName}\n\nType: ${projectType}\n\n${summary || "Project scaffold created from Flow setup."}\n\n## Next Steps\n- Review IMPLEMENTATION_PLAN.md\n- Run Flow in dry mode for rehearsal\n- Run Flow in build mode for first task\n`;

          await writeWorkspaceFile(planPath, planBody);
          await writeWorkspaceFile(promptPlanPath, planPrompt);
          await writeWorkspaceFile(promptBuildPath, buildPrompt);
          await writeWorkspaceFile("specs/overview.md", specSeed);
          await writeWorkspaceFile("README.md", readme).catch(() => undefined);

          state.flowProjectSetupOpen = false;
          state.flowProjectSetupDismissed = false;
          state.flowMessage = `Project scaffold created for '${projectName}'.`;
        }
      },
      files: {
        listFilesDirectory: workspaceToolsRuntime.listFilesDirectory,
        selectFilesPath: workspaceToolsRuntime.selectFilesPath,
        toggleFilesNode: workspaceToolsRuntime.toggleFilesNode,
        openFilesFile: workspaceToolsRuntime.openFilesFile,
        activateFilesTab: workspaceToolsRuntime.activateFilesTab,
        closeFilesTab: workspaceToolsRuntime.closeFilesTab,
        updateFilesBuffer: workspaceToolsRuntime.updateFilesBuffer,
        saveActiveFilesTab: workspaceToolsRuntime.saveActiveFilesTab,
        saveActiveFilesTabAs: workspaceToolsRuntime.saveActiveFilesTabAs,
        saveAllFilesTabs: workspaceToolsRuntime.saveAllFilesTabs,
        createNewFilesFile: workspaceToolsRuntime.createNewFilesFile,
        createNewFilesFolder: workspaceToolsRuntime.createNewFilesFolder,
        duplicateActiveFilesTab: workspaceToolsRuntime.duplicateActiveFilesTab,
        deleteFilesPath: workspaceToolsRuntime.deleteFilesPath,
        renameFilesPath: workspaceToolsRuntime.renameFilesPath,
        pasteFilesClipboard: workspaceToolsRuntime.pasteFilesClipboard,
        undoLastFilesDelete: workspaceToolsRuntime.undoLastFilesDelete,
        openPathInTerminal
      },
      web: {
        runWebSearch: workspaceToolsRuntime.runWebSearch,
        createAndActivateWebTab: workspaceToolsRuntime.createAndActivateWebTab,
        ensureTerminalSession,
        persistWebSearchHistory,
        withActiveWebTab: workspaceToolsRuntime.withActiveWebTab,
        saveWebSearchSetup: workspaceToolsRuntime.saveWebSearchSetup
      },
      createTool: {
        createScaffold: workspaceToolsRuntime.createToolScaffold,
        browseIcons: workspaceToolsRuntime.browseCreateToolIcons,
        generatePrd: workspaceToolsRuntime.generateCreateToolPrd,
        generatePrdSection: async (section: CreateToolPrdSection, onUpdate?: () => void) => {
          await workspaceToolsRuntime.generateCreateToolPrdSection(section, () => {
            onUpdate?.();
            renderAndBind(sendMessage);
          });
        },
        runPrdReview: workspaceToolsRuntime.runCreateToolPrdReview,
        generateDevPlan: workspaceToolsRuntime.generateCreateToolDevPlan,
        registerTool: workspaceToolsRuntime.registerCreateToolInWorkspace
      }
    };
    workspacePane.onclick = async (event) => {
      const prelude = await handleWorkspacePaneClickPrelude({
        state,
        event,
        workspaceToolTargetSelector: WORKSPACE_TOOL_TARGET_SELECTOR,
        rerender: () => renderAndBind(sendMessage),
        isWorkspaceTab,
        ensureTerminalSession,
        refreshTools,
        onWorkspaceTabActivated: async (workspaceTab) => {
          await handleWorkspaceToolTabActivation(workspaceTab as WorkspaceTab, state, {
            ensureWebTabs: workspaceToolsRuntime.ensureWebTabs,
            refreshApiConnections,
            hasVerifiedSearchConnection: workspaceToolsRuntime.hasVerifiedSearchConnection,
            ensureFilesExplorerLoaded: workspaceToolsRuntime.ensureFilesExplorerLoaded,
            refreshFlowRuns
          });
        },
        maybeOpenFlowProjectSetup,
        dispatchWorkspaceToolClick: async (target) => dispatchWorkspaceToolClick(target, state, workspaceToolDeps),
        persistFlowWorkspacePrefs: () => persistFlowWorkspacePrefs(state)
      });
      if (prelude.handled) return;
      const target = prelude.target;
      if (!target) return;

      if (
        await handleManagerAndTerminalClick({
          state,
          target,
          event,
          shellPopover,
          clientRef,
          nextCorrelationId,
          refreshTools,
          pushConsoleEntry,
          rerender: () => renderAndBind(sendMessage),
          persistFlowPhaseSessionMap,
          terminalManager,
          closeTerminalSessionAndPickNext,
          createTerminalSessionForProfile,
          workspaceToolManagerActions
        })
      ) {
        return;
      }
    };
    workspacePane.onmousedown = (event) => {
      if (event.button === 0) {
        setPrimarySelectionGuard(true);
      }
      const rawTarget = event.target as HTMLElement | null;
      if (state.workspaceTab === "flow-tool" && rawTarget?.closest(".flow-splitter")) {
        flowSplitDragActive = true;
        workspacePane.querySelector<HTMLElement>(".flow-workspace")?.classList.add("is-resizing");
        event.preventDefault();
        return;
      }
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        WORKSPACE_TOOL_TARGET_SELECTOR
      );
      if (!target) return;
      dispatchWorkspaceToolPointerDown(event, target, state);
    };
    workspacePane.oncontextmenu = (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (dispatchWorkspaceToolContextMenu(event, target, state)) {
        renderAndBind(sendMessage);
      }
    };
    workspacePane.onmousemove = (event) => {
      if (flowSplitDragActive && state.workspaceTab === "flow-tool") {
        if (event.buttons === 0) {
          flowSplitDragActive = false;
          workspacePane.querySelector<HTMLElement>(".flow-workspace")?.classList.remove("is-resizing");
          return;
        }
        const workspace = workspacePane.querySelector<HTMLElement>(".flow-workspace");
        if (workspace) {
          const rect = workspace.getBoundingClientRect();
          const offset = event.clientY - rect.top;
          const percent = Math.round((offset / Math.max(1, rect.height)) * 100);
          const next = Math.max(28, Math.min(78, percent));
          if (next !== state.flowWorkspaceSplit) {
            state.flowWorkspaceSplit = next;
            persistFlowWorkspacePrefs(state);
            renderAndBind(sendMessage);
          }
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (dispatchWorkspaceToolMouseMove(target, state)) {
        renderAndBind(sendMessage);
      }
    };
    workspacePane.onmouseup = () => {
      flowSplitDragActive = false;
      workspacePane.querySelector<HTMLElement>(".flow-workspace")?.classList.remove("is-resizing");
      setPrimarySelectionGuard(false);
    };
    workspacePane.onmouseleave = () => {
      flowSplitDragActive = false;
      workspacePane.querySelector<HTMLElement>(".flow-workspace")?.classList.remove("is-resizing");
      setPrimarySelectionGuard(false);
    };
    bindWorkspaceToolDelegatedEvents({
      workspacePane,
      state,
      workspaceToolDeps,
      managerToggleAttr: MANAGER_DATA_ATTR.toggleToolId,
      managerToggleIconAttr: MANAGER_DATA_ATTR.toggleToolIconId,
      clientRef,
      nextCorrelationId,
      refreshTools,
      dispatchWorkspaceToolChange,
      dispatchWorkspaceToolSubmit,
      dispatchWorkspaceToolInput,
      dispatchWorkspaceToolKeyDown,
      dispatchWorkspaceToolDoubleClick,
      persistCreateToolDraft: () => persistCreateToolDraft(state),
      persistFlowWorkspacePrefs: () => persistFlowWorkspacePrefs(state),
      rerender: () => renderAndBind(sendMessage)
    });
  }
  if (shellPopover) {
    shellPopover.onclick = (event) => {
      event.stopPropagation();
    };
  }

  void renderChartCanvasIfNeeded(sendMessage);

  mountWorkspaceTerminalHosts(state, terminalManager, persistFlowPhaseSessionMap);
  bindConsoleInteractions({
    consoleEntries: state.consoleEntries,
    consoleView: state.consoleView,
    setConsoleView: (view) => {
      state.consoleView = view;
    },
    pushConsoleEntry,
    rerender: () => renderAndBind(sendMessage)
  });

}

async function ensureTerminalSession(): Promise<void> {
  state.activeTerminalSessionId = await ensureTerminalSessionForProfile(
    terminalManager,
    state.activeTerminalSessionId,
    state.terminalShellProfile
  );
}

async function bootstrap(): Promise<void> {
  installConsoleCapture();
  let sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void> = async () => {
    // Initialized after bootstrap wiring.
  };
  const { client, runtimeMode } = await createChatIpcClient();
  clientRef = client;
  tauriWindowHandle = await syncBootstrapRuntime({
    client,
    runtimeMode,
    state,
    fallbackAppVersion: FALLBACK_APP_VERSION,
    persistSttBackend,
    persistSttModel
  });
  terminalManager.setClient(client);
  terminalManager.setDisplayMode(state.displayMode);

  await runCoreBootstrapSteps({
    refreshConversations,
    refreshTools,
    refreshFlowRuns,
    refreshApiConnections,
    refreshTtsState,
    onTtsBootstrapError: (error) => {
      state.tts.status = "error";
      state.tts.message = `TTS bootstrap failed: ${String(error)}`;
    },
    refreshDevicesState,
    refreshLlamaRuntime,
    refreshModelManagerInstalled,
    shouldRefreshUnslothUdCatalog: () => state.modelManagerCollection === "unsloth_ud",
    refreshModelManagerUnslothUdCatalog,
    autoStartLlamaRuntimeIfConfigured,
    loadConversation: () => loadConversation(state.conversationId)
  });

  appResourcePolling.restart(1000);

  window.addEventListener("beforeunload", () => {
    appResourcePolling.stop();
    stopTtsPlaybackLocal();
    void terminalManager.closeAll();
  });
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      void refreshDevicesState().then(() => renderAndBind(sendMessage));
    });
  }
  await installTauriSttListeners({
    runtimeMode,
    state,
    sttPipelineErrorUnlisten,
    sttVadUnlisten,
    setSttPipelineErrorUnlisten: (value) => {
      sttPipelineErrorUnlisten = value;
    },
    setSttVadUnlisten: (value) => {
      sttVadUnlisten = value;
    },
    nextCorrelationId,
    pushConsoleEntry,
    rerender: () => renderAndBind(sendMessage),
    onVadSpeakingChanged: (isSpeaking) => {
      sttLastWasSpeaking = isSpeaking;
      updateChatVoiceInputIcons();
    }
  });

  const scheduleFlowRunsRefresh = createFlowRunsRefreshScheduler({
    refresh: refreshFlowRuns,
    onRefreshed: () => renderAndBind(sendMessage),
    delayMs: 250
  });

  const maybeHandleFlowPhaseTerminalEvent = createFlowPhaseTerminalEventHandler({
    state,
    terminalManager,
    flowTerminalPhases: FLOW_TERMINAL_PHASES,
    createTerminalSessionForProfile,
    persistFlowWorkspacePrefs: () => persistFlowWorkspacePrefs(state),
    persistFlowPhaseSessionMap
  });

  registerClientEventBridge({
    client,
    handleCoreEvent: (event) => {
      if (event.action === "chart.definition.set") {
        const payload = payloadAsRecord(event.payload);
        const definition = typeof payload?.definition === "string" ? payload.definition.trim() : "";
        if (definition) {
          state.chartSource = definition;
          state.chartRenderSource = definition;
          state.chartError = null;
          state.workspaceTab = "chart-tool";
          chartLastRenderedSource = null;
          renderAndBind(sendMessage);
        }
        return true;
      }
      return handleCoreAppEvent(event, {
        onChatTtsStreamChunkEvent,
        formatAgentEventLine,
        pushConsoleEntry,
        safePayloadPreview,
        terminalManager,
        renderAndBind: () => renderAndBind(sendMessage),
        resolveChatTtsStreamWaiters,
        extractRuntimeProcessLine,
        updateRuntimeMetricsFromLine,
        formatRuntimeEventLine,
        refreshLlamaRuntime,
        state,
        applyFlowRuntimeEvent: (eventItem) => applyFlowRuntimeEvent(state, eventItem, scheduleFlowRunsRefresh),
        maybeHandleFlowPhaseTerminalEvent
      });
    },
    handleChatEvent: (event) =>
      handleChatStreamEvent(event, {
        isCurrentChatCorrelation,
        state,
        setChatTtsStopRequested: (value) => {
          chatTtsStopRequested = value;
        },
        getVoicePipelineState: () => voicePipelineState,
        setVoicePipelineState,
        resetChatTtsStreamParser,
        flushChatStreamForTts: (correlationId) => flushChatStreamForTts(sendMessage, correlationId),
        scheduleChatStreamDomUpdate,
        parseAgentToolPayload,
        ensureAssistantMessageForCorrelation,
        ensureToolIntentRow,
        appendChatToolRow: (correlationId, row) => appendChatToolRow(correlationId, row as any),
        toolIconName,
        toolTitleName,
        parseStreamChunk,
        parseReasoningStreamChunk,
        updateAssistantDraft,
        ingestChatStreamForTts: (correlationId, delta) => ingestChatStreamForTts(sendMessage, correlationId, delta),
        updateReasoningDraft,
        renderAndBind: () => renderAndBind(sendMessage)
      })
  });

  sendMessage = initializeSendMessageBinding({
    getClientRef: () => clientRef,
    state,
    nextCorrelationId,
    normalizeChatText,
    clearVoicePrefillState: () => {
      clearVoicePrefillWarmupTimer();
      voicePrefillLastPartial = "";
      voicePrefillStableSinceMs = 0;
      voicePrefillWarmedPartial = "";
    },
    chatTtsLatencyCapturedByCorrelation,
    chatTtsSawStreamDeltaByCorrelation,
    postprocessSpeakableText,
    extractSpeakableStreamDelta,
    enqueueImmediateTtsChunk: (text, correlationId) => {
      chatTtsQueue.push({ text, correlationId });
      notifyChatTtsQueueAvailable();
    },
    enqueueSpeakableChunk,
    runChatTtsQueue,
    refreshConversations,
    renderAndBind
  }, (boundSendMessage) => {
    appResourceRenderSendMessageRef = boundSendMessage;
  });

  installCustomToolBridge(sendMessage);
  renderAndBind(sendMessage);
  installThinkingToggleDelegation(sendMessage);
}

function installConsoleCapture(): void {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;

  const originals = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  console.log = (...args: unknown[]) => {
    originals.log(...args);
    pushConsoleEntry("log", "browser", stringifyConsoleArgs(args));
  };
  console.info = (...args: unknown[]) => {
    originals.info(...args);
    pushConsoleEntry("info", "browser", stringifyConsoleArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    originals.warn(...args);
    pushConsoleEntry("warn", "browser", stringifyConsoleArgs(args));
  };
  console.error = (...args: unknown[]) => {
    originals.error(...args);
    pushConsoleEntry("error", "browser", stringifyConsoleArgs(args));
  };
  console.debug = (...args: unknown[]) => {
    originals.debug(...args);
    pushConsoleEntry("debug", "browser", stringifyConsoleArgs(args));
  };
}

function stringifyConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function safePayloadPreview(payload: AppEvent["payload"]): string {
  try {
    if (payload === null) return "null";
    if (typeof payload === "object") return JSON.stringify(payload);
    return String(payload);
  } catch {
    return "<unserializable>";
  }
}

bootstrap().catch((error) => {
  state.events.push({
    timestampMs: Date.now(),
    correlationId: "bootstrap",
    subsystem: "frontend",
    action: "app.bootstrap",
    stage: "error",
    severity: "error",
    payload: { message: String(error) }
  });
  render();
  attachDividerResize();
});

function attachDividerResize(): void {
  const root = document.querySelector<HTMLElement>(".app-frame");
  if (!root) return;

  if (state.layoutOrientation === "portrait") {
    const portraitLayout = document.querySelector<HTMLElement>("#portraitLayout");
    const portraitDivider = document.querySelector<HTMLDivElement>("#portraitPaneDivider");
    if (!portraitLayout || !portraitDivider) return;

    portraitDivider.onpointerdown = (event) => {
      event.preventDefault();
      portraitDivider.classList.add("dragging");
      portraitDivider.setPointerCapture(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const bounds = portraitLayout.getBoundingClientRect();
        const rawPercent = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
        const clamped = Math.max(26, Math.min(74, rawPercent));
        state.portraitWorkspacePercent = Number(clamped.toFixed(2));
        root.style.setProperty("--portrait-workspace-percent", String(state.portraitWorkspacePercent));
      };

      const onUp = (upEvent: PointerEvent) => {
        portraitDivider.classList.remove("dragging");
        portraitDivider.releasePointerCapture(upEvent.pointerId);
        portraitDivider.removeEventListener("pointermove", onMove);
        portraitDivider.removeEventListener("pointerup", onUp);
        portraitDivider.removeEventListener("pointercancel", onUp);
      };

      portraitDivider.addEventListener("pointermove", onMove);
      portraitDivider.addEventListener("pointerup", onUp);
      portraitDivider.addEventListener("pointercancel", onUp);
    };
    return;
  }

  const split = document.querySelector<HTMLDivElement>("#splitLayout");
  const divider = document.querySelector<HTMLDivElement>("#paneDivider");
  if (!split || !divider) return;

  divider.onpointerdown = (event) => {
    event.preventDefault();
    divider.classList.add("dragging");
    divider.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const bounds = split.getBoundingClientRect();
      const rawPercent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      const clamped = Math.max(22, Math.min(78, rawPercent));
      state.chatPanePercent = Number(clamped.toFixed(2));
      root.style.setProperty("--chat-pane-percent", String(state.chatPanePercent));
    };

    const onUp = (upEvent: PointerEvent) => {
      divider.classList.remove("dragging");
      divider.releasePointerCapture(upEvent.pointerId);
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      divider.removeEventListener("pointercancel", onUp);
    };

    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
    divider.addEventListener("pointercancel", onUp);
  };
}
