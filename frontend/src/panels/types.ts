import type {
  ChatAttachment,
  ApiConnectionRecord,
  ApiConnectionType,
  ConversationSummaryRecord,
  LlamaRuntimeStatusResponse,
  ModelManagerHfCandidate,
  ModelManagerInstalledModel,
  PersistedVoiceSettings,
  VadManifest,
  DuplexMode,
  HandoffState,
  SpeculationState,
  VoiceRuntimeState
} from "../contracts";
import type { ChatModelCapabilities } from "../modelCapabilities";
import type { IconName } from "../icons";
import type { ProjectRecord } from "../projectsStore";

export type SidebarTab =
  | "chat"
  | "history"
  | "workspace"
  | "devices"
  | "apis"
  | "tts"
  | "stt"
  | "vad"
  | "llama_cpp"
  | "model_manager"
  | "avatar"
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

export interface ChatPanelState {
  panelId: string;
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
  chatActiveModelId: string;
  chatActiveModelLabel: string;
  chatModelStatusMessage: string | null;
  llamaRuntimeBusy: boolean;
  chatActiveModelCapabilities: ChatModelCapabilities;
  chatThinkingEnabled: boolean;
  chatTtsEnabled: boolean;
  chatTtsPlaying: boolean;
  activeChatCorrelationId: string | null;
}

export interface AvatarMeshSetting {
  key: string;
  visible: boolean;
  color: string;
  opacity: number;
  textureUrl: string;
  textureName: string;
}

export interface AvatarMorphSetting {
  name: string;
  value: number;
}

export interface AvatarBoneSetting {
  key: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

export const AVATAR_MORPHS = [
  "Bra", "Pantys", "EYE_R_Up", "EYE_R_Dw", "EYE_R_Rt", "EYE_R_Lt",
  "EYE_L_Up", "EYE_L_Dw", "EYE_L_Lt", "EYE_L_Rt", "EYE_close_R", "EYE_close_L",
  "EM_Brows_up", "EM_Brows_frown", "EM_Mouth_open", "EM_scream",
  "PH_JAW_Fwd", "PH_JAW_Lft", "PH_JAW_Rgt", "EM_Eyes_shut", "EM_Fright",
  "EM_Mouth_kiss", "EM_Mouth_Blow", "EM_Mouth_smile", "EM_Mouth_smilewide",
  "EM_Mouth_disgust", "EM_Mouth_R_Up", "EM_Mouth_L_Up",
  "PH_A", "PH_O-U", "PH_B-P", "PH_D-S", "PH_V-F", "PH_I-E", "PH_CH-SH",
  "Toes", "Tongue_open", "Tongue_scream", "Tongue_out2"
] as const;

export const AVATAR_ARM_BONES = [
  { key: "lClavicle", label: "L Clavicle" },
  { key: "rClavicle", label: "R Clavicle" },
  { key: "lUpperArm", label: "L Upper Arm" },
  { key: "rUpperArm", label: "R Upper Arm" },
  { key: "lForearm", label: "L Forearm" },
  { key: "rForearm", label: "R Forearm" },
  { key: "lHand", label: "L Hand" },
  { key: "rHand", label: "R Hand" },
] as const;

export const AVATAR_MESH_GROUPS = [
  { key: "wireframe", label: "Wireframe" },
  { key: "body", label: "Body" },
  { key: "eyes", label: "Eyes" },
  { key: "eyebrows", label: "Eyebrows" },
  { key: "hair", label: "Hair" },
  { key: "jawTop", label: "Jaw Top" },
  { key: "jawBtm", label: "Jaw Bottom" },
  { key: "tongue", label: "Tongue" },
] as const;

export function defaultAvatarMeshes(): AvatarMeshSetting[] {
  return AVATAR_MESH_GROUPS.map((g) => ({
    key: g.key,
    visible: g.key !== "eyebrows" && g.key !== "hair",
    color: g.key === "wireframe"
      ? "#00ccff"
      : g.key === "jawTop"
      ? "#C0BFBC"
      : g.key === "body" || g.key === "eyes" || g.key === "jawBtm" || g.key === "tongue"
      ? "#102527"
      : "#16E9F5",
    opacity: 1,
    textureUrl: "",
    textureName: "",
  }));
}

export interface AvatarState {
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
}

export interface SttState {
  status: "idle" | "starting" | "running" | "error";
  message: string | null;
  backend: "whisper_cpp" | "sherpa_onnx";
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
  // Model settings
  selectedModel: string;
  availableModels: string[];
  language: string;
  threads: number;
  showAdvancedSettings: boolean;
  modelDownloadProgress: number | null;
  modelDownloadError: string | null;
}

export interface SttModelDownload {
  name: string;
  url: string;
  fileName: string;
}

export interface TtsState {
  status: "idle" | "ready" | "busy" | "error";
  message: string | null;
  engineId: string;
  engine: "kokoro" | "piper" | "matcha" | "kitten" | "pocket";
  ready: boolean;
  modelPath: string;
  voices: string[];
  selectedVoice: string;
  speed: number;
  lexiconStatus: string;
  testText: string;
  lastDurationMs: number | null;
  lastBytes: number | null;
  lastSampleRate: number | null;
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
  chatRoutePreference: "auto" | "agent" | "legacy";
  showAppResourceCpu: boolean;
  showAppResourceMemory: boolean;
  showAppResourceNetwork: boolean;
  showBottomEngine: boolean;
  showBottomModel: boolean;
  showBottomContext: boolean;
  showBottomSpeed: boolean;
  showBottomTtsLatency: boolean;
  chat: ChatPanelState;
  chatToolIntentByCorrelation: Record<string, boolean>;
  chatFirstAssistantChunkMsByCorrelation: Record<string, number>;
  chatFirstReasoningChunkMsByCorrelation: Record<string, number>;
  chatTtsLatencyMs: number | null;
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
  conversations: ConversationSummaryRecord[];
  llamaRuntime: LlamaRuntimeStatusResponse | null;
  llamaRuntimeSelectedEngineId: string;
  llamaRuntimeModelPath: string;
  llamaRuntimeActiveModelPath: string;
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
  modelManagerActiveTab: "all_models" | "download";
  modelManagerDisabledModelIds: string[];
  modelManagerInfoModalModelId: string | null;
  chatModelOptions: Array<{
    id: string;
    label: string;
    source: "api" | "local";
    modelName: string;
    detail: string;
  }>;
  allModelsList: Array<{
    id: string;
    label: string;
    source: "api" | "local";
    modelName: string;
    detail: string;
  }>;
  modelManagerQuery: string;
  modelManagerCollection: string;
  modelManagerSearchResults: ModelManagerHfCandidate[];
  modelManagerBusy: boolean;
  modelManagerDownloading: boolean;
  modelManagerActiveDownloadKey: string | null;
  modelManagerActiveDownloadFileName: string | null;
  modelManagerActiveDownloadCorrelationId: string | null;
  modelManagerDownloadReceivedBytes: number | null;
  modelManagerDownloadTotalBytes: number | null;
  modelManagerDownloadPercent: number | null;
  modelManagerDownloadSpeedBytesPerSec: number | null;
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
  tts: TtsState;
  consoleEntries: ConsoleEntry[];
  projectsById: Record<string, ProjectRecord>;
  projectsSelectedId: string | null;
  projectsNameDraft: string;
  projectsModalOpen: boolean;
  avatar: AvatarState;
  avatarActiveTab: "appearance" | "animation" | "morphTargets";
  avatarLipSyncStrength: number;
  avatarLipSyncJawBlend: number;
  avatarLipSyncJawAmp: number;
  avatarLipSyncPhonemeBoost: number;
  avatarLipSyncJawMorphScale: number;
  avatarLipSyncOpenRate: number;
  avatarLipSyncCloseRate: number;
  avatarLipSyncFallbackRate: number;
  avatarJawBtmX: number;
  avatarJawBtmY: number;
  avatarJawBtmZ: number;
  avatarJawBtmValue: number;
  avatarJawTopX: number;
  avatarJawTopY: number;
  avatarJawTopZ: number;
  avatarJawTopValue: number;
}

export interface PrimaryPanelDefinition {
  title: string;
  icon: IconName;
  renderBody: () => string;
  renderActions: () => string;
}

export interface PrimaryPanelBindings {
  onSendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  onUpdateChatDraft: (text: string) => void;
  onSetChatAttachment: (fileName: string, content: string) => void;
  onClearChatAttachment: () => void;
  onStopCurrentResponse: () => Promise<void>;
  onSpeakLatestAssistantTts: () => Promise<void>;
  onToggleVoiceMode: () => Promise<void>;
  onToggleThinkingPanel: (correlationId: string) => Promise<void>;
  onCreateConversation: () => Promise<void>;
  onClearChat: () => Promise<void>;
  onToggleChatThinking: () => Promise<void>;
  onDevicesRefresh: () => Promise<void>;
  onRequestMicrophoneAccess: () => Promise<void>;
  onRequestSpeakerAccess: () => Promise<void>;
  onApiConnectionsRefresh: () => Promise<void>;
  onApiConnectionsExportJson: () => Promise<void>;
  onApiConnectionsExportCsv: () => Promise<void>;
  onApiConnectionsImportJson: () => Promise<void>;
  onApiConnectionsImportCsv: () => Promise<void>;
  onApiConnectionsSetFormOpen: (open: boolean) => Promise<void>;
  onApiConnectionDraftChange: (patch: Partial<ApiConnectionDraft>) => Promise<void>;
  onApiConnectionProbe: () => Promise<void>;
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
  onModelManagerSetActiveTab: (tab: "all_models" | "download") => Promise<void>;
  onModelManagerToggleModelAvailability: (modelId: string) => Promise<void>;
  onModelManagerSetInfoModalModelId: (modelId: string | null) => Promise<void>;
  onModelManagerNavigateToApis: () => Promise<void>;
  onModelManagerSetQuery: (query: string) => Promise<void>;
  onModelManagerSetCollection: (collection: string) => Promise<void>;
  onModelManagerSearchHf: () => Promise<void>;
  onModelManagerDownloadHf: (args: { repoId: string; fileName: string }) => Promise<void>;
  onModelManagerCancelDownload: () => Promise<void>;
  onModelManagerSetUdQuant: (args: { repoId: string; fileName: string }) => Promise<void>;
  onModelManagerUseAsLlamaPath: (modelPath: string) => Promise<void>;
  onModelManagerEjectActive: () => Promise<void>;
  onModelManagerDeleteInstalled: (modelId: string) => Promise<void>;
  onToggleStt: () => Promise<void>;
  onSetSttBackend: (backend: "whisper_cpp" | "sherpa_onnx") => Promise<void>;
  onSetSttModel: (model: string) => Promise<void>;
  onSetSttLanguage: (language: string) => Promise<void>;
  onSetSttThreads: (threads: number) => Promise<void>;
  onToggleSttAdvancedSettings: () => Promise<void>;
  onDownloadSttModel: (fileName: string) => Promise<void>;
  onTtsStart: () => Promise<void>;
  onTtsRefresh: () => Promise<void>;
  onTtsSetVoice: (voice: string) => Promise<void>;
  onTtsSetEngine: (engine: "kokoro" | "piper" | "matcha" | "kitten" | "pocket") => Promise<void>;
  onTtsSetSpeed: (speed: number) => Promise<void>;
  onTtsSetTestText: (text: string) => Promise<void>;
  onTtsBrowseModelPath: () => Promise<void>;
  onTtsSpeakTest: () => Promise<void>;
  onTtsStop: () => Promise<void>;
  onTtsSelfTest: () => Promise<void>;
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
  onSetVadMethod: (methodId: string) => Promise<void>;
  onSetVadIncludeExperimental: (value: boolean) => Promise<void>;
  onUpdateVadMethodConfig: (key: string, value: number) => Promise<void>;
  onRefreshVadSettings: () => Promise<void>;
  onRequestVadHandoff: (targetMethodId: string) => Promise<void>;
  onSetVadShadowMethod: (methodId: string | null) => Promise<void>;
  onStartVadShadowEval: () => Promise<void>;
  onStopVadShadowEval: () => Promise<void>;
  onSetVoiceDuplexMode: (mode: DuplexMode) => Promise<void>;
  onSetDisplayMode: (mode: "dark" | "light" | "terminal") => Promise<void>;
  onSetDisplayModePreference: (mode: "dark" | "light" | "system" | "terminal") => Promise<void>;
  onSetChatRoutePreference: (mode: "auto" | "agent" | "legacy") => Promise<void>;
  onSetShowAppResourceCpu: (value: boolean) => Promise<void>;
  onSetShowAppResourceMemory: (value: boolean) => Promise<void>;
  onSetShowAppResourceNetwork: (value: boolean) => Promise<void>;
  onSetShowBottomEngine: (value: boolean) => Promise<void>;
  onSetShowBottomModel: (value: boolean) => Promise<void>;
  onSetShowBottomContext: (value: boolean) => Promise<void>;
  onSetShowBottomSpeed: (value: boolean) => Promise<void>;
  onSetShowBottomTtsLatency: (value: boolean) => Promise<void>;
  onToggleAvatar: () => Promise<void>;
  onSetAvatarPlacement: (placement: "chat" | "tools") => Promise<void>;
  onToggleAvatarMaximized: () => Promise<void>;
  onAvatarUploadImage: () => Promise<void>;
  onAvatarUseWireframe: () => Promise<void>;
  onAvatarMeshUpdate: (key: string, updates: Partial<AvatarMeshSetting>) => Promise<void>;
  onAvatarMeshTextureUpload: (key: string) => void;
  onAvatarBorderChange: (size: number, color: string) => Promise<void>;
  onAvatarBgChange: (color: string, opacity: number) => Promise<void>;
  onAvatarSetActiveTab: (tab: "appearance" | "animation" | "morphTargets") => Promise<void>;
  onAvatarMorphChange: (name: string, value: number) => Promise<void>;
  onAvatarBoneChange: (key: string, axis: "x" | "y" | "z", value: number) => Promise<void>;
  onAvatarLipSyncChange: (key: string, value: number) => void;
  onAvatarLipSyncReset: () => Promise<void>;
  onProjectCreate: (name: string) => Promise<void>;
  onProjectSelect: (id: string | null) => void;
  onProjectDelete: (id: string) => Promise<void>;
  onProjectUpdateField: (id: string, field: "name" | "rootPath", value: string) => void;
  onProjectSetModalOpen: (open: boolean) => void;
  onProjectSetNameDraft: (name: string) => void;
}
