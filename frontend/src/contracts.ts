export type ToolMode = "sandbox" | "shell" | "root";

export interface ChatSendRequest {
  conversationId: string;
  userMessage: string;
  correlationId: string;
  thinkingEnabled?: boolean;
  maxTokens?: number;
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
  status: string;
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

export interface WorkspaceToolsExportRequest {
  correlationId: string;
}

export interface WorkspaceToolsExportResponse {
  correlationId: string;
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
}

export interface ApiConnectionsListRequest {
  correlationId: string;
}

export interface ApiConnectionsListResponse {
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

export interface AppVersionResponse {
  version: string;
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
