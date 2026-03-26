import type {
  ConversationSummaryRecord,
  LlamaRuntimeStatusResponse,
  ModelManagerHfCandidate,
  ModelManagerInstalledModel,
  SttModelRecord,
  TtsEngineStatusResponse
} from "../contracts";
import type { IconName } from "../icons";

export type SidebarTab =
  | "chat"
  | "history"
  | "workspace"
  | "devices"
  | "tts"
  | "stt"
  | "llama_cpp"
  | "model_manager";

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

export interface PrimaryPanelRenderState {
  conversationId: string;
  messages: UiMessage[];
  chatReasoningByCorrelation: Record<string, string>;
  chatThinkingPlacementByCorrelation: Record<string, "before" | "after">;
  chatThinkingExpandedByCorrelation: Record<string, boolean>;
  chatStreaming: boolean;
  devices: DevicesState;
  conversations: ConversationSummaryRecord[];
  chatThinkingEnabled: boolean;
  voiceModeEnabled: boolean;
  voiceModeBusy: boolean;
  ttsEnabled: boolean;
  ttsBusy: boolean;
  ttsLastError: string | null;
  ttsEngineStatus: TtsEngineStatusResponse | null;
  ttsVoices: string[];
  ttsSelectedVoice: string;
  ttsLanguage: string;
  ttsSpeed: number;
  ttsChunkMaxChars: number;
  ttsChunkPauseMs: number;
  sttReady: boolean;
  sttRunning: boolean;
  sttState: string;
  sttEngine: string;
  sttModelPath: string;
  sttLastTranscript: string;
  sttLastError: string | null;
  sttAutoSubmit: boolean;
  sttVadThreshold: number;
  sttMinSilenceMs: number;
  sttModels: SttModelRecord[];
  sttSelectedModelPath: string;
  sttDownloadBusy: boolean;
  sttDownloadMessage: string | null;
  sttConsoleLines: string[];
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
}

export interface PrimaryPanelDefinition {
  title: string;
  icon: IconName;
  renderBody: () => string;
  renderActions: () => string;
}

export interface PrimaryPanelBindings {
  onSendMessage: (text: string) => Promise<void>;
  onStopCurrentResponse: () => Promise<void>;
  onToggleThinkingPanel: (correlationId: string) => Promise<void>;
  onCreateConversation: () => Promise<void>;
  onClearChat: () => Promise<void>;
  onToggleChatThinking: () => Promise<void>;
  onToggleVoiceMode: () => Promise<void>;
  onDevicesRefresh: () => Promise<void>;
  onRequestMicrophoneAccess: () => Promise<void>;
  onRequestSpeakerAccess: () => Promise<void>;
  onToggleTtsEnabled: () => Promise<void>;
  onTtsCheckEngine: () => Promise<void>;
  onTtsTestSpeak: () => Promise<void>;
  onTtsSetVoice: (voice: string) => Promise<void>;
  onTtsSetLanguage: (language: string) => Promise<void>;
  onTtsSetSpeed: (speed: number) => Promise<void>;
  onTtsSetChunking: (args: { maxChars: number; pauseMs: number }) => Promise<void>;
  onSttRefresh: () => Promise<void>;
  onSttToggle: () => Promise<void>;
  onSttSetAutoSubmit: (enabled: boolean) => Promise<void>;
  onSttSetVad: (args: { threshold: number; minSilenceMs: number }) => Promise<void>;
  onSttSetModelPath: (modelPath: string) => Promise<void>;
  onSttDownloadModel: (args: { url: string; fileName?: string }) => Promise<void>;
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
}
