export type ToolMode = "sandbox" | "shell" | "root";

export interface ChatSendRequest {
  conversationId: string;
  userMessage: string;
  correlationId: string;
}

export interface ChatSendResponse {
  conversationId: string;
  assistantMessage: string;
  correlationId: string;
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

export interface ChatStreamStartPayload {
  conversationId: string;
}

export interface ChatStreamChunkPayload {
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
