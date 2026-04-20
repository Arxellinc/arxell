import type {
  ApiConnectionCreateRequest,
  ApiConnectionCreateResponse,
  ApiConnectionDeleteRequest,
  ApiConnectionDeleteResponse,
  ApiConnectionGetSecretRequest,
  ApiConnectionGetSecretResponse,
  ApiConnectionProbeRequest,
  ApiConnectionProbeResponse,
  ApiConnectionRecord,
  ApiConnectionReverifyRequest,
  ApiConnectionReverifyResponse,
  ApiConnectionUpdateRequest,
  ApiConnectionUpdateResponse,
  ApiConnectionsExportRequest,
  ApiConnectionsExportResponse,
  ApiConnectionsImportRequest,
  ApiConnectionsImportResponse,
  ApiConnectionsListRequest,
  ApiConnectionsListResponse,
  AppResourceUsageRequest,
  AppResourceUsageResponse,
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
  TtsListVoicesRequest,
  TtsListVoicesResponse,
  TtsDownloadModelRequest,
  TtsDownloadModelResponse,
  TtsSelfTestRequest,
  TtsSelfTestResponse,
  TtsSettingsGetRequest,
  TtsSettingsGetResponse,
  TtsSettingsSetRequest,
  TtsSettingsSetResponse,
  TtsSpeakRequest,
  TtsSpeakResponse,
  TtsStatusRequest,
  TtsStatusResponse,
  TtsStopRequest,
  TtsStopResponse,
  VoiceGetRuntimeDiagnosticsRequest,
  VoiceGetVadSettingsRequest,
  VoiceGetVadSettingsResponse,
  VoiceListVadMethodsRequest,
  VoiceListVadMethodsResponse,
  VoiceRequestHandoffRequest,
  VoiceRuntimeSnapshotResponse,
  VoiceSetDuplexModeRequest,
  VoiceSetShadowMethodRequest,
  VoiceSetVadMethodRequest,
  VoiceStartSessionRequest,
  VoiceStartShadowEvalRequest,
  VoiceStopSessionRequest,
  VoiceStopShadowEvalRequest,
  VoiceUpdateVadConfigRequest,
  VoiceUpdateVadConfigResponse,
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
  WebSearchRequest,
  WebSearchResponse,
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
  ToolInvokeRequest,
  ToolInvokeResponse,
  WorkspaceToolRecord,
  WorkspaceToolsListRequest,
  WorkspaceToolsListResponse,
  WorkspaceToolSetEnabledRequest,
  WorkspaceToolSetEnabledResponse,
  WorkspaceToolCreateAppPluginRequest,
  WorkspaceToolCreateAppPluginResponse,
  WorkspaceToolForgetRequest,
  WorkspaceToolForgetResponse,
  WorkspaceToolSetIconRequest,
  WorkspaceToolSetIconResponse,
  WorkspaceToolsExportRequest,
  WorkspaceToolsExportResponse,
  WorkspaceToolsImportRequest,
  WorkspaceToolsImportResponse,
  CustomToolCapabilityInvokeRequest,
  CustomToolCapabilityInvokeResponse,
  PluginCapabilityInvokeRequest,
  PluginCapabilityInvokeResponse,
  FilesListDirectoryRequest,
  FilesListDirectoryResponse,
  FlowListRunsRequest,
  FlowListRunsResponse,
  FlowRerunValidationRequest,
  FlowRerunValidationResponse,
  FlowStartRequest,
  FlowStartResponse,
  FlowStatusRequest,
  FlowStatusResponse,
  FlowStopRequest,
  FlowStopResponse,
  FlowPauseResponse,
  FlowNudgeResponse
} from "./contracts";
import { APP_BUILD_VERSION } from "./version";
import { getAllToolManifests } from "./tools/registry";

export interface ChatIpcClient {
  getAppVersion(): Promise<AppVersionResponse>;
  getAppResourceUsage(request: AppResourceUsageRequest): Promise<AppResourceUsageResponse>;
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
  exportWorkspaceTools(request: WorkspaceToolsExportRequest): Promise<WorkspaceToolsExportResponse>;
  importWorkspaceTools(request: WorkspaceToolsImportRequest): Promise<WorkspaceToolsImportResponse>;
  setWorkspaceToolEnabled(
    request: WorkspaceToolSetEnabledRequest
  ): Promise<WorkspaceToolSetEnabledResponse>;
  setWorkspaceToolIcon(
    request: WorkspaceToolSetIconRequest
  ): Promise<WorkspaceToolSetIconResponse>;
  forgetWorkspaceTool(
    request: WorkspaceToolForgetRequest
  ): Promise<WorkspaceToolForgetResponse>;
  createWorkspaceAppPlugin(
    request: WorkspaceToolCreateAppPluginRequest
  ): Promise<WorkspaceToolCreateAppPluginResponse>;
  toolInvoke(request: ToolInvokeRequest): Promise<ToolInvokeResponse>;
  customToolCapabilityInvoke(
    request: CustomToolCapabilityInvokeRequest
  ): Promise<CustomToolCapabilityInvokeResponse>;
  pluginCapabilityInvoke(
    request: PluginCapabilityInvokeRequest
  ): Promise<PluginCapabilityInvokeResponse>;
  listApiConnections(request: ApiConnectionsListRequest): Promise<ApiConnectionsListResponse>;
  exportApiConnections(request: ApiConnectionsExportRequest): Promise<ApiConnectionsExportResponse>;
  importApiConnections(request: ApiConnectionsImportRequest): Promise<ApiConnectionsImportResponse>;
  createApiConnection(request: ApiConnectionCreateRequest): Promise<ApiConnectionCreateResponse>;
  probeApiConnectionEndpoint(
    request: ApiConnectionProbeRequest
  ): Promise<ApiConnectionProbeResponse>;
  updateApiConnection(request: ApiConnectionUpdateRequest): Promise<ApiConnectionUpdateResponse>;
  reverifyApiConnection(
    request: ApiConnectionReverifyRequest
  ): Promise<ApiConnectionReverifyResponse>;
  deleteApiConnection(request: ApiConnectionDeleteRequest): Promise<ApiConnectionDeleteResponse>;
  getApiConnectionSecret(
    request: ApiConnectionGetSecretRequest
  ): Promise<ApiConnectionGetSecretResponse>;
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
  ttsStatus(request: TtsStatusRequest): Promise<TtsStatusResponse>;
  ttsListVoices(request: TtsListVoicesRequest): Promise<TtsListVoicesResponse>;
  ttsSpeak(request: TtsSpeakRequest): Promise<TtsSpeakResponse>;
  ttsStop(request: TtsStopRequest): Promise<TtsStopResponse>;
  ttsSelfTest(request: TtsSelfTestRequest): Promise<TtsSelfTestResponse>;
  ttsSettingsGet(request: TtsSettingsGetRequest): Promise<TtsSettingsGetResponse>;
  ttsSettingsSet(request: TtsSettingsSetRequest): Promise<TtsSettingsSetResponse>;
  ttsDownloadModel(request: TtsDownloadModelRequest): Promise<TtsDownloadModelResponse>;
  voiceListVadMethods(request: VoiceListVadMethodsRequest): Promise<VoiceListVadMethodsResponse>;
  voiceGetVadSettings(request: VoiceGetVadSettingsRequest): Promise<VoiceGetVadSettingsResponse>;
  voiceSetVadMethod(request: VoiceSetVadMethodRequest): Promise<VoiceRuntimeSnapshotResponse>;
  voiceUpdateVadConfig(request: VoiceUpdateVadConfigRequest): Promise<VoiceUpdateVadConfigResponse>;
  voiceStartSession(request: VoiceStartSessionRequest): Promise<VoiceRuntimeSnapshotResponse>;
  voiceStopSession(request: VoiceStopSessionRequest): Promise<VoiceRuntimeSnapshotResponse>;
  voiceRequestHandoff(request: VoiceRequestHandoffRequest): Promise<VoiceRuntimeSnapshotResponse>;
  voiceSetShadowMethod(request: VoiceSetShadowMethodRequest): Promise<VoiceRuntimeSnapshotResponse>;
  voiceStartShadowEval(request: VoiceStartShadowEvalRequest): Promise<VoiceRuntimeSnapshotResponse>;
  voiceStopShadowEval(request: VoiceStopShadowEvalRequest): Promise<VoiceRuntimeSnapshotResponse>;
  voiceSetDuplexMode(request: VoiceSetDuplexModeRequest): Promise<VoiceRuntimeSnapshotResponse>;
  voiceGetRuntimeDiagnostics(
    request: VoiceGetRuntimeDiagnosticsRequest
  ): Promise<VoiceRuntimeSnapshotResponse>;
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

function toPluginCapabilityInvokeResponse(
  response: CustomToolCapabilityInvokeResponse
): PluginCapabilityInvokeResponse {
  const mapped: PluginCapabilityInvokeResponse = {
    correlationId: response.correlationId,
    pluginId: response.customToolId,
    requestId: response.requestId,
    capability: response.capability,
    ok: response.ok,
    data: response.data
  };
  if (response.error !== undefined) {
    mapped.error = response.error;
  }
  if (response.code !== undefined) {
    mapped.code = response.code;
  }
  return mapped;
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

  getAppResourceUsage(request: AppResourceUsageRequest): Promise<AppResourceUsageResponse> {
    return this.invokeFn<AppResourceUsageResponse>("cmd_app_resource_usage", { request });
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

  setWorkspaceToolIcon(
    request: WorkspaceToolSetIconRequest
  ): Promise<WorkspaceToolSetIconResponse> {
    return this.invokeFn<WorkspaceToolSetIconResponse>("cmd_workspace_tool_set_icon", {
      request
    });
  }

  forgetWorkspaceTool(
    request: WorkspaceToolForgetRequest
  ): Promise<WorkspaceToolForgetResponse> {
    return this.invokeFn<WorkspaceToolForgetResponse>("cmd_workspace_tool_forget", {
      request
    });
  }

  createWorkspaceAppPlugin(
    request: WorkspaceToolCreateAppPluginRequest
  ): Promise<WorkspaceToolCreateAppPluginResponse> {
    return this.invokeFn<WorkspaceToolCreateAppPluginResponse>("cmd_workspace_tool_create_app_plugin", {
      request
    });
  }

  toolInvoke(request: ToolInvokeRequest): Promise<ToolInvokeResponse> {
    return this.invokeFn<ToolInvokeResponse>("cmd_tool_invoke", { request });
  }

  customToolCapabilityInvoke(
    request: CustomToolCapabilityInvokeRequest
  ): Promise<CustomToolCapabilityInvokeResponse> {
    return this.invokeFn<CustomToolCapabilityInvokeResponse>("cmd_custom_tool_capability_invoke", {
      request
    });
  }

  pluginCapabilityInvoke(
    request: PluginCapabilityInvokeRequest
  ): Promise<PluginCapabilityInvokeResponse> {
    return this.customToolCapabilityInvoke({
      correlationId: request.correlationId,
      customToolId: request.pluginId,
      requestId: request.requestId,
      capability: request.capability,
      payload: request.payload
    }).then((response) => toPluginCapabilityInvokeResponse(response));
  }

  private async invokeToolTyped<TResponse>(
    request: Omit<ToolInvokeRequest, "mode">
  ): Promise<TResponse> {
    const response = await this.toolInvoke({
      ...request,
      mode: "sandbox"
    });
    if (!response.ok) {
      throw new Error(response.error || `Tool invoke failed: ${request.toolId}.${request.action}`);
    }
    return response.data as unknown as TResponse;
  }

  exportWorkspaceTools(
    request: WorkspaceToolsExportRequest
  ): Promise<WorkspaceToolsExportResponse> {
    return this.invokeFn<WorkspaceToolsExportResponse>("cmd_workspace_tools_export", { request });
  }

  importWorkspaceTools(
    request: WorkspaceToolsImportRequest
  ): Promise<WorkspaceToolsImportResponse> {
    return this.invokeFn<WorkspaceToolsImportResponse>("cmd_workspace_tools_import", { request });
  }

  listApiConnections(request: ApiConnectionsListRequest): Promise<ApiConnectionsListResponse> {
    return this.invokeFn<ApiConnectionsListResponse>("cmd_api_connections_list", { request });
  }

  exportApiConnections(
    request: ApiConnectionsExportRequest
  ): Promise<ApiConnectionsExportResponse> {
    return this.invokeFn<ApiConnectionsExportResponse>("cmd_api_connections_export", { request });
  }

  importApiConnections(
    request: ApiConnectionsImportRequest
  ): Promise<ApiConnectionsImportResponse> {
    return this.invokeFn<ApiConnectionsImportResponse>("cmd_api_connections_import", { request });
  }

  createApiConnection(request: ApiConnectionCreateRequest): Promise<ApiConnectionCreateResponse> {
    return this.invokeFn<ApiConnectionCreateResponse>("cmd_api_connection_create", { request });
  }

  probeApiConnectionEndpoint(
    request: ApiConnectionProbeRequest
  ): Promise<ApiConnectionProbeResponse> {
    return this.invokeFn<ApiConnectionProbeResponse>("cmd_api_connection_probe", { request });
  }

  updateApiConnection(request: ApiConnectionUpdateRequest): Promise<ApiConnectionUpdateResponse> {
    return this.invokeFn<ApiConnectionUpdateResponse>("cmd_api_connection_update", { request });
  }

  reverifyApiConnection(
    request: ApiConnectionReverifyRequest
  ): Promise<ApiConnectionReverifyResponse> {
    return this.invokeFn<ApiConnectionReverifyResponse>("cmd_api_connection_reverify", { request });
  }

  deleteApiConnection(request: ApiConnectionDeleteRequest): Promise<ApiConnectionDeleteResponse> {
    return this.invokeFn<ApiConnectionDeleteResponse>("cmd_api_connection_delete", { request });
  }

  getApiConnectionSecret(
    request: ApiConnectionGetSecretRequest
  ): Promise<ApiConnectionGetSecretResponse> {
    return this.invokeFn<ApiConnectionGetSecretResponse>("cmd_api_connection_get_secret", {
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

  ttsStatus(request: TtsStatusRequest): Promise<TtsStatusResponse> {
    return this.invokeFn<TtsStatusResponse>("cmd_tts_status", { request });
  }

  ttsListVoices(request: TtsListVoicesRequest): Promise<TtsListVoicesResponse> {
    return this.invokeFn<TtsListVoicesResponse>("cmd_tts_list_voices", { request });
  }

  ttsSpeak(request: TtsSpeakRequest): Promise<TtsSpeakResponse> {
    return this.invokeFn<TtsSpeakResponse>("cmd_tts_speak", { request });
  }

  ttsStop(request: TtsStopRequest): Promise<TtsStopResponse> {
    return this.invokeFn<TtsStopResponse>("cmd_tts_stop", { request });
  }

  ttsSelfTest(request: TtsSelfTestRequest): Promise<TtsSelfTestResponse> {
    return this.invokeFn<TtsSelfTestResponse>("cmd_tts_self_test", { request });
  }

  ttsSettingsGet(request: TtsSettingsGetRequest): Promise<TtsSettingsGetResponse> {
    return this.invokeFn<TtsSettingsGetResponse>("cmd_tts_settings_get", { request });
  }

  ttsSettingsSet(request: TtsSettingsSetRequest): Promise<TtsSettingsSetResponse> {
    return this.invokeFn<TtsSettingsSetResponse>("cmd_tts_settings_set", { request });
  }

  ttsDownloadModel(request: TtsDownloadModelRequest): Promise<TtsDownloadModelResponse> {
    return this.invokeFn<TtsDownloadModelResponse>("cmd_tts_download_model", { request });
  }

  voiceListVadMethods(request: VoiceListVadMethodsRequest): Promise<VoiceListVadMethodsResponse> {
    return this.invokeFn<VoiceListVadMethodsResponse>("cmd_voice_list_vad_methods", { request });
  }

  voiceGetVadSettings(request: VoiceGetVadSettingsRequest): Promise<VoiceGetVadSettingsResponse> {
    return this.invokeFn<VoiceGetVadSettingsResponse>("cmd_voice_get_vad_settings", { request });
  }

  voiceSetVadMethod(request: VoiceSetVadMethodRequest): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_set_vad_method", { request });
  }

  voiceUpdateVadConfig(
    request: VoiceUpdateVadConfigRequest
  ): Promise<VoiceUpdateVadConfigResponse> {
    return this.invokeFn<VoiceUpdateVadConfigResponse>("cmd_voice_update_vad_config", { request });
  }

  voiceStartSession(request: VoiceStartSessionRequest): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_start_session", { request });
  }

  voiceStopSession(request: VoiceStopSessionRequest): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_stop_session", { request });
  }

  voiceRequestHandoff(request: VoiceRequestHandoffRequest): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_request_handoff", { request });
  }

  voiceSetShadowMethod(
    request: VoiceSetShadowMethodRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_set_shadow_method", { request });
  }

  voiceStartShadowEval(
    request: VoiceStartShadowEvalRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_start_shadow_eval", { request });
  }

  voiceStopShadowEval(request: VoiceStopShadowEvalRequest): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_stop_shadow_eval", { request });
  }

  voiceSetDuplexMode(request: VoiceSetDuplexModeRequest): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_set_duplex_mode", { request });
  }

  voiceGetRuntimeDiagnostics(
    request: VoiceGetRuntimeDiagnosticsRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return this.invokeFn<VoiceRuntimeSnapshotResponse>("cmd_voice_get_runtime_diagnostics", {
      request
    });
  }
}

export class MockChatIpcClient implements ChatIpcClient {
  private listeners: Array<(event: AppEvent) => void> = [];
  private readonly flowRuns: FlowListRunsResponse["runs"] = [];
  private readonly tools = new Map<string, WorkspaceToolRecord>(
    getAllToolManifests().map((manifest) => [
      manifest.id,
      {
        toolId: manifest.id,
        title: manifest.title,
        description: manifest.description,
        category: manifest.category,
        core: manifest.core,
        optional: !manifest.core,
        version: manifest.version,
        source: manifest.source,
        enabled: manifest.defaultEnabled,
        icon: true,
        status: manifest.defaultEnabled ? "ready" : "disabled"
      }
    ])
  );
  private readonly apiConnections = new Map<string, ApiConnectionRecord>();
  private readonly apiConnectionSecrets = new Map<string, string>();
  private mockTts: {
    engine: "kokoro" | "piper" | "matcha" | "kitten" | "pocket";
    voice: string;
    speed: number;
    modelPath: string;
    secondaryPath: string;
    voicesPath: string;
    tokensPath: string;
    dataDir: string;
  } = {
    engine: "kokoro",
    voice: "af_heart",
    speed: 1,
    modelPath: "",
    secondaryPath: "",
    voicesPath: "",
    tokensPath: "",
    dataDir: ""
  };

  private normalizeMockTtsEngine(value: string | undefined | null): "kokoro" | "piper" | "matcha" | "kitten" | "pocket" {
    const normalized = (value || "").trim().toLowerCase();
    if (normalized === "piper" || normalized === "matcha" || normalized === "kitten" || normalized === "pocket") {
      return normalized;
    }
    return "kokoro";
  }

  private mockVoicesForEngine(engine: "kokoro" | "piper" | "matcha" | "kitten" | "pocket"): string[] {
    return engine === "kokoro" ? ["af_heart"] : ["speaker_0"];
  }

  async getAppVersion(): Promise<AppVersionResponse> {
    return { version: APP_BUILD_VERSION };
  }

  async getAppResourceUsage(request: AppResourceUsageRequest): Promise<AppResourceUsageResponse> {
    return {
      correlationId: request.correlationId,
      cpuPercent: 0,
      memoryBytes: null,
      networkRxBytesPerSec: 0,
      networkTxBytesPerSec: 0
    };
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

  async setWorkspaceToolIcon(
    request: WorkspaceToolSetIconRequest
  ): Promise<WorkspaceToolSetIconResponse> {
    const current = this.tools.get(request.toolId);
    if (current) {
      current.icon = request.icon;
    }
    return {
      toolId: request.toolId,
      icon: request.icon,
      correlationId: request.correlationId
    };
  }

  async forgetWorkspaceTool(
    request: WorkspaceToolForgetRequest
  ): Promise<WorkspaceToolForgetResponse> {
    this.tools.delete(request.toolId);
    return {
      toolId: request.toolId,
      forgotten: true,
      correlationId: request.correlationId
    };
  }

  async createWorkspaceAppPlugin(
    request: WorkspaceToolCreateAppPluginRequest
  ): Promise<WorkspaceToolCreateAppPluginResponse> {
    const tool: WorkspaceToolRecord = {
      toolId: request.toolId,
      title: request.name || request.toolId,
      description: request.description || "Generated workspace app tool",
      category: "workspace",
      core: false,
      optional: true,
      version: "1.0.0",
      source: "custom",
      enabled: true,
      icon: true,
      status: "ready",
      entry: `/mock/plugins/${request.toolId}/dist/index.html`
    };
    this.tools.set(request.toolId, tool);
    return {
      correlationId: request.correlationId,
      tool
    };
  }

  async toolInvoke(request: ToolInvokeRequest): Promise<ToolInvokeResponse> {
    const payload = request.payload as Record<string, unknown>;
    try {
      if (request.toolId === "files" && (request.action === "list-directory" || request.action === "listDirectory")) {
        const path = typeof payload.path === "string" ? payload.path : null;
        const response = await this.mockFilesListDirectory({
          correlationId: String(payload.correlationId ?? request.correlationId),
          ...(path ? { path } : {})
        });
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
      if (request.toolId === "flow" && request.action === "start") {
        const response = await this.mockFlowStart(payload as unknown as FlowStartRequest);
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
      if (request.toolId === "flow" && request.action === "stop") {
        const response = await this.mockFlowStop(payload as unknown as FlowStopRequest);
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
      if (request.toolId === "flow" && request.action === "status") {
        const response = await this.mockFlowStatus(payload as unknown as FlowStatusRequest);
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
      if (request.toolId === "flow" && (request.action === "pause" || request.action === "set-paused" || request.action === "setPaused")) {
        const runId = typeof payload.runId === "string" ? payload.runId : "";
        const paused = payload.paused === true;
        const response: FlowPauseResponse = {
          correlationId: String(payload.correlationId ?? request.correlationId),
          runId,
          paused,
          updated: true
        };
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
      if (request.toolId === "flow" && (request.action === "nudge" || request.action === "redirect" || request.action === "redirect-task")) {
        const runId = typeof payload.runId === "string" ? payload.runId : "";
        const response: FlowNudgeResponse = {
          correlationId: String(payload.correlationId ?? request.correlationId),
          runId,
          accepted: true
        };
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
      if (request.toolId === "flow" && (request.action === "rerun-validation" || request.action === "rerunValidation")) {
        const response = await this.mockFlowRerunValidation(
          payload as unknown as FlowRerunValidationRequest
        );
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
      if (request.toolId === "flow" && (request.action === "list-runs" || request.action === "listRuns")) {
        const response = await this.mockFlowListRuns(payload as unknown as FlowListRunsRequest);
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
      if ((request.toolId === "webSearch" || request.toolId === "web") && request.action === "search") {
        const response = await this.mockWebSearch(payload as unknown as WebSearchRequest);
        return {
          correlationId: request.correlationId,
          toolId: request.toolId,
          action: request.action,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
    } catch (error) {
      return {
        correlationId: request.correlationId,
        toolId: request.toolId,
        action: request.action,
        ok: false,
        data: {},
        error: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      correlationId: request.correlationId,
      toolId: request.toolId,
      action: request.action,
      ok: false,
      data: {},
      error: "Mock runtime does not implement generic tool invoke."
    };
  }

  async customToolCapabilityInvoke(
    request: CustomToolCapabilityInvokeRequest
  ): Promise<CustomToolCapabilityInvokeResponse> {
    if (request.capability === "files.read") {
      const payload = request.payload as Record<string, unknown>;
      const action = typeof payload.action === "string" ? payload.action : "list-directory";
      if (action === "list-directory" || action === "listDirectory") {
        const path = typeof payload.path === "string" ? payload.path : null;
        const response = await this.mockFilesListDirectory({
          correlationId: request.correlationId,
          ...(path ? { path } : {})
        });
        return {
          correlationId: request.correlationId,
          customToolId: request.customToolId,
          requestId: request.requestId,
          capability: request.capability,
          ok: true,
          data: response as unknown as Record<string, unknown>
        };
      }
    }
    return {
      correlationId: request.correlationId,
      customToolId: request.customToolId,
      requestId: request.requestId,
      capability: request.capability,
      ok: false,
      data: {},
      error: "Mock runtime does not implement this custom tool capability.",
      code: "capability_unavailable"
    };
  }

  async pluginCapabilityInvoke(
    request: PluginCapabilityInvokeRequest
  ): Promise<PluginCapabilityInvokeResponse> {
    const response = await this.customToolCapabilityInvoke({
      correlationId: request.correlationId,
      customToolId: request.pluginId,
      requestId: request.requestId,
      capability: request.capability,
      payload: request.payload
    });
    return toPluginCapabilityInvokeResponse(response);
  }

  private async mockFilesListDirectory(
    request: FilesListDirectoryRequest
  ): Promise<FilesListDirectoryResponse> {
    const rootPath = "/";
    const listedPath = request.path?.trim() || rootPath;
    return {
      correlationId: request.correlationId,
      rootPath,
      listedPath,
      entries: [
        {
          name: "src",
          path: `${listedPath.replace(/\/$/, "")}/src`,
          isDir: true,
          sizeBytes: 0,
          modifiedMs: Date.now()
        },
        {
          name: "README.md",
          path: `${listedPath.replace(/\/$/, "")}/README.md`,
          isDir: false,
          sizeBytes: 1320,
          modifiedMs: Date.now()
        }
      ]
    };
  }

  private async mockFlowStart(request: FlowStartRequest): Promise<FlowStartResponse> {
    const runId = `mock-flow-${Date.now()}`;
    const startedAtMs = Date.now();
    const run: FlowListRunsResponse["runs"][number] = {
      runId,
      mode: request.mode,
      status: "queued",
      maxIterations: request.maxIterations ?? null,
      currentIteration: 0,
      startedAtMs,
      completedAtMs: null,
      dryRun: request.dryRun ?? true,
      autoPush: request.autoPush ?? false,
      promptPlanPath: request.promptPlanPath ?? "PROMPT_plan.md",
      promptBuildPath: request.promptBuildPath ?? "PROMPT_build.md",
      planPath: request.planPath ?? "IMPLEMENTATION_PLAN.md",
      specsGlob: request.specsGlob ?? "specs/*.md",
      backpressureCommands: request.backpressureCommands ?? [],
      implementCommand: request.implementCommand ?? "",
      summary: null,
      iterations: []
    };
    this.flowRuns.unshift(run);
    this.emit({
      timestampMs: startedAtMs,
      correlationId: request.correlationId,
      subsystem: "service",
      action: "flow.run.start",
      stage: "start",
      severity: "info",
      payload: { runId, mode: request.mode }
    });
    return {
      correlationId: request.correlationId,
      runId,
      status: "queued"
    };
  }

  private async mockFlowStop(request: FlowStopRequest): Promise<FlowStopResponse> {
    const run = this.flowRuns.find((item) => item.runId === request.runId);
    if (run) {
      run.status = "stopped";
      run.completedAtMs = Date.now();
      run.summary = "Stopped by user";
    }
    this.emit({
      timestampMs: Date.now(),
      correlationId: request.correlationId,
      subsystem: "service",
      action: "flow.run.complete",
      stage: "complete",
      severity: "info",
      payload: { runId: request.runId, stopped: true }
    });
    return {
      correlationId: request.correlationId,
      runId: request.runId,
      stopped: true
    };
  }

  private async mockFlowStatus(request: FlowStatusRequest): Promise<FlowStatusResponse> {
    const run = this.flowRuns.find((item) => item.runId === request.runId);
    if (!run) {
      throw new Error(`Flow run not found: ${request.runId}`);
    }
    return {
      correlationId: request.correlationId,
      run
    };
  }

  private async mockFlowListRuns(request: FlowListRunsRequest): Promise<FlowListRunsResponse> {
    return {
      correlationId: request.correlationId,
      runs: [...this.flowRuns]
    };
  }

  private async mockFlowRerunValidation(
    request: FlowRerunValidationRequest
  ): Promise<FlowRerunValidationResponse> {
    const run = this.flowRuns.find((item) => item.runId === request.runId);
    if (!run) {
      throw new Error(`Flow run not found: ${request.runId}`);
    }
    const results = (run.backpressureCommands ?? []).map((command) => ({
      command,
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 0
    }));
    return {
      correlationId: request.correlationId,
      runId: request.runId,
      iteration: request.iteration ?? run.currentIteration ?? null,
      ok: true,
      results
    };
  }

  async exportWorkspaceTools(
    request: WorkspaceToolsExportRequest
  ): Promise<WorkspaceToolsExportResponse> {
    const enabled: Record<string, boolean> = {};
    const icon: Record<string, boolean> = {};
    for (const [toolId, tool] of this.tools.entries()) {
      enabled[toolId] = tool.enabled;
      icon[toolId] = tool.icon;
    }
    return {
      correlationId: request.correlationId,
      fileName: "arxell-tools-registry.json",
      payloadJson: `${JSON.stringify({ version: 1, enabled, icon }, null, 2)}\n`
    };
  }

  async importWorkspaceTools(
    request: WorkspaceToolsImportRequest
  ): Promise<WorkspaceToolsImportResponse> {
    const parsed = JSON.parse(request.payloadJson) as {
      enabled?: Record<string, boolean>;
      icon?: Record<string, boolean>;
    };
    const enabled = parsed.enabled ?? {};
    const icon = parsed.icon ?? {};
    for (const [toolId, tool] of this.tools.entries()) {
      const value = enabled[toolId];
      if (typeof value === "boolean") {
        tool.enabled = value;
        tool.status = value ? "ready" : "disabled";
      }
      const iconValue = icon[toolId];
      if (typeof iconValue === "boolean") {
        tool.icon = iconValue;
      }
    }
    return {
      correlationId: request.correlationId,
      tools: [...this.tools.values()]
    };
  }

  async listApiConnections(
    request: ApiConnectionsListRequest
  ): Promise<ApiConnectionsListResponse> {
    return {
      correlationId: request.correlationId,
      connections: [...this.apiConnections.values()].sort((a, b) => b.createdMs - a.createdMs)
    };
  }

  async exportApiConnections(
    request: ApiConnectionsExportRequest
  ): Promise<ApiConnectionsExportResponse> {
    const connections = [...this.apiConnections.values()].sort((a, b) => b.createdMs - a.createdMs);
    const payload = {
      version: 1,
      exportedAtMs: Date.now(),
      connections: connections.map((record) => ({
        id: record.id,
        apiType: record.apiType,
        apiUrl: record.apiUrl,
        name: record.name,
        apiKey: this.apiConnectionSecrets.get(record.id) || "",
        modelName: record.modelName,
        costPerMonthUsd: record.costPerMonthUsd,
        apiStandardPath: record.apiStandardPath,
        createdMs: record.createdMs
      }))
    };
    return {
      correlationId: request.correlationId,
      fileName: "arxell-api-connections.json",
      payloadJson: `${JSON.stringify(payload, null, 2)}\n`
    };
  }

  async importApiConnections(
    request: ApiConnectionsImportRequest
  ): Promise<ApiConnectionsImportResponse> {
    const raw = request.payloadJson.trim();
    if (!raw) {
      return {
        correlationId: request.correlationId,
        connections: [...this.apiConnections.values()].sort((a, b) => b.createdMs - a.createdMs)
      };
    }
    const parsed = JSON.parse(raw) as {
      connections?: Array<{
        id?: string;
        apiType?: ApiConnectionRecord["apiType"];
        apiUrl?: string;
        name?: string | null;
        apiKey?: string;
        modelName?: string | null;
        costPerMonthUsd?: number | null;
        apiStandardPath?: string | null;
        createdMs?: number;
      }>;
    };
    const items = Array.isArray(parsed.connections) ? parsed.connections : [];
    for (const item of items) {
      const apiUrl = String(item.apiUrl || "").trim();
      const apiKey = String(item.apiKey || "").trim();
      if (!apiUrl || !apiKey) continue;
      const id = String(item.id || "").trim() || `api-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const createdMs = Number.isFinite(item.createdMs) ? Number(item.createdMs) : Date.now();
      const prefix = apiKey.slice(0, 7);
      const modelName = typeof item.modelName === "string" && item.modelName.trim()
        ? item.modelName.trim()
        : null;
      const connection: ApiConnectionRecord = {
        id,
        apiType: item.apiType || "llm",
        apiUrl,
        name: item.name?.trim() || null,
        apiKeyPrefix: prefix,
        apiKeyMasked: prefix ? `${prefix}…` : "(none)",
        modelName,
        costPerMonthUsd:
          typeof item.costPerMonthUsd === "number" ? item.costPerMonthUsd : null,
        status: "pending",
        statusMessage: "Imported connection. Verify to confirm status.",
        lastCheckedMs: null,
        createdMs,
        apiStandardPath: item.apiStandardPath?.trim() || null,
        availableModels: modelName ? [modelName] : []
      };
      this.apiConnections.set(id, connection);
      this.apiConnectionSecrets.set(id, apiKey);
    }
    return {
      correlationId: request.correlationId,
      connections: [...this.apiConnections.values()].sort((a, b) => b.createdMs - a.createdMs)
    };
  }

  async createApiConnection(
    request: ApiConnectionCreateRequest
  ): Promise<ApiConnectionCreateResponse> {
    const now = Date.now();
    const apiKey = request.apiKey?.trim() || "";
    const prefix = apiKey.slice(0, 7);
    const isVerified = /^https?:\/\//.test(request.apiUrl.trim());
    const connection: ApiConnectionRecord = {
      id: `api-${now}-${Math.floor(Math.random() * 1000)}`,
      apiType: request.apiType,
      apiUrl: request.apiUrl.trim(),
      name: request.name?.trim() || null,
      apiKeyPrefix: prefix,
      apiKeyMasked: prefix ? `${prefix}…` : "(none)",
      modelName: request.modelName?.trim() || null,
      costPerMonthUsd:
        typeof request.costPerMonthUsd === "number" ? request.costPerMonthUsd : null,
      status: isVerified ? "verified" : "warning",
      statusMessage: isVerified
        ? "Mock verification succeeded"
        : "Mock verification failed: invalid URL",
      lastCheckedMs: now,
      createdMs: now,
      apiStandardPath: request.apiStandardPath?.trim() || null,
      availableModels: request.modelName?.trim() ? [request.modelName.trim()] : []
    };
    this.apiConnections.set(connection.id, connection);
    this.apiConnectionSecrets.set(connection.id, apiKey);
    return {
      correlationId: request.correlationId,
      connection
    };
  }

  async probeApiConnectionEndpoint(
    request: ApiConnectionProbeRequest
  ): Promise<ApiConnectionProbeResponse> {
    const apiUrl = request.apiUrl.trim();
    const isReachable = /^https?:\/\//.test(apiUrl);
    const models = isReachable ? ["local-model"] : [];
    return {
      correlationId: request.correlationId,
      detectedApiType: request.apiType ?? "llm",
      apiStandardPath: "/v1/chat/completions",
      verifyUrl: `${apiUrl.replace(/\/$/, "")}/v1/chat/completions`,
      models,
      selectedModel: models[0] ?? null,
      status: isReachable ? "verified" : "warning",
      statusMessage: isReachable
        ? "Mock probe detected an OpenAI-compatible endpoint."
        : "Mock probe failed: invalid URL."
    };
  }

  async updateApiConnection(
    request: ApiConnectionUpdateRequest
  ): Promise<ApiConnectionUpdateResponse> {
    const current = this.apiConnections.get(request.id);
    if (!current) {
      throw new Error(`API connection not found: ${request.id}`);
    }
    const updated: ApiConnectionRecord = {
      ...current,
      ...(request.apiType && { apiType: request.apiType }),
      ...(request.apiUrl && { apiUrl: request.apiUrl }),
      ...(request.name !== undefined && { name: request.name || null }),
      ...(request.apiKey && { apiKeyPrefix: request.apiKey.slice(0, 7), apiKeyMasked: `${request.apiKey.slice(0, 7)}…` }),
      ...(request.modelName !== undefined && { modelName: request.modelName || null }),
      ...(request.costPerMonthUsd !== undefined && { costPerMonthUsd: request.costPerMonthUsd }),
      ...(request.apiStandardPath !== undefined && { apiStandardPath: request.apiStandardPath || null }),
      ...(request.modelName !== undefined && {
        availableModels: request.modelName ? [request.modelName] : current.availableModels
      }),
      lastCheckedMs: Date.now()
    };
    this.apiConnections.set(updated.id, updated);
    if (request.apiKey) {
      this.apiConnectionSecrets.set(updated.id, request.apiKey);
    }
    return {
      correlationId: request.correlationId,
      connection: updated
    };
  }

  async reverifyApiConnection(
    request: ApiConnectionReverifyRequest
  ): Promise<ApiConnectionReverifyResponse> {
    const current = this.apiConnections.get(request.id);
    if (!current) {
      throw new Error(`API connection not found: ${request.id}`);
    }
    const isVerified = /^https?:\/\//.test(current.apiUrl.trim());
    const updated: ApiConnectionRecord = {
      ...current,
      status: isVerified ? "verified" : "warning",
      statusMessage: isVerified
        ? "Mock verification succeeded"
        : "Mock verification failed: invalid URL",
      lastCheckedMs: Date.now()
    };
    this.apiConnections.set(updated.id, updated);
    return {
      correlationId: request.correlationId,
      connection: updated
    };
  }

  async deleteApiConnection(
    request: ApiConnectionDeleteRequest
  ): Promise<ApiConnectionDeleteResponse> {
    const deleted = this.apiConnections.delete(request.id);
    this.apiConnectionSecrets.delete(request.id);
    return {
      correlationId: request.correlationId,
      id: request.id,
      deleted
    };
  }

  async getApiConnectionSecret(
    request: ApiConnectionGetSecretRequest
  ): Promise<ApiConnectionGetSecretResponse> {
    const secret = this.apiConnectionSecrets.get(request.id);
    if (!secret) {
      throw new Error(`API connection secret not found: ${request.id}`);
    }
    return {
      correlationId: request.correlationId,
      id: request.id,
      apiKey: secret
    };
  }

  private async mockWebSearch(request: WebSearchRequest): Promise<WebSearchResponse> {
    const query = request.query.trim();
    if (!query) {
      throw new Error("query is required");
    }
    return {
      correlationId: request.correlationId,
      result: {
        query,
        mode: request.mode ?? "search",
        page: request.page ?? 1,
        num: request.num ?? 8,
        organic: [
          {
            title: "Mock search result",
            link: "https://example.com",
            snippet: `Mocked result for '${query}'`
          }
        ]
      }
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

  async ttsStatus(request: TtsStatusRequest): Promise<TtsStatusResponse> {
    const voices = this.mockVoicesForEngine(this.mockTts.engine);
    const fallbackVoice = voices[0] ?? (this.mockTts.engine === "kokoro" ? "af_heart" : "speaker_0");
    return {
      correlationId: request.correlationId,
      engineId: `sherpa-${this.mockTts.engine}`,
      engine: this.mockTts.engine,
      ready: false,
      message: "Mock runtime: TTS unavailable",
      modelPath: this.mockTts.modelPath,
      secondaryPath: this.mockTts.secondaryPath,
      voicesPath: this.mockTts.engine === "piper" ? "" : this.mockTts.voicesPath,
      tokensPath: this.mockTts.tokensPath,
      dataDir: this.mockTts.dataDir,
      pythonPath: "",
      scriptPath: "",
      runtimeArchivePresent: false,
      availableModelPaths: this.mockTts.modelPath ? [this.mockTts.modelPath] : [],
      availableVoices: voices,
      selectedVoice: voices.includes(this.mockTts.voice) ? this.mockTts.voice : fallbackVoice,
      speed: this.mockTts.speed,
      lexiconStatus: ""
    };
  }

  async ttsListVoices(request: TtsListVoicesRequest): Promise<TtsListVoicesResponse> {
    const voices = this.mockVoicesForEngine(this.mockTts.engine);
    const fallbackVoice = voices[0] ?? (this.mockTts.engine === "kokoro" ? "af_heart" : "speaker_0");
    return {
      correlationId: request.correlationId,
      voices,
      selectedVoice: voices.includes(this.mockTts.voice) ? this.mockTts.voice : fallbackVoice
    };
  }

  async voiceListVadMethods(
    request: VoiceListVadMethodsRequest
  ): Promise<VoiceListVadMethodsResponse> {
    const methods = [
      {
        id: "energy-basic",
        displayName: "Energy Basic",
        status: "stable" as const,
        description: "Deterministic threshold-based voice activity detection.",
        capabilities: {
          supportsEndpointing: true,
          supportsInterruptionSignals: false,
          supportsMicroTurns: false,
          supportsOverlapTurnYieldHints: false,
          supportsSpeechProbability: true,
          supportsPartialSegmentation: true,
          supportsLiveHandoff: true,
          supportsSpeculativeOnset: false
        },
        defaultConfig: { threshold: 0.0012, minSpeechMs: 120, minSilenceMs: 240, hangoverMs: 80 }
      },
      {
        id: "sherpa-silero",
        displayName: "Sherpa Silero",
        status: "stable" as const,
        description: "Production-compatible endpointing adapter.",
        capabilities: {
          supportsEndpointing: true,
          supportsInterruptionSignals: true,
          supportsMicroTurns: false,
          supportsOverlapTurnYieldHints: false,
          supportsSpeechProbability: true,
          supportsPartialSegmentation: true,
          supportsLiveHandoff: true,
          supportsSpeculativeOnset: false
        },
        defaultConfig: {
          baseThreshold: 0.0012,
          startFrames: 2,
          endFrames: 8,
          dynamicMultiplier: 2.4,
          noiseAdaptationAlpha: 0.03,
          preSpeechMs: 200,
          minUtteranceMs: 200,
          maxUtteranceS: 30,
          forceFlushS: 3
        }
      },
      {
        id: "microturn-v1",
        displayName: "Microturn v1",
        status: "experimental" as const,
        description: "Experimental periodic micro-turn segmentation.",
        capabilities: {
          supportsEndpointing: true,
          supportsInterruptionSignals: false,
          supportsMicroTurns: true,
          supportsOverlapTurnYieldHints: false,
          supportsSpeechProbability: true,
          supportsPartialSegmentation: true,
          supportsLiveHandoff: true,
          supportsSpeculativeOnset: true
        },
        defaultConfig: { threshold: 0.0012, microturnWindowMs: 700, minSpeechMs: 120 }
      },
      {
        id: "hybrid_interrupt",
        displayName: "Hybrid Interrupt",
        status: "experimental" as const,
        description: "Interruption-aware VAD with overlap and speculative-onset safety signals.",
        capabilities: {
          supportsEndpointing: true,
          supportsInterruptionSignals: true,
          supportsMicroTurns: true,
          supportsOverlapTurnYieldHints: true,
          supportsSpeechProbability: true,
          supportsPartialSegmentation: true,
          supportsLiveHandoff: true,
          supportsSpeculativeOnset: true
        },
        defaultConfig: {
          interruptThreshold: 0.0018,
          minOverlapMs: 120,
          cancelTtsOnInterrupt: true,
          resumeAfterFalseInterrupt: true,
          yieldBias: 0.45,
          assistantSpeakingSensitivity: 0.65
        }
      }
    ].filter((method) => request.includeExperimental || method.status !== "experimental");
    return {
      correlationId: request.correlationId,
      methods,
      selectedVadMethod: "sherpa-silero",
      state: "idle"
    };
  }

  async voiceGetVadSettings(
    request: VoiceGetVadSettingsRequest
  ): Promise<VoiceGetVadSettingsResponse> {
    return {
      correlationId: request.correlationId,
      state: "idle",
      settings: {
        version: 1,
        selectedVadMethod: "sherpa-silero",
        shadowVadMethod: "microturn-v1",
        duplexMode: "single_turn",
        globalVoiceConfig: { sampleRateHz: 16000 },
        speculation: { enabled: false, maxPrefixMs: 800, cancelOnUserContinuation: true },
        vadMethods: {
          "sherpa-silero": {
            baseThreshold: 0.0012,
            startFrames: 2,
            endFrames: 8,
            dynamicMultiplier: 2.4,
            noiseAdaptationAlpha: 0.03,
            preSpeechMs: 200,
            minUtteranceMs: 200,
            maxUtteranceS: 30,
            forceFlushS: 3
          }
        }
      }
    };
  }

  async voiceSetVadMethod(
    request: VoiceSetVadMethodRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: this.mockVoiceSnapshot("idle", request.methodId)
    };
  }

  async voiceUpdateVadConfig(
    request: VoiceUpdateVadConfigRequest
  ): Promise<VoiceUpdateVadConfigResponse> {
    return {
      correlationId: request.correlationId,
      settings: {
        version: 1,
        selectedVadMethod: request.methodId,
        shadowVadMethod: null,
        duplexMode: "single_turn",
        globalVoiceConfig: { sampleRateHz: 16000 },
        speculation: { enabled: false, maxPrefixMs: 800, cancelOnUserContinuation: true },
        vadMethods: { [request.methodId]: request.config }
      }
    };
  }

  async voiceStartSession(
    request: VoiceStartSessionRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: this.mockVoiceSnapshot("running_single", "sherpa-silero", "mock-voice")
    };
  }

  async voiceStopSession(request: VoiceStopSessionRequest): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: this.mockVoiceSnapshot("idle", "sherpa-silero")
    };
  }

  async voiceRequestHandoff(
    request: VoiceRequestHandoffRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: this.mockVoiceSnapshot("running_single", request.targetMethodId, "mock-voice")
    };
  }

  async voiceSetShadowMethod(
    request: VoiceSetShadowMethodRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: {
        ...this.mockVoiceSnapshot("idle", "sherpa-silero"),
        shadowVadMethodId: request.methodId ?? null
      }
    };
  }

  async voiceStartShadowEval(
    request: VoiceStartShadowEvalRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: {
        ...this.mockVoiceSnapshot("running_dual", "sherpa-silero", "mock-voice"),
        shadowVadMethodId: "microturn-v1"
      }
    };
  }

  async voiceStopShadowEval(
    request: VoiceStopShadowEvalRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: this.mockVoiceSnapshot("running_single", "sherpa-silero", "mock-voice")
    };
  }

  async voiceSetDuplexMode(
    request: VoiceSetDuplexModeRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: { ...this.mockVoiceSnapshot("idle", "sherpa-silero"), duplexMode: request.duplexMode }
    };
  }

  async voiceGetRuntimeDiagnostics(
    request: VoiceGetRuntimeDiagnosticsRequest
  ): Promise<VoiceRuntimeSnapshotResponse> {
    return {
      correlationId: request.correlationId,
      snapshot: this.mockVoiceSnapshot("idle", "sherpa-silero")
    };
  }

  private mockVoiceSnapshot(
    state: "idle" | "running_single" | "running_dual",
    methodId: string,
    sessionId: string | null = null
  ) {
    return {
      state,
      sessionId,
      selectedVadMethod: methodId,
      activeVadMethodId: methodId,
      standbyVadMethodId: null,
      shadowVadMethodId: null,
      handoffState: "none" as const,
      speculationState: "disabled" as const,
      duplexMode: "single_turn" as const,
      shadowSummary: null
    };
  }

  async ttsSpeak(request: TtsSpeakRequest): Promise<TtsSpeakResponse> {
    void request;
    throw new Error("Mock runtime does not synthesize TTS audio.");
  }

  async ttsStop(request: TtsStopRequest): Promise<TtsStopResponse> {
    return {
      correlationId: request.correlationId,
      stopped: true
    };
  }

  async ttsSelfTest(request: TtsSelfTestRequest): Promise<TtsSelfTestResponse> {
    return {
      correlationId: request.correlationId,
      ok: false,
      message: "Mock runtime: self-test unavailable",
      bytes: 0,
      sampleRate: 0,
      durationMs: 0
    };
  }

  async ttsSettingsGet(request: TtsSettingsGetRequest): Promise<TtsSettingsGetResponse> {
    const voices = this.mockVoicesForEngine(this.mockTts.engine);
    const fallbackVoice = voices[0] ?? (this.mockTts.engine === "kokoro" ? "af_heart" : "speaker_0");
    const voice = voices.includes(this.mockTts.voice) ? this.mockTts.voice : fallbackVoice;
    return {
      correlationId: request.correlationId,
      engineId: `sherpa-${this.mockTts.engine}`,
      engine: this.mockTts.engine,
      voice,
      speed: this.mockTts.speed,
      modelPath: this.mockTts.modelPath,
      secondaryPath: this.mockTts.secondaryPath,
      voicesPath: this.mockTts.engine === "piper" ? "" : this.mockTts.voicesPath,
      tokensPath: this.mockTts.tokensPath,
      dataDir: this.mockTts.dataDir,
      pythonPath: ""
    };
  }

  async ttsSettingsSet(request: TtsSettingsSetRequest): Promise<TtsSettingsSetResponse> {
    const nextEngine = this.normalizeMockTtsEngine(request.engine ?? this.mockTts.engine);
    const engineChanged = nextEngine !== this.mockTts.engine;
    if (engineChanged) {
      this.mockTts.engine = nextEngine;
      this.mockTts.modelPath = "";
      this.mockTts.secondaryPath = "";
      this.mockTts.voicesPath = "";
      this.mockTts.tokensPath = "";
      this.mockTts.dataDir = "";
      this.mockTts.speed = 1;
      this.mockTts.voice = this.mockVoicesForEngine(nextEngine)[0] ?? (nextEngine === "kokoro" ? "af_heart" : "speaker_0");
    }
    if (typeof request.speed === "number" && Number.isFinite(request.speed)) {
      this.mockTts.speed = request.speed;
    }
    if (typeof request.voice === "string") {
      const voice = request.voice.trim();
      if (voice) {
        this.mockTts.voice = voice;
      }
    }
    if (typeof request.modelPath === "string") {
      this.mockTts.modelPath = request.modelPath.trim();
    }
    if (typeof request.secondaryPath === "string") {
      this.mockTts.secondaryPath = request.secondaryPath.trim();
      if (this.mockTts.engine !== "piper") {
        this.mockTts.voicesPath = this.mockTts.secondaryPath;
      }
    }
    if (typeof request.voicesPath === "string") {
      const value = request.voicesPath.trim();
      if (this.mockTts.engine === "piper") {
        this.mockTts.secondaryPath = value;
        this.mockTts.voicesPath = "";
      } else {
        this.mockTts.voicesPath = value;
        this.mockTts.secondaryPath = value;
      }
    }
    if (typeof request.tokensPath === "string") {
      this.mockTts.tokensPath = request.tokensPath.trim();
    }
    if (typeof request.dataDir === "string") {
      this.mockTts.dataDir = request.dataDir.trim();
    }
    const voices = this.mockVoicesForEngine(this.mockTts.engine);
    if (!voices.includes(this.mockTts.voice)) {
      this.mockTts.voice = voices[0] ?? (this.mockTts.engine === "kokoro" ? "af_heart" : "speaker_0");
    }

    return {
      correlationId: request.correlationId,
      ok: true,
      engine: this.mockTts.engine,
      voice: this.mockTts.voice,
      speed: this.mockTts.speed
    };
  }

  async ttsDownloadModel(request: TtsDownloadModelRequest): Promise<TtsDownloadModelResponse> {
    return {
      correlationId: request.correlationId,
      ok: false,
      message: "Mock runtime cannot download TTS models.",
      modelPath: "",
      voicesPath: "",
      tokensPath: "",
      dataDir: ""
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
