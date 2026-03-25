import type {
  AppEvent,
  AppVersionResponse,
  ChatCancelRequest,
  ChatCancelResponse,
  ChatDeleteConversationRequest,
  ChatDeleteConversationResponse,
  ChatGetMessagesRequest,
  ChatGetMessagesResponse,
  ChatListConversationsRequest,
  ChatListConversationsResponse,
  DevicesProbeMicrophoneRequest,
  DevicesProbeMicrophoneResponse,
  LlamaRuntimeInstallRequest,
  LlamaRuntimeInstallResponse,
  LlamaRuntimeStartRequest,
  LlamaRuntimeStartResponse,
  LlamaRuntimeStatusRequest,
  LlamaRuntimeStatusResponse,
  LlamaRuntimeStopRequest,
  LlamaRuntimeStopResponse,
  ModelManagerDeleteInstalledRequest,
  ModelManagerDeleteInstalledResponse,
  ModelManagerDownloadHfRequest,
  ModelManagerDownloadHfResponse,
  ModelManagerListCatalogCsvRequest,
  ModelManagerListCatalogCsvResponse,
  ModelManagerListInstalledRequest,
  ModelManagerListInstalledResponse,
  ModelManagerSearchHfRequest,
  ModelManagerSearchHfResponse,
  ChatSendRequest,
  ChatSendResponse,
  TerminalCloseSessionRequest,
  TerminalCloseSessionResponse,
  TerminalInputRequest,
  TerminalInputResponse,
  TerminalOpenSessionRequest,
  TerminalOpenSessionResponse,
  TerminalResizeRequest,
  TerminalResizeResponse,
  WorkspaceToolRecord,
  WorkspaceToolsListRequest,
  WorkspaceToolsListResponse,
  WorkspaceToolSetEnabledRequest,
  WorkspaceToolSetEnabledResponse
} from "./contracts";
import { APP_BUILD_VERSION } from "./version";

export interface ChatIpcClient {
  getAppVersion(): Promise<AppVersionResponse>;
  sendMessage(request: ChatSendRequest): Promise<ChatSendResponse>;
  cancelMessage(request: ChatCancelRequest): Promise<ChatCancelResponse>;
  getMessages(request: ChatGetMessagesRequest): Promise<ChatGetMessagesResponse>;
  listConversations(request: ChatListConversationsRequest): Promise<ChatListConversationsResponse>;
  deleteConversation(
    request: ChatDeleteConversationRequest
  ): Promise<ChatDeleteConversationResponse>;
  openTerminalSession(request: TerminalOpenSessionRequest): Promise<TerminalOpenSessionResponse>;
  sendTerminalInput(request: TerminalInputRequest): Promise<TerminalInputResponse>;
  resizeTerminal(request: TerminalResizeRequest): Promise<TerminalResizeResponse>;
  closeTerminalSession(
    request: TerminalCloseSessionRequest
  ): Promise<TerminalCloseSessionResponse>;
  listWorkspaceTools(request: WorkspaceToolsListRequest): Promise<WorkspaceToolsListResponse>;
  setWorkspaceToolEnabled(
    request: WorkspaceToolSetEnabledRequest
  ): Promise<WorkspaceToolSetEnabledResponse>;
  getLlamaRuntimeStatus(request: LlamaRuntimeStatusRequest): Promise<LlamaRuntimeStatusResponse>;
  installLlamaRuntimeEngine(
    request: LlamaRuntimeInstallRequest
  ): Promise<LlamaRuntimeInstallResponse>;
  startLlamaRuntime(request: LlamaRuntimeStartRequest): Promise<LlamaRuntimeStartResponse>;
  stopLlamaRuntime(request: LlamaRuntimeStopRequest): Promise<LlamaRuntimeStopResponse>;
  modelManagerListInstalled(
    request: ModelManagerListInstalledRequest
  ): Promise<ModelManagerListInstalledResponse>;
  modelManagerSearchHf(request: ModelManagerSearchHfRequest): Promise<ModelManagerSearchHfResponse>;
  modelManagerDownloadHf(
    request: ModelManagerDownloadHfRequest
  ): Promise<ModelManagerDownloadHfResponse>;
  modelManagerDeleteInstalled(
    request: ModelManagerDeleteInstalledRequest
  ): Promise<ModelManagerDeleteInstalledResponse>;
  modelManagerListCatalogCsv(
    request: ModelManagerListCatalogCsvRequest
  ): Promise<ModelManagerListCatalogCsvResponse>;
  probeMicrophoneDevice(
    request: DevicesProbeMicrophoneRequest
  ): Promise<DevicesProbeMicrophoneResponse>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}

export type IpcRuntimeMode = "tauri" | "mock";

export interface ChatIpcClientFactoryResult {
  client: ChatIpcClient;
  runtimeMode: IpcRuntimeMode;
}

export async function createChatIpcClient(): Promise<ChatIpcClientFactoryResult> {
  if (isTauriRuntime()) {
    return { client: await createTauriChatIpcClient(), runtimeMode: "tauri" };
  }
  return { client: new MockChatIpcClient(), runtimeMode: "mock" };
}

class TauriChatIpcClient implements ChatIpcClient {
  private listeners: Array<(event: AppEvent) => void> = [];
  private unlisten: null | (() => void) = null;

  constructor(
    private readonly invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
    private readonly listenFn: (
      event: string,
      handler: (payload: unknown) => void
    ) => Promise<() => void>
  ) {}

  async initialize(): Promise<void> {
    this.unlisten = await this.listenFn("app:event", (payload) => {
      const event = asAppEvent(payload);
      if (!event) return;
      for (const listener of this.listeners) {
        listener(event);
      }
    });
  }

  onEvent(listener: (event: AppEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getAppVersion(): Promise<AppVersionResponse> {
    return this.invokeFn<AppVersionResponse>("cmd_app_version");
  }

  sendMessage(request: ChatSendRequest): Promise<ChatSendResponse> {
    return this.invokeFn<ChatSendResponse>("cmd_chat_send_message", { request });
  }

  cancelMessage(request: ChatCancelRequest): Promise<ChatCancelResponse> {
    return this.invokeFn<ChatCancelResponse>("cmd_chat_cancel_message", { request });
  }

  getMessages(request: ChatGetMessagesRequest): Promise<ChatGetMessagesResponse> {
    return this.invokeFn<ChatGetMessagesResponse>("cmd_chat_get_messages", { request });
  }

  listConversations(
    request: ChatListConversationsRequest
  ): Promise<ChatListConversationsResponse> {
    return this.invokeFn<ChatListConversationsResponse>("cmd_chat_list_conversations", {
      request
    });
  }

  deleteConversation(
    request: ChatDeleteConversationRequest
  ): Promise<ChatDeleteConversationResponse> {
    return this.invokeFn<ChatDeleteConversationResponse>("cmd_chat_delete_conversation", {
      request
    });
  }

  openTerminalSession(
    request: TerminalOpenSessionRequest
  ): Promise<TerminalOpenSessionResponse> {
    return this.invokeFn<TerminalOpenSessionResponse>("cmd_terminal_open_session", { request });
  }

  sendTerminalInput(request: TerminalInputRequest): Promise<TerminalInputResponse> {
    return this.invokeFn<TerminalInputResponse>("cmd_terminal_send_input", { request });
  }

  resizeTerminal(request: TerminalResizeRequest): Promise<TerminalResizeResponse> {
    return this.invokeFn<TerminalResizeResponse>("cmd_terminal_resize", { request });
  }

  closeTerminalSession(
    request: TerminalCloseSessionRequest
  ): Promise<TerminalCloseSessionResponse> {
    return this.invokeFn<TerminalCloseSessionResponse>("cmd_terminal_close_session", { request });
  }

  listWorkspaceTools(request: WorkspaceToolsListRequest): Promise<WorkspaceToolsListResponse> {
    return this.invokeFn<WorkspaceToolsListResponse>("cmd_workspace_tools_list", { request });
  }

  setWorkspaceToolEnabled(
    request: WorkspaceToolSetEnabledRequest
  ): Promise<WorkspaceToolSetEnabledResponse> {
    return this.invokeFn<WorkspaceToolSetEnabledResponse>("cmd_workspace_tool_set_enabled", {
      request
    });
  }

  getLlamaRuntimeStatus(
    request: LlamaRuntimeStatusRequest
  ): Promise<LlamaRuntimeStatusResponse> {
    return this.invokeFn<LlamaRuntimeStatusResponse>("cmd_llama_runtime_status", { request });
  }

  installLlamaRuntimeEngine(
    request: LlamaRuntimeInstallRequest
  ): Promise<LlamaRuntimeInstallResponse> {
    return this.invokeFn<LlamaRuntimeInstallResponse>("cmd_llama_runtime_install_engine", {
      request
    });
  }

  startLlamaRuntime(request: LlamaRuntimeStartRequest): Promise<LlamaRuntimeStartResponse> {
    return this.invokeFn<LlamaRuntimeStartResponse>("cmd_llama_runtime_start", { request });
  }

  stopLlamaRuntime(request: LlamaRuntimeStopRequest): Promise<LlamaRuntimeStopResponse> {
    return this.invokeFn<LlamaRuntimeStopResponse>("cmd_llama_runtime_stop", { request });
  }

  modelManagerListInstalled(
    request: ModelManagerListInstalledRequest
  ): Promise<ModelManagerListInstalledResponse> {
    return this.invokeFn<ModelManagerListInstalledResponse>("cmd_model_manager_list_installed", {
      request
    });
  }

  modelManagerSearchHf(request: ModelManagerSearchHfRequest): Promise<ModelManagerSearchHfResponse> {
    return this.invokeFn<ModelManagerSearchHfResponse>("cmd_model_manager_search_hf", {
      request
    });
  }

  modelManagerDownloadHf(
    request: ModelManagerDownloadHfRequest
  ): Promise<ModelManagerDownloadHfResponse> {
    return this.invokeFn<ModelManagerDownloadHfResponse>("cmd_model_manager_download_hf", {
      request
    });
  }

  modelManagerDeleteInstalled(
    request: ModelManagerDeleteInstalledRequest
  ): Promise<ModelManagerDeleteInstalledResponse> {
    return this.invokeFn<ModelManagerDeleteInstalledResponse>("cmd_model_manager_delete_installed", {
      request
    });
  }

  modelManagerListCatalogCsv(
    request: ModelManagerListCatalogCsvRequest
  ): Promise<ModelManagerListCatalogCsvResponse> {
    return this.invokeFn<ModelManagerListCatalogCsvResponse>("cmd_model_manager_list_catalog_csv", {
      request
    });
  }

  probeMicrophoneDevice(
    request: DevicesProbeMicrophoneRequest
  ): Promise<DevicesProbeMicrophoneResponse> {
    return this.invokeFn<DevicesProbeMicrophoneResponse>("cmd_devices_probe_microphone", {
      request
    });
  }
}

export class MockChatIpcClient implements ChatIpcClient {
  private listeners: Array<(event: AppEvent) => void> = [];
  private readonly tools = new Map<string, WorkspaceToolRecord>([
    [
      "terminal",
      {
        toolId: "terminal",
        title: "Terminal",
        enabled: true,
        status: "ready"
      }
    ]
  ]);

  async getAppVersion(): Promise<AppVersionResponse> {
    return { version: APP_BUILD_VERSION };
  }

  onEvent(listener: (event: AppEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async sendMessage(request: ChatSendRequest): Promise<ChatSendResponse> {
    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "ipc",
      action: "cmd.chat.send_message",
      stage: "start",
      severity: "info",
      payload: { conversationId: request.conversationId }
    });

    const text = `Echoed safely via registry: ${request.userMessage}`;
    const thinking = request.thinkingEnabled
      ? "Checking local mock registry response synthesis."
      : "";
    if (thinking) {
      this.emit({
        timestampMs: Date.now(),
        correlationId: request.correlationId,
        subsystem: "service",
        action: "chat.stream.reasoning_chunk",
        stage: "progress",
        severity: "info",
        payload: {
          conversationId: request.conversationId,
          delta: thinking,
          done: false
        }
      });
    }
    for (const token of text.split(" ")) {
      this.emit({
        timestampMs: Date.now(),
        correlationId: request.correlationId,
        subsystem: "service",
        action: "chat.stream.chunk",
        stage: "progress",
        severity: "info",
        payload: {
          conversationId: request.conversationId,
          delta: `${token} `,
          done: false
        }
      });
      await sleep(30);
    }

    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "service",
      action: "chat.stream.complete",
      stage: "complete",
      severity: "info",
      payload: { conversationId: request.conversationId, assistantLength: text.length }
    });

    const response: ChatSendResponse = thinking
      ? {
          conversationId: request.conversationId,
          assistantMessage: text,
          assistantThinking: thinking,
          correlationId: request.correlationId
        }
      : {
          conversationId: request.conversationId,
          assistantMessage: text,
          correlationId: request.correlationId
        };

    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "ipc",
      action: "cmd.chat.send_message",
      stage: "complete",
      severity: "info",
      payload: { ok: true }
    });

    return response;
  }

  async cancelMessage(request: ChatCancelRequest): Promise<ChatCancelResponse> {
    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "ipc",
      action: "cmd.chat.cancel_message",
      stage: "complete",
      severity: "info",
      payload: { cancelled: true, targetCorrelationId: request.targetCorrelationId }
    });
    return {
      correlationId: request.correlationId,
      targetCorrelationId: request.targetCorrelationId,
      cancelled: true
    };
  }

  async getMessages(request: ChatGetMessagesRequest): Promise<ChatGetMessagesResponse> {
    return {
      conversationId: request.conversationId,
      messages: [],
      correlationId: request.correlationId
    };
  }

  async listConversations(
    request: ChatListConversationsRequest
  ): Promise<ChatListConversationsResponse> {
    return {
      conversations: [
        {
          conversationId: "foundation-chat",
          title: "Foundation Chat",
          messageCount: 0,
          lastMessagePreview: "No messages yet",
          updatedAtMs: Date.now()
        }
      ],
      correlationId: request.correlationId
    };
  }

  async deleteConversation(
    request: ChatDeleteConversationRequest
  ): Promise<ChatDeleteConversationResponse> {
    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "ipc",
      action: "cmd.chat.delete_conversation",
      stage: "complete",
      severity: "info",
      payload: { deleted: true, conversationId: request.conversationId }
    });
    return {
      conversationId: request.conversationId,
      correlationId: request.correlationId,
      deleted: true
    };
  }

  async openTerminalSession(
    request: TerminalOpenSessionRequest
  ): Promise<TerminalOpenSessionResponse> {
    return {
      sessionId: `mock-terminal-${Date.now()}`,
      correlationId: request.correlationId
    };
  }

  async sendTerminalInput(request: TerminalInputRequest): Promise<TerminalInputResponse> {
    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "service",
      action: "terminal.output",
      stage: "progress",
      severity: "info",
      payload: {
        sessionId: request.sessionId,
        data: `mock> ${request.input}`
      }
    });
    return {
      sessionId: request.sessionId,
      accepted: true,
      correlationId: request.correlationId
    };
  }

  async resizeTerminal(request: TerminalResizeRequest): Promise<TerminalResizeResponse> {
    return { sessionId: request.sessionId, correlationId: request.correlationId };
  }

  async closeTerminalSession(
    request: TerminalCloseSessionRequest
  ): Promise<TerminalCloseSessionResponse> {
    return { sessionId: request.sessionId, closed: true, correlationId: request.correlationId };
  }

  async listWorkspaceTools(
    request: WorkspaceToolsListRequest
  ): Promise<WorkspaceToolsListResponse> {
    return {
      tools: [...this.tools.values()],
      correlationId: request.correlationId
    };
  }

  async setWorkspaceToolEnabled(
    request: WorkspaceToolSetEnabledRequest
  ): Promise<WorkspaceToolSetEnabledResponse> {
    const current = this.tools.get(request.toolId);
    if (current) {
      current.enabled = request.enabled;
      current.status = request.enabled ? "ready" : "disabled";
    }
    return {
      toolId: request.toolId,
      enabled: request.enabled,
      correlationId: request.correlationId
    };
  }

  async getLlamaRuntimeStatus(
    request: LlamaRuntimeStatusRequest
  ): Promise<LlamaRuntimeStatusResponse> {
    return {
      correlationId: request.correlationId,
      state: "idle",
      activeEngineId: null,
      endpoint: null,
      pid: null,
      engines: [
        {
          engineId: "llama.cpp-cpu",
          backend: "cpu",
          label: "llama.cpp (CPU)",
          isApplicable: true,
          isBundled: false,
          isInstalled: false,
          isReady: false,
          binaryPath: null,
          prerequisites: []
        },
        {
          engineId: "llama.cpp-vulkan",
          backend: "vulkan",
          label: "llama.cpp (Vulkan)",
          isApplicable: true,
          isBundled: false,
          isInstalled: false,
          isReady: false,
          binaryPath: null,
          prerequisites: [
            {
              key: "vulkaninfo",
              ok: false,
              message: "Missing Vulkan runtime/driver"
            }
          ]
        }
      ]
    };
  }

  async installLlamaRuntimeEngine(
    request: LlamaRuntimeInstallRequest
  ): Promise<LlamaRuntimeInstallResponse> {
    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "runtime",
      action: "llama.runtime.install",
      stage: "progress",
      severity: "info",
      payload: { engineId: request.engineId, message: "Mock install completed" }
    });
    return {
      correlationId: request.correlationId,
      engineId: request.engineId,
      installedPath: `/tmp/${request.engineId}/llama-server`
    };
  }

  async startLlamaRuntime(request: LlamaRuntimeStartRequest): Promise<LlamaRuntimeStartResponse> {
    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "runtime",
      action: "llama.runtime.start",
      stage: "progress",
      severity: "info",
      payload: {
        engineId: request.engineId,
        line: `mock runtime started with model ${request.modelPath}`
      }
    });
    return {
      correlationId: request.correlationId,
      engineId: request.engineId,
      endpoint: `http://127.0.0.1:${request.port ?? 1420}/v1`,
      pid: 12345
    };
  }

  async stopLlamaRuntime(request: LlamaRuntimeStopRequest): Promise<LlamaRuntimeStopResponse> {
    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "runtime",
      action: "llama.runtime.stop",
      stage: "complete",
      severity: "info",
      payload: { stopped: true }
    });
    return {
      correlationId: request.correlationId,
      stopped: true
    };
  }

  async modelManagerListInstalled(
    request: ModelManagerListInstalledRequest
  ): Promise<ModelManagerListInstalledResponse> {
    return {
      correlationId: request.correlationId,
      models: []
    };
  }

  async modelManagerSearchHf(
    request: ModelManagerSearchHfRequest
  ): Promise<ModelManagerSearchHfResponse> {
    return {
      correlationId: request.correlationId,
      results: []
    };
  }

  async modelManagerDownloadHf(
    request: ModelManagerDownloadHfRequest
  ): Promise<ModelManagerDownloadHfResponse> {
    const fileName = request.fileName?.trim() || "downloaded-model.gguf";
    return {
      correlationId: request.correlationId,
      model: {
        id: fileName,
        name: fileName,
        path: `/tmp/models/${fileName}`,
        sizeMb: 0,
        modifiedMs: Date.now()
      }
    };
  }

  async modelManagerDeleteInstalled(
    request: ModelManagerDeleteInstalledRequest
  ): Promise<ModelManagerDeleteInstalledResponse> {
    return {
      correlationId: request.correlationId,
      modelId: request.modelId,
      deleted: true
    };
  }

  async modelManagerListCatalogCsv(
    request: ModelManagerListCatalogCsvRequest
  ): Promise<ModelManagerListCatalogCsvResponse> {
    return {
      correlationId: request.correlationId,
      listName: request.listName,
      rows: []
    };
  }

  async probeMicrophoneDevice(
    request: DevicesProbeMicrophoneRequest
  ): Promise<DevicesProbeMicrophoneResponse> {
    const hasMediaDevices =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      !!navigator.mediaDevices.enumerateDevices;
    if (!hasMediaDevices) {
      return {
        correlationId: request.correlationId,
        status: "no_device",
        message: "No media devices API",
        inputDeviceCount: 0,
        defaultInputName: null
      };
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === "audioinput");
    if (!audioInputs.length) {
      return {
        correlationId: request.correlationId,
        status: "no_device",
        message: "No microphone detected",
        inputDeviceCount: 0,
        defaultInputName: null
      };
    }

      return {
        correlationId: request.correlationId,
        status: "enabled",
        message: "Mock microphone probe succeeded",
      inputDeviceCount: audioInputs.length,
      defaultInputName: audioInputs[0]?.label || null
    };
  }

  private emit(event: AppEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

async function createTauriChatIpcClient(): Promise<ChatIpcClient> {
  const [{ invoke }, eventApi] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event")
  ]);

  const client = new TauriChatIpcClient(
    (command, args) => invoke(command, args),
    async (event, handler) => {
      const unlisten = await eventApi.listen(event, (evt) => handler(evt.payload));
      return () => {
        unlisten();
      };
    }
  );
  await client.initialize();
  return client;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function asAppEvent(payload: unknown): AppEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.timestampMs !== "number" ||
    typeof value.correlationId !== "string" ||
    typeof value.subsystem !== "string" ||
    typeof value.action !== "string" ||
    typeof value.stage !== "string" ||
    typeof value.severity !== "string" ||
    value.payload === undefined
  ) {
    return null;
  }
  return value as unknown as AppEvent;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
