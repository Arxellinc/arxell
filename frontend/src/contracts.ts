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
