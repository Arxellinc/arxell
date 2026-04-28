import "./styles.css";
import "xterm/css/xterm.css";
import type {
  ApiConnectionProbeRequest,
  ApiConnectionRecord,
  AppResourceUsageResponse,
  AppEvent,
  ChatAttachment,
  ChatContextBreakdownItem,
  ChatStreamChunkPayload,
  ChatStreamReasoningChunkPayload,
  ConversationSummaryRecord,
  FilesListDirectoryEntry,
  LlamaRuntimeStatusResponse,
  ModelManagerHfCandidate,
  ModelManagerInstalledModel,
  PersistedVoiceSettings,
  TtsSpeakResponse,
  DuplexMode,
  HandoffState,
  SpeculationState,
  VadManifest,
  VoiceRuntimeState,
  WorkspaceToolRecord
} from "./contracts";
import { iconHtml } from "./icons";
import type { IconName } from "./icons";
import { APP_ICON } from "./icons/map";
import type { ChatIpcClient } from "./ipcClient";
import { createChatIpcClient } from "./ipcClient";
import type { ChatPanelState } from "./panels/types";
import {
  BOTTOMBAR_RESOURCE_IDS,
  bindPaneMenu,
  isWorkspaceTab,
  renderGlobalBottombar,
  renderGlobalTopbar,
  renderSidebarRail,
  renderWorkspacePane
} from "./layout";
import { attachPrimaryPanelInteractions, getPanelDefinition } from "./panels";
import { bindChatPanel } from "./panels/chatPanel";
import type {
  ApiConnectionDraft,
  ChatToolEventRow,
  DevicesState,
  SidebarTab,
  UiMessage,
  AvatarMeshSetting
} from "./panels/types";
import { defaultAvatarMeshes } from "./panels/types";
import type { AvatarMorphSetting, AvatarBoneSetting } from "./panels/types";
import { AVATAR_MORPHS, AVATAR_ARM_BONES } from "./panels/types";
import type { DisplayMode, LayoutOrientation, WorkspaceTab } from "./layout";
import { escapeHtml } from "./panels/utils";
import { renderHighlightedCode } from "./tools/notepad/shared";
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
import { applyLooperRuntimeEvent } from "./tools/host/looperEvents";
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
import { handleWorkspaceToolTabActivation } from "./tools/host/workspaceLifecycle";
import { createWorkspaceToolsRuntime } from "./tools/host/workspaceRuntime";
import { buildWorkspaceToolViews } from "./tools/host/viewBuilder";
import {
  createWebTab,
  loadPersistedWebSearchHistory,
  persistWebSearchHistory
} from "./tools/webSearch/runtime";
import type { WebSearchHistoryItem, WebTabState } from "./tools/webSearch/state";
import type { FilesDeleteUndoEntry } from "./tools/files/state";
import { getInitialOpenCodeState } from "./tools/opencode/state";
import type { OpenCodeToolState } from "./tools/opencode/state";
import { checkOpenCodeInstalled, spawnAgent } from "./tools/opencode/actions";
import type { OpenCodeActionsDeps } from "./tools/opencode/actions";
import { OPENCODE_UI_ID } from "./tools/ui/constants";
import { getInitialLooperState } from "./tools/looper/state";
import type { LooperToolState } from "./tools/looper/state";
import { ensureLooperInit } from "./tools/looper/actions";
import type { LooperActionsDeps } from "./tools/looper/actions";
import { LOOPER_UI_ID } from "./tools/ui/constants";
import {
  activateDocsTab,
  closeDocsTab,
  createNewDocsFile,
  ensureDocsLoaded,
  listDocsDirectory,
  openDocsFile,
  saveActiveDocsTab,
  saveActiveDocsTabAs,
  saveAllDocsTabs,
  selectDocsPath,
  toggleDocsNode,
  updateDocsBuffer
} from "./tools/docs/actions";
import { getInitialSheetsState } from "./tools/sheets/state";
import type { SheetsToolState } from "./tools/sheets/state";
import { mountSheetsRuntime, unmountSheetsRuntime } from "./tools/sheets/canvas/mount";
import { persistTasksById } from "./tools/tasks/actions";
import type { TaskFolder, TaskSortDirection, TaskSortKey, TaskRecord } from "./tools/tasks/state";
import {
  loadPersistedProjectsById,
  createProject,
  deleteProject,
  updateProjectField,
  persistProjectsById,
  loadChatProjectMap,
  setChatProjectId,
  getChatProjectId,
  persistChatProjectMap,
  type ProjectRecord
} from "./projectsStore";
import { ensureUserProject } from "./projects";
import { KOKORO_BUNDLE_OPTIONS, resetTtsStateForEngine, type TtsEngine } from "./tts/engineRules";
import { getAllToolManifests } from "./tools/registry";
import { renderChatMessages } from "./panels/chatPanel";
import { renderAvatarPreview } from "./panels/avatarPanel";
import { buildPhonemeTimeline } from "./avatar/phonemeUtils";
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
  loadMicBubbleDismissed,
  loadPersistedBottomItem,
  loadPersistedChatModelId,
  loadPersistedChatRoutePreference,
  loadPersistedMemoryAlwaysLoadTools,
  loadPersistedMemoryAlwaysLoadSkills,
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
  persistMemoryAlwaysLoadTools,
  persistMemoryAlwaysLoadSkills,
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
  loadPersistedWorkspaceTab,
  persistWorkspaceTab,
  loadPersistedModelManagerDisabledModelIds,
  persistModelManagerDisabledModelIds,
  type ChatRoutePreference,
  type SttBackend
} from "./app/persistence";
import { createAppResourcePolling } from "./app/polling";
import { runCoreBootstrapSteps } from "./app/bootstrap";
import {
  createInitialDocsState,
  createInitialFilesState,
  createInitialFlowState,
  createInitialMemoryState,
  createInitialNotepadState,
  createInitialSkillsFileState,
  createInitialTasksState,
  defaultApiConnectionDraft,
  defaultDevicesState,
  selectDocsToolState,
  selectFilesToolState,
  selectFlowToolState,
  selectMemoryToolState,
  selectNotepadToolState,
  selectSkillsToolState,
  selectTasksToolState,
  type FlowPhaseTranscriptEntry,
  type FlowRerunValidationResult,
  type FlowRunView
} from "./app/state";
import {
  buildBottomStatus,
  buildConversationMarkdown,
  composeAppBodyHtml,
  composeAppFrameHtml,
  composePrimaryPaneHtml,
  conversationMarkdownFilename,
  formatBytesShort,
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
const chatPaneDomUpdatesPending = new Set<string>();
let chatThinkingDelegationInstalled = false;
let customToolBridgeInstalled = false;
let tauriWindowHandle: TauriWindowHandle | null = null;
const FALLBACK_APP_VERSION = normalizeVersionLabel(APP_BUILD_VERSION);
let preferredChatModelId = loadPersistedChatModelId();
const initialWorkspaceTabCandidate = loadPersistedWorkspaceTab("tasks-tool");
const initialWorkspaceTab = initialWorkspaceTabCandidate === "flow-tool"
  ? "events"
  : initialWorkspaceTabCandidate === "skills-tool"
  ? "memory-tool"
  : isWorkspaceTab(initialWorkspaceTabCandidate)
  ? initialWorkspaceTabCandidate
  : "events";
const FIRST_RUN_ONBOARDING_DISMISSED_KEY = "arxell.firstRunOnboarding.dismissed";
type FirstRunOnboardingStep = "welcome" | "model" | "tts";
interface FirstRunModelOption {
  id: string;
  name: string;
  size: string;
  description: string;
  repoId?: string;
  fileName?: string;
  custom?: boolean;
}
const FIRST_RUN_MODEL_OPTIONS: FirstRunModelOption[] = [
  {
    id: "qwen35-2b",
    name: "Qwen3.5 2B",
    size: "~2 GB",
    description: "Fast startup option for lower-end hardware and responsive voice mode.",
    repoId: "unsloth/Qwen3.5-2B-GGUF",
    fileName: "Qwen3.5-2B-UD-Q4_K_XL.gguf"
  },
  {
    id: "qwen35-4b",
    name: "Qwen3.5 4B",
    size: "~4 GB",
    description: "Balanced baseline for everyday chat and tool-assisted work.",
    repoId: "unsloth/Qwen3.5-4B-GGUF",
    fileName: "Qwen3.5-4B-UD-Q4_K_XL.gguf"
  },
  {
    id: "gpt-oss-20b",
    name: "GPT-OSS 20B",
    size: "~13 GB",
    description: "Higher quality output for machines with more memory.",
    repoId: "Arxell/gpt-oss-20b-MXFP4",
    fileName: "gpt-oss-20b-MXFP4.gguf"
  },
  {
    id: "custom-gguf",
    name: "Select Custom GGUF",
    size: "Local file",
    description: "Use an existing .gguf model already on this machine.",
    custom: true
  }
];

function loadFirstRunOnboardingDismissed(): boolean {
  try {
    return window.localStorage.getItem(FIRST_RUN_ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistFirstRunOnboardingDismissed(): void {
  try {
    window.localStorage.setItem(FIRST_RUN_ONBOARDING_DISMISSED_KEY, "1");
  } catch {}
}
type ConsoleView = "all" | "errors-warnings" | "security-events";
type DisplayModePreference = DisplayMode | "system" | "terminal";
const FLOW_TERMINAL_PHASES: string[] = [];
type AvatarRuntimeModule = typeof import("./avatar/wireframeRuntime");
let avatarRuntimePromise: Promise<AvatarRuntimeModule> | null = null;
let avatarMeshTextureTargetKey = "";
let avatarRuntimeModule: AvatarRuntimeModule | null = null;

function loadAvatarRuntime(): Promise<AvatarRuntimeModule> {
  if (avatarRuntimeModule) return Promise.resolve(avatarRuntimeModule);
  avatarRuntimePromise ??= import("./avatar/wireframeRuntime").then((mod) => {
    avatarRuntimeModule = mod;
    return mod;
  });
  return avatarRuntimePromise;
}

function mountAvatarStagesIfNeeded(): void {
  if (!state.avatar.active || state.avatar.assetKind !== "glb") {
    avatarRuntimeModule?.disposeAvatarStages();
    return;
  }
  void loadAvatarRuntime().then((mod) => mod.mountAvatarStages());
}

interface PreservedAvatarPreview {
  element: HTMLElement;
  key: string;
}

function avatarPreviewPreserveKey(element: HTMLElement): string {
  const stage = element.querySelector<HTMLElement>("[data-avatar-stage]");
  return JSON.stringify({
    className: element.className,
    style: element.getAttribute("style") || "",
    imageSrc: element.querySelector<HTMLImageElement>(".avatar-preview-image")?.src || "",
    stage: stage
      ? {
          assetKind: stage.dataset.avatarAssetKind || "",
          assetUrl: stage.dataset.avatarAssetUrl || "",
          assetName: stage.dataset.avatarAssetName || "",
          meshSettings: stage.dataset.avatarMeshSettings || "",
          bgColor: stage.dataset.avatarBgColor || "",
          bgOpacity: stage.dataset.avatarBgOpacity || "",
          morphs: stage.dataset.avatarMorphs || "",
          armBones: stage.dataset.avatarArmBones || ""
        }
      : null
  });
}

function preserveAvatarPreviewBeforeRender(): PreservedAvatarPreview | null {
  const element = document.querySelector<HTMLElement>(".avatar-preview");
  if (!element) return null;
  return { element, key: avatarPreviewPreserveKey(element) };
}

function restoreAvatarPreviewAfterRender(preserved: PreservedAvatarPreview | null): void {
  if (!preserved) return;
  const next = document.querySelector<HTMLElement>(".avatar-preview");
  if (!next || avatarPreviewPreserveKey(next) !== preserved.key) return;
  next.replaceWith(preserved.element);
}

function updateAvatarSpeechState(active: boolean, amplitude: number): void {
  avatarRuntimeModule?.setAvatarSpeechState({ active, amplitude });
}

function updateAvatarPhonemeTimeline(
  text: string | null,
  durationMs: number,
): void {
  if (!text || !avatarRuntimeModule) return;
  const timeline = buildPhonemeTimeline(text, durationMs);
  if (timeline.length > 0) {
    avatarRuntimeModule.setAvatarPhonemeTimeline(timeline);
  }
}

function clearAvatarPhonemeTimeline(): void {
  avatarRuntimeModule?.setAvatarPhonemeTimeline(null);
}

function filterFlowEvents(_events: AppEvent[], _filter: string, _limit: number): { forInspector: AppEvent[]; forRender: AppEvent[] } {
  return { forInspector: [], forRender: [] };
}

function normalizeFlowRunView(run: { runId: string }): FlowRunView {
  return { runId: run.runId };
}

function persistFlowPhaseSessionMap(_map: Record<string, string>): void {}
function persistFlowActivePhase(_phase: string): void {}
function persistFlowWorkspacePrefs(_state: unknown): void {}
function loadPersistedFlowActivePhase(): string { return ""; }
function loadPersistedFlowAdvancedOpen(): boolean { return false; }
function loadPersistedFlowAutoFollow(): boolean { return false; }
function loadPersistedFlowBottomPanel(): "terminal" | "validate" | "events" { return "events"; }
function loadPersistedFlowPhaseSessionMap(): Record<string, string> { return {}; }
function loadPersistedFlowSplit(): number { return 50; }

async function refreshFlowRunsFromToolInvoke(_state: unknown, _deps: unknown): Promise<void> {}
function createFlowRunsRefreshScheduler(_deps: {
  refresh: () => Promise<void>;
  onRefreshed?: () => void;
  delayMs?: number;
}): () => void {
  return () => {};
}
function applyFlowRuntimeEvent(_state: unknown, _event: AppEvent, _scheduleRefresh: () => void): void {}
function createFlowPhaseTerminalEventHandler(_deps: unknown): (event: AppEvent) => boolean {
  return () => false;
}
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
  allModelsList: ChatModelOption[];
  chatTtsEnabled: boolean;
  chatTtsPlaying: boolean;
  activeChatCorrelationId: string | null;
  chatSplitMode: "none" | "vertical" | "horizontal";
  chatSplitPercent: number;
  chatPanels: ChatPanelState[];
  avatar: {
    active: boolean;
    placement: "chat" | "tools";
    maximized: boolean;
    assetKind: "image" | "glb";
    assetName: string | null;
    assetUrl: string;
    meshes: AvatarMeshSetting[];
    morphs: AvatarMorphSetting[];
    armBones: AvatarBoneSetting[];
    bgColor: string;
    bgOpacity: number;
    borderSize: number;
    borderColor: string;
  };
  avatarActiveTab: "appearance" | "animation";
  avatarLipSyncStrength: number;
  avatarLipSyncJawBlend: number;
  devices: DevicesState;
  apiConnections: ApiConnectionRecord[];
  apiFormOpen: boolean;
  apiDraft: ApiConnectionDraft;
  apiEditingId: string | null;
  apiMessage: string | null;
  apiSaveBusy: boolean;
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
  opencodeState: OpenCodeToolState;
  opencodeNeedsInit: boolean;
  looperState: LooperToolState;
  looperNeedsInit: boolean;
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
  filesDeleteUndoStack: FilesDeleteUndoEntry[];
  filesConflictModalOpen: boolean;
  filesConflictName: string;
  filesSelectionAnchorPath: string | null;
  filesSelectionDragActive: boolean;
  filesSelectionJustDragged: boolean;
  filesSelectionGesture: "single" | "toggle" | "range" | null;
  filesError: string | null;
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
  memoryContextItems: ChatContextBreakdownItem[];
  memoryChatHistory: Array<ConversationSummaryRecord & { fullBody: string; charCount: number; wordCount: number; tokenEstimate: number }>;
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
  tasksById: Record<string, TaskRecord>;
  tasksSelectedId: string | null;
  tasksFolder: TaskFolder;
  tasksSortKey: TaskSortKey;
  tasksSortDirection: TaskSortDirection;
  tasksDetailsCollapsed: boolean;
  tasksJsonDraft: string;
  projectsById: Record<string, ProjectRecord>;
  projectsSelectedId: string | null;
  projectsNameDraft: string;
  projectsModalOpen: boolean;
  chatProjectMap: Record<string, string>;
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
  firstRunOnboardingOpen: boolean;
  firstRunOnboardingStep: FirstRunOnboardingStep;
  firstRunSelectedModelId: string;
  firstRunTermsAccepted: boolean;
  firstRunCustomModelPath: string;
  firstRunBusy: boolean;
  firstRunMessage: string | null;
  modelManagerInstalled: ModelManagerInstalledModel[];
  modelManagerActiveTab: "all_models" | "download";
  modelManagerDisabledModelIds: string[];
  modelManagerInfoModalModelId: string | null;
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
  vadMethods: VadManifest[];
  vadIncludeExperimental: boolean;
  vadSelectedMethod: string;
  vadShadowMethod: string | null;
  vadStandbyMethod: string | null;
  vadSettings: PersistedVoiceSettings | null;
  voiceRuntimeState: VoiceRuntimeState;
  voiceHandoffState: HandoffState;
  voiceSpeculationState: SpeculationState;
  voiceDuplexMode: DuplexMode;
  vadShadowSummary: {
    activeMethodId: string;
    shadowMethodId: string;
    activeEventCount: number;
    shadowEventCount: number;
    disagreementCount: number;
  } | null;
  vadMessage: string | null;
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
    lexiconStatus: string;
    testText: string;
    lastDurationMs: number | null;
    lastBytes: number | null;
    lastSampleRate: number | null;
    downloadReceivedBytes: number | null;
    downloadTotalBytes: number | null;
    downloadPercent: number | null;
    ttsSetupModalOpen: boolean;
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
  allModelsList: [],
  chatTtsEnabled: false,
  chatTtsPlaying: false,
  activeChatCorrelationId: null,
  chatSplitMode: "none",
  chatSplitPercent: 50,
  chatPanels: [],
  avatar: {
    active: false,
    placement: "chat",
    maximized: false,
    assetKind: "glb",
    assetName: "wireframe.glb",
    assetUrl: "/avatar/wireframe.glb",
    meshes: defaultAvatarMeshes(),
    morphs: AVATAR_MORPHS.map((n) => ({ name: n, value: 0 })),
    armBones: AVATAR_ARM_BONES.map((b) => {
      const defaults: Record<string, { x: number; y: number; z: number }> = {
        lUpperArm: { x: 10, y: 38, z: -3 },
        rUpperArm: { x: -3, y: -40, z: 2 },
      };
      const d = defaults[b.key] ?? { x: 0, y: 0, z: 0 };
      return { key: b.key, label: b.label, x: d.x, y: d.y, z: d.z };
    }),
    bgColor: "#000000",
    bgOpacity: 50,
    borderSize: 0,
    borderColor: "#000000"
  },
  avatarActiveTab: "appearance" as const,
  avatarLipSyncStrength: 0.7,
  avatarLipSyncJawBlend: 0.4,
  devices: defaultDevicesState(),
  apiConnections: [],
  apiFormOpen: false,
  apiDraft: defaultApiConnectionDraft(),
  apiEditingId: null,
  apiMessage: null,
  apiSaveBusy: false,
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
  workspaceTab: initialWorkspaceTab,
  layoutOrientation: "landscape",
  activeTerminalSessionId: null,
  terminalShellProfile: "default",
  opencodeState: getInitialOpenCodeState(),
  opencodeNeedsInit: true,
  looperState: getInitialLooperState(),
  looperNeedsInit: true,
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
  ...createInitialFilesState(),
  ...createInitialNotepadState(),
  sheetsState: getInitialSheetsState(),
  ...createInitialDocsState(),
  ...createInitialSkillsFileState(),
  ...createInitialMemoryState({
    alwaysLoadToolKeys: loadPersistedMemoryAlwaysLoadTools(),
    alwaysLoadSkillKeys: loadPersistedMemoryAlwaysLoadSkills()
  }),
  ...createInitialTasksState(),
  projectsById: loadPersistedProjectsById(),
  projectsSelectedId: null,
  projectsNameDraft: "",
  projectsModalOpen: false,
  chatProjectMap: loadChatProjectMap(),
  ...createInitialFlowState({
    advancedOpen: loadPersistedFlowAdvancedOpen(),
    bottomPanel: loadPersistedFlowBottomPanel(),
    workspaceSplit: loadPersistedFlowSplit(),
    activeTerminalPhase: loadPersistedFlowActivePhase(),
    phaseSessionByName: loadPersistedFlowPhaseSessionMap(),
    autoFocusPhaseTerminal: loadPersistedFlowAutoFollow()
  }),
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
  firstRunOnboardingOpen: !loadFirstRunOnboardingDismissed(),
  firstRunOnboardingStep: "welcome",
  firstRunSelectedModelId: FIRST_RUN_MODEL_OPTIONS[0]?.id ?? "",
  firstRunTermsAccepted: false,
  firstRunCustomModelPath: "",
  firstRunBusy: false,
  firstRunMessage: null,
  modelManagerInstalled: [],
  modelManagerActiveTab: "all_models",
  modelManagerDisabledModelIds: loadPersistedModelManagerDisabledModelIds(),
  modelManagerInfoModalModelId: null,
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
  vadMethods: [],
  vadIncludeExperimental: false,
  vadSelectedMethod: "sherpa-silero",
  vadShadowMethod: null,
  vadStandbyMethod: null,
  vadSettings: null,
  voiceRuntimeState: "idle",
  voiceHandoffState: "none",
  voiceSpeculationState: "disabled",
  voiceDuplexMode: "single_turn",
  vadShadowSummary: null,
  vadMessage: null,
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
    lexiconStatus: "",
    testText: "Hello from Arxell text to speech.",
    lastDurationMs: null,
    lastBytes: null,
    lastSampleRate: null,
    downloadReceivedBytes: null,
    downloadTotalBytes: null,
    downloadPercent: null,
    ttsSetupModalOpen: false
  }
};
state.activeWebTabId = state.webTabs[0]?.id ?? "";
state.chatPanels = [createChatPanelState("chat-0", state)];

const PRIMARY_CHAT_PANE_ID = "chat-0";
const chatPaneIdByCorrelation = new Map<string, string>();

function syncPrimaryChatPanelFromFlatState(): void {
  const cp = state.chatPanels[0];
  if (!cp) return;
  cp.conversationId = state.conversationId;
  cp.messages = state.messages;
  cp.chatReasoningByCorrelation = state.chatReasoningByCorrelation;
  cp.chatThinkingPlacementByCorrelation = state.chatThinkingPlacementByCorrelation;
  cp.chatThinkingExpandedByCorrelation = state.chatThinkingExpandedByCorrelation;
  cp.chatToolRowsByCorrelation = state.chatToolRowsByCorrelation;
  cp.chatToolRowExpandedById = state.chatToolRowExpandedById;
  cp.chatStreamCompleteByCorrelation = state.chatStreamCompleteByCorrelation;
  cp.chatStreaming = state.chatStreaming;
  cp.chatDraft = state.chatDraft;
  cp.chatAttachedFileName = state.chatAttachedFileName;
  cp.chatAttachedFileContent = state.chatAttachedFileContent;
  cp.chatActiveModelId = state.chatActiveModelId;
  cp.chatActiveModelLabel = state.chatActiveModelLabel;
  cp.chatActiveModelCapabilities = state.chatActiveModelCapabilities;
  cp.chatThinkingEnabled = state.chatThinkingEnabled;
  cp.chatTtsEnabled = state.chatTtsEnabled;
  cp.chatTtsPlaying = state.chatTtsPlaying;
  cp.activeChatCorrelationId = state.activeChatCorrelationId;
}

function getPrimaryChatPanelState(): ChatPanelState {
  let cp = state.chatPanels[0];
  if (!cp) {
    cp = createChatPanelState(PRIMARY_CHAT_PANE_ID, state);
    state.chatPanels[0] = cp;
  }
  syncPrimaryChatPanelFromFlatState();
  return cp;
}

function getSecondaryChatPanelState(panelId: string): ChatPanelState | null {
  if (panelId === PRIMARY_CHAT_PANE_ID) return null;
  return state.chatPanels.find((panel) => panel.panelId === panelId) ?? null;
}

function getChatPanelById(panelId: string): ChatPanelState | null {
  if (panelId === PRIMARY_CHAT_PANE_ID) {
    return getPrimaryChatPanelState();
  }
  return getSecondaryChatPanelState(panelId);
}

function rememberChatCorrelationTarget(panelId: string, correlationId: string): void {
  chatPaneIdByCorrelation.set(correlationId, panelId);
}

function resolveChatPaneIdForEvent(correlationId: string, conversationId?: string | null): string | null {
  const knownPaneId = chatPaneIdByCorrelation.get(correlationId);
  if (knownPaneId) return knownPaneId;
  if (state.activeChatCorrelationId === correlationId || state.conversationId === conversationId) {
    return PRIMARY_CHAT_PANE_ID;
  }
  for (const cp of state.chatPanels.slice(1)) {
    if (cp.activeChatCorrelationId === correlationId || cp.conversationId === conversationId) {
      return cp.panelId;
    }
  }
  return null;
}

function createChatPanelState(panelId: string, src: typeof state): ChatPanelState {
  return {
    panelId,
    conversationId: src.conversationId,
    messages: src.messages,
    chatReasoningByCorrelation: src.chatReasoningByCorrelation,
    chatThinkingPlacementByCorrelation: src.chatThinkingPlacementByCorrelation,
    chatThinkingExpandedByCorrelation: src.chatThinkingExpandedByCorrelation,
    chatToolRowsByCorrelation: src.chatToolRowsByCorrelation,
    chatToolRowExpandedById: src.chatToolRowExpandedById,
    chatStreamCompleteByCorrelation: src.chatStreamCompleteByCorrelation,
    chatStreaming: false,
    chatDraft: "",
    chatAttachedFileName: null,
    chatAttachedFileContent: null,
    chatActiveModelId: src.chatActiveModelId,
    chatActiveModelLabel: src.chatActiveModelLabel,
    chatActiveModelCapabilities: src.chatActiveModelCapabilities,
    chatThinkingEnabled: src.chatThinkingEnabled,
    chatTtsEnabled: false,
    chatTtsPlaying: false,
    activeChatCorrelationId: null
  };
}

function createFreshChatPanelState(panelId: string, modelId: string, modelLabel: string): ChatPanelState {
  return {
    panelId,
    conversationId: generateChatConversationId(),
    messages: [],
    chatReasoningByCorrelation: {},
    chatThinkingPlacementByCorrelation: {},
    chatThinkingExpandedByCorrelation: {},
    chatToolRowsByCorrelation: {},
    chatToolRowExpandedById: {},
    chatStreamCompleteByCorrelation: {},
    chatStreaming: false,
    chatDraft: "",
    chatAttachedFileName: null,
    chatAttachedFileContent: null,
    chatActiveModelId: modelId,
    chatActiveModelLabel: modelLabel,
    chatActiveModelCapabilities: inferChatModelCapabilities(modelLabel),
    chatThinkingEnabled: false,
    chatTtsEnabled: false,
    chatTtsPlaying: false,
    activeChatCorrelationId: null
  };
}

function resetSecondaryChatPaneState(cp: ChatPanelState): void {
  cp.messages = [];
  cp.chatDraft = "";
  cp.chatAttachedFileName = null;
  cp.chatAttachedFileContent = null;
  cp.chatReasoningByCorrelation = {};
  cp.chatThinkingPlacementByCorrelation = {};
  cp.chatThinkingExpandedByCorrelation = {};
  cp.chatToolRowsByCorrelation = {};
  cp.chatToolRowExpandedById = {};
  cp.chatStreamCompleteByCorrelation = {};
  cp.chatStreaming = false;
  cp.activeChatCorrelationId = null;
}

function createSecondaryChatSendState(
  cp: ChatPanelState
): Parameters<typeof createSendMessageHandler>[0]["state"] {
  return {
    get messages() {
      return cp.messages;
    },
    set messages(value) {
      cp.messages = value;
    },
    get chatDraft() {
      return cp.chatDraft;
    },
    set chatDraft(value) {
      cp.chatDraft = value;
    },
    get chatStreaming() {
      return cp.chatStreaming;
    },
    set chatStreaming(value) {
      cp.chatStreaming = value;
    },
    get activeChatCorrelationId() {
      return cp.activeChatCorrelationId;
    },
    set activeChatCorrelationId(value) {
      cp.activeChatCorrelationId = value;
    },
    get chatStreamCompleteByCorrelation() {
      return cp.chatStreamCompleteByCorrelation;
    },
    set chatStreamCompleteByCorrelation(value) {
      cp.chatStreamCompleteByCorrelation = value;
    },
    get chatTtsLatencyMs() {
      return state.chatTtsLatencyMs;
    },
    set chatTtsLatencyMs(value) {
      state.chatTtsLatencyMs = value;
    },
    get chatModelOptions() {
      return state.chatModelOptions;
    },
    set chatModelOptions(value) {
      state.chatModelOptions = value;
    },
    get chatActiveModelId() {
      return cp.chatActiveModelId;
    },
    set chatActiveModelId(value) {
      cp.chatActiveModelId = value;
    },
    get conversationId() {
      return cp.conversationId;
    },
    set conversationId(value) {
      cp.conversationId = value;
    },
    get chatThinkingEnabled() {
      return cp.chatThinkingEnabled;
    },
    set chatThinkingEnabled(value) {
      cp.chatThinkingEnabled = value;
    },
    get chatRoutePreference() {
      return state.chatRoutePreference;
    },
    set chatRoutePreference(value) {
      state.chatRoutePreference = value;
    },
    get chatActiveModelLabel() {
      return cp.chatActiveModelLabel;
    },
    set chatActiveModelLabel(value) {
      cp.chatActiveModelLabel = value;
    },
    get llamaRuntimeMaxTokens() {
      return state.llamaRuntimeMaxTokens;
    },
    set llamaRuntimeMaxTokens(value) {
      state.llamaRuntimeMaxTokens = value;
    },
    get chatReasoningByCorrelation() {
      return cp.chatReasoningByCorrelation;
    },
    set chatReasoningByCorrelation(value) {
      cp.chatReasoningByCorrelation = value;
    },
    get chatThinkingExpandedByCorrelation() {
      return cp.chatThinkingExpandedByCorrelation;
    },
    set chatThinkingExpandedByCorrelation(value) {
      cp.chatThinkingExpandedByCorrelation = value;
    },
    get chatThinkingPlacementByCorrelation() {
      return cp.chatThinkingPlacementByCorrelation;
    },
    set chatThinkingPlacementByCorrelation(value) {
      cp.chatThinkingPlacementByCorrelation = value;
    },
    get chatTtsEnabled() {
      return false;
    },
    set chatTtsEnabled(_value) {},
    get chatFirstAssistantChunkMsByCorrelation() {
      return state.chatFirstAssistantChunkMsByCorrelation;
    },
    set chatFirstAssistantChunkMsByCorrelation(value) {
      state.chatFirstAssistantChunkMsByCorrelation = value;
    },
    get events() {
      return state.events;
    },
    set events(value) {
      state.events = value;
    },
    get memoryAlwaysLoadToolKeys() {
      return state.memoryAlwaysLoadToolKeys;
    },
    set memoryAlwaysLoadToolKeys(value) {
      state.memoryAlwaysLoadToolKeys = value;
    },
    get memoryAlwaysLoadSkillKeys() {
      return state.memoryAlwaysLoadSkillKeys;
    },
    set memoryAlwaysLoadSkillKeys(value) {
      state.memoryAlwaysLoadSkillKeys = value;
    }
  };
}

function resolveSplitPanelModel(): { id: string; label: string } {
  const primary = getPrimaryChatPanelState();
  if (!primary) return { id: "", label: "Select a model..." };
  const currentOption = state.chatModelOptions.find((o) => o.id === primary.chatActiveModelId);
  if (currentOption && currentOption.source === "api") {
    return { id: currentOption.id, label: currentOption.label };
  }
  const firstApi = state.chatModelOptions.find((o) => o.source === "api");
  if (firstApi) return { id: firstApi.id, label: firstApi.label };
  return { id: "", label: "Select a model..." };
}

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
let ttsActiveWebAudioStop: (() => void) | null = null;
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

function shouldOfferPlaintextFallback(error: unknown): boolean {
  return String(error).toLowerCase().includes("plaintext fallback");
}

function plaintextFallbackWarning(): string {
  return "Secure OS credential storage is unavailable. Store this API key in a clearly named plaintext fallback file instead? This protects normal config files, but the key can be read by anyone with access to your app data directory.";
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

interface PreservedEditableFocus {
  id: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  value: string | null;
}

function preserveEditableFocusBeforeRender(): PreservedEditableFocus | null {
  const active = document.activeElement as HTMLElement | null;
  if (!isEditableElementActive(active) || !active?.id) return null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return {
      id: active.id,
      selectionStart: active.selectionStart,
      selectionEnd: active.selectionEnd,
      value: active.value
    };
  }
  return {
    id: active.id,
    selectionStart: null,
    selectionEnd: null,
    value: null
  };
}

function restoreEditableFocusAfterRender(preserved: PreservedEditableFocus | null): void {
  if (!preserved) return;
  const next = document.getElementById(preserved.id) as HTMLElement | null;
  if (!next || !isEditableElementActive(next)) return;
  if ((next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) && preserved.value !== null) {
    next.value = preserved.value;
    next.focus({ preventScroll: true });
    if (preserved.selectionStart !== null && preserved.selectionEnd !== null) {
      next.setSelectionRange(preserved.selectionStart, preserved.selectionEnd);
    }
    return;
  }
  next.focus({ preventScroll: true });
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
  if (ttsActiveWebAudioStop) {
    const stop = ttsActiveWebAudioStop;
    ttsActiveWebAudioStop = null;
    stop();
  }
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
  clearAvatarPhonemeTimeline();
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
  updateAvatarSpeechState(false, 0);
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

async function playTtsAudio(audioBytes: unknown, correlationId: string | null, spokenText?: string | null): Promise<void> {
  const bytes = decodeTtsAudioBytes(audioBytes);
  if (!bytes.length) {
    throw new Error("No audio bytes returned from TTS.");
  }
  stopTtsPlaybackLocal();
  const arrayBuffer = new Uint8Array(bytes).buffer.slice(0) as ArrayBuffer;
  try {
    const audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const durationMs = audioBuffer.duration * 1000;
    if (spokenText) {
      updateAvatarPhonemeTimeline(spokenText, durationMs);
    }
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    const pcm = new Float32Array(analyser.fftSize);
    let pollTimer: number | null = null;
    let settled = false;
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (pollTimer !== null) window.clearTimeout(pollTimer);
        ttsActiveWebAudioStop = null;
        updateAvatarSpeechState(false, 0);
        clearAvatarPhonemeTimeline();
        void audioContext.close().catch(() => {});
        resolve();
      };
      const poll = () => {
        if (settled) return;
        analyser.getFloatTimeDomainData(pcm);
        let rms = 0;
        for (const sample of pcm) rms += sample * sample;
        rms = Math.sqrt(rms / pcm.length);
        updateAvatarSpeechState(true, Math.min(1, rms * 10));
        pollTimer = window.setTimeout(poll, 67);
      };
      ttsActiveWebAudioStop = () => {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
        cleanup();
      };
      source.onended = cleanup;
      source.start();
      poll();
      if (correlationId) {
        const firstTokenMs = state.chatFirstAssistantChunkMsByCorrelation[correlationId];
        if (firstTokenMs && !chatTtsLatencyCapturedByCorrelation.has(correlationId)) {
          state.chatTtsLatencyMs = Math.max(0, Date.now() - firstTokenMs);
          chatTtsLatencyCapturedByCorrelation.add(correlationId);
        }
      }
    });
    return;
  } catch (error) {
    updateAvatarSpeechState(false, 0);
    pushConsoleEntry("debug", "browser", `WebAudio TTS playback fallback: ${String(error)}`);
  }
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
      updateAvatarSpeechState(false, 0);
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
        currentItem.correlationId,
        currentItem.text,
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

function renderFirstRunOnboardingModal(): string {
  if (!state.firstRunOnboardingOpen) return "";
  const selectedModel =
    FIRST_RUN_MODEL_OPTIONS.find((model) => model.id === state.firstRunSelectedModelId) ??
    FIRST_RUN_MODEL_OPTIONS[0];
  const busyAttr = state.firstRunBusy ? " disabled" : "";
  const step = state.firstRunOnboardingStep;
  const nextDisabledAttr = state.firstRunBusy || (step === "welcome" && !state.firstRunTermsAccepted) ? " disabled" : "";
  const stepsHtml = ["welcome", "model", "tts"]
    .map((item, idx) => `<span class="first-run-step${step === item ? " is-active" : ""}">${idx + 1}</span>`)
    .join("");
  const messageHtml = state.firstRunMessage
    ? `<div class="first-run-message">${escapeHtml(state.firstRunMessage)}</div>`
    : "";
  const progressValue = Number.isFinite(state.tts.downloadPercent ?? NaN)
    ? Math.max(0, Math.min(100, state.tts.downloadPercent ?? 0))
    : null;
  const progressLabel = progressValue !== null
    ? `${progressValue.toFixed(0)}%`
    : state.tts.downloadReceivedBytes !== null
    ? formatBytesShort(state.tts.downloadReceivedBytes)
    : "Downloading";
  const progressDetail = state.tts.downloadReceivedBytes !== null
    ? state.tts.downloadTotalBytes !== null
      ? `${formatBytesShort(state.tts.downloadReceivedBytes)} of ${formatBytesShort(state.tts.downloadTotalBytes)}`
      : formatBytesShort(state.tts.downloadReceivedBytes)
    : "";
  const progressHtml = state.firstRunOnboardingStep === "tts" && state.firstRunBusy
    ? `<div class="tts-download-progress first-run-progress" role="status" aria-live="polite">
        <div class="tts-download-progress-top">
          <span>Downloading Kokoro voice bundle</span>
          <span>${escapeHtml(progressLabel)}</span>
        </div>
        <progress ${progressValue !== null ? `value="${progressValue.toFixed(2)}" max="100"` : ""}></progress>
        ${progressDetail ? `<div class="tts-download-progress-detail">${escapeHtml(progressDetail)}</div>` : ""}
      </div>`
    : "";

  const bodyHtml =
    step === "welcome"
      ? `<div class="tts-setup-modal-title">Welcome to Arxell</div>
        <div class="tts-setup-modal-desc">Arxell is a local-first AI workstation for chat, voice, tools, files, terminals, and agent workflows. It is under active development and some tools may be incomplete.</div>
        <div class="first-run-checklist">
          <div><strong>Features.</strong> Local GGUF models, API models, voice input/output, workspace tools, and configurable guardrails.</div>
          <div><strong>Setup.</strong> Pick a starter model that fits your RAM/VRAM, then download a Kokoro voice bundle.</div>
          <div><strong>Safety.</strong> This software is experimental and provided with no guarantees. You are responsible for reviewing output and using guardrails before autonomous workflows.</div>
          <div><strong>License.</strong> Personal use is free. Commercial use requires a valid license. Review the <a href="https://www.arxell.com/legal" target="_blank" rel="noreferrer noopener">Terms</a>.</div>
        </div>
        <label class="first-run-terms"><input type="checkbox" id="firstRunTermsCheckbox" ${state.firstRunTermsAccepted ? "checked" : ""}${busyAttr} /> I have read and agree to the terms of use.</label>`
      : step === "model"
      ? `<div class="tts-setup-modal-title">Choose your first model</div>
        <div class="tts-setup-modal-desc">Download a starter model or select an existing local .gguf file. Use Next when you are ready to continue.</div>
        <div class="first-run-model-list">
          ${FIRST_RUN_MODEL_OPTIONS.map((model) => `
            <label class="first-run-model-option${model.id === state.firstRunSelectedModelId ? " is-selected" : ""}">
              <input type="radio" name="firstRunModel" value="${escapeHtml(model.id)}" ${model.id === state.firstRunSelectedModelId ? "checked" : ""}${busyAttr} />
              <span class="first-run-model-copy">
                <span class="first-run-model-title">${escapeHtml(model.name)} <small>${escapeHtml(model.size)}</small></span>
                <span class="first-run-model-desc">${escapeHtml(model.description)}</span>
              </span>
            </label>
          `).join("")}
        </div>
        ${state.firstRunSelectedModelId === "custom-gguf" ? `<div class="first-run-custom-path">${escapeHtml(state.firstRunCustomModelPath || "No local model selected yet.")}</div>` : ""}`
      : `<div class="tts-setup-modal-title">Install voice bundle</div>
        <div class="tts-setup-modal-desc">Download a compatible sherpa-onnx Kokoro bundle so voice mode and read-aloud work on first use.</div>
        <div class="tts-setup-modal-bundles">
          ${KOKORO_BUNDLE_OPTIONS.map((bundle, idx) => `
            <button type="button" class="tts-setup-modal-bundle-btn first-run-tts-download" data-url="${escapeHtml(bundle.url)}"${busyAttr}>
              <span class="tts-setup-modal-bundle-name">Kokoro ${escapeHtml(bundle.label)}${idx === 0 ? " (recommended)" : ""}</span>
              <span class="tts-setup-modal-bundle-size">${escapeHtml(bundle.sizeLabel)}</span>
            </button>
          `).join("")}
        </div>`;

  const primaryAction =
    step === "welcome"
      ? `<button type="button" class="tts-setup-modal-bundle-btn first-run-next"${nextDisabledAttr}>Next</button>`
      : step === "model"
      ? `<button type="button" class="tts-setup-modal-bundle-btn first-run-next"${busyAttr}>Next</button>`
      : `<button type="button" class="tts-setup-modal-cancel-btn first-run-finish"${busyAttr}>Finish</button>`;
  const stepAction =
    step === "model"
      ? selectedModel?.custom
        ? `<button type="button" class="tts-setup-modal-cancel-btn first-run-select-custom-model"${busyAttr}>Select GGUF</button>`
        : `<button type="button" class="tts-setup-modal-cancel-btn first-run-download-model"${busyAttr}>${state.firstRunBusy ? "Downloading..." : "Download"}</button>`
      : "";

  return `<div class="tts-setup-modal-backdrop first-run-backdrop">
    <div class="tts-setup-modal-box first-run-modal-box">
      <button type="button" class="tts-setup-modal-close first-run-skip"${busyAttr}>${iconHtml("x", { size: 16, tone: "dark", label: "Close" })}</button>
      <div class="first-run-steps">${stepsHtml}</div>
      ${bodyHtml}
      ${messageHtml}
      ${progressHtml}
      <div class="tts-setup-modal-actions first-run-actions">
        ${step !== "welcome" ? `<button type="button" class="tts-setup-modal-cancel-btn first-run-skip-step"${busyAttr}>Skip step</button>` : ""}
        <div class="first-run-action-group">
          ${step !== "welcome" ? `<button type="button" class="tts-setup-modal-cancel-btn first-run-back"${busyAttr}>Back</button>` : ""}
          ${stepAction}
          ${primaryAction}
        </div>
      </div>
    </div>
  </div>`;
}

function render(): void {
  syncPrimaryChatPanelFromFlatState();
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
    terminalManager.listSessions("terminal"),
    state.activeTerminalSessionId
  );
  const terminalActionsHtml = renderTerminalToolbar(
    terminalManager.listSessions("terminal"),
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
  state.looperState.availableModels = state.flowAvailableModels;
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
    ...selectFilesToolState(state),
    ...selectNotepadToolState(state),
    sheetsState: state.sheetsState,
    ...selectDocsToolState(state),
    ...selectSkillsToolState(state),
    ...selectMemoryToolState(state),
    ...selectTasksToolState(state),
    projectsById: state.projectsById,
    ...selectFlowToolState(state),
    flowTerminalPhases: [...FLOW_TERMINAL_PHASES],
    terminalSessions: terminalManager.listSessions("terminal").map((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      status: session.status
    })),
    filteredFlowEvents: filteredFlow.forRender,
    opencodeState: state.opencodeState,
    looperState: state.looperState
  });

  const primaryChatPanel = getPrimaryChatPanelState();

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
    chat: primaryChatPanel,
    chatToolIntentByCorrelation: state.chatToolIntentByCorrelation,
    chatFirstAssistantChunkMsByCorrelation: state.chatFirstAssistantChunkMsByCorrelation,
    chatFirstReasoningChunkMsByCorrelation: state.chatFirstReasoningChunkMsByCorrelation,
    chatTtsLatencyMs: state.chatTtsLatencyMs,
    devices: state.devices,
    apiConnections: state.apiConnections,
    apiFormOpen: state.apiFormOpen,
    apiDraft: state.apiDraft,
    apiEditingId: state.apiEditingId,
    apiMessage: state.apiMessage,
    apiSaveBusy: state.apiSaveBusy,
    apiProbeBusy: state.apiProbeBusy,
    apiProbeStatus: state.apiProbeStatus,
    apiProbeMessage: state.apiProbeMessage,
    apiDetectedModels: state.apiDetectedModels,
    conversations: state.conversations,
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
    modelManagerActiveTab: state.modelManagerActiveTab,
    modelManagerDisabledModelIds: state.modelManagerDisabledModelIds,
    modelManagerInfoModalModelId: state.modelManagerInfoModalModelId,
    chatModelOptions: state.chatModelOptions,
    allModelsList: state.allModelsList,
    modelManagerQuery: state.modelManagerQuery,
    modelManagerCollection: state.modelManagerCollection,
    modelManagerSearchResults: state.modelManagerSearchResults,
    modelManagerBusy: state.modelManagerBusy,
    modelManagerMessage: state.modelManagerMessage,
    modelManagerUnslothUdCatalog: state.modelManagerUnslothUdCatalog,
    modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading,
    stt: state.stt,
    vadMethods: state.vadMethods,
    vadIncludeExperimental: state.vadIncludeExperimental,
    vadSelectedMethod: state.vadSelectedMethod,
    vadShadowMethod: state.vadShadowMethod,
    vadStandbyMethod: state.vadStandbyMethod,
    vadSettings: state.vadSettings,
    voiceRuntimeState: state.voiceRuntimeState,
    voiceHandoffState: state.voiceHandoffState,
    voiceSpeculationState: state.voiceSpeculationState,
    voiceDuplexMode: state.voiceDuplexMode,
    vadShadowSummary: state.vadShadowSummary,
    vadMessage: state.vadMessage,
    tts: state.tts,
    consoleEntries: state.consoleEntries,
    projectsById: state.projectsById,
    projectsSelectedId: state.projectsSelectedId,
    projectsNameDraft: state.projectsNameDraft,
    projectsModalOpen: state.projectsModalOpen,
    avatar: state.avatar,
    avatarActiveTab: state.avatarActiveTab,
    avatarLipSyncStrength: state.avatarLipSyncStrength,
    avatarLipSyncJawBlend: state.avatarLipSyncJawBlend
  });

  const isChatTab = state.sidebarTab === "chat";
  const extraPanelHtmls =
    isChatTab && state.chatSplitMode !== "none" && state.chatPanels.length > 1
      ? state.chatPanels.slice(1).map((cp, idx) => {
          const scopeId = `-${idx + 1}`;
          const splitPanelDef = getPanelDefinition("chat", {
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
            chat: cp,
            chatToolIntentByCorrelation: {},
            chatFirstAssistantChunkMsByCorrelation: {},
            chatFirstReasoningChunkMsByCorrelation: {},
            chatTtsLatencyMs: null,
            devices: state.devices,
            apiConnections: state.apiConnections,
            apiFormOpen: state.apiFormOpen,
            apiDraft: state.apiDraft,
            apiEditingId: state.apiEditingId,
            apiMessage: state.apiMessage,
            apiSaveBusy: state.apiSaveBusy,
            apiProbeBusy: state.apiProbeBusy,
            apiProbeStatus: state.apiProbeStatus,
            apiProbeMessage: state.apiProbeMessage,
            apiDetectedModels: state.apiDetectedModels,
            conversations: state.conversations,
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
            modelManagerActiveTab: state.modelManagerActiveTab,
            modelManagerDisabledModelIds: state.modelManagerDisabledModelIds,
            modelManagerInfoModalModelId: state.modelManagerInfoModalModelId,
            chatModelOptions: state.chatModelOptions,
            allModelsList: state.allModelsList,
            modelManagerQuery: state.modelManagerQuery,
            modelManagerCollection: state.modelManagerCollection,
            modelManagerSearchResults: state.modelManagerSearchResults,
            modelManagerBusy: state.modelManagerBusy,
            modelManagerMessage: state.modelManagerMessage,
            modelManagerUnslothUdCatalog: state.modelManagerUnslothUdCatalog,
            modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading,
            stt: state.stt,
            vadMethods: state.vadMethods,
            vadIncludeExperimental: state.vadIncludeExperimental,
            vadSelectedMethod: state.vadSelectedMethod,
            vadShadowMethod: state.vadShadowMethod,
            vadStandbyMethod: state.vadStandbyMethod,
            vadSettings: state.vadSettings,
            voiceRuntimeState: state.voiceRuntimeState,
            voiceHandoffState: state.voiceHandoffState,
            voiceSpeculationState: state.voiceSpeculationState,
            voiceDuplexMode: state.voiceDuplexMode,
            vadShadowSummary: state.vadShadowSummary,
            vadMessage: state.vadMessage,
            tts: state.tts,
            consoleEntries: state.consoleEntries,
            projectsById: state.projectsById,
            projectsSelectedId: state.projectsSelectedId,
            projectsNameDraft: state.projectsNameDraft,
            projectsModalOpen: state.projectsModalOpen,
            avatar: state.avatar,
    avatarActiveTab: state.avatarActiveTab,
    avatarLipSyncStrength: state.avatarLipSyncStrength,
    avatarLipSyncJawBlend: state.avatarLipSyncJawBlend
          }, scopeId);
          return {
            paneTitleHtml: renderPanelTitleIcon({
              icon: splitPanelDef.icon,
              title: splitPanelDef.title,
              sidebarTab: "chat",
              chatModelOptions: state.chatModelOptions,
              chatActiveModelId: cp.chatActiveModelId,
              chatPaneId: cp.panelId,
              scopeId,
              ttsReady: state.tts.ready,
              ttsEngine: state.tts.engine
            }),
            panelActionsHtml: splitPanelDef.renderActions(),
            panelBodyHtml: splitPanelDef.renderBody()
          };
        })
      : undefined;

  const primaryPaneHtml = composePrimaryPaneHtml({
    isChatTab,
    chatSplitMode: isChatTab ? state.chatSplitMode : "none",
    chatSplitPercent: state.chatSplitPercent,
    paneTitleHtml: renderPanelTitleIcon({
      icon: panel.icon,
      title: panel.title,
      sidebarTab: state.sidebarTab,
      chatModelOptions: state.chatModelOptions,
      chatActiveModelId: primaryChatPanel.chatActiveModelId,
      chatPaneId: primaryChatPanel.panelId,
      scopeId: "",
      ttsReady: state.tts.ready,
      ttsEngine: state.tts.engine
    }),
    panelActionsHtml: panel.renderActions(),
    panelBodyHtml: panel.renderBody(),
    extraPanelHtmls
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
    state.workspaceTab,
    state.avatar.active && state.avatar.placement === "tools"
      ? renderAvatarPreview(state.avatar, { context: "tools" })
      : "",
    state.avatar.maximized ? "content" : "pane"
  );

  const sidebarRailHtml = renderSidebarRail(
    state.sidebarTab,
    llamaRuntimeOnline,
    state.stt.status === "running",
    state.chatTtsEnabled,
    state.apiConnections.some(
      (connection) => connection.apiType === "llm" && connection.status === "verified"
    ),
    state.avatar.active
  );
  const appBodyHtml = composeAppBodyHtml({
    layoutOrientation: state.layoutOrientation,
    sidebarRailHtml,
    primaryPaneHtml,
    workspacePaneHtml
  });

  const preservedAvatarPreview = preserveAvatarPreviewBeforeRender();
  const preservedEditableFocus = preserveEditableFocusBeforeRender();
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
    bottombarHtml: `${renderGlobalBottombar(currentBottomStatus())}${renderFirstRunOnboardingModal()}`
  });
  restoreAvatarPreviewAfterRender(preservedAvatarPreview);
  restoreEditableFocusAfterRender(preservedEditableFocus);
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

function scheduleDeferredStartupTask(
  label: string,
  run: () => Promise<void>,
  rerender: () => void
): void {
  pushConsoleEntry("info", "app", `Deferred startup queued: ${label}.`);
  window.setTimeout(() => {
    pushConsoleEntry("info", "app", `Deferred startup started: ${label}.`);
    void run()
      .then(() => {
        pushConsoleEntry("info", "app", `Deferred startup completed: ${label}.`);
      })
      .catch((error) => {
        pushConsoleEntry("warn", "app", `Deferred startup failed: ${label}: ${String(error)}`);
      })
      .finally(() => {
        rerender();
      });
  }, 0);
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

function updateSecondaryAssistantDraft(cp: ChatPanelState, correlationId: string, delta: string): void {
  if (!state.chatFirstAssistantChunkMsByCorrelation[correlationId]) {
    state.chatFirstAssistantChunkMsByCorrelation[correlationId] = Date.now();
    syncSecondaryThinkingPlacement(cp, correlationId);
  }
  const existing = cp.messages.find((message) => message.role === "assistant" && message.correlationId === correlationId);
  if (existing) {
    existing.text = normalizeChatText(`${existing.text}${delta}`);
    return;
  }
  cp.messages.push({ role: "assistant", text: normalizeChatText(delta), correlationId });
}

function updateSecondaryReasoningDraft(cp: ChatPanelState, correlationId: string, delta: string): void {
  if (!state.chatFirstReasoningChunkMsByCorrelation[correlationId]) {
    state.chatFirstReasoningChunkMsByCorrelation[correlationId] = Date.now();
    syncSecondaryThinkingPlacement(cp, correlationId);
  }
  if (cp.chatThinkingExpandedByCorrelation[correlationId] === undefined) {
    cp.chatThinkingExpandedByCorrelation[correlationId] = false;
  }
  const current = cp.chatReasoningByCorrelation[correlationId] ?? "";
  cp.chatReasoningByCorrelation[correlationId] = normalizeChatText(`${current}${delta}`);
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

function syncSecondaryThinkingPlacement(cp: ChatPanelState, correlationId: string): void {
  const assistantTs = state.chatFirstAssistantChunkMsByCorrelation[correlationId];
  const reasoningTs = state.chatFirstReasoningChunkMsByCorrelation[correlationId];
  if (assistantTs && reasoningTs) {
    cp.chatThinkingPlacementByCorrelation[correlationId] = reasoningTs <= assistantTs ? "before" : "after";
    return;
  }
  if (reasoningTs && !assistantTs) {
    cp.chatThinkingPlacementByCorrelation[correlationId] = "before";
    return;
  }
  if (assistantTs && !reasoningTs) {
    cp.chatThinkingPlacementByCorrelation[correlationId] = "after";
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
    .replace(/(^|\s)[\[(<]\s*(?:blank[_ ]audio|silence|no[_ ]speech|no[_ ]audio|inaudible|noise|music|applause|laughter|laughing|cough(?:ing)?|breathing|typing)\s*[\])>](?=\s|$)/gi, " ")
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

function ensureAssistantMessageForPanel(cp: ChatPanelState, correlationId: string): void {
  const existing = cp.messages.find((message) => message.role === "assistant" && message.correlationId === correlationId);
  if (existing) return;
  cp.messages.push({ role: "assistant", text: "", correlationId });
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

function appendChatToolRowForPanel(
  cp: ChatPanelState,
  correlationId: string,
  row: Omit<ChatToolEventRow, "rowId">
): void {
  const existing = cp.chatToolRowsByCorrelation[correlationId] ?? [];
  const rowId = `tool-row-${correlationId}-${existing.length + 1}`;
  cp.chatToolRowsByCorrelation[correlationId] = [...existing, { rowId, ...row }];
  if (cp.chatToolRowExpandedById[rowId] === undefined) {
    cp.chatToolRowExpandedById[rowId] = false;
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
  const hasLoadedLlamaModel =
    state.llamaRuntime?.state === "healthy" &&
    Boolean(state.llamaRuntime.activeEngineId) &&
    Boolean(state.llamaRuntime.pid) &&
    Boolean(state.llamaRuntimeModelPath.trim());
  const loadedLlamaModelLabel = hasLoadedLlamaModel
    ? `Llama.cpp: ${modelNameFromPath(state.llamaRuntimeModelPath)}`
    : null;
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
    modelPath: hasLoadedLlamaModel ? state.llamaRuntimeModelPath : "",
    modelLabel: loadedLlamaModelLabel,
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

function mapMemoryContextItem(item: ChatContextBreakdownItem) {
  return {
    section: item.section,
    key: item.key,
    value: item.value,
    category: item.category,
    sourcePath: item.sourcePath ?? null,
    loadMethod: item.loadMethod,
    loadReason: item.loadReason,
    tokenEstimate: item.tokenEstimate,
    charCount: item.charCount,
    wordCount: item.wordCount
  };
}

async function loadMemoryContext(): Promise<void> {
  if (!clientRef) return;
  state.memoryLoading = true;
  state.memoryError = null;
  try {
    const response = await clientRef.inspectChatContext({
      conversationId: state.conversationId,
      correlationId: nextCorrelationId(),
      chatMode: state.chatRoutePreference,
      alwaysLoadToolKeys: state.memoryAlwaysLoadToolKeys,
      alwaysLoadSkillKeys: state.memoryAlwaysLoadSkillKeys
    });
    state.memoryContextItems = response.items.map(mapMemoryContextItem);
    const conversations = response.conversations.slice(0, 10);
    const historyBodies = await Promise.all(
      conversations.map(async (conv) => {
        try {
          const msgResponse = await clientRef!.getMessages({
            conversationId: conv.conversationId,
            correlationId: nextCorrelationId()
          });
          const body = msgResponse.messages.map((m) => m.content).join("\n");
          return { conversationId: conv.conversationId, body };
        } catch {
          const fallback = conv.lastMessagePreview || "";
          return { conversationId: conv.conversationId, body: fallback };
        }
      })
    );
    const bodyMap = new Map(historyBodies.map((b) => [b.conversationId, b.body]));
    state.memoryChatHistory = conversations.map((conv) => {
      const fullBody = bodyMap.get(conv.conversationId) || conv.lastMessagePreview || "";
      const chars = fullBody.length;
      const words = fullBody.split(/\s+/).filter(Boolean).length;
      const tokenEstimate = Math.round(((chars * 0.25) + (words * 1.3)) * 0.5);
      return { ...conv, fullBody, charCount: chars, wordCount: words, tokenEstimate };
    });
    state.memoryPersistentItems = response.memoryItems.map(mapMemoryContextItem);
    state.memorySkillsItems = response.skillsItems.map(mapMemoryContextItem);
    state.memoryToolsItems = response.toolsItems.map(mapMemoryContextItem);
    state.memoryRouteMode = response.routeMode;
    state.memoryTotalTokenEstimate = response.totalTokenEstimate;
  } catch (error) {
    state.memoryError = error instanceof Error ? error.message : String(error);
  } finally {
    state.memoryLoading = false;
  }
}

function closeMemoryModal(): void {
  state.memoryModalOpen = false;
  state.memoryModalMode = "edit";
  state.memoryModalSection = null;
  state.memoryModalTitle = "";
  state.memoryModalValue = "";
  state.memoryModalEditable = false;
  state.memoryModalTarget = null;
  state.memoryModalNamespace = null;
  state.memoryModalKey = null;
  state.memoryModalSourcePath = null;
  state.memoryModalConversationId = null;
  state.memoryModalDraftKey = "";
  state.memoryModalDraftCategory = "directive";
  state.memoryModalDraftDescription = "";
}

function openMemoryCreateModal(section: "context" | "history" | "memory" | "skills" | "tools"): void {
  state.memoryModalOpen = true;
  state.memoryModalMode = "create";
  state.memoryModalSection = section;
  state.memoryModalTitle = `Add New ${section.charAt(0).toUpperCase()}${section.slice(1)} Item`;
  state.memoryModalValue = "";
  state.memoryModalEditable = true;
  state.memoryModalTarget = null;
  state.memoryModalNamespace = null;
  state.memoryModalKey = null;
  state.memoryModalSourcePath = null;
  state.memoryModalConversationId = null;
  state.memoryModalDraftKey = "";
  state.memoryModalDraftCategory = section === "memory" ? "directive" : "";
  state.memoryModalDraftDescription = "";
}

function openHistoryIndexModal(): void {
  const value = state.memoryChatHistory
    .slice(0, 10)
    .map((chat) => {
      const date = formatMemoryTimestamp(chat.updatedAtMs);
      const title = chat.title?.trim() || chat.lastMessagePreview || chat.conversationId;
      const preview = chat.lastMessagePreview || title;
      return `- ${date} | ${title} | ${chat.messageCount} msgs | ${preview}`;
    })
    .join("\n");
  state.memoryModalOpen = true;
  state.memoryModalMode = "edit";
  state.memoryModalSection = "history";
  state.memoryModalTitle = "History Index";
  state.memoryModalValue = `# History\n\n${value}`;
  state.memoryModalEditable = false;
  state.memoryModalTarget = null;
  state.memoryModalNamespace = null;
  state.memoryModalKey = null;
  state.memoryModalSourcePath = null;
  state.memoryModalConversationId = null;
}

function refreshMemoryModalEditor(textarea: HTMLTextAreaElement): void {
  const panel = textarea.closest(".notepad-editor-panel") as HTMLElement | null;
  if (!panel) return;
  const content = textarea.value;
  const lineCount = Math.max(1, content.split("\n").length);
  const displayLines = Math.max(99, lineCount);
  const lineNumbers = panel.querySelector<HTMLElement>(".notepad-editor-lines");
  if (lineNumbers) {
    const previousLineCount = Number(lineNumbers.dataset.notepadLineCount || "0");
    if (previousLineCount !== lineCount) {
      let nums = "";
      for (let i = 1; i <= displayLines; i += 1) {
        nums += `${i}${i === displayLines ? "" : "\n"}`;
      }
      lineNumbers.textContent = nums;
      lineNumbers.dataset.notepadLineCount = String(lineCount);
    }
  }
  const plainTextMode = content.length > 20000;
  panel.classList.toggle("is-plain-text", plainTextMode);
  const highlight = panel.querySelector<HTMLElement>(".notepad-editor-highlight");
  if (highlight) {
    if (plainTextMode) {
      highlight.textContent = "";
    } else {
      try {
        highlight.innerHTML = renderHighlightedCode(content);
      } catch {
        highlight.textContent = content;
      }
    }
  }
  const fallback = displayLines * 20 + 20;
  const height = Math.max(220, fallback);
  textarea.style.height = `${height}px`;
  textarea.closest<HTMLElement>(".notepad-editor-code-wrap")?.style.setProperty(
    "--notepad-editor-height",
    `${height}px`
  );
}

function openMemoryModal(section: "context" | "history" | "memory" | "skills" | "tools", index: number): void {
  if (section === "history") {
    const item = state.memoryChatHistory.slice(0, 10)[index];
    if (!item) return;
    const title = item.title?.trim() || item.lastMessagePreview || item.conversationId;
    const isCustomHistory = item.conversationId.startsWith("custom-history:");
    state.memoryModalOpen = true;
    state.memoryModalMode = "edit";
    state.memoryModalSection = section;
    state.memoryModalTitle = title;
    state.memoryModalValue = item.fullBody || item.lastMessagePreview || "";
    state.memoryModalEditable = isCustomHistory;
    state.memoryModalTarget = isCustomHistory ? "custom-item" : null;
    state.memoryModalNamespace = isCustomHistory ? "history" : null;
    state.memoryModalKey = isCustomHistory ? item.title : null;
    state.memoryModalConversationId = isCustomHistory ? null : item.conversationId;
    return;
  }

  const source =
    section === "memory"
      ? state.memoryPersistentItems
      : section === "skills"
        ? state.memorySkillsItems
        : section === "tools"
          ? state.memoryToolsItems
          : state.memoryContextItems;
  const item = source[index];
  if (!item) return;
  const namespaceKey = section === "memory" ? item.key.split(":") : [];
  const isIndex = item.category === "skill-index" || item.category === "tool-index";
  const isReadOnlyKey = item.key === "Skill Index" || item.key === "Tool Index" || item.key === "Runtime metadata" || item.key === "Verified API registry context";
  const isSystemPrompt = section === "context" && item.key === "Base system prompt";
  const isCustomContext = section === "context" && item.category === "custom-context";
  const isCustomTool = section === "tools" && item.category === "tool-note";
  const isSkillFile = section === "skills" && !!item.sourcePath;
  const editable = isSystemPrompt || isCustomContext || isCustomTool || isSkillFile || (section === "memory" && !isIndex && !isReadOnlyKey);
  const modalValue = item.value;
  state.memoryModalOpen = true;
  state.memoryModalMode = "edit";
  state.memoryModalSection = section;
  state.memoryModalTitle = item.key;
  state.memoryModalValue = modalValue;
  state.memoryModalEditable = editable;
  state.memoryModalTarget = section === "memory" ? "memory" : isSystemPrompt ? "system-prompt" : isCustomContext || isCustomTool ? "custom-item" : isSkillFile ? null : null;
  state.memoryModalNamespace = section === "memory" ? namespaceKey[0] || null : isCustomContext || isCustomTool ? section : null;
  state.memoryModalKey = section === "memory" ? namespaceKey.slice(1).join(":") || item.key : isCustomContext || isCustomTool ? item.key : null;
  state.memoryModalSourcePath = item.sourcePath || null;
  state.memoryModalConversationId = null;
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
  if (state.workspaceTab === "memory-tool") {
    await loadMemoryContext();
  }
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
}

async function reverifyApiConnectionInBackground(id: string, renderAndBind: (sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>) => void, sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>): Promise<void> {
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
    state.apiMessage = verified.connection.statusMessage;
  } catch (error) {
    state.apiMessage = `Saved API connection, but background verification failed: ${String(error)}`;
  }
  renderAndBind(sendMessage);
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

function isTauriRuntimeAvailable(): boolean {
  return state.runtimeMode === "tauri" || Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

async function saveTextFile(
  fileName: string,
  text: string,
  mimeType: string,
  title = "Save File",
  filters = [{ name: "JSON", extensions: ["json"] }],
  defaultPath = fileName
): Promise<string | null> {
  if (isTauriRuntimeAvailable()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | null>("plugin:dialog|save", {
        options: {
          title,
          defaultPath,
          filters
        }
      });
      if (!selected) return null;
      await invoke("write_text_file", { path: selected, contents: text });
      return selected;
    } catch (error) {
      throw new Error(`Native save failed: ${String(error)}`);
    }
  }

  downloadTextFile(fileName, text, mimeType);
  return fileName;
}

async function apiExportDefaultPath(fileName: string): Promise<string> {
  if (!clientRef) return fileName;
  try {
    const roots = await clientRef.getUserProjectsRoots({ correlationId: nextCorrelationId() });
    const root = roots.contentRoot.trim();
    if (!root) return fileName;
    return `${root.replace(/[\\/]+$/, "")}/${fileName}`;
  } catch {
    return fileName;
  }
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

function parseMarkdownTemplate(text: string): { frontmatter: Record<string, string>; body: string } {
  if (!text.startsWith("---\n")) {
    return { frontmatter: {}, body: text.trim() };
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) {
    return { frontmatter: {}, body: text.trim() };
  }
  const rawFrontmatter = text.slice(4, end).trim();
  const body = text.slice(end + 4).trim();
  const frontmatter: Record<string, string> = {};
  for (const line of rawFrontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split(":");
    if (!key || rest.length === 0) continue;
    frontmatter[key.trim().toLowerCase()] = rest.join(":").trim().replace(/^"|"$/g, "");
  }
  return { frontmatter, body };
}

function buildMemoryTemplate(): { fileName: string; content: string } {
  return {
    fileName: "memory-item-template.md",
    content: `---
kind: memory
type: directive
key: sample-memory-key
enabled: false
---

Write the memory content here.
`
  };
}

function buildSkillTemplate(): { fileName: string; content: string } {
  return {
    fileName: "skill-template.md",
    content: `---
kind: skill
name: sample-skill
description: Short description of what this skill does.
enabled: false
---

Write the skill content here.
`
  };
}

function normalizePortableApiType(raw: string | null | undefined): ApiConnectionPortableRecord["apiType"] {
  if (raw === "llm" || raw === "search" || raw === "stt" || raw === "tts" || raw === "image" || raw === "other") {
    return raw;
  }
  return "llm";
}

function portableString(item: unknown, camelName: string, snakeName: string): string {
  const record = item as Record<string, unknown>;
  const value = record[camelName] ?? record[snakeName] ?? "";
  return String(value).trim();
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
          apiType: normalizePortableApiType(portableString(item, "apiType", "api_type")),
          apiUrl: portableString(item, "apiUrl", "api_url"),
          apiKey: portableString(item, "apiKey", "api_key")
        };
        const id = portableString(item, "id", "id");
        const name = portableString(item, "name", "name");
        const modelName = portableString(item, "modelName", "model_name");
        const apiStandardPath = portableString(item, "apiStandardPath", "api_standard_path");
        if (id) normalized.id = id;
        if (name) normalized.name = name;
        if (modelName) normalized.modelName = modelName;
        if (apiStandardPath) normalized.apiStandardPath = apiStandardPath;
        const rawItem = item as Record<string, unknown>;
        const costPerMonthUsd = rawItem.costPerMonthUsd ?? rawItem.cost_per_month_usd;
        const createdMs = rawItem.createdMs ?? rawItem.created_ms;
        if (typeof costPerMonthUsd === "number") normalized.costPerMonthUsd = costPerMonthUsd;
        if (typeof createdMs === "number") normalized.createdMs = createdMs;
        return normalized;
      })
      .filter((item) => Boolean(item.apiUrl))
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

function confirmUnencryptedApiKeysExport(): boolean {
  return window.confirm(
    "This export will contain unencrypted API keys. You are responsible for keeping the exported file secure. Continue?"
  );
}

function apiConnectionsMissingKeyCount(snapshot: ApiConnectionsPortableSnapshot): number {
  return snapshot.connections.filter((connection) => !connection.apiKey.trim()).length;
}

function assertApiConnectionsExportHasKeys(snapshot: ApiConnectionsPortableSnapshot): void {
  const missing = snapshot.connections.filter((connection) => !connection.apiKey.trim());
  if (missing.length > 0) {
    const names = missing
      .slice(0, 3)
      .map((connection) => connection.name || connection.apiUrl || connection.id || "unknown API")
      .join(", ");
    throw new Error(
      `${missing.length} API key${missing.length === 1 ? " is" : "s are"} unavailable; re-enter the key for ${names} before exporting.`
    );
  }
}

function apiConnectionsExportMessage(savedPath: string, missingKeyCount: number): string {
  if (missingKeyCount > 0) {
    return `Exported API connections to ${savedPath}. ${missingKeyCount} API key${missingKeyCount === 1 ? " was" : "s were"} unavailable and exported blank.`;
  }
  return `Exported API connections to ${savedPath}.`;
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
  state.tts.lexiconStatus = status.lexiconStatus || "";
  state.tts.status = status.ready ? "ready" : "idle";
  state.tts.message = status.message;
}

function applyVadSettingsToLegacyStt(): void {
  const sherpa = state.vadSettings?.vadMethods["sherpa-silero"];
  if (!sherpa) return;
  const readNumber = (key: string, fallback: number) => {
    const value = Number(sherpa[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  state.stt.vadBaseThreshold = readNumber("baseThreshold", state.stt.vadBaseThreshold);
  state.stt.vadStartFrames = readNumber("startFrames", state.stt.vadStartFrames);
  state.stt.vadEndFrames = readNumber("endFrames", state.stt.vadEndFrames);
  state.stt.vadDynamicMultiplier = readNumber("dynamicMultiplier", state.stt.vadDynamicMultiplier);
  state.stt.vadNoiseAdaptationAlpha = readNumber("noiseAdaptationAlpha", state.stt.vadNoiseAdaptationAlpha);
  state.stt.vadPreSpeechMs = readNumber("preSpeechMs", state.stt.vadPreSpeechMs);
  state.stt.vadMinUtteranceMs = readNumber("minUtteranceMs", state.stt.vadMinUtteranceMs);
  state.stt.vadMaxUtteranceS = readNumber("maxUtteranceS", state.stt.vadMaxUtteranceS);
  state.stt.vadForceFlushS = readNumber("forceFlushS", state.stt.vadForceFlushS);
}

async function refreshVadState(): Promise<void> {
  if (!clientRef) return;
  const [methods, settings, diagnostics] = await Promise.all([
    clientRef.voiceListVadMethods({
      correlationId: nextCorrelationId(),
      includeExperimental: state.vadIncludeExperimental
    }),
    clientRef.voiceGetVadSettings({ correlationId: nextCorrelationId() }),
    clientRef.voiceGetRuntimeDiagnostics({ correlationId: nextCorrelationId() })
  ]);
  state.vadMethods = methods.methods;
  state.vadSelectedMethod = settings.settings.selectedVadMethod || methods.selectedVadMethod;
  state.vadShadowMethod = settings.settings.shadowVadMethod ?? diagnostics.snapshot.shadowVadMethodId;
  state.vadStandbyMethod = diagnostics.snapshot.standbyVadMethodId;
  state.vadSettings = settings.settings;
  state.voiceRuntimeState = diagnostics.snapshot.state || settings.state;
  state.voiceHandoffState = diagnostics.snapshot.handoffState;
  state.voiceSpeculationState = diagnostics.snapshot.speculationState;
  state.voiceDuplexMode = diagnostics.snapshot.duplexMode || settings.settings.duplexMode || "single_turn";
  state.vadShadowSummary = diagnostics.snapshot.shadowSummary;
  applyVadSettingsToLegacyStt();
}

function handleTtsDownloadProgressEvent(event: AppEvent, rerender: () => void): boolean {
  if (event.action !== "tts.download_model") return false;
  const payload = payloadAsRecord(event.payload);
  if (event.stage === "start") {
    state.tts.downloadReceivedBytes = 0;
    state.tts.downloadTotalBytes = null;
    state.tts.downloadPercent = null;
    return false;
  }
  if (event.stage === "progress") {
    const receivedBytes = Number(payload?.receivedBytes);
    const totalBytes = Number(payload?.totalBytes);
    const percent = Number(payload?.percent);
    state.tts.downloadReceivedBytes = Number.isFinite(receivedBytes) ? receivedBytes : state.tts.downloadReceivedBytes;
    state.tts.downloadTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
    state.tts.downloadPercent = Number.isFinite(percent) ? percent : null;
    rerender();
    return false;
  }
  if (event.stage === "complete" || event.stage === "error") {
    state.tts.downloadReceivedBytes = null;
    state.tts.downloadTotalBytes = null;
    state.tts.downloadPercent = null;
    return false;
  }
  return false;
}

function syncNotepadDocumentFromEvent(payload: Record<string, unknown> | null): boolean {
  const path = typeof payload?.path === "string" ? payload.path.trim() : "";
  const content = typeof payload?.content === "string" ? payload.content : "";
  if (!path) return false;
  const titleRaw = typeof payload?.title === "string" ? payload.title.trim() : "";
  const title = titleRaw || path.split(/[\\/]/).pop() || path;
  const readOnly = payload?.readOnly === true;
  const sizeBytes = Number(payload?.sizeBytes);
  const activate = payload?.activate !== false;
  const focusTool = payload?.focusTool !== false;
  if (!state.notepadOpenTabs.includes(path)) {
    state.notepadOpenTabs = [...state.notepadOpenTabs, path];
  }
  state.notepadPathByTabId[path] = path;
  state.notepadTitleByTabId[path] = title;
  state.notepadContentByTabId[path] = content;
  state.notepadSavedContentByTabId[path] = content;
  state.notepadDirtyByTabId[path] = false;
  state.notepadLoadingByTabId[path] = false;
  state.notepadSavingByTabId[path] = false;
  state.notepadReadOnlyByTabId[path] = readOnly;
  state.notepadSizeByTabId[path] = Number.isFinite(sizeBytes) ? sizeBytes : content.length;
  state.notepadError = null;
  if (activate) {
    state.notepadActiveTabId = path;
  }
  if (focusTool) {
    state.workspaceTab = "notepad-tool";
    persistWorkspaceTab("notepad-tool");
  }
  return true;
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

  for (const cp of state.chatPanels.slice(1)) {
    const existing = state.chatModelOptions.find((option) => option.id === cp.chatActiveModelId);
    if (existing) {
      applyChatModelSelectionToPanel(cp, existing);
      continue;
    }
    const fallbackModel = resolveSplitPanelModel();
    applyChatModelSelectionToPanel(cp, {
      id: fallbackModel.id,
      label: fallbackModel.label,
      modelName: fallbackModel.label,
      source: fallbackModel.id.startsWith("api:") ? "api" : "local",
      detail: ""
    });
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

function applyChatModelSelectionToPanel(panel: ChatPanelState, option: ChatModelOption): void {
  panel.chatActiveModelId = option.id;
  panel.chatActiveModelLabel = option.label;
  panel.chatActiveModelCapabilities = inferChatModelCapabilities(option.modelName);
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

  const sorted = options.sort((a, b) => a.label.localeCompare(b.label));
  state.allModelsList = sorted;
  return sorted.filter((opt) => !state.modelManagerDisabledModelIds.includes(opt.id));
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

function formatMemoryTimestamp(timestampMs: number): string {
  if (!timestampMs || timestampMs <= 0) return "--";
  const date = new Date(timestampMs);
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yy}/${mm}/${dd} ${hh}:${min}`;
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
}

async function refreshModelManagerUnslothUdCatalog(): Promise<void> {
  if (!clientRef) return;
  state.modelManagerUnslothUdLoading = true;
  try {
    const resp = await clientRef.modelManagerRefreshUnslothCatalog({
      correlationId: nextCorrelationId()
    });
    const csv = resp.rows;
    const grouped = new Map<
      string,
      {
        repoId: string;
        modelName: string;
        parameterCount: string;
        udAssets: Array<{ fileName: string; quant: string; sizeGb: string }>;
      }
    >();
    for (const row of csv) {
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
      const extra = resp.newCount > 0 ? ` (+${resp.newCount} new from HuggingFace)` : "";
      state.modelManagerMessage = `Loaded ${rows.length} UD model(s) from catalog.${extra}`;
      return;
    }
    state.modelManagerUnslothUdCatalog = [];
    state.modelManagerMessage = "No UD models found in catalog.";
  } catch {
    state.modelManagerUnslothUdCatalog = [];
    state.modelManagerMessage = "Failed to load UD catalog.";
  }
  state.modelManagerUnslothUdLoading = false;
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
      if (!state.tts.modelPath && !state.tts.availableModelPaths.length) {
        state.tts.status = "error";
        state.tts.message = "Voice mode requires a TTS bundle. Install one in the TTS panel first.";
        renderAndBind(sendMessage);
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Starting TTS engine...";
      renderAndBind(sendMessage);
      try {
        const selfTest = await clientRef!.ttsSelfTest({ correlationId: nextCorrelationId() });
        await refreshTtsState();
        if (!selfTest.ok) {
          state.tts.status = "error";
          state.tts.message = selfTest.message || "TTS engine failed to start.";
          renderAndBind(sendMessage);
          return;
        }
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `TTS engine start failed: ${formatTtsError(error)}`;
        renderAndBind(sendMessage);
        return;
      }
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

render();
if (state.workspaceTab === "sheets-tool") {
  mountActiveSheetsRuntime(sendMessage);
}
syncOverlayScrollbars();
  scrollConsoleToBottom();
  attachDividerResize();
  attachTopbarInteractions(sendMessage);
  attachChatHeaderModelInteractions(sendMessage);
  attachSidebarInteractions(sendMessage);
  attachWorkspaceInteractions(sendMessage);
  bindCustomToolIframes();
  const collapseSplitPanes = async () => {
    if (clientRef) {
      for (const cp of state.chatPanels.slice(1)) {
        if (!cp.activeChatCorrelationId) continue;
        try {
          await clientRef.cancelMessage({
            correlationId: nextCorrelationId(),
            targetCorrelationId: cp.activeChatCorrelationId
          });
        } catch {
          // Best effort when closing split panes.
        }
      }
    }
    state.chatSplitMode = "none";
    state.chatPanels.length = 1;
    renderAndBind(sendMessage);
  };
  bindPaneMenu("chatPaneMenu", {
    "pane-menu-1": () => {
      if (state.chatSplitMode === "none") {
        state.chatSplitMode = "vertical";
        state.chatSplitPercent = 50;
        if (state.chatPanels.length < 2) {
          const model = resolveSplitPanelModel();
          state.chatPanels.push(createFreshChatPanelState("chat-1", model.id, model.label));
        }
        renderAndBind(sendMessage);
      }
    },
    "pane-menu-2": () => {
      if (state.chatSplitMode === "none") {
        state.chatSplitMode = "horizontal";
        state.chatSplitPercent = 50;
        if (state.chatPanels.length < 2) {
          const model = resolveSplitPanelModel();
          state.chatPanels.push(createFreshChatPanelState("chat-1", model.id, model.label));
        }
        renderAndBind(sendMessage);
      }
    },
    "pane-menu-5": () => {
      if (state.chatSplitMode !== "none") {
        void collapseSplitPanes();
      }
    }
  });
  bindPaneMenu("workspacePaneMenu");
  for (let i = 1; i < state.chatPanels.length; i++) {
    const cp = state.chatPanels[i];
    if (!cp) continue;
    const scopeId = `-${i}`;
    const paneSendState = createSecondaryChatSendState(cp);
    const paneSendMessage = createSendMessageHandler({
      getClientRef: () => clientRef,
      state: paneSendState,
      nextCorrelationId: () => {
        const correlationId = nextCorrelationId();
        rememberChatCorrelationTarget(cp.panelId, correlationId);
        return correlationId;
      },
      normalizeChatText,
      clearVoicePrefillState: () => {},
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
      renderAndBind: (_boundSendMessage) => renderAndBind(sendMessage)
    });
    bindPaneMenu(`chatPaneMenu-${i}`, {
      "pane-menu-5": () => {
        void collapseSplitPanes();
      }
    });
    bindChatPanel(
      scopeId,
      paneSendMessage,
      (text: string) => { cp.chatDraft = text; },
      (fileName: string, content: string) => {
        cp.chatAttachedFileName = fileName;
        cp.chatAttachedFileContent = content;
      },
      () => {
        cp.chatAttachedFileName = null;
        cp.chatAttachedFileContent = null;
      },
      async () => {
        const targetCorrelationId = cp.activeChatCorrelationId;
        cp.chatStreaming = false;
        cp.activeChatCorrelationId = null;
        if (clientRef && targetCorrelationId) {
          try {
            await clientRef.cancelMessage({
              correlationId: nextCorrelationId(),
              targetCorrelationId
            });
          } catch (error) {
            pushConsoleEntry("warn", "browser", `Failed to stop split response ${targetCorrelationId}: ${String(error)}`);
          }
        }
        renderAndBind(sendMessage);
      },
      async () => {},
      cp.chatStreaming || cp.chatTtsPlaying,
      cp.chatAttachedFileName
        ? { name: cp.chatAttachedFileName, content: cp.chatAttachedFileContent ?? "" }
        : null,
      cp.chatActiveModelLabel,
      cp.chatActiveModelCapabilities
    );
    const newBtn = document.querySelector<HTMLButtonElement>(`#chatNewBtn${scopeId}`);
    if (newBtn) {
      newBtn.onclick = async () => {
        if (clientRef && cp.activeChatCorrelationId) {
          try {
            await clientRef.cancelMessage({
              correlationId: nextCorrelationId(),
              targetCorrelationId: cp.activeChatCorrelationId
            });
          } catch {
            // Best effort before starting a fresh split conversation.
          }
        }
        cp.conversationId = generateChatConversationId();
        resetSecondaryChatPaneState(cp);
        await refreshConversations();
        renderAndBind(sendMessage);
      };
    }
    const clearBtn = document.querySelector<HTMLButtonElement>(`#chatClearBtn${scopeId}`);
    if (clearBtn) {
      clearBtn.onclick = async () => {
        const currentId = cp.conversationId;
        if (clientRef && cp.activeChatCorrelationId) {
          try {
            await clientRef.cancelMessage({
              correlationId: nextCorrelationId(),
              targetCorrelationId: cp.activeChatCorrelationId
            });
          } catch {
            // Best effort before clearing the conversation.
          }
        }
        if (clientRef) {
          try {
            await clientRef.deleteConversation({
              conversationId: currentId,
              correlationId: nextCorrelationId()
            });
          } catch (error) {
            pushConsoleEntry("warn", "browser", `Failed to clear split conversation ${currentId}: ${String(error)}`);
          }
        }
        cp.conversationId = generateChatConversationId();
        resetSecondaryChatPaneState(cp);
        await refreshConversations();
        renderAndBind(sendMessage);
      };
    }
    const thinkingToggleBtn = document.querySelector<HTMLButtonElement>(`#chatThinkingToggleBtn${scopeId}`);
    if (thinkingToggleBtn) {
      thinkingToggleBtn.onclick = async () => {
        cp.chatThinkingEnabled = !cp.chatThinkingEnabled;
        renderAndBind(sendMessage);
      };
    }
  }
  const dismissFirstRunOnboarding = () => {
    state.firstRunOnboardingOpen = false;
    state.firstRunBusy = false;
    state.firstRunMessage = null;
    persistFirstRunOnboardingDismissed();
    renderAndBind(sendMessage);
  };
  document.querySelectorAll<HTMLButtonElement>(".first-run-skip").forEach((btn) => {
    btn.onclick = dismissFirstRunOnboarding;
  });
  const termsCheckbox = document.querySelector<HTMLInputElement>("#firstRunTermsCheckbox");
  if (termsCheckbox) {
    termsCheckbox.onchange = () => {
      state.firstRunTermsAccepted = termsCheckbox.checked;
      state.firstRunMessage = null;
      renderAndBind(sendMessage);
    };
  }
  const firstRunSkipStep = document.querySelector<HTMLButtonElement>(".first-run-skip-step");
  if (firstRunSkipStep) {
    firstRunSkipStep.onclick = () => {
      if (state.firstRunOnboardingStep === "welcome") {
        state.firstRunOnboardingStep = "model";
      } else if (state.firstRunOnboardingStep === "model") {
        state.firstRunOnboardingStep = "tts";
      } else {
        dismissFirstRunOnboarding();
        return;
      }
      state.firstRunMessage = null;
      renderAndBind(sendMessage);
    };
  }
  const firstRunNext = document.querySelector<HTMLButtonElement>(".first-run-next");
  if (firstRunNext) {
    firstRunNext.onclick = () => {
      if (state.firstRunOnboardingStep === "welcome" && !state.firstRunTermsAccepted) return;
      state.firstRunOnboardingStep = state.firstRunOnboardingStep === "welcome" ? "model" : "tts";
      state.firstRunMessage = null;
      renderAndBind(sendMessage);
    };
  }
  const firstRunBack = document.querySelector<HTMLButtonElement>(".first-run-back");
  if (firstRunBack) {
    firstRunBack.onclick = () => {
      state.firstRunOnboardingStep = state.firstRunOnboardingStep === "tts" ? "model" : "welcome";
      state.firstRunMessage = null;
      renderAndBind(sendMessage);
    };
  }
  document.querySelectorAll<HTMLInputElement>('input[name="firstRunModel"]').forEach((input) => {
    input.onchange = () => {
      state.firstRunSelectedModelId = input.value;
      state.firstRunMessage = null;
      renderAndBind(sendMessage);
    };
  });
  const firstRunDownloadModel = document.querySelector<HTMLButtonElement>(".first-run-download-model");
  if (firstRunDownloadModel) {
    firstRunDownloadModel.onclick = async () => {
      if (!clientRef || state.firstRunBusy) return;
      const model = FIRST_RUN_MODEL_OPTIONS.find((item) => item.id === state.firstRunSelectedModelId) ?? FIRST_RUN_MODEL_OPTIONS[0];
      if (!model || model.custom || !model.repoId || !model.fileName) return;
      state.firstRunBusy = true;
      state.firstRunMessage = `Downloading ${model.name}...`;
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.modelManagerDownloadHf({
          correlationId: nextCorrelationId(),
          repoId: model.repoId,
          fileName: model.fileName
        });
        state.llamaRuntimeModelPath = response.model.path;
        persistLlamaModelPath(response.model.path);
        await refreshModelManagerInstalled();
        state.firstRunOnboardingStep = "tts";
        state.firstRunMessage = `Downloaded ${response.model.name}. Next, install voice output.`;
      } catch (error) {
        state.firstRunMessage = `Model download failed: ${String(error)}`;
      } finally {
        state.firstRunBusy = false;
      }
      renderAndBind(sendMessage);
    };
  }
  const firstRunSelectCustomModel = document.querySelector<HTMLButtonElement>(".first-run-select-custom-model");
  if (firstRunSelectCustomModel) {
    firstRunSelectCustomModel.onclick = async () => {
      if (state.firstRunBusy) return;
      const selectedPath = await browseModelPath();
      if (!selectedPath) return;
      state.firstRunCustomModelPath = selectedPath;
      state.llamaRuntimeModelPath = selectedPath;
      persistLlamaModelPath(selectedPath);
      state.firstRunMessage = `Selected local model: ${selectedPath}`;
      renderAndBind(sendMessage);
    };
  }
  document.querySelectorAll<HTMLButtonElement>(".first-run-tts-download").forEach((btn) => {
    btn.onclick = async () => {
      if (!clientRef || state.firstRunBusy) return;
      const url = btn.dataset.url;
      if (!url) return;
      state.firstRunBusy = true;
      state.firstRunMessage = "Downloading Kokoro voice bundle...";
      state.tts.downloadReceivedBytes = 0;
      state.tts.downloadTotalBytes = null;
      state.tts.downloadPercent = null;
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.ttsDownloadModel({ correlationId: nextCorrelationId(), url });
        await refreshTtsState();
        if (!state.tts.ready) {
          state.firstRunMessage = "Initializing TTS engine...";
          renderAndBind(sendMessage);
          try {
            const selfTest = await clientRef.ttsSelfTest({ correlationId: nextCorrelationId() });
            await refreshTtsState();
            state.firstRunMessage = selfTest.ok
              ? "Kokoro voice bundle installed and engine ready."
              : (selfTest.message || "Bundle installed but engine not ready. You can enable voice mode later.");
          } catch (initError) {
            state.firstRunMessage = `Bundle installed. Engine init skipped: ${formatTtsError(initError)}`;
          }
        } else {
          state.firstRunMessage = response.message || "Kokoro voice bundle installed and ready.";
        }
      } catch (error) {
        state.firstRunMessage = `TTS download failed: ${formatTtsError(error)}`;
      } finally {
        state.firstRunBusy = false;
        state.tts.downloadReceivedBytes = null;
        state.tts.downloadTotalBytes = null;
        state.tts.downloadPercent = null;
      }
      renderAndBind(sendMessage);
    };
  });
  const firstRunFinish = document.querySelector<HTMLButtonElement>(".first-run-finish");
  if (firstRunFinish) {
    firstRunFinish.onclick = dismissFirstRunOnboarding;
  }
  attachPrimaryPanelInteractions(state.sidebarTab, currentPrimaryPanelRenderState(), {
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
      if (state.projectsSelectedId) {
        setChatProjectId(state.chatProjectMap, id, state.projectsSelectedId);
      }
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
      if (!confirmUnencryptedApiKeysExport()) {
        state.apiMessage = "API connections export cancelled.";
        renderAndBind(sendMessage);
        return;
      }
      try {
        const exported = await clientRef.exportApiConnections({
          correlationId: nextCorrelationId()
        });
        const snapshot = parsePortableSnapshot(exported.payloadJson);
        assertApiConnectionsExportHasKeys(snapshot);
        const missingKeyCount = apiConnectionsMissingKeyCount(snapshot);
        const savedPath = await saveTextFile(
          exported.fileName,
          exported.payloadJson,
          "application/json;charset=utf-8",
          "Save API Connections",
          [{ name: "JSON", extensions: ["json"] }],
          await apiExportDefaultPath(exported.fileName)
        );
        state.apiMessage = savedPath
          ? apiConnectionsExportMessage(savedPath, missingKeyCount)
          : "API connections export cancelled.";
      } catch (error) {
        state.apiMessage = `Failed exporting API connections: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionsExportCsv: async () => {
      if (!clientRef) return;
      if (!confirmUnencryptedApiKeysExport()) {
        state.apiMessage = "API connections export cancelled.";
        renderAndBind(sendMessage);
        return;
      }
      try {
        const exported = await clientRef.exportApiConnections({
          correlationId: nextCorrelationId()
        });
        const snapshot = parsePortableSnapshot(exported.payloadJson);
        assertApiConnectionsExportHasKeys(snapshot);
        const missingKeyCount = apiConnectionsMissingKeyCount(snapshot);
        const csv = toApiConnectionsCsv(snapshot);
        const savedPath = await saveTextFile(
          "arxell-api-connections.csv",
          csv,
          "text/csv;charset=utf-8",
          "Save API Connections CSV",
          [{ name: "CSV", extensions: ["csv"] }],
          await apiExportDefaultPath("arxell-api-connections.csv")
        );
        state.apiMessage = savedPath
          ? apiConnectionsExportMessage(savedPath, missingKeyCount)
          : "API connections export cancelled.";
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
        const request = {
          correlationId: nextCorrelationId(),
          payloadJson: selected.text
        };
        const imported = await clientRef.importApiConnections(request);
        state.apiConnections = imported.connections;
        refreshChatModelProfile();
        state.apiMessage = `Imported API connections from ${selected.name}.`;
      } catch (error) {
        if (shouldOfferPlaintextFallback(error) && window.confirm(plaintextFallbackWarning())) {
          try {
            const imported = await clientRef.importApiConnections({
              correlationId: nextCorrelationId(),
              payloadJson: selected.text,
              allowPlaintextFallback: true
            });
            state.apiConnections = imported.connections;
            refreshChatModelProfile();
            state.apiMessage = `Imported API connections from ${selected.name} using plaintext fallback storage.`;
          } catch (retryError) {
            state.apiMessage = `Failed importing API connections JSON: ${String(retryError)}`;
          }
        } else {
          state.apiMessage = `Failed importing API connections JSON: ${String(error)}`;
        }
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionsImportCsv: async () => {
      if (!clientRef) return;
      const selected = await pickTextFile("text/csv,.csv,text/plain,.txt");
      if (!selected) return;
      let payloadJson = "";
      try {
        const snapshot = fromApiConnectionsCsv(selected.text);
        payloadJson = `${JSON.stringify(snapshot, null, 2)}\n`;
        const imported = await clientRef.importApiConnections({
          correlationId: nextCorrelationId(),
          payloadJson
        });
        state.apiConnections = imported.connections;
        refreshChatModelProfile();
        state.apiMessage = `Imported API connections from ${selected.name}.`;
      } catch (error) {
        if (shouldOfferPlaintextFallback(error) && window.confirm(plaintextFallbackWarning())) {
          try {
            const imported = await clientRef.importApiConnections({
              correlationId: nextCorrelationId(),
              payloadJson,
              allowPlaintextFallback: true
            });
            state.apiConnections = imported.connections;
            refreshChatModelProfile();
            state.apiMessage = `Imported API connections from ${selected.name} using plaintext fallback storage.`;
          } catch (retryError) {
            state.apiMessage = `Failed importing API connections CSV: ${String(retryError)}`;
          }
        } else {
          state.apiMessage = `Failed importing API connections CSV: ${String(error)}`;
        }
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionsSetFormOpen: async (open: boolean) => {
      state.apiFormOpen = open;
      if (!open) {
        state.apiDraft = defaultApiConnectionDraft();
        state.apiSaveBusy = false;
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
      state.apiEditingId = id;
      state.apiDraft = {
        apiType: connection.apiType,
        apiUrl: connection.apiUrl,
        name: connection.name ?? "",
        apiKey: "",
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
      if (state.apiSaveBusy) return;
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
      state.apiSaveBusy = true;
      state.apiMessage = state.apiEditingId
        ? "Saving API connection..."
        : "Saving new API connection...";
      renderAndBind(sendMessage);
      try {
        if (state.apiEditingId) {
          const editingId = state.apiEditingId;
          const includeApiKey =
            Boolean(apiKey) &&
            !(apiKey.includes("*") && /\*{2,}/.test(apiKey));
          // Update existing connection
            const updateRequest = {
            correlationId: nextCorrelationId(),
            id: state.apiEditingId,
            apiType: state.apiDraft.apiType,
            apiUrl,
            ...(state.apiDraft.name.trim() ? { name: state.apiDraft.name.trim() } : {}),
            ...(includeApiKey ? { apiKey } : {}),
            ...(state.apiDraft.modelName.trim() ? { modelName: state.apiDraft.modelName.trim() } : {}),
            ...(typeof costPerMonthUsd === "number" ? { costPerMonthUsd } : {}),
            ...(state.apiDraft.apiStandardPath.trim() ? { apiStandardPath: state.apiDraft.apiStandardPath.trim() } : {})
          };
          const updated = await clientRef.updateApiConnection(updateRequest);
          state.apiConnections = state.apiConnections.map((record) =>
            record.id === editingId ? updated.connection : record
          );
          refreshChatModelProfile();
          state.apiFormOpen = false;
          state.apiEditingId = null;
          state.apiDraft = defaultApiConnectionDraft();
          state.apiMessage = "API connection saved. Verifying in background...";
          void reverifyApiConnectionInBackground(updated.connection.id, renderAndBind, sendMessage);
        } else {
          // Create new connection
          const createRequest = {
            correlationId: nextCorrelationId(),
            apiType: state.apiDraft.apiType,
            apiUrl,
            apiKey,
            ...(state.apiDraft.name.trim() ? { name: state.apiDraft.name.trim() } : {}),
            ...(state.apiDraft.modelName.trim() ? { modelName: state.apiDraft.modelName.trim() } : {}),
            ...(typeof costPerMonthUsd === "number" ? { costPerMonthUsd } : {}),
            ...(state.apiDraft.apiStandardPath.trim() ? { apiStandardPath: state.apiDraft.apiStandardPath.trim() } : {})
          };
          const created = await clientRef.createApiConnection(createRequest);
          state.apiConnections = [created.connection, ...state.apiConnections];
          refreshChatModelProfile();
          state.apiFormOpen = false;
          state.apiEditingId = null;
          state.apiDraft = defaultApiConnectionDraft();
          state.apiMessage = "API connection saved. Verifying in background...";
          void reverifyApiConnectionInBackground(created.connection.id, renderAndBind, sendMessage);
        }
      } catch (error) {
        if (shouldOfferPlaintextFallback(error) && window.confirm(plaintextFallbackWarning())) {
          try {
            if (state.apiEditingId) {
              const editingId = state.apiEditingId;
              const includeApiKey = Boolean(apiKey) && !(apiKey.includes("*") && /\*{2,}/.test(apiKey));
              const updated = await clientRef.updateApiConnection({
                correlationId: nextCorrelationId(),
                id: state.apiEditingId,
                apiType: state.apiDraft.apiType,
                apiUrl,
                ...(state.apiDraft.name.trim() ? { name: state.apiDraft.name.trim() } : {}),
                ...(includeApiKey ? { apiKey } : {}),
                ...(state.apiDraft.modelName.trim() ? { modelName: state.apiDraft.modelName.trim() } : {}),
                ...(typeof costPerMonthUsd === "number" ? { costPerMonthUsd } : {}),
                ...(state.apiDraft.apiStandardPath.trim() ? { apiStandardPath: state.apiDraft.apiStandardPath.trim() } : {}),
                allowPlaintextFallback: true
              });
              state.apiConnections = state.apiConnections.map((record) =>
                record.id === editingId ? updated.connection : record
              );
              refreshChatModelProfile();
              state.apiFormOpen = false;
              state.apiEditingId = null;
              state.apiDraft = defaultApiConnectionDraft();
              state.apiMessage = "API connection saved using plaintext fallback storage. Verifying in background...";
              void reverifyApiConnectionInBackground(updated.connection.id, renderAndBind, sendMessage);
            } else {
              const created = await clientRef.createApiConnection({
                correlationId: nextCorrelationId(),
                apiType: state.apiDraft.apiType,
                apiUrl,
                apiKey,
                ...(state.apiDraft.name.trim() ? { name: state.apiDraft.name.trim() } : {}),
                ...(state.apiDraft.modelName.trim() ? { modelName: state.apiDraft.modelName.trim() } : {}),
                ...(typeof costPerMonthUsd === "number" ? { costPerMonthUsd } : {}),
                ...(state.apiDraft.apiStandardPath.trim() ? { apiStandardPath: state.apiDraft.apiStandardPath.trim() } : {}),
                allowPlaintextFallback: true
              });
              state.apiConnections = [created.connection, ...state.apiConnections];
              refreshChatModelProfile();
              state.apiFormOpen = false;
              state.apiEditingId = null;
              state.apiDraft = defaultApiConnectionDraft();
              state.apiMessage = "API connection saved using plaintext fallback storage. Verifying in background...";
              void reverifyApiConnectionInBackground(created.connection.id, renderAndBind, sendMessage);
            }
          } catch (retryError) {
            state.apiMessage = `Failed saving API: ${String(retryError)}`;
          }
        } else {
          state.apiMessage = `Failed saving API: ${String(error)}`;
        }
      }
      state.apiSaveBusy = false;
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
    onModelManagerSetActiveTab: async (tab: "all_models" | "download") => {
      state.modelManagerActiveTab = tab;
      renderAndBind(sendMessage);
    },
    onModelManagerToggleModelAvailability: async (modelId: string) => {
      const idx = state.modelManagerDisabledModelIds.indexOf(modelId);
      if (idx >= 0) {
        state.modelManagerDisabledModelIds = state.modelManagerDisabledModelIds.filter((id) => id !== modelId);
      } else {
        state.modelManagerDisabledModelIds = [...state.modelManagerDisabledModelIds, modelId];
      }
      persistModelManagerDisabledModelIds(state.modelManagerDisabledModelIds);
      refreshChatModelProfile();
      renderAndBind(sendMessage);
    },
    onModelManagerSetInfoModalModelId: async (modelId: string | null) => {
      state.modelManagerInfoModalModelId = modelId;
      renderAndBind(sendMessage);
    },
    onModelManagerNavigateToApis: async () => {
      state.sidebarTab = "apis";
      await refreshApiConnections();
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
        if (!state.tts.modelPath && !state.tts.availableModelPaths.length) {
          state.tts.ttsSetupModalOpen = true;
        }
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
      state.tts.downloadReceivedBytes = 0;
      state.tts.downloadTotalBytes = null;
      state.tts.downloadPercent = null;
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.ttsDownloadModel({
          correlationId: nextCorrelationId()
        });
        state.tts.message = response.message;
        await refreshTtsState();
        if (state.tts.ready) state.tts.ttsSetupModalOpen = false;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Model download failed: ${formatTtsError(error)}`;
      } finally {
        state.tts.downloadReceivedBytes = null;
        state.tts.downloadTotalBytes = null;
        state.tts.downloadPercent = null;
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
      state.tts.downloadReceivedBytes = 0;
      state.tts.downloadTotalBytes = null;
      state.tts.downloadPercent = null;
      renderAndBind(sendMessage);
      try {
        const response = await clientRef.ttsDownloadModel({
          correlationId: nextCorrelationId(),
          url
        });
        state.tts.message = response.message;
        await refreshTtsState();
        if (state.tts.ready) state.tts.ttsSetupModalOpen = false;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Model download failed: ${formatTtsError(error)}`;
      } finally {
        state.tts.downloadReceivedBytes = null;
        state.tts.downloadTotalBytes = null;
        state.tts.downloadPercent = null;
      }
      renderAndBind(sendMessage);
    },
    onTtsSetSetupModalOpen: (open: boolean) => {
      state.tts.ttsSetupModalOpen = open;
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
        await playTtsAudio(response.audioBytes, null, text);
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
    onSetVadMethod: async (methodId) => {
      if (!clientRef) return;
      try {
        const response = await clientRef.voiceSetVadMethod({
          correlationId: nextCorrelationId(),
          methodId
        });
        state.vadSelectedMethod = response.snapshot.selectedVadMethod;
        state.voiceRuntimeState = response.snapshot.state;
        await refreshVadState();
        state.vadMessage = `Selected ${state.vadSelectedMethod}.`;
      } catch (error) {
        state.vadMessage = `VAD method switch failed: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onSetVadIncludeExperimental: async (value) => {
      state.vadIncludeExperimental = value;
      await refreshVadState();
      renderAndBind(sendMessage);
    },
    onUpdateVadMethodConfig: async (key, value) => {
      if (!clientRef) return;
      const methodId = state.vadSelectedMethod;
      const current = {
        ...(state.vadSettings?.vadMethods[methodId] ?? state.vadMethods.find((method) => method.id === methodId)?.defaultConfig ?? {})
      };
      current[key] = value;
      try {
        const response = await clientRef.voiceUpdateVadConfig({
          correlationId: nextCorrelationId(),
          methodId,
          config: current
        });
        state.vadSettings = response.settings;
        state.vadSelectedMethod = response.settings.selectedVadMethod;
        applyVadSettingsToLegacyStt();
        state.vadMessage = `Saved ${methodId} settings.`;
      } catch (error) {
        state.vadMessage = `VAD settings save failed: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onRefreshVadSettings: async () => {
      await refreshVadState();
      renderAndBind(sendMessage);
    },
    onRequestVadHandoff: async (targetMethodId) => {
      if (!clientRef) return;
      try {
        const response = await clientRef.voiceRequestHandoff({
          correlationId: nextCorrelationId(),
          targetMethodId
        });
        state.vadSelectedMethod = response.snapshot.selectedVadMethod;
        state.voiceRuntimeState = response.snapshot.state;
        state.voiceHandoffState = response.snapshot.handoffState;
        state.vadStandbyMethod = response.snapshot.standbyVadMethodId;
        state.vadMessage = `Handoff complete: ${response.snapshot.activeVadMethodId}.`;
        await refreshVadState();
      } catch (error) {
        state.vadMessage = `Handoff failed: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onSetVadShadowMethod: async (methodId) => {
      if (!clientRef) return;
      try {
        const response = await clientRef.voiceSetShadowMethod({
          correlationId: nextCorrelationId(),
          methodId
        });
        state.vadShadowMethod = response.snapshot.shadowVadMethodId;
        state.vadMessage = methodId ? `Shadow method set to ${methodId}.` : "Shadow method cleared.";
        await refreshVadState();
      } catch (error) {
        state.vadMessage = `Shadow method update failed: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onStartVadShadowEval: async () => {
      if (!clientRef) return;
      try {
        const response = await clientRef.voiceStartShadowEval({ correlationId: nextCorrelationId() });
        state.voiceRuntimeState = response.snapshot.state;
        state.vadShadowSummary = response.snapshot.shadowSummary;
        state.vadMessage = "Shadow evaluation started.";
      } catch (error) {
        state.vadMessage = `Shadow start failed: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onStopVadShadowEval: async () => {
      if (!clientRef) return;
      try {
        const response = await clientRef.voiceStopShadowEval({ correlationId: nextCorrelationId() });
        state.voiceRuntimeState = response.snapshot.state;
        state.vadShadowSummary = response.snapshot.shadowSummary;
        state.vadMessage = "Shadow evaluation stopped.";
      } catch (error) {
        state.vadMessage = `Shadow stop failed: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onSetVoiceDuplexMode: async (mode) => {
      if (!clientRef) return;
      try {
        const response = await clientRef.voiceSetDuplexMode({
          correlationId: nextCorrelationId(),
          duplexMode: mode
        });
        state.voiceDuplexMode = response.snapshot.duplexMode;
        state.voiceSpeculationState = response.snapshot.speculationState;
        state.vadMessage = `Duplex mode set to ${mode}.`;
      } catch (error) {
        state.vadMessage = `Duplex mode update failed: ${String(error)}`;
      }
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
    },
    onToggleAvatar: async () => {
      state.avatar.active = !state.avatar.active;
      renderAndBind(sendMessage);
    },
    onSetAvatarPlacement: async (placement: "chat" | "tools") => {
      state.avatar.active = true;
      state.avatar.placement = placement;
      renderAndBind(sendMessage);
    },
    onToggleAvatarMaximized: async () => {
      state.avatar.maximized = !state.avatar.maximized;
      renderAndBind(sendMessage);
    },
    onAvatarUploadImage: async () => {
      const input = document.querySelector<HTMLInputElement>("#avatarImageInput");
      input?.click();
    },
    onAvatarUseWireframe: async () => {
      if (state.avatar.assetUrl.startsWith("blob:")) {
        URL.revokeObjectURL(state.avatar.assetUrl);
      }
      state.avatar.assetKind = "glb";
      state.avatar.assetName = "wireframe.glb";
      state.avatar.assetUrl = "/avatar/wireframe.glb";
      state.avatar.active = true;
      renderAndBind(sendMessage);
    },
    onAvatarMeshUpdate: async (key: string, updates: Partial<AvatarMeshSetting>) => {
      const ms = state.avatar.meshes.find((m) => m.key === key);
      if (!ms) return;
      if ("textureUrl" in updates && ms.textureUrl && ms.textureUrl.startsWith("blob:")) {
        URL.revokeObjectURL(ms.textureUrl);
      }
      Object.assign(ms, updates);
      renderAndBind(sendMessage);
    },
    onAvatarMeshTextureUpload: (key: string) => {
      avatarMeshTextureTargetKey = key;
      const input = document.querySelector<HTMLInputElement>("#avatarMeshTextureInput");
      input?.click();
    },
    onAvatarBorderChange: async (size: number, color: string) => {
      state.avatar.borderSize = size;
      state.avatar.borderColor = color;
      renderAndBind(sendMessage);
    },
    onAvatarBgChange: async (color: string, opacity: number) => {
      state.avatar.bgColor = color;
      state.avatar.bgOpacity = opacity;
      renderAndBind(sendMessage);
    },
    onAvatarSetActiveTab: async (tab: "appearance" | "animation") => {
      state.avatarActiveTab = tab;
      renderAndBind(sendMessage);
    },
    onAvatarMorphChange: async (name: string, value: number) => {
      const ms = state.avatar.morphs.find((m) => m.name === name);
      if (ms) ms.value = value;
      renderAndBind(sendMessage);
    },
    onAvatarBoneChange: async (key: string, axis: "x" | "y" | "z", value: number) => {
      const bone = state.avatar.armBones.find((b) => b.key === key);
      if (bone) bone[axis] = value;
      renderAndBind(sendMessage);
    },
    onAvatarLipSyncChange: (strength: number | undefined, jawBlend: number | undefined) => {
      if (strength !== undefined) state.avatarLipSyncStrength = strength;
      if (jawBlend !== undefined) state.avatarLipSyncJawBlend = jawBlend;
      avatarRuntimeModule?.setAvatarLipSyncSettings({
        strength: state.avatarLipSyncStrength,
        jawBlend: state.avatarLipSyncJawBlend,
      });
    },
    onProjectCreate: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      state.projectsNameDraft = trimmed;
      const client = clientRef;
      if (client) {
        try {
          const info = await ensureUserProject(client, nextCorrelationId(), trimmed);
          createProject(state, info.rootPath);
        } catch {
          createProject(state, "");
        }
      } else {
        createProject(state, "");
      }
      renderAndBind(sendMessage);
    },
    onProjectSelect: (id: string | null) => {
      state.projectsSelectedId = id;
      renderAndBind(sendMessage);
    },
    onProjectDelete: async (id: string) => {
      const projectId = id || state.projectsSelectedId;
      if (!projectId) return;
      state.projectsSelectedId = projectId;
      deleteProject(state);
      for (const task of Object.values(state.tasksById)) {
        if (task.projectId === projectId) {
          task.projectId = "";
        }
      }
      persistTasksById(state);
      for (const convId of Object.keys(state.chatProjectMap)) {
        if (state.chatProjectMap[convId] === projectId) {
          delete state.chatProjectMap[convId];
        }
      }
      persistChatProjectMap(state.chatProjectMap);
      renderAndBind(sendMessage);
    },
    onProjectUpdateField: (id: string, field: "name" | "rootPath", value: string) => {
      state.projectsSelectedId = id;
      updateProjectField(state, field, value);
      renderAndBind(sendMessage);
    },
    onProjectSetModalOpen: (open: boolean) => {
      state.projectsModalOpen = open;
      if (!open) state.projectsNameDraft = "";
      renderAndBind(sendMessage);
    },
    onProjectSetNameDraft: (name: string) => {
      state.projectsNameDraft = name;
    }
  });
  bindAvatarPreviewInteractions(sendMessage);
  mountAvatarStagesIfNeeded();
}

function mountActiveSheetsRuntime(sendMessage: (text: string) => Promise<void>): void {
  if (state.workspaceTab !== "sheets-tool") {
    unmountSheetsRuntime();
    return;
  }
  const sheetsModelOptions = state.chatModelOptions.map((option) => ({ id: option.id, label: option.modelName }));
  const sheetsActiveModelId = sheetsModelOptions.some((option) => option.id === state.sheetsState.aiModelId)
    ? state.sheetsState.aiModelId
    : state.chatActiveModelId;
  mountSheetsRuntime(state.sheetsState, {
    rerender: () => renderAndBind(sendMessage),
    ensureWorkbook: async () => {
      if (!state.sheetsState.hasWorkbook) {
        await workspaceToolsRuntime.createNewSheet();
      } else {
        await workspaceToolsRuntime.ensureSheetReady();
      }
    },
    undoSheet: async () => {
      await workspaceToolsRuntime.undoSheet();
    },
    redoSheet: async () => {
      await workspaceToolsRuntime.redoSheet();
    },
    updateFormulaBarValue: (value) => {
      state.sheetsState.activeEditorValue = value;
    },
    modelOptions: sheetsModelOptions,
    aiModelId: sheetsActiveModelId,
    setAiModel: async (modelId) => {
      await workspaceToolsRuntime.setAiModel(modelId);
    },
    commitFormulaBar: async (value) => {
      const selection = state.sheetsState.selection;
      if (!selection) return;
      await workspaceToolsRuntime.setCellInput(selection.startRow, selection.startCol, value);
    },
    fireSetCellInput: async (row, col, value) => {
      await workspaceToolsRuntime.setCellInput(row, col, value);
    },
    fireWriteRange: async (startRow, startCol, values) => {
      await workspaceToolsRuntime.writeRange(startRow, startCol, values);
    },
    fireCopyPasteRange: async (srcStartRow, srcStartCol, srcEndRow, srcEndCol, destStartRow, destStartCol, values) => {
      await workspaceToolsRuntime.copyPasteRange(srcStartRow, srcStartCol, srcEndRow, srcEndCol, destStartRow, destStartCol, values);
    },
    insertRows: async (index, count = 1) => {
      await workspaceToolsRuntime.insertRows(index, count);
    },
    insertColumns: async (index, count = 1) => {
      await workspaceToolsRuntime.insertColumns(index, count);
    },
    deleteRows: async (index, count = 1) => {
      await workspaceToolsRuntime.deleteRows(index, count);
    },
    deleteColumns: async (index, count = 1) => {
      await workspaceToolsRuntime.deleteColumns(index, count);
    }
  });
}

function attachChatHeaderModelInteractions(sendMessage: (text: string) => Promise<void>): void {
  const selects = document.querySelectorAll<HTMLSelectElement>(".chat-header-model-select[data-chat-pane-id]");
  selects.forEach((select) => {
    select.onchange = () => {
      const paneId = select.dataset.chatPaneId?.trim() || PRIMARY_CHAT_PANE_ID;
      const nextId = select.value;
      const selected = state.chatModelOptions.find((option) => option.id === nextId);
      if (!selected) return;
      if (paneId === PRIMARY_CHAT_PANE_ID) {
        const previousId = state.chatActiveModelId;
        applyChatModelSelection(selected);
        if (previousId !== selected.id) {
          pushConsoleEntry("info", "browser", `Chat model changed to ${selected.label} (${selected.id}).`);
        }
      } else {
        const panel = getSecondaryChatPanelState(paneId);
        if (!panel) return;
        const previousId = panel.chatActiveModelId;
        applyChatModelSelectionToPanel(panel, selected);
        if (previousId !== selected.id) {
          pushConsoleEntry("info", "browser", `Split chat model changed to ${selected.label} (${selected.id}).`);
        }
      }
      renderAndBind(sendMessage);
    };
  });
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
  if (/^[\[(<]?\s*(?:blank[_ ]audio|silence|no[_ ]speech|no[_ ]audio|inaudible)\s*[\])>]?$/.test(transcript.toLowerCase())) {
    return true;
  }

  // Strip non-verbal annotations commonly emitted by STT models:
  // [typing], [Music], (cough), *laughs*, etc.
  const stripped = transcript
    .replace(/[\[(][^\])\n]{1,80}[\])]/g, " ")
    .replace(/<[^>\n]{1,80}>/g, " ")
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
  const primaryChatPanel = getPrimaryChatPanelState();
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
    chat: primaryChatPanel,
    chatToolIntentByCorrelation: state.chatToolIntentByCorrelation,
    chatFirstAssistantChunkMsByCorrelation: state.chatFirstAssistantChunkMsByCorrelation,
    chatFirstReasoningChunkMsByCorrelation: state.chatFirstReasoningChunkMsByCorrelation,
    chatTtsLatencyMs: state.chatTtsLatencyMs,
    devices: state.devices,
    apiConnections: state.apiConnections,
    apiFormOpen: state.apiFormOpen,
    apiDraft: state.apiDraft,
    apiEditingId: state.apiEditingId,
    apiMessage: state.apiMessage,
    apiSaveBusy: state.apiSaveBusy,
    apiProbeBusy: state.apiProbeBusy,
    apiProbeStatus: state.apiProbeStatus,
    apiProbeMessage: state.apiProbeMessage,
    apiDetectedModels: state.apiDetectedModels,
    conversations: state.conversations,
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
    modelManagerActiveTab: state.modelManagerActiveTab,
    modelManagerDisabledModelIds: state.modelManagerDisabledModelIds,
    modelManagerInfoModalModelId: state.modelManagerInfoModalModelId,
    chatModelOptions: state.chatModelOptions,
    allModelsList: state.allModelsList,
    modelManagerQuery: state.modelManagerQuery,
    modelManagerCollection: state.modelManagerCollection,
    modelManagerSearchResults: state.modelManagerSearchResults,
    modelManagerBusy: state.modelManagerBusy,
    modelManagerMessage: state.modelManagerMessage,
    modelManagerUnslothUdCatalog: state.modelManagerUnslothUdCatalog,
    modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading,
    stt: state.stt,
    vadMethods: state.vadMethods,
    vadIncludeExperimental: state.vadIncludeExperimental,
    vadSelectedMethod: state.vadSelectedMethod,
    vadShadowMethod: state.vadShadowMethod,
    vadStandbyMethod: state.vadStandbyMethod,
    vadSettings: state.vadSettings,
    voiceRuntimeState: state.voiceRuntimeState,
    voiceHandoffState: state.voiceHandoffState,
    voiceSpeculationState: state.voiceSpeculationState,
    voiceDuplexMode: state.voiceDuplexMode,
    vadShadowSummary: state.vadShadowSummary,
    vadMessage: state.vadMessage,
    tts: state.tts,
    consoleEntries: state.consoleEntries,
    projectsById: state.projectsById,
    projectsSelectedId: state.projectsSelectedId,
    projectsNameDraft: state.projectsNameDraft,
    projectsModalOpen: state.projectsModalOpen,
    avatar: state.avatar,
    avatarActiveTab: state.avatarActiveTab,
    avatarLipSyncStrength: state.avatarLipSyncStrength,
    avatarLipSyncJawBlend: state.avatarLipSyncJawBlend
  };
}

function renderChatMessagesOnly(panelId = PRIMARY_CHAT_PANE_ID): void {
  if (state.sidebarTab !== "chat") return;
  const messagesHost = document.querySelector<HTMLElement>(`.messages[data-chat-pane-id="${panelId}"]`);
  if (!messagesHost) return;
  const panel = getChatPanelById(panelId);
  if (!panel) return;
  const isNearBottom =
    messagesHost.scrollHeight - messagesHost.scrollTop - messagesHost.clientHeight < 36;
  messagesHost.innerHTML = renderChatMessages({ chat: panel });
  if (isNearBottom || panel.chatStreaming) {
    messagesHost.scrollTop = messagesHost.scrollHeight;
  }
}

function scheduleChatStreamDomUpdate(panelId = PRIMARY_CHAT_PANE_ID): void {
  chatPaneDomUpdatesPending.add(panelId);
  if (chatStreamDomUpdateScheduled) return;
  chatStreamDomUpdateScheduled = true;
  requestAnimationFrame(() => {
    chatStreamDomUpdateScheduled = false;
    const pendingPaneIds = Array.from(chatPaneDomUpdatesPending);
    chatPaneDomUpdatesPending.clear();
    pendingPaneIds.forEach((pendingPaneId) => renderChatMessagesOnly(pendingPaneId));
  });
}

function installThinkingToggleDelegation(sendMessage: (text: string) => Promise<void>): void {
  if (chatThinkingDelegationInstalled) return;
  chatThinkingDelegationInstalled = true;
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const toolToggle = target?.closest<HTMLButtonElement>("[data-tool-row-toggle-id]");
    if (toolToggle) {
      const paneId = toolToggle.dataset.chatPaneId?.trim() || PRIMARY_CHAT_PANE_ID;
      const rowId = toolToggle.dataset.toolRowToggleId;
      if (!rowId) return;
      if (paneId === PRIMARY_CHAT_PANE_ID) {
        const current = state.chatToolRowExpandedById[rowId] === true;
        state.chatToolRowExpandedById[rowId] = !current;
      } else {
        const panel = getSecondaryChatPanelState(paneId);
        if (!panel) return;
        const current = panel.chatToolRowExpandedById[rowId] === true;
        panel.chatToolRowExpandedById[rowId] = !current;
      }
      if (state.sidebarTab === "chat") {
        renderChatMessagesOnly(paneId);
        return;
      }
      renderAndBind(sendMessage);
      return;
    }
    const toggle = target?.closest<HTMLButtonElement>("[data-thinking-toggle-corr]");
    if (!toggle) return;
    const correlationId = toggle.dataset.thinkingToggleCorr;
    if (!correlationId) return;
    const paneId = resolveChatPaneIdForEvent(correlationId) ?? PRIMARY_CHAT_PANE_ID;
    if (paneId === PRIMARY_CHAT_PANE_ID) {
      const current = state.chatThinkingExpandedByCorrelation[correlationId] === true;
      state.chatThinkingExpandedByCorrelation[correlationId] = !current;
    } else {
      const panel = getSecondaryChatPanelState(paneId);
      if (!panel) return;
      const current = panel.chatThinkingExpandedByCorrelation[correlationId] === true;
      panel.chatThinkingExpandedByCorrelation[correlationId] = !current;
    }
    if (state.sidebarTab === "chat") {
      renderChatMessagesOnly(paneId);
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
          if (!state.tts.modelPath && !state.tts.availableModelPaths.length && !state.tts.ttsSetupModalOpen) {
            state.tts.ttsSetupModalOpen = true;
          }
        } catch (error) {
          state.tts.status = "error";
          state.tts.message = `TTS refresh failed: ${String(error)}`;
        }
      }
      renderAndBind(sendMessage);
    };
  });
}

function bindAvatarPreviewInteractions(sendMessage: (text: string) => Promise<void>): void {
  const imageInput = document.querySelector<HTMLInputElement>("#avatarImageInput");
  if (imageInput) {
    imageInput.onchange = () => {
      const file = imageInput.files?.[0] ?? null;
      imageInput.value = "";
      if (!file || !file.type.startsWith("image/")) return;
      if (state.avatar.assetUrl.startsWith("blob:")) {
        URL.revokeObjectURL(state.avatar.assetUrl);
      }
      state.avatar.assetKind = "image";
      state.avatar.assetName = file.name;
      state.avatar.assetUrl = URL.createObjectURL(file);
      state.avatar.active = true;
      renderAndBind(sendMessage);
    };
  }
  const avatarButtons = document.querySelectorAll<HTMLButtonElement>("[data-avatar-action]");
  avatarButtons.forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.avatarAction;
      if (action === "view-chat") {
        state.avatar.active = true;
        state.avatar.placement = "chat";
        state.sidebarTab = "chat";
      } else if (action === "view-tools") {
        state.avatar.active = true;
        state.avatar.placement = "tools";
      } else if (action === "close") {
        state.avatar.active = false;
      } else if (action === "toggle-size") {
        state.avatar.maximized = !state.avatar.maximized;
      }
      renderAndBind(sendMessage);
    };
  });
  const meshTextureInput = document.querySelector<HTMLInputElement>("#avatarMeshTextureInput");
  if (meshTextureInput) {
    meshTextureInput.onchange = () => {
      const file = meshTextureInput.files?.[0] ?? null;
      meshTextureInput.value = "";
      if (!file || !file.type.startsWith("image/") || !avatarMeshTextureTargetKey) return;
      const key = avatarMeshTextureTargetKey;
      avatarMeshTextureTargetKey = "";
      const ms = state.avatar.meshes.find((m) => m.key === key);
      if (!ms) return;
      if (ms.textureUrl && ms.textureUrl.startsWith("blob:")) URL.revokeObjectURL(ms.textureUrl);
      ms.textureUrl = URL.createObjectURL(file);
      ms.textureName = file.name;
      renderAndBind(sendMessage);
    };
  }
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

    const sanitizeGeneratedToolId = (value: string): string => {
      const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "")
        .slice(0, 40);
      return /^[a-z][a-z0-9-]{1,40}$/.test(normalized) ? normalized : "new-app-tool";
    };

    const writeGeneratedAppToolScaffold = async (
      toolId: string,
      toolName: string,
      toolIcon: string,
      summary: string
    ): Promise<void> => {
      if (!clientRef) {
        throw new Error("IPC client unavailable.");
      }
      if (state.workspaceTools.some((tool) => tool.toolId === toolId)) {
        throw new Error(`App tool '${toolId}' already exists. Choose a different project name.`);
      }
      await clientRef.createWorkspaceAppPlugin({
        correlationId: nextCorrelationId(),
        toolId,
        name: toolName || toolId,
        icon: toolIcon || "wrench",
        description: summary || "Generated workspace app tool"
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
      forgetWorkspaceTool: async (toolId: string) => {
        if (!clientRef) return;
        await clientRef.forgetWorkspaceTool({
          correlationId: nextCorrelationId(),
          toolId
        });
      },
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
      persistWorkspaceTab("terminal");
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
            state.activeTerminalSessionId = terminalManager.listSessions("terminal")[0]?.sessionId ?? null;
          }
          persistFlowPhaseSessionMap(state.flowPhaseSessionByName);
        },
        createProjectSetup: async (name: string, projectType: string, icon: string, description: string) => {
          const rawProjectName = name.trim() || "new-project";
          const projectName = projectType === "app-tool" ? sanitizeGeneratedToolId(rawProjectName) : rawProjectName;
          const summary = description.trim();
          const toolIcon = icon.trim() || "wrench";
          const planPath = state.flowPlanPath?.trim() || "IMPLEMENTATION_PLAN.md";
          const promptPlanPath = state.flowPromptPlanPath?.trim() || "PROMPT_plan.md";
          const promptBuildPath = state.flowPromptBuildPath?.trim() || "PROMPT_build.md";
          await workspaceToolsRuntime.createNewFilesFolder("specs").catch(() => undefined);
          if (projectType === "app-tool") {
            state.flowBackpressureCommands = state.flowBackpressureCommands.trim()
              ? state.flowBackpressureCommands
              : "cd frontend && npm run check";
          }

          const appToolContext =
            projectType === "app-tool"
              ? `\n## App Tool Context\n- Tool ID: ${projectName}\n- Icon: ${toolIcon}\n- Required architecture guide: docs/TOOLS_ARCHITECTURE.md\n- Build as a runtime plugin/custom tool under the app-managed plugins directory.\n- Include manifest.json, permissions.json, dist/index.html, dist/main.js, and any plugin assets needed by the tool.\n- Keep workspace UI, invoke tools, and agent tools separate. Do not bypass IPC or registry boundaries.\n- Validate that the tool can be discovered, enabled, opened, and deleted from within an installed app without rebuilding the app bundle.\n`
              : "";
          const projectDescriptionSection = summary ? `\n## Project Description\n${summary}\n` : "";
          const planBody = `# Implementation Plan\n\nProject: ${projectName}\nType: ${projectType}\n${projectDescriptionSection}${appToolContext}\n## Initial Tasks\n- [ ] Define project scope and first milestone\n- [ ] Scaffold baseline structure and dependencies\n- [ ] Implement first end-to-end vertical slice\n- [ ] Add/verify validation command coverage\n`;
          const planPrompt = `You are planning implementation tasks for a ${projectType} project.\nProject name: ${projectName}\n${summary ? `Project description: ${summary}\n` : ""}${
            projectType === "app-tool"
              ? `Read docs/TOOLS_ARCHITECTURE.md before planning. The app-tool icon is ${toolIcon}. Plan all files and registry/enable/launch wiring needed for an in-app workspace tool.\n`
              : ""
          }Create concise, testable checklist items in ${planPath}.`;
          const buildPrompt = `You are executing implementation tasks for a ${projectType} project.\nProject name: ${projectName}\n${summary ? `Project description: ${summary}\n` : ""}${
            projectType === "app-tool"
              ? `Read docs/TOOLS_ARCHITECTURE.md before editing. Use icon ${toolIcon}. Ensure the tool is scaffolded, registered, enabled, and launchable from within the app.\n`
              : ""
          }Implement one unchecked task from ${planPath}, then validate and update the plan.`;
          const specSeed = `# ${projectName}\n\nType: ${projectType}\n${projectType === "app-tool" ? `Icon: ${toolIcon}\nArchitecture: docs/TOOLS_ARCHITECTURE.md\n` : ""}\n${summary || "Describe goals, constraints, and first release scope."}\n`;
          const readme = `# ${projectName}\n\nType: ${projectType}\n${projectType === "app-tool" ? `Icon: ${toolIcon}\n` : ""}\n${summary || "Project scaffold created from Flow setup."}\n\n## Next Steps\n- Review IMPLEMENTATION_PLAN.md\n- Run Flow in dry mode for rehearsal\n- Run Flow in build mode for first task\n`;

          await writeWorkspaceFile(planPath, planBody);
          await writeWorkspaceFile(promptPlanPath, planPrompt);
          await writeWorkspaceFile(promptBuildPath, buildPrompt);
          await writeWorkspaceFile("specs/overview.md", specSeed);
          await writeWorkspaceFile("README.md", readme).catch(() => undefined);
          if (projectType === "app-tool") {
            await writeGeneratedAppToolScaffold(projectName, rawProjectName, toolIcon, summary);
          }
          await refreshTools();

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
      notepad: {
        ensureNotepadReady: workspaceToolsRuntime.ensureNotepadReady,
        createUntitledNotepadTab: workspaceToolsRuntime.createUntitledNotepadTab,
        openNotepadFile: workspaceToolsRuntime.openNotepadFile,
        activateNotepadTab: workspaceToolsRuntime.activateNotepadTab,
        closeNotepadTab: workspaceToolsRuntime.closeNotepadTab,
        updateNotepadBuffer: workspaceToolsRuntime.updateNotepadBuffer,
        saveActiveNotepadTab: workspaceToolsRuntime.saveActiveNotepadTab,
        saveActiveNotepadTabAs: workspaceToolsRuntime.saveActiveNotepadTabAs,
        saveAllNotepadTabs: workspaceToolsRuntime.saveAllNotepadTabs,
        duplicateActiveNotepadTab: workspaceToolsRuntime.duplicateActiveNotepadTab,
        deleteActiveNotepadFile: workspaceToolsRuntime.deleteActiveNotepadFile
      },
      sheets: {
        createNewSheet: workspaceToolsRuntime.createNewSheet,
        openSheetWithDialog: workspaceToolsRuntime.openSheetWithDialog,
        saveSheetCurrent: workspaceToolsRuntime.saveSheetCurrent,
        saveSheetWithDialog: workspaceToolsRuntime.saveSheetWithDialog,
        undoSheet: workspaceToolsRuntime.undoSheet,
        redoSheet: workspaceToolsRuntime.redoSheet,
        insertRows: workspaceToolsRuntime.insertRows,
        insertColumns: workspaceToolsRuntime.insertColumns,
        deleteRows: workspaceToolsRuntime.deleteRows,
        deleteColumns: workspaceToolsRuntime.deleteColumns
      },
      docs: {
        listDocsDirectory: (path?: string) => listDocsDirectory(state, { client: clientRef!, nextCorrelationId }, path),
        selectDocsPath: (path: string) => selectDocsPath(state, { client: clientRef!, nextCorrelationId }, path),
        toggleDocsNode: (path: string) => toggleDocsNode(state, { client: clientRef!, nextCorrelationId }, path),
        openDocsFile: (path: string) => openDocsFile(state, { client: clientRef!, nextCorrelationId }, path),
        createNewDocsFile: (path: string) => createNewDocsFile(state, { client: clientRef!, nextCorrelationId }, path),
        activateDocsTab: (path: string) => activateDocsTab(state, path),
        closeDocsTab: (path: string) => closeDocsTab(state, path),
        updateDocsBuffer: (path: string, content: string) => updateDocsBuffer(state, path, content),
        saveActiveDocsTab: () => saveActiveDocsTab(state, { client: clientRef!, nextCorrelationId }),
        saveActiveDocsTabAs: (path: string) => saveActiveDocsTabAs(state, { client: clientRef!, nextCorrelationId }, path),
        saveAllDocsTabs: () => saveAllDocsTabs(state, { client: clientRef!, nextCorrelationId })
      },
      web: {
        runWebSearch: workspaceToolsRuntime.runWebSearch,
        createAndActivateWebTab: workspaceToolsRuntime.createAndActivateWebTab,
        ensureTerminalSession,
        persistWebSearchHistory,
        withActiveWebTab: workspaceToolsRuntime.withActiveWebTab,
        saveWebSearchSetup: workspaceToolsRuntime.saveWebSearchSetup
      },
      opencode: {
        state: state.opencodeState,
        actionsDeps: {
          terminalManager,
          client: clientRef!,
          nextCorrelationId,
          renderAndBind: () => renderAndBind(sendMessage)
        }
      },
      looper: {
        state: state.looperState,
        actionsDeps: {
          terminalManager,
          client: clientRef!,
          nextCorrelationId,
          renderAndBind: () => renderAndBind(sendMessage),
          projectsById: state.projectsById
        }
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
              ensureDocsLoaded: () => ensureDocsLoaded(state, { client: clientRef!, nextCorrelationId }),
              ensureNotepadReady: workspaceToolsRuntime.ensureNotepadReady,
              ensureSheetReady: workspaceToolsRuntime.ensureSheetReady,
              ensureMemoryLoaded: loadMemoryContext,
              refreshFlowRuns,
             ensureOpenCodeInit: async () => {
              const opencodeDeps: OpenCodeActionsDeps = {
                terminalManager,
                client: clientRef!,
                nextCorrelationId,
                renderAndBind: () => renderAndBind(sendMessage)
              };
              const installed = await checkOpenCodeInstalled(state.opencodeState, opencodeDeps);
              if (installed) {
                await spawnAgent(state.opencodeState, opencodeDeps, { label: "Agent 1" });
              }
            },
ensureLooperInit: async () => {
  const looperDeps: LooperActionsDeps = {
    terminalManager,
    client: clientRef!,
    nextCorrelationId,
    renderAndBind: () => renderAndBind(sendMessage),
    projectsById: state.projectsById
  };
  await ensureLooperInit(state.looperState, looperDeps);
}
});
if (workspaceTab === "sheets-tool") {
  mountActiveSheetsRuntime(sendMessage);
} else {
  unmountSheetsRuntime();
}
},
        maybeOpenFlowProjectSetup,
        dispatchWorkspaceToolClick: async (target) => dispatchWorkspaceToolClick(target, state, workspaceToolDeps),
        persistFlowWorkspacePrefs: () => persistFlowWorkspacePrefs(state),
        persistWorkspaceTab: (tab: string) => persistWorkspaceTab(tab)
      });
      if (prelude.handled) return;
      const target = prelude.target;
      if (!target) return;

      const rawClickTarget = event.target as HTMLElement;
      const backdropEl = rawClickTarget?.closest<HTMLElement>(".memory-modal-backdrop");
      if (backdropEl && rawClickTarget === backdropEl) {
        closeMemoryModal();
        renderAndBind(sendMessage);
        return;
      }

      const memoryAction = target.getAttribute("data-memory-action");
      if (memoryAction === "open-row") {
        const section = target.getAttribute("data-memory-section");
        const rawIndex = target.getAttribute("data-memory-index");
        const index = rawIndex ? Number.parseInt(rawIndex, 10) : Number.NaN;
        if (
          (section === "context" || section === "history" || section === "memory" || section === "skills" || section === "tools") &&
          Number.isFinite(index)
        ) {
          openMemoryModal(section, index);
          renderAndBind(sendMessage);
          return;
        }
      }
      if (memoryAction === "open-history-index") {
        openHistoryIndexModal();
        renderAndBind(sendMessage);
        return;
      }
      if (memoryAction === "tab") {
        const tab = target.getAttribute("data-memory-tab");
        if (
          tab === "context" ||
          tab === "history" ||
          tab === "memory" ||
          tab === "skills" ||
          tab === "tools"
        ) {
          state.memoryActiveTab = tab;
          renderAndBind(sendMessage);
          return;
        }
      }
      if (memoryAction === "toggle-always-load-tool") {
        const toolKey = target.getAttribute("data-memory-tool-key")?.trim();
        if (toolKey) {
          const checked = target instanceof HTMLInputElement ? target.checked : false;
          state.memoryAlwaysLoadToolKeys = checked
            ? Array.from(new Set([...state.memoryAlwaysLoadToolKeys, toolKey]))
            : state.memoryAlwaysLoadToolKeys.filter((item) => item !== toolKey);
          persistMemoryAlwaysLoadTools(state.memoryAlwaysLoadToolKeys);
          await loadMemoryContext();
          renderAndBind(sendMessage);
          return;
        }
      }
      if (memoryAction === "toggle-always-load-skill") {
        const skillKey = target.getAttribute("data-memory-skill-key")?.trim();
        if (skillKey) {
          const checked = target instanceof HTMLInputElement ? target.checked : false;
          state.memoryAlwaysLoadSkillKeys = checked
            ? Array.from(new Set([...state.memoryAlwaysLoadSkillKeys, skillKey]))
            : state.memoryAlwaysLoadSkillKeys.filter((item) => item !== skillKey);
          persistMemoryAlwaysLoadSkills(state.memoryAlwaysLoadSkillKeys);
          await loadMemoryContext();
          renderAndBind(sendMessage);
          return;
        }
      }
      if (memoryAction === "close-modal") {
        closeMemoryModal();
        renderAndBind(sendMessage);
        return;
      }
      if (memoryAction === "open-create-modal") {
        const section = target.getAttribute("data-memory-section");
        if (section === "context" || section === "history" || section === "memory" || section === "skills" || section === "tools") {
          openMemoryCreateModal(section);
          renderAndBind(sendMessage);
          return;
        }
      }
      if (memoryAction === "export-markdown") {
        const section = target.getAttribute("data-memory-section");
        if (section === "memory") {
          const template = buildMemoryTemplate();
          downloadTextFile(template.fileName, template.content, "text/markdown");
          return;
        }
        if (section === "skills") {
          const template = buildSkillTemplate();
          downloadTextFile(template.fileName, template.content, "text/markdown");
          return;
        }
      }
      if (memoryAction === "import-markdown") {
        const section = target.getAttribute("data-memory-section");
        if (!clientRef || (section !== "memory" && section !== "skills")) return;
        const picked = await pickTextFile(".md,text/markdown,text/plain");
        if (!picked) return;
        const parsed = parseMarkdownTemplate(picked.text);
        if (section === "memory") {
          const key = parsed.frontmatter.key?.trim();
          const type = (parsed.frontmatter.type?.trim() || "directive").toLowerCase();
          if (!key) {
            state.memoryError = "Imported memory markdown is missing 'key' frontmatter.";
            renderAndBind(sendMessage);
            return;
          }
          await clientRef.upsertMemory({
            namespace: type || "other",
            key,
            value: parsed.body,
            correlationId: nextCorrelationId()
          });
        } else if (section === "skills") {
          const name = parsed.frontmatter.name?.trim();
          const description = parsed.frontmatter.description?.trim();
          if (!name || !description) {
            state.memoryError = "Imported skill markdown requires 'name' and 'description' frontmatter.";
            renderAndBind(sendMessage);
            return;
          }
          await clientRef.createSkill({
            name,
            description,
            content: parsed.body,
            correlationId: nextCorrelationId()
          });
        }
        await loadMemoryContext();
        renderAndBind(sendMessage);
        return;
      }
      if (memoryAction === "open-conversation") {
        const conversationId = target.getAttribute("data-memory-conversation-id")?.trim();
        if (conversationId) {
          state.sidebarTab = "chat";
          await loadConversation(conversationId);
          closeMemoryModal();
          renderAndBind(sendMessage);
          return;
        }
      }
      if (memoryAction === "save-modal-memory") {
        if (!clientRef || !state.memoryModalEditable) return;
        const editor = document.querySelector<HTMLTextAreaElement>("#memoryModalEditor");
        const value = editor?.value ?? state.memoryModalValue;
        state.memoryModalValue = value;
        const modalMode = state.memoryModalMode;
        const modalTarget = state.memoryModalTarget;
        const modalSection = state.memoryModalSection;
        const modalNamespace = state.memoryModalNamespace;
        const modalKey = state.memoryModalKey;
        const modalSourcePath = state.memoryModalSourcePath;
        const draftKey = state.memoryModalDraftKey.trim();
        const draftCategory = state.memoryModalDraftCategory.trim();
        const draftDescription = state.memoryModalDraftDescription.trim();
        closeMemoryModal();
        renderAndBind(sendMessage);
        try {
          if (modalMode === "create") {
            if (!modalSection || !draftKey) throw new Error("A key or name is required.");
            if (modalSection === "memory") {
              await clientRef.upsertMemory({
                namespace: draftCategory || "other",
                key: draftKey,
                value,
                correlationId: nextCorrelationId()
              });
            } else if (modalSection === "skills") {
              if (!draftDescription) throw new Error("A description is required for a skill.");
              await clientRef.createSkill({
                name: draftKey,
                description: draftDescription,
                content: value,
                correlationId: nextCorrelationId()
              });
            } else {
              await clientRef.upsertCustomItem({
                section: modalSection,
                key: draftKey,
                value,
                correlationId: nextCorrelationId()
              });
            }
          } else if (modalTarget === "memory") {
            if (!modalNamespace || !modalKey) return;
            await clientRef.upsertMemory({
              namespace: modalNamespace,
              key: modalKey,
              value,
              correlationId: nextCorrelationId()
            });
          } else if (modalTarget === "system-prompt") {
            await clientRef.setSystemPrompt({
              value,
              correlationId: nextCorrelationId()
            });
          } else if (modalTarget === "custom-item") {
            if (!modalSection || !modalKey) return;
            await clientRef.upsertCustomItem({
              section: modalSection,
              key: modalKey,
              value,
              correlationId: nextCorrelationId()
            });
          } else if (modalSourcePath) {
            await clientRef.setReferenceFile({
              path: modalSourcePath,
              value,
              correlationId: nextCorrelationId()
            });
          }
          await loadMemoryContext();
          renderAndBind(sendMessage);
        } catch (error) {
          state.memoryError = error instanceof Error ? error.message : String(error);
          renderAndBind(sendMessage);
        }
        return;
      }
      if (memoryAction === "delete-modal-memory") {
        if (!clientRef || !state.memoryModalNamespace || !state.memoryModalKey) return;
        const confirmed = window.confirm("Delete this memory item?");
        if (!confirmed) return;
        if (state.memoryModalTarget === "custom-item") {
          await clientRef.deleteCustomItem({
            section: state.memoryModalNamespace,
            key: state.memoryModalKey,
            correlationId: nextCorrelationId()
          });
        } else {
          await clientRef.deleteMemory({
            namespace: state.memoryModalNamespace,
            key: state.memoryModalKey,
            correlationId: nextCorrelationId()
          });
        }
        closeMemoryModal();
        await loadMemoryContext();
        renderAndBind(sendMessage);
        return;
      }

      const memoryOpenId = target.getAttribute("data-memory-open-id")?.trim();
      if (memoryOpenId) {
        state.sidebarTab = "chat";
        await loadConversation(memoryOpenId);
        renderAndBind(sendMessage);
        return;
      }
      const memoryEditKey = target.getAttribute("data-memory-edit-key")?.trim();
      if (memoryEditKey) {
        const index = state.memoryPersistentItems.findIndex((item) => item.key === memoryEditKey);
        if (index >= 0) {
          openMemoryModal("memory", index);
          renderAndBind(sendMessage);
          return;
        }
      }
      const memoryDeleteKey = target.getAttribute("data-memory-delete-key")?.trim();
      if (memoryDeleteKey) {
        const item = state.memoryPersistentItems.find((entry) => entry.key === memoryDeleteKey);
        if (!clientRef || !item) return;
        const namespace = item.key.split(":")[0] || "other";
        const key = item.key.split(":").slice(1).join(":") || item.key;
        const confirmed = window.confirm("Delete this memory item?");
        if (!confirmed) return;
        await clientRef.deleteMemory({ namespace, key, correlationId: nextCorrelationId() });
        await loadMemoryContext();
        renderAndBind(sendMessage);
        return;
      }

      if (target.id === "memoryRefreshBtn") {
        await loadMemoryContext();
        renderAndBind(sendMessage);
        return;
      }

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
      persistFlowWorkspacePrefs: () => persistFlowWorkspacePrefs(state),
      persistWorkspaceTab: (tab: string) => persistWorkspaceTab(tab),
      rerender: () => renderAndBind(sendMessage)
    });
    workspacePane.addEventListener("input", (event: Event) => {
      const input = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const action = input.getAttribute?.("data-memory-action");
      if (action === "editor-input" && input instanceof HTMLTextAreaElement) {
        state.memoryModalValue = input.value;
        refreshMemoryModalEditor(input);
        return;
      }
      if (action === "modal-draft-key") {
        state.memoryModalDraftKey = input.value;
        return;
      }
      if (action === "modal-draft-category") {
        state.memoryModalDraftCategory = input.value;
        return;
      }
      if (action === "modal-draft-description") {
        state.memoryModalDraftDescription = input.value;
      }
      if (input.getAttribute?.("data-chart-field") === "source") {
        void renderChartCanvasIfNeeded(sendMessage);
      }
    });
    workspacePane.addEventListener("change", (event: Event) => {
      const input = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const action = input.getAttribute?.("data-memory-action");
      if (action === "modal-draft-category") {
        state.memoryModalDraftCategory = input.value;
      }
    });
    workspacePane.addEventListener("keydown", (event: KeyboardEvent) => {
      const ta = event.target as HTMLTextAreaElement;
      if (ta.getAttribute?.("data-memory-action") !== "editor-input") return;
      if (event.key === "Tab") {
        event.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.substring(0, start) + "\t" + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 1;
        refreshMemoryModalEditor(ta);
      }
      if (event.key === "Escape") {
        closeMemoryModal();
        renderAndBind(sendMessage);
      }
    });
  }
  if (shellPopover) {
    shellPopover.onclick = (event) => {
      event.stopPropagation();
    };
  }

  void renderChartCanvasIfNeeded(sendMessage);

  mountWorkspaceTerminalHosts(state, terminalManager, persistFlowPhaseSessionMap);

  if (state.workspaceTab === "opencode-tool") {
    const activeAgent = state.opencodeState.agents.find(
      (a: { id: string }) => a.id === state.opencodeState.activeAgentId
    );
    if (activeAgent) {
      const opencodeHost = document.querySelector<HTMLElement>(`#${OPENCODE_UI_ID.terminalHost}`);
      if (opencodeHost) {
        terminalManager.mountSession(activeAgent.sessionId, opencodeHost);
      }
    }
  }

  if (state.workspaceTab === "looper-tool") {
    const activeLoop = state.looperState.loops.find(
      (l: { id: string }) => l.id === state.looperState.activeLoopId
    );
    if (activeLoop) {
      const phases: string[] = ["planner", "executor", "validator", "critic"];
      for (const phase of phases) {
        const sessionId = activeLoop.phases[phase as keyof typeof activeLoop.phases]?.sessionId;
        if (sessionId) {
          const hostId = `${LOOPER_UI_ID.terminalHostPrefix}${activeLoop.id}-${phase}`;
          const host = document.querySelector<HTMLElement>(`#${hostId}`);
          if (host) {
            terminalManager.mountSession(sessionId, host);
          }
        }
      }
    }
  }

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
    shouldRefreshUnslothUdCatalog: () => false,
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

  let looperRefreshScheduled = false;
  const scheduleLooperRefresh = () => {
    if (looperRefreshScheduled) return;
    looperRefreshScheduled = true;
    window.setTimeout(() => {
      looperRefreshScheduled = false;
      renderAndBind(sendMessage);
    }, 0);
  };

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
      handleTtsDownloadProgressEvent(event, () => renderAndBind(sendMessage));
      if (event.action === "chart.definition.set") {
        const payload = payloadAsRecord(event.payload);
        const definition = typeof payload?.definition === "string" ? payload.definition.trim() : "";
        if (definition) {
          state.chartSource = definition;
          state.chartRenderSource = definition;
          state.chartError = null;
          state.workspaceTab = "chart-tool";
          persistWorkspaceTab("chart-tool");
          chartLastRenderedSource = null;
          renderAndBind(sendMessage);
        }
        return true;
      }
      if (event.action === "notepad.document.sync") {
        const payload = payloadAsRecord(event.payload);
        if (syncNotepadDocumentFromEvent(payload)) {
          renderAndBind(sendMessage);
        }
        return true;
      }
      if (event.action === "sheets.workbook.sync") {
        const payload = payloadAsRecord(event.payload);
        const source = typeof payload?.source === "string" ? payload.source : null;
        const operation = typeof payload?.operation === "string" ? payload.operation : null;
      if (source === "user" && operation === "write_range") {
          state.sheetsState.filePath = typeof payload?.filePath === "string" ? payload.filePath : state.sheetsState.filePath;
          state.sheetsState.fileName = typeof payload?.fileName === "string" ? payload.fileName : state.sheetsState.fileName;
          state.sheetsState.rowCount = typeof payload?.rowCount === "number" ? payload.rowCount : state.sheetsState.rowCount;
          state.sheetsState.columnCount = typeof payload?.columnCount === "number" ? payload.columnCount : state.sheetsState.columnCount;
          state.sheetsState.usedRange = (payload?.usedRange as typeof state.sheetsState.usedRange) ?? state.sheetsState.usedRange;
          state.sheetsState.dirty = typeof payload?.dirty === "boolean" ? payload.dirty : state.sheetsState.dirty;
          state.sheetsState.revision = typeof payload?.revision === "number" ? payload.revision : state.sheetsState.revision;
          return true;
        }
        void workspaceToolsRuntime.refreshSheetSnapshot().then(() => {
          renderAndBind(sendMessage);
        });
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
        applyLooperRuntimeEvent: (eventItem) =>
          applyLooperRuntimeEvent(state.looperState, eventItem, scheduleLooperRefresh, (_loopId, phase, sessionId) => {
            terminalManager.ensureSession({
              sessionId,
              title: `Looper ${phase}`,
              shell: "remote",
              owner: "looper"
            });
          }),
        maybeHandleFlowPhaseTerminalEvent: async (eventItem) => {
          void maybeHandleFlowPhaseTerminalEvent(eventItem);
        }
      });
    },
    handleChatEvent: (event) =>
      handleChatStreamEvent(event, {
        resolveChatEventTarget: (correlationId, conversationId) => {
          const paneId = resolveChatPaneIdForEvent(correlationId, conversationId);
          if (!paneId) return null;
          if (paneId === PRIMARY_CHAT_PANE_ID) {
            return {
              controlsVoiceState: true,
              chatTtsEnabled: state.chatTtsEnabled,
              chatTtsPlaying: state.chatTtsPlaying,
              markStreamComplete: (targetCorrelationId: string, complete: boolean) => {
                state.chatStreamCompleteByCorrelation[targetCorrelationId] = complete;
              },
              ensureAssistantMessageForCorrelation,
              ensureToolIntentRow,
              appendChatToolRow: (targetCorrelationId, row) => appendChatToolRow(targetCorrelationId, row as any),
              updateAssistantDraft,
              ingestChatStreamForTts: (targetCorrelationId, delta) => ingestChatStreamForTts(sendMessage, targetCorrelationId, delta),
              updateReasoningDraft,
              scheduleDomUpdate: () => scheduleChatStreamDomUpdate(PRIMARY_CHAT_PANE_ID)
            };
          }
          const panel = getSecondaryChatPanelState(paneId);
          if (!panel) return null;
          return {
            controlsVoiceState: false,
            chatTtsEnabled: false,
            chatTtsPlaying: false,
            markStreamComplete: (targetCorrelationId: string, complete: boolean) => {
              panel.chatStreamCompleteByCorrelation[targetCorrelationId] = complete;
            },
            ensureAssistantMessageForCorrelation: (targetCorrelationId: string) => {
              ensureAssistantMessageForPanel(panel, targetCorrelationId);
            },
            ensureToolIntentRow: (targetCorrelationId: string, toolName: string) => {
              const key = `${targetCorrelationId}:${toolName}`;
              if (state.chatToolIntentByCorrelation[key]) return;
              state.chatToolIntentByCorrelation[key] = true;
              appendChatToolRowForPanel(panel, targetCorrelationId, {
                icon: toolIconName(toolName),
                title: `Use ${toolTitleName(toolName)} tool`,
                details: `Agent confirmed it will use the ${toolTitleName(toolName)} tool.`
              });
            },
            appendChatToolRow: (targetCorrelationId, row) => appendChatToolRowForPanel(panel, targetCorrelationId, row as any),
            updateAssistantDraft: (targetCorrelationId: string, delta: string) => {
              updateSecondaryAssistantDraft(panel, targetCorrelationId, delta);
            },
            ingestChatStreamForTts: () => {},
            updateReasoningDraft: (targetCorrelationId: string, delta: string) => {
              updateSecondaryReasoningDraft(panel, targetCorrelationId, delta);
            },
            scheduleDomUpdate: () => scheduleChatStreamDomUpdate(panel.panelId)
          };
        },
        setChatTtsStopRequested: (value) => {
          chatTtsStopRequested = value;
        },
        getVoicePipelineState: () => voicePipelineState,
        setVoicePipelineState,
        resetChatTtsStreamParser,
        flushChatStreamForTts: (correlationId) => flushChatStreamForTts(sendMessage, correlationId),
        parseAgentToolPayload,
        toolIconName,
        toolTitleName,
        parseStreamChunk,
        parseReasoningStreamChunk,
        renderAndBind: () => renderAndBind(sendMessage)
      })
  });

  sendMessage = initializeSendMessageBinding({
    getClientRef: () => clientRef,
    state,
    nextCorrelationId: () => {
      const correlationId = nextCorrelationId();
      rememberChatCorrelationTarget(PRIMARY_CHAT_PANE_ID, correlationId);
      return correlationId;
    },
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

  const runWorkspaceTabStartup = async () => {
    await handleWorkspaceToolTabActivation(state.workspaceTab, state, {
      ensureWebTabs: workspaceToolsRuntime.ensureWebTabs,
      refreshApiConnections,
      hasVerifiedSearchConnection: workspaceToolsRuntime.hasVerifiedSearchConnection,
      ensureFilesExplorerLoaded: workspaceToolsRuntime.ensureFilesExplorerLoaded,
      ensureDocsLoaded: () => ensureDocsLoaded(state, { client: clientRef!, nextCorrelationId }),
      ensureNotepadReady: workspaceToolsRuntime.ensureNotepadReady,
      ensureSheetReady: workspaceToolsRuntime.ensureSheetReady,
      ensureMemoryLoaded: loadMemoryContext,
      refreshFlowRuns,
      ensureOpenCodeInit: async () => {
        const opencodeDeps: OpenCodeActionsDeps = {
          terminalManager,
          client: clientRef!,
          nextCorrelationId,
          renderAndBind: () => renderAndBind(sendMessage)
        };
        const installed = await checkOpenCodeInstalled(state.opencodeState, opencodeDeps);
        if (installed) {
          await spawnAgent(state.opencodeState, opencodeDeps, { label: "Agent 1" });
        }
      },
      ensureLooperInit: async () => {
        const looperDeps: LooperActionsDeps = {
          terminalManager,
          client: clientRef!,
          nextCorrelationId,
          renderAndBind: () => renderAndBind(sendMessage),
          projectsById: state.projectsById
        };
        await ensureLooperInit(state.looperState, looperDeps);
      }
    });
    if (state.workspaceTab === "sheets-tool") {
      mountActiveSheetsRuntime(sendMessage);
    } else {
      unmountSheetsRuntime();
    }
  };

  scheduleDeferredStartupTask("workspace tab activation", runWorkspaceTabStartup, () => {
    renderAndBind(sendMessage);
  });

  scheduleDeferredStartupTask("voice activity detection state", async () => {
    try {
      await refreshVadState();
    } catch (error) {
      state.vadMessage = `VAD bootstrap failed: ${String(error)}`;
      throw error;
    }
  }, () => {
    renderAndBind(sendMessage);
  });

  if (state.modelManagerCollection === "unsloth_ud") {
    scheduleDeferredStartupTask("model catalog refresh", async () => {
      await refreshModelManagerUnslothUdCatalog();
    }, () => {
      renderAndBind(sendMessage);
    });
  }
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

  const chatSplitWrap = document.querySelector<HTMLElement>("#chatSplitWrap");
  const chatSplitDivider = document.querySelector<HTMLDivElement>("#chatSplitDivider");
  if (chatSplitWrap && chatSplitDivider) {
    chatSplitDivider.onpointerdown = (event) => {
      event.preventDefault();
      chatSplitDivider.classList.add("dragging");
      chatSplitDivider.setPointerCapture(event.pointerId);

      const isVertical = state.chatSplitMode === "vertical";

      const onMove = (moveEvent: PointerEvent) => {
        const bounds = chatSplitWrap.getBoundingClientRect();
        const rawPercent = isVertical
          ? ((moveEvent.clientX - bounds.left) / bounds.width) * 100
          : ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
        const clamped = Math.max(20, Math.min(80, rawPercent));
        state.chatSplitPercent = Number(clamped.toFixed(2));
        chatSplitWrap.style.setProperty("--chat-split-percent", String(state.chatSplitPercent));
      };

      const onUp = (upEvent: PointerEvent) => {
        chatSplitDivider.classList.remove("dragging");
        chatSplitDivider.releasePointerCapture(upEvent.pointerId);
        chatSplitDivider.removeEventListener("pointermove", onMove);
        chatSplitDivider.removeEventListener("pointerup", onUp);
        chatSplitDivider.removeEventListener("pointercancel", onUp);
      };

      chatSplitDivider.addEventListener("pointermove", onMove);
      chatSplitDivider.addEventListener("pointerup", onUp);
      chatSplitDivider.addEventListener("pointercancel", onUp);
    };
  }
}
