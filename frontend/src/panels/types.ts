import type {
  ApiConnectionRecord,
  ApiConnectionType,
  ConversationSummaryRecord,
  LlamaRuntimeStatusResponse,
  ModelManagerHfCandidate,
  ModelManagerInstalledModel
} from "../contracts";
import type { IconName } from "../icons";

export type SidebarTab =
  | "chat"
  | "history"
  | "workspace"
  | "devices"
  | "apis"
  | "tts"
  | "stt"
  | "llama_cpp"
  | "model_manager"
  | "settings";

export interface DevicesState {
  microphonePermission: "not_enabled" | "enabled" | "no_device";
  speakerPermission: "not_enabled" | "enabled" | "no_device";
  defaultAudioInput: string;
  defaultAudioOutput: string;
  audioInputCount: number;
  audioOutputCount: number;
  webcamCount: number;
  keyboardDetected: boolean;
  mouseDetected: boolean;
  lastUpdatedLabel: string;
}

export interface UiMessage {
  role: "user" | "assistant";
  text: string;
  correlationId?: string;
}

export interface ChatToolEventRow {
  rowId: string;
  title: string;
  details: string;
  icon: IconName;
}

export interface SttState {
  status: "idle" | "starting" | "running" | "error";
  message: string | null;
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
}

export interface ConsoleEntry {
  timestampMs: number;
  level: "log" | "info" | "warn" | "error" | "debug";
  source: "browser" | "app";
  message: string;
}

export interface ApiConnectionDraft {
  apiType: ApiConnectionType;
  apiUrl: string;
  name: string;
  apiKey: string;
  modelName: string;
  costPerMonthUsd: string;
  apiStandardPath: string;
}

export interface PrimaryPanelRenderState {
  displayMode: "dark" | "light" | "terminal";
  displayModePreference: "dark" | "light" | "system" | "terminal";
  conversationId: string;
  messages: UiMessage[];
  chatReasoningByCorrelation: Record<string, string>;
  chatThinkingPlacementByCorrelation: Record<string, "before" | "after">;
  chatThinkingExpandedByCorrelation: Record<string, boolean>;
  chatToolRowsByCorrelation: Record<string, ChatToolEventRow[]>;
  chatToolRowExpandedById: Record<string, boolean>;
  chatStreamCompleteByCorrelation: Record<string, boolean>;
  chatStreaming: boolean;
  chatDraft: string;
  chatAttachedFileName: string | null;
  chatAttachedFileContent: string | null;
  devices: DevicesState;
  apiConnections: ApiConnectionRecord[];
  apiFormOpen: boolean;
  apiDraft: ApiConnectionDraft;
  apiEditingId: string | null;
  apiMessage: string | null;
  conversations: ConversationSummaryRecord[];
  chatThinkingEnabled: boolean;
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
  stt: SttState;
  consoleEntries: ConsoleEntry[];
}

export interface PrimaryPanelDefinition {
  title: string;
  icon: IconName;
  renderBody: () => string;
  renderActions: () => string;
}

export interface PrimaryPanelBindings {
  onSendMessage: (text: string) => Promise<void>;
  onUpdateChatDraft: (text: string) => void;
  onSetChatAttachment: (fileName: string, content: string) => void;
  onClearChatAttachment: () => void;
  onStopCurrentResponse: () => Promise<void>;
  onToggleThinkingPanel: (correlationId: string) => Promise<void>;
  onCreateConversation: () => Promise<void>;
  onClearChat: () => Promise<void>;
  onToggleChatThinking: () => Promise<void>;
  onDevicesRefresh: () => Promise<void>;
  onRequestMicrophoneAccess: () => Promise<void>;
  onRequestSpeakerAccess: () => Promise<void>;
  onApiConnectionsRefresh: () => Promise<void>;
  onApiConnectionsSetFormOpen: (open: boolean) => Promise<void>;
  onApiConnectionDraftChange: (patch: Partial<ApiConnectionDraft>) => Promise<void>;
  onApiConnectionSave: () => Promise<void>;
  onApiConnectionEdit: (id: string) => Promise<void>;
  onApiConnectionReverify: (id: string) => Promise<void>;
  onApiConnectionDelete: (id: string) => Promise<void>;
  onSelectConversation: (conversationId: string) => Promise<void>;
  onExportConversation: (conversationId: string) => Promise<void>;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  onLlamaRuntimeRefresh: () => Promise<void>;
  onLlamaRuntimeInstall: (engineId: string) => Promise<void>;
  onLlamaRuntimeBrowseModelPath: () => Promise<void>;
  onLlamaRuntimeSetMaxTokens: (maxTokens: number | null) => Promise<void>;
  onLlamaRuntimeClearLogs: () => Promise<void>;
  onLlamaRuntimeStart: (args: {
    engineId: string;
    modelPath: string;
    port: number;
    ctxSize: number;
    nGpuLayers: number;
    threads: number | null;
    batchSize: number | null;
    ubatchSize: number | null;
    temperature: number;
    topP: number;
    topK: number;
    repeatPenalty: number;
    flashAttn: boolean;
    mmap: boolean;
    mlock: boolean;
    seed: number | null;
  }) => Promise<void>;
  onLlamaRuntimeStop: () => Promise<void>;
  onModelManagerRefreshInstalled: () => Promise<void>;
  onModelManagerSetQuery: (query: string) => Promise<void>;
  onModelManagerSetCollection: (collection: string) => Promise<void>;
  onModelManagerSearchHf: () => Promise<void>;
  onModelManagerDownloadHf: (args: { repoId: string; fileName: string }) => Promise<void>;
  onModelManagerSetUdQuant: (args: { repoId: string; fileName: string }) => Promise<void>;
  onModelManagerUseAsLlamaPath: (modelPath: string) => Promise<void>;
  onModelManagerEjectActive: () => Promise<void>;
  onModelManagerDeleteInstalled: (modelId: string) => Promise<void>;
  onToggleStt: () => Promise<void>;
  onUpdateSttVadSetting: (key: keyof Pick<SttState,
    "vadBaseThreshold" |
    "vadStartFrames" |
    "vadEndFrames" |
    "vadDynamicMultiplier" |
    "vadNoiseAdaptationAlpha" |
    "vadPreSpeechMs" |
    "vadMinUtteranceMs" |
    "vadMaxUtteranceS" |
    "vadForceFlushS">, value: number) => Promise<void>;
  onSetDisplayMode: (mode: "dark" | "light" | "terminal") => Promise<void>;
  onSetDisplayModePreference: (mode: "dark" | "light" | "system" | "terminal") => Promise<void>;
}
