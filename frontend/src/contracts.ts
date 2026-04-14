export type ToolMode = "sandbox" | "shell" | "root";

export interface ToolInvokeRequest {
  correlationId: string;
  toolId: string;
  action: string;
  mode: ToolMode;
  payload: Record<string, unknown>;
}

export interface ToolInvokeResponse {
  correlationId: string;
  toolId: string;
  action: string;
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
}

export interface ChatSendRequest {
  conversationId: string;
  userMessage: string;
  correlationId: string;
  thinkingEnabled?: boolean;
  chatMode?: "auto" | "agent" | "legacy";
  modelId?: string;
  modelName?: string;
  maxTokens?: number;
  attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  kind: "image";
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export interface ChatSendResponse {
  conversationId: string;
  assistantMessage: string;
  assistantThinking?: string;
  correlationId: string;
}

export interface ChatCancelRequest {
  correlationId: string;
  targetCorrelationId: string;
}

export interface ChatCancelResponse {
  correlationId: string;
  targetCorrelationId: string;
  cancelled: boolean;
}

export type MessageRole = "user" | "assistant";

export interface ConversationMessageRecord {
  conversationId: string;
  role: MessageRole;
  content: string;
  correlationId: string;
  timestampMs: number;
}

export interface ChatGetMessagesRequest {
  conversationId: string;
  correlationId: string;
}

export interface ChatGetMessagesResponse {
  conversationId: string;
  messages: ConversationMessageRecord[];
  correlationId: string;
}

export interface ConversationSummaryRecord {
  conversationId: string;
  title: string;
  messageCount: number;
  lastMessagePreview: string;
  updatedAtMs: number;
}

export interface ChatListConversationsRequest {
  correlationId: string;
}

export interface ChatListConversationsResponse {
  conversations: ConversationSummaryRecord[];
  correlationId: string;
}

export interface ChatDeleteConversationRequest {
  conversationId: string;
  correlationId: string;
}

export interface ChatDeleteConversationResponse {
  conversationId: string;
  correlationId: string;
  deleted: boolean;
}

export interface TerminalOpenSessionRequest {
  correlationId: string;
  cols?: number;
  rows?: number;
  shell?: string;
  cwd?: string;
}

export interface TerminalOpenSessionResponse {
  sessionId: string;
  correlationId: string;
}

export interface TerminalInputRequest {
  sessionId: string;
  input: string;
  correlationId: string;
}

export interface TerminalInputResponse {
  sessionId: string;
  accepted: boolean;
  correlationId: string;
}

export interface TerminalResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
  correlationId: string;
}

export interface TerminalResizeResponse {
  sessionId: string;
  correlationId: string;
}

export interface TerminalCloseSessionRequest {
  sessionId: string;
  correlationId: string;
}

export interface TerminalCloseSessionResponse {
  sessionId: string;
  closed: boolean;
  correlationId: string;
}

export interface WorkspaceToolRecord {
  toolId: string;
  title: string;
  description: string;
  category: string;
  core: boolean;
  optional: boolean;
  version: string;
  source: string;
  enabled: boolean;
  icon: boolean;
  status: string;
  entry?: string | null;
}

export interface WorkspaceToolsListRequest {
  correlationId: string;
}

export interface WorkspaceToolsListResponse {
  tools: WorkspaceToolRecord[];
  correlationId: string;
}

export interface WorkspaceToolSetEnabledRequest {
  correlationId: string;
  toolId: string;
  enabled: boolean;
}

export interface WorkspaceToolSetEnabledResponse {
  correlationId: string;
  toolId: string;
  enabled: boolean;
}

export interface WorkspaceToolSetIconRequest {
  correlationId: string;
  toolId: string;
  icon: boolean;
}

export interface WorkspaceToolSetIconResponse {
  correlationId: string;
  toolId: string;
  icon: boolean;
}

export interface WorkspaceToolForgetRequest {
  correlationId: string;
  toolId: string;
}

export interface WorkspaceToolForgetResponse {
  correlationId: string;
  toolId: string;
  forgotten: boolean;
}

export interface WorkspaceToolCreateAppPluginRequest {
  correlationId: string;
  toolId: string;
  name: string;
  icon: string;
  description: string;
}

export interface WorkspaceToolCreateAppPluginResponse {
  correlationId: string;
  tool: WorkspaceToolRecord;
}

export interface WorkspaceToolsExportRequest {
  correlationId: string;
}

export interface WorkspaceToolsExportResponse {
  correlationId: string;
  fileName: string;
  payloadJson: string;
}

export interface WorkspaceToolsImportRequest {
  correlationId: string;
  payloadJson: string;
}

export interface WorkspaceToolsImportResponse {
  correlationId: string;
  tools: WorkspaceToolRecord[];
}

export interface CustomToolCapabilityInvokeRequest {
  correlationId: string;
  customToolId: string;
  requestId: string;
  capability: string;
  payload: Record<string, unknown>;
}

export interface CustomToolCapabilityInvokeResponse {
  correlationId: string;
  customToolId: string;
  requestId: string;
  capability: string;
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
  code?: string;
}

export interface PluginCapabilityInvokeRequest {
  correlationId: string;
  pluginId: string;
  requestId: string;
  capability: string;
  payload: Record<string, unknown>;
}

export interface PluginCapabilityInvokeResponse {
  correlationId: string;
  pluginId: string;
  requestId: string;
  capability: string;
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
  code?: string;
}

export interface FilesListDirectoryRequest {
  correlationId: string;
  path?: string;
}

export interface FilesListDirectoryEntry {
  name: string;
  path: string;
  isDir: boolean;
  sizeBytes: number;
  modifiedMs: number | null;
}

export interface FilesListDirectoryResponse {
  correlationId: string;
  rootPath: string;
  listedPath: string;
  entries: FilesListDirectoryEntry[];
}

export interface FilesReadFileRequest {
  correlationId: string;
  path: string;
}

export interface FilesReadFileResponse {
  correlationId: string;
  path: string;
  content: string;
  sizeBytes: number;
  readOnly: boolean;
  isBinary: boolean;
}

export interface FilesWriteFileRequest {
  correlationId: string;
  path: string;
  content: string;
}

export interface FilesWriteFileResponse {
  correlationId: string;
  path: string;
  sizeBytes: number;
}

export interface FilesCreateDirectoryRequest {
  correlationId: string;
  path: string;
  recursive?: boolean;
}

export interface FilesCreateDirectoryResponse {
  correlationId: string;
  path: string;
  created: boolean;
}

export type ApiConnectionType = "llm" | "search" | "stt" | "tts" | "image" | "other";
export type ApiConnectionStatus = "verified" | "warning" | "pending";

export interface ApiConnectionRecord {
  id: string;
  apiType: ApiConnectionType;
  apiUrl: string;
  name: string | null;
  apiKeyPrefix: string;
  apiKeyMasked: string;
  modelName: string | null;
  costPerMonthUsd: number | null;
  status: ApiConnectionStatus;
  statusMessage: string;
  lastCheckedMs: number | null;
  createdMs: number;
  apiStandardPath: string | null;
  availableModels: string[];
}

export interface ApiConnectionsListRequest {
  correlationId: string;
}

export interface ApiConnectionsListResponse {
  correlationId: string;
  connections: ApiConnectionRecord[];
}

export interface ApiConnectionsExportRequest {
  correlationId: string;
}

export interface ApiConnectionsExportResponse {
  correlationId: string;
  fileName: string;
  payloadJson: string;
}

export interface ApiConnectionsImportRequest {
  correlationId: string;
  payloadJson: string;
}

export interface ApiConnectionsImportResponse {
  correlationId: string;
  connections: ApiConnectionRecord[];
}

export interface ApiConnectionGetSecretRequest {
  correlationId: string;
  id: string;
}

export interface ApiConnectionGetSecretResponse {
  correlationId: string;
  id: string;
  apiKey: string;
}

export interface WebSearchRequest {
  correlationId: string;
  query: string;
  mode?: string;
  num?: number;
  page?: number;
}

export interface WebSearchResponse {
  correlationId: string;
  result: Record<string, unknown>;
}

export interface ApiConnectionCreateRequest {
  correlationId: string;
  apiType: ApiConnectionType;
  apiUrl: string;
  name?: string;
  apiKey: string;
  modelName?: string;
  costPerMonthUsd?: number;
  apiStandardPath?: string;
}

export interface ApiConnectionCreateResponse {
  correlationId: string;
  connection: ApiConnectionRecord;
}

export interface ApiConnectionProbeRequest {
  correlationId: string;
  apiUrl: string;
  apiType?: ApiConnectionType;
  apiKey?: string;
  apiStandardPath?: string;
}

export interface ApiConnectionProbeResponse {
  correlationId: string;
  detectedApiType: ApiConnectionType;
  apiStandardPath: string | null;
  verifyUrl: string;
  models: string[];
  selectedModel: string | null;
  status: ApiConnectionStatus;
  statusMessage: string;
}

export interface ApiConnectionUpdateRequest {
  correlationId: string;
  id: string;
  apiType?: ApiConnectionType;
  apiUrl?: string;
  name?: string;
  apiKey?: string;
  modelName?: string;
  costPerMonthUsd?: number;
  apiStandardPath?: string;
}

export interface ApiConnectionUpdateResponse {
  correlationId: string;
  connection: ApiConnectionRecord;
}

export interface ApiConnectionReverifyRequest {
  correlationId: string;
  id: string;
}

export interface ApiConnectionReverifyResponse {
  correlationId: string;
  connection: ApiConnectionRecord;
}

export interface ApiConnectionDeleteRequest {
  correlationId: string;
  id: string;
}

export interface ApiConnectionDeleteResponse {
  correlationId: string;
  id: string;
  deleted: boolean;
}

export interface LlamaRuntimeStatusRequest {
  correlationId: string;
}

export interface LlamaRuntimePrerequisite {
  key: string;
  ok: boolean;
  message: string;
}

export interface LlamaRuntimeEngine {
  engineId: string;
  backend: string;
  label: string;
  isApplicable: boolean;
  isBundled: boolean;
  isInstalled: boolean;
  isReady: boolean;
  binaryPath: string | null;
  prerequisites: LlamaRuntimePrerequisite[];
}

export interface LlamaRuntimeStatusResponse {
  correlationId: string;
  state: string;
  activeEngineId: string | null;
  endpoint: string | null;
  pid: number | null;
  engines: LlamaRuntimeEngine[];
}

export interface LlamaRuntimeInstallRequest {
  correlationId: string;
  engineId: string;
}

export interface LlamaRuntimeInstallResponse {
  correlationId: string;
  engineId: string;
  installedPath: string;
}

export interface LlamaRuntimeStartRequest {
  correlationId: string;
  engineId: string;
  modelPath: string;
  port?: number;
  ctxSize?: number;
  nGpuLayers?: number;
  threads?: number;
  batchSize?: number;
  ubatchSize?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  flashAttn?: boolean;
  mmap?: boolean;
  mlock?: boolean;
  seed?: number;
}

export interface LlamaRuntimeStartResponse {
  correlationId: string;
  engineId: string;
  endpoint: string;
  pid: number;
}

export interface LlamaRuntimeStopRequest {
  correlationId: string;
}

export interface LlamaRuntimeStopResponse {
  correlationId: string;
  stopped: boolean;
}

export interface ModelManagerListInstalledRequest {
  correlationId: string;
}

export interface ModelManagerInstalledModel {
  id: string;
  name: string;
  path: string;
  sizeMb: number;
  modifiedMs: number;
}

export interface ModelManagerListInstalledResponse {
  correlationId: string;
  models: ModelManagerInstalledModel[];
}

export interface ModelManagerSearchHfRequest {
  correlationId: string;
  query: string;
  limit?: number;
}

export interface ModelManagerHfCandidate {
  id: string;
  repoId: string;
  fileName: string;
  sizeMb: number | null;
  downloadUrl: string | null;
}

export interface ModelManagerSearchHfResponse {
  correlationId: string;
  results: ModelManagerHfCandidate[];
}

export interface ModelManagerDownloadHfRequest {
  correlationId: string;
  repoId: string;
  fileName?: string;
}

export interface ModelManagerDownloadHfResponse {
  correlationId: string;
  model: ModelManagerInstalledModel;
}

export interface ModelManagerDeleteInstalledRequest {
  correlationId: string;
  modelId: string;
}

export interface ModelManagerDeleteInstalledResponse {
  correlationId: string;
  modelId: string;
  deleted: boolean;
}

export interface ModelManagerCatalogCsvRow {
  repoId: string;
  modelName: string;
  parameterCount: string;
  fileName: string;
  quant: string;
  sizeMb: number | null;
  downloadUrl: string;
}

export interface ModelManagerListCatalogCsvRequest {
  correlationId: string;
  listName: string;
}

export interface ModelManagerListCatalogCsvResponse {
  correlationId: string;
  listName: string;
  rows: ModelManagerCatalogCsvRow[];
}

export interface DevicesProbeMicrophoneRequest {
  correlationId: string;
  attemptOpen?: boolean;
}

export interface DevicesProbeMicrophoneResponse {
  correlationId: string;
  status: "enabled" | "not_enabled" | "no_device";
  message: string;
  inputDeviceCount: number;
  defaultInputName: string | null;
}

export interface TtsStatusRequest {
  correlationId: string;
}

export interface TtsStatusResponse {
  correlationId: string;
  engineId: string;
  engine: string;
  ready: boolean;
  message: string;
  modelPath: string;
  secondaryPath: string;
  voicesPath: string;
  tokensPath: string;
  dataDir: string;
  pythonPath: string;
  scriptPath: string;
  runtimeArchivePresent: boolean;
  availableModelPaths: string[];
  availableVoices: string[];
  selectedVoice: string;
  speed: number;
  lexiconStatus: string;
}

export interface TtsListVoicesRequest {
  correlationId: string;
}

export interface TtsListVoicesResponse {
  correlationId: string;
  voices: string[];
  selectedVoice: string;
}

export interface TtsSpeakRequest {
  correlationId: string;
  text: string;
  voice?: string;
  speed?: number;
}

export interface TtsSpeakResponse {
  correlationId: string;
  engineId: string;
  voice: string;
  speed: number;
  sampleRate: number;
  durationMs: number;
  audioBytes: number[];
}

export interface TtsStopRequest {
  correlationId: string;
}

export interface TtsStopResponse {
  correlationId: string;
  stopped: boolean;
}

export interface TtsSelfTestRequest {
  correlationId: string;
}

export interface TtsSelfTestResponse {
  correlationId: string;
  ok: boolean;
  message: string;
  bytes: number;
  sampleRate: number;
  durationMs: number;
}

export interface TtsSettingsGetRequest {
  correlationId: string;
}

export interface TtsSettingsGetResponse {
  correlationId: string;
  engineId: string;
  engine: string;
  voice: string;
  speed: number;
  modelPath: string;
  secondaryPath: string;
  voicesPath: string;
  tokensPath: string;
  dataDir: string;
  pythonPath: string;
}

export interface TtsSettingsSetRequest {
  correlationId: string;
  engine?: string;
  voice?: string;
  speed?: number;
  modelPath?: string;
  secondaryPath?: string;
  voicesPath?: string;
  tokensPath?: string;
  dataDir?: string;
  pythonPath?: string;
}

export interface TtsSettingsSetResponse {
  correlationId: string;
  ok: boolean;
  engine: string;
  voice: string;
  speed: number;
}

export interface TtsDownloadModelRequest {
  correlationId: string;
  url?: string;
}

export interface TtsDownloadModelResponse {
  correlationId: string;
  ok: boolean;
  message: string;
  modelPath: string;
  voicesPath: string;
  tokensPath: string;
  dataDir: string;
}

export interface AppVersionResponse {
  version: string;
}

export interface AppResourceUsageRequest {
  correlationId: string;
}

export interface AppResourceUsageResponse {
  correlationId: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  networkRxBytesPerSec: number | null;
  networkTxBytesPerSec: number | null;
}

export type FlowMode = "plan" | "build";
export type FlowRunStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "stopped";
export type FlowStepState = "pending" | "running" | "complete" | "error" | "skipped";

export interface FlowStartRequest {
  correlationId: string;
  mode: FlowMode;
  maxIterations?: number;
  dryRun?: boolean;
  autoPush?: boolean;
  promptPlanPath?: string;
  promptBuildPath?: string;
  planPath?: string;
  specsGlob?: string;
  backpressureCommands?: string[];
  implementCommand?: string;
  phaseModels?: Record<string, string>;
}

export interface FlowStartResponse {
  correlationId: string;
  runId: string;
  status: FlowRunStatus;
}

export interface FlowStopRequest {
  correlationId: string;
  runId: string;
}

export interface FlowStopResponse {
  correlationId: string;
  runId: string;
  stopped: boolean;
}

export interface FlowPauseRequest {
  correlationId: string;
  runId: string;
  paused: boolean;
}

export interface FlowPauseResponse {
  correlationId: string;
  runId: string;
  paused: boolean;
  updated: boolean;
}

export interface FlowNudgeRequest {
  correlationId: string;
  runId: string;
  message: string;
}

export interface FlowNudgeResponse {
  correlationId: string;
  runId: string;
  accepted: boolean;
}

export interface FlowStatusRequest {
  correlationId: string;
  runId: string;
}

export interface FlowListRunsRequest {
  correlationId: string;
}

export interface FlowRerunValidationRequest {
  correlationId: string;
  runId: string;
  iteration?: number;
}

export interface FlowRerunValidationResult {
  command: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface FlowRerunValidationResponse {
  correlationId: string;
  runId: string;
  iteration: number | null;
  ok: boolean;
  results: FlowRerunValidationResult[];
}

export interface FlowStepStatus {
  step: string;
  state: FlowStepState;
  startedAtMs: number | null;
  completedAtMs: number | null;
  result: string | null;
  error: string | null;
}

export interface FlowIterationStatus {
  index: number;
  status: FlowRunStatus;
  startedAtMs: number;
  completedAtMs: number | null;
  taskId: string | null;
  steps: FlowStepStatus[];
}

export interface FlowRunRecord {
  runId: string;
  mode: FlowMode;
  status: FlowRunStatus;
  maxIterations: number | null;
  currentIteration: number;
  startedAtMs: number;
  completedAtMs: number | null;
  dryRun: boolean;
  autoPush: boolean;
  promptPlanPath: string;
  promptBuildPath: string;
  planPath: string;
  specsGlob: string;
  backpressureCommands: string[];
  implementCommand: string;
  phaseModels?: Record<string, string>;
  summary: string | null;
  iterations: FlowIterationStatus[];
}

export interface FlowStatusResponse {
  correlationId: string;
  run: FlowRunRecord;
}

export interface FlowListRunsResponse {
  correlationId: string;
  runs: FlowRunRecord[];
}

export interface ChatStreamStartPayload {
  conversationId: string;
}

export interface ChatStreamChunkPayload {
  conversationId: string;
  delta: string;
  done: boolean;
}

export interface ChatStreamReasoningChunkPayload {
  conversationId: string;
  delta: string;
  done: boolean;
}

export interface ChatStreamCompletePayload {
  conversationId: string;
  assistantLength: number;
}

export type Subsystem =
  | "frontend"
  | "ipc"
  | "service"
  | "runtime"
  | "registry"
  | "tool"
  | "memory"
  | "persistence";

export type EventStage = "start" | "progress" | "complete" | "error";
export type EventSeverity = "debug" | "info" | "warn" | "error";

export interface AppEvent {
  timestampMs: number;
  correlationId: string;
  subsystem: Subsystem;
  action: string;
  stage: EventStage;
  severity: EventSeverity;
  payload: Record<string, unknown> | string | number | boolean | null;
}
