import type { ConversationSummaryRecord, LlamaRuntimeStatusResponse } from "../contracts";
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
  llamaRuntime: LlamaRuntimeStatusResponse | null;
  llamaRuntimeSelectedEngineId: string;
  llamaRuntimeModelPath: string;
  llamaRuntimePort: number;
  llamaRuntimeCtxSize: number;
  llamaRuntimeGpuLayers: number;
  llamaRuntimeMaxTokens: number | null;
  llamaRuntimeBusy: boolean;
  llamaRuntimeLogs: string[];
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
  onDevicesRefresh: () => Promise<void>;
  onRequestMicrophoneAccess: () => Promise<void>;
  onRequestSpeakerAccess: () => Promise<void>;
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
  }) => Promise<void>;
  onLlamaRuntimeStop: () => Promise<void>;
}
