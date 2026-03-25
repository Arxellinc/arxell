import type { ConversationSummaryRecord, LlamaRuntimeStatusResponse } from "../contracts";
import type { IconName } from "../icons";

export type SidebarTab =
  | "chat"
  | "history"
  | "workspace"
  | "tts"
  | "stt"
  | "llama_cpp"
  | "model_manager";

export interface UiMessage {
  role: "user" | "assistant";
  text: string;
  correlationId?: string;
}

export interface PrimaryPanelRenderState {
  conversationId: string;
  messages: UiMessage[];
  conversations: ConversationSummaryRecord[];
  llamaRuntime: LlamaRuntimeStatusResponse | null;
  llamaRuntimeSelectedEngineId: string;
  llamaRuntimeModelPath: string;
  llamaRuntimePort: number;
  llamaRuntimeCtxSize: number;
  llamaRuntimeGpuLayers: number;
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
  onCreateConversation: () => Promise<void>;
  onSelectConversation: (conversationId: string) => Promise<void>;
  onLlamaRuntimeRefresh: () => Promise<void>;
  onLlamaRuntimeInstall: (engineId: string) => Promise<void>;
  onLlamaRuntimeStart: (args: {
    engineId: string;
    modelPath: string;
    port: number;
    ctxSize: number;
    nGpuLayers: number;
  }) => Promise<void>;
  onLlamaRuntimeStop: () => Promise<void>;
}
