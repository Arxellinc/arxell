use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendRequest {
    pub conversation_id: String,
    pub user_message: String,
    pub correlation_id: String,
    pub thinking_enabled: Option<bool>,
    pub chat_mode: Option<String>,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub max_tokens: Option<u32>,
    pub attachments: Option<Vec<ChatAttachment>>,
    pub always_load_tool_keys: Option<Vec<String>>,
    pub always_load_skill_keys: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    pub kind: String,
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendResponse {
    pub conversation_id: String,
    pub assistant_message: String,
    pub assistant_thinking: Option<String>,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCancelRequest {
    pub correlation_id: String,
    pub target_correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCancelResponse {
    pub correlation_id: String,
    pub target_correlation_id: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRecord {
    pub conversation_id: String,
    pub role: MessageRole,
    pub content: String,
    pub correlation_id: String,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummaryRecord {
    pub conversation_id: String,
    pub title: String,
    pub message_count: usize,
    pub last_message_preview: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGetMessagesRequest {
    pub conversation_id: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGetMessagesResponse {
    pub conversation_id: String,
    pub messages: Vec<ConversationMessageRecord>,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatListConversationsRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatListConversationsResponse {
    pub conversations: Vec<ConversationSummaryRecord>,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInspectContextRequest {
    pub conversation_id: String,
    pub correlation_id: String,
    pub chat_mode: Option<String>,
    pub always_load_tool_keys: Option<Vec<String>>,
    pub always_load_skill_keys: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatContextBreakdownItem {
    pub section: String,
    pub category: String,
    pub key: String,
    pub value: String,
    pub source_path: Option<String>,
    pub load_method: String,
    pub load_reason: String,
    pub token_estimate: i64,
    pub char_count: usize,
    pub word_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInspectContextResponse {
    pub conversation_id: String,
    pub correlation_id: String,
    pub route_mode: String,
    pub total_token_estimate: i64,
    pub items: Vec<ChatContextBreakdownItem>,
    pub conversations: Vec<ConversationSummaryRecord>,
    pub memory_items: Vec<ChatContextBreakdownItem>,
    pub skills_items: Vec<ChatContextBreakdownItem>,
    pub tools_items: Vec<ChatContextBreakdownItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpsertRequest {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpsertResponse {
    pub namespace: String,
    pub key: String,
    pub correlation_id: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDeleteRequest {
    pub namespace: String,
    pub key: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDeleteResponse {
    pub namespace: String,
    pub key: String,
    pub correlation_id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptSetRequest {
    pub value: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptSetResponse {
    pub value: String,
    pub correlation_id: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomItemUpsertRequest {
    pub section: String,
    pub key: String,
    pub value: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomItemUpsertResponse {
    pub section: String,
    pub key: String,
    pub correlation_id: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomItemDeleteRequest {
    pub section: String,
    pub key: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomItemDeleteResponse {
    pub section: String,
    pub key: String,
    pub correlation_id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCreateRequest {
    pub name: String,
    pub description: String,
    pub content: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCreateResponse {
    pub name: String,
    pub file_path: String,
    pub correlation_id: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceFileSetRequest {
    pub path: String,
    pub value: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceFileSetResponse {
    pub path: String,
    pub correlation_id: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDeleteConversationRequest {
    pub conversation_id: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDeleteConversationResponse {
    pub conversation_id: String,
    pub correlation_id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpenSessionRequest {
    pub correlation_id: String,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpenSessionResponse {
    pub session_id: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputRequest {
    pub session_id: String,
    pub input: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputResponse {
    pub session_id: String,
    pub accepted: bool,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeResponse {
    pub session_id: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCloseSessionRequest {
    pub session_id: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCloseSessionResponse {
    pub session_id: String,
    pub closed: bool,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamStartPayload {
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamChunkPayload {
    pub conversation_id: String,
    pub delta: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamReasoningChunkPayload {
    pub conversation_id: String,
    pub delta: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamCompletePayload {
    pub conversation_id: String,
    pub assistant_length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolMode {
    Sandbox,
    Shell,
    Root,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvokeRequest {
    pub correlation_id: String,
    pub tool_id: String,
    pub action: String,
    pub mode: ToolMode,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvokeResponse {
    pub correlation_id: String,
    pub tool_id: String,
    pub action: String,
    pub ok: bool,
    pub data: Value,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolRecord {
    pub tool_id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub core: bool,
    pub optional: bool,
    pub version: String,
    pub source: String,
    pub enabled: bool,
    pub icon: bool,
    pub status: String,
    pub entry: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolsListRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolsListResponse {
    pub tools: Vec<WorkspaceToolRecord>,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolSetEnabledRequest {
    pub correlation_id: String,
    pub tool_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolSetEnabledResponse {
    pub correlation_id: String,
    pub tool_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolSetIconRequest {
    pub correlation_id: String,
    pub tool_id: String,
    pub icon: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolSetIconResponse {
    pub correlation_id: String,
    pub tool_id: String,
    pub icon: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolForgetRequest {
    pub correlation_id: String,
    pub tool_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolForgetResponse {
    pub correlation_id: String,
    pub tool_id: String,
    pub forgotten: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolCreateAppPluginRequest {
    pub correlation_id: String,
    pub tool_id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolCreateAppPluginResponse {
    pub correlation_id: String,
    pub tool: WorkspaceToolRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolsExportRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolsExportResponse {
    pub correlation_id: String,
    pub file_name: String,
    pub payload_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolsImportRequest {
    pub correlation_id: String,
    pub payload_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolsImportResponse {
    pub correlation_id: String,
    pub tools: Vec<WorkspaceToolRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProjectsRootsRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProjectsRootsResponse {
    pub correlation_id: String,
    pub content_root: String,
    pub projects_root: String,
    pub tools_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProjectEnsureRequest {
    pub correlation_id: String,
    pub project_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProjectEnsureResponse {
    pub correlation_id: String,
    pub project_name: String,
    pub project_slug: String,
    pub root_path: String,
    pub tasks_path: String,
    pub sheets_path: String,
    pub looper_path: String,
    pub files_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomToolCapabilityInvokeRequest {
    pub correlation_id: String,
    #[serde(alias = "pluginId")]
    pub custom_tool_id: String,
    pub request_id: String,
    pub capability: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomToolCapabilityInvokeResponse {
    pub correlation_id: String,
    #[serde(alias = "pluginId")]
    pub custom_tool_id: String,
    pub request_id: String,
    pub capability: String,
    pub ok: bool,
    pub data: Value,
    pub error: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityInvokeRequest {
    pub correlation_id: String,
    pub plugin_id: String,
    pub request_id: String,
    pub capability: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityInvokeResponse {
    pub correlation_id: String,
    pub plugin_id: String,
    pub request_id: String,
    pub capability: String,
    pub ok: bool,
    pub data: Value,
    pub error: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesListDirectoryRequest {
    pub correlation_id: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesListDirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesListDirectoryResponse {
    pub correlation_id: String,
    pub root_path: String,
    pub listed_path: String,
    pub entries: Vec<FilesListDirectoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesReadFileRequest {
    pub correlation_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesReadFileResponse {
    pub correlation_id: String,
    pub path: String,
    pub content: String,
    pub size_bytes: u64,
    pub read_only: bool,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesWriteFileRequest {
    pub correlation_id: String,
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesWriteFileResponse {
    pub correlation_id: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesDeletePathRequest {
    pub correlation_id: String,
    pub path: String,
    pub recursive: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesDeletePathResponse {
    pub correlation_id: String,
    pub path: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesCreateDirectoryRequest {
    pub correlation_id: String,
    pub path: String,
    pub recursive: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesCreateDirectoryResponse {
    pub correlation_id: String,
    pub path: String,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiConnectionType {
    Llm,
    Search,
    Stt,
    Tts,
    Image,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApiConnectionStatus {
    Verified,
    Warning,
    Pending,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionRecord {
    pub id: String,
    pub api_type: ApiConnectionType,
    pub api_url: String,
    pub name: Option<String>,
    pub api_key_prefix: String,
    pub api_key_masked: String,
    pub model_name: Option<String>,
    pub cost_per_month_usd: Option<f64>,
    pub status: ApiConnectionStatus,
    pub status_message: String,
    pub last_checked_ms: Option<i64>,
    pub created_ms: i64,
    pub api_standard_path: Option<String>,
    #[serde(default)]
    pub available_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionAgentRecord {
    pub id: String,
    pub api_type: ApiConnectionType,
    pub api_url: String,
    pub name: Option<String>,
    pub api_key: String,
    pub model_name: Option<String>,
    pub cost_per_month_usd: Option<f64>,
    pub api_standard_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionsListRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionsListResponse {
    pub correlation_id: String,
    pub connections: Vec<ApiConnectionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionsExportRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionsExportResponse {
    pub correlation_id: String,
    pub file_name: String,
    pub payload_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionsImportRequest {
    pub correlation_id: String,
    pub payload_json: String,
    #[serde(default)]
    pub allow_plaintext_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionsImportResponse {
    pub correlation_id: String,
    pub connections: Vec<ApiConnectionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionGetSecretRequest {
    pub correlation_id: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionGetSecretResponse {
    pub correlation_id: String,
    pub id: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchRequest {
    pub correlation_id: String,
    pub query: String,
    pub mode: Option<String>,
    pub num: Option<u32>,
    pub page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResponse {
    pub correlation_id: String,
    pub result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionCreateRequest {
    pub correlation_id: String,
    pub api_type: ApiConnectionType,
    pub api_url: String,
    pub name: Option<String>,
    pub api_key: String,
    pub model_name: Option<String>,
    pub cost_per_month_usd: Option<f64>,
    pub api_standard_path: Option<String>,
    #[serde(default)]
    pub allow_plaintext_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionCreateResponse {
    pub correlation_id: String,
    pub connection: ApiConnectionRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionProbeRequest {
    pub correlation_id: String,
    pub api_url: String,
    pub api_type: Option<ApiConnectionType>,
    pub api_key: Option<String>,
    pub api_standard_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionProbeResponse {
    pub correlation_id: String,
    pub detected_api_type: ApiConnectionType,
    pub api_standard_path: Option<String>,
    pub verify_url: String,
    pub models: Vec<String>,
    pub selected_model: Option<String>,
    pub status: ApiConnectionStatus,
    pub status_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionReverifyRequest {
    pub correlation_id: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionReverifyResponse {
    pub correlation_id: String,
    pub connection: ApiConnectionRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionUpdateRequest {
    pub correlation_id: String,
    pub id: String,
    pub api_type: Option<ApiConnectionType>,
    pub api_url: Option<String>,
    pub name: Option<String>,
    pub api_key: Option<String>,
    pub model_name: Option<String>,
    pub cost_per_month_usd: Option<f64>,
    pub api_standard_path: Option<String>,
    #[serde(default)]
    pub allow_plaintext_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionUpdateResponse {
    pub correlation_id: String,
    pub connection: ApiConnectionRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionDeleteRequest {
    pub correlation_id: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionDeleteResponse {
    pub correlation_id: String,
    pub id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeStatusRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimePrerequisite {
    pub key: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeEngine {
    pub engine_id: String,
    pub backend: String,
    pub label: String,
    pub is_applicable: bool,
    pub is_bundled: bool,
    pub is_installed: bool,
    pub is_ready: bool,
    pub binary_path: Option<String>,
    pub prerequisites: Vec<LlamaRuntimePrerequisite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeStatusResponse {
    pub correlation_id: String,
    pub state: String,
    pub active_engine_id: Option<String>,
    pub endpoint: Option<String>,
    pub pid: Option<u32>,
    pub engines: Vec<LlamaRuntimeEngine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeInstallRequest {
    pub correlation_id: String,
    pub engine_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeInstallResponse {
    pub correlation_id: String,
    pub engine_id: String,
    pub installed_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeStartRequest {
    pub correlation_id: String,
    pub engine_id: String,
    pub model_path: String,
    pub port: Option<u16>,
    pub ctx_size: Option<u32>,
    pub n_gpu_layers: Option<i32>,
    pub threads: Option<u32>,
    pub batch_size: Option<u32>,
    pub ubatch_size: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<u32>,
    pub repeat_penalty: Option<f32>,
    pub flash_attn: Option<bool>,
    pub mmap: Option<bool>,
    pub mlock: Option<bool>,
    pub seed: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeStartResponse {
    pub correlation_id: String,
    pub engine_id: String,
    pub endpoint: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeStopRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaRuntimeStopResponse {
    pub correlation_id: String,
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerListInstalledRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerInstalledModel {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size_mb: u64,
    pub modified_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerListInstalledResponse {
    pub correlation_id: String,
    pub models: Vec<ModelManagerInstalledModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerSearchHfRequest {
    pub correlation_id: String,
    pub query: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerHfCandidate {
    pub id: String,
    pub repo_id: String,
    pub file_name: String,
    pub size_mb: Option<u64>,
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerSearchHfResponse {
    pub correlation_id: String,
    pub results: Vec<ModelManagerHfCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerDownloadHfRequest {
    pub correlation_id: String,
    pub repo_id: String,
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerDownloadHfResponse {
    pub correlation_id: String,
    pub model: ModelManagerInstalledModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerDeleteInstalledRequest {
    pub correlation_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerDeleteInstalledResponse {
    pub correlation_id: String,
    pub model_id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerListCatalogCsvRequest {
    pub correlation_id: String,
    pub list_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerCatalogCsvRow {
    pub repo_id: String,
    pub model_name: String,
    pub parameter_count: String,
    pub file_name: String,
    pub quant: String,
    pub size_mb: Option<u64>,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerListCatalogCsvResponse {
    pub correlation_id: String,
    pub list_name: String,
    pub rows: Vec<ModelManagerCatalogCsvRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerRefreshUnslothCatalogRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManagerRefreshUnslothCatalogResponse {
    pub correlation_id: String,
    pub rows: Vec<ModelManagerCatalogCsvRow>,
    pub new_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesProbeMicrophoneRequest {
    pub correlation_id: String,
    pub attempt_open: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesProbeMicrophoneResponse {
    pub correlation_id: String,
    pub status: String,
    pub message: String,
    pub input_device_count: usize,
    pub default_input_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionResponse {
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppResourceUsageRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppResourceUsageResponse {
    pub correlation_id: String,
    pub cpu_percent: Option<f32>,
    pub memory_bytes: Option<u64>,
    pub network_rx_bytes_per_sec: Option<u64>,
    pub network_tx_bytes_per_sec: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowMode {
    Plan,
    Build,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowRunStatus {
    Idle,
    Queued,
    Running,
    #[serde(alias = "completed")]
    Succeeded,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStartRequest {
    pub correlation_id: String,
    pub mode: FlowMode,
    pub max_iterations: Option<u32>,
    pub dry_run: Option<bool>,
    pub auto_push: Option<bool>,
    pub prompt_plan_path: Option<String>,
    pub prompt_build_path: Option<String>,
    pub plan_path: Option<String>,
    pub specs_glob: Option<String>,
    pub backpressure_commands: Option<Vec<String>>,
    pub implement_command: Option<String>,
    pub phase_models: Option<std::collections::HashMap<String, String>>,
    pub use_agent: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStartResponse {
    pub correlation_id: String,
    pub run_id: String,
    pub status: FlowRunStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStopRequest {
    pub correlation_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStopResponse {
    pub correlation_id: String,
    pub run_id: String,
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowPauseRequest {
    pub correlation_id: String,
    pub run_id: String,
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowPauseResponse {
    pub correlation_id: String,
    pub run_id: String,
    pub paused: bool,
    pub updated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNudgeRequest {
    pub correlation_id: String,
    pub run_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNudgeResponse {
    pub correlation_id: String,
    pub run_id: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStatusRequest {
    pub correlation_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowListRunsRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowRerunValidationRequest {
    pub correlation_id: String,
    pub run_id: String,
    pub iteration: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowRerunValidationResult {
    pub command: String,
    pub ok: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowRerunValidationResponse {
    pub correlation_id: String,
    pub run_id: String,
    pub iteration: Option<u32>,
    pub ok: bool,
    pub results: Vec<FlowRerunValidationResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowStepState {
    Pending,
    Running,
    Complete,
    Error,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStepStatus {
    pub step: String,
    pub state: FlowStepState,
    pub started_at_ms: Option<i64>,
    pub completed_at_ms: Option<i64>,
    pub result: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowIterationStatus {
    pub index: u32,
    pub status: FlowRunStatus,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub task_id: Option<String>,
    pub steps: Vec<FlowStepStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowRunRecord {
    pub run_id: String,
    pub mode: FlowMode,
    pub status: FlowRunStatus,
    pub max_iterations: Option<u32>,
    pub current_iteration: u32,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub dry_run: bool,
    pub auto_push: bool,
    pub prompt_plan_path: String,
    pub prompt_build_path: String,
    pub plan_path: String,
    pub specs_glob: String,
    pub backpressure_commands: Vec<String>,
    #[serde(default)]
    pub implement_command: String,
    #[serde(default)]
    pub phase_models: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub use_agent: bool,
    pub summary: Option<String>,
    pub iterations: Vec<FlowIterationStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStatusResponse {
    pub correlation_id: String,
    pub run: FlowRunRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowListRunsResponse {
    pub correlation_id: String,
    pub runs: Vec<FlowRunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LooperLoopType {
    Prd,
    Build,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LooperLoopStatus {
    Idle,
    Running,
    Paused,
    Completed,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LooperPhaseStatus {
    Idle,
    Running,
    Complete,
    Error,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperSubStepStatus {
    pub id: String,
    pub label: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperPhaseState {
    pub phase: String,
    pub status: LooperPhaseStatus,
    pub session_id: Option<String>,
    pub substeps: Vec<LooperSubStepStatus>,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperQuestionOption {
    pub id: String,
    pub label: String,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperQuestion {
    pub id: String,
    pub title: String,
    pub prompt: String,
    #[serde(default)]
    pub options: Vec<LooperQuestionOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperPreviewStateRecord {
    pub status: String,
    pub command: Option<String>,
    pub url: Option<String>,
    pub session_id: Option<String>,
    pub last_error: Option<String>,
    pub last_started_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperLoopRecord {
    pub id: String,
    pub iteration: i32,
    pub loop_type: LooperLoopType,
    pub status: LooperLoopStatus,
    pub active_phase: Option<String>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub phases: std::collections::HashMap<String, LooperPhaseState>,
    pub review_result: Option<String>,
    pub cwd: String,
    pub task_path: String,
    pub specs_glob: String,
    pub max_iterations: i32,
    #[serde(default)]
    pub phase_models: std::collections::HashMap<String, String>,
    pub project_name: String,
    pub project_type: String,
    pub project_icon: String,
    pub project_description: String,
    #[serde(default)]
    pub review_before_execute: bool,
    #[serde(default)]
    pub planner_plan: String,
    #[serde(default)]
    pub pending_questions: Vec<LooperQuestion>,
    #[serde(default)]
    pub preview: Option<LooperPreviewStateRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperStartRequest {
    pub correlation_id: String,
    pub loop_id: String,
    pub iteration: i32,
    pub loop_type: LooperLoopType,
    pub cwd: String,
    pub task_path: String,
    pub specs_glob: String,
    pub max_iterations: i32,
    pub phase_models: Option<std::collections::HashMap<String, String>>,
    pub phase_prompts: Option<std::collections::HashMap<String, String>>,
    pub project_name: String,
    pub project_type: String,
    pub project_icon: String,
    pub project_description: String,
    #[serde(default = "default_true")]
    pub review_before_execute: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperStartResponse {
    pub correlation_id: String,
    pub loop_id: String,
    pub status: LooperLoopStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperStopRequest {
    pub correlation_id: String,
    pub loop_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperStopResponse {
    pub correlation_id: String,
    pub loop_id: String,
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperPauseRequest {
    pub correlation_id: String,
    pub loop_id: String,
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperPauseResponse {
    pub correlation_id: String,
    pub loop_id: String,
    pub paused: bool,
    pub updated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperAdvanceRequest {
    pub correlation_id: String,
    pub loop_id: String,
    pub next_phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperAdvanceResponse {
    pub correlation_id: String,
    pub loop_id: String,
    pub active_phase: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperStatusRequest {
    pub correlation_id: String,
    pub loop_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperStatusResponse {
    pub correlation_id: String,
    pub loop_record: Option<LooperLoopRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperListRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperListResponse {
    pub correlation_id: String,
    pub loops: Vec<LooperLoopRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperCloseRequest {
    pub correlation_id: String,
    pub loop_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperCloseResponse {
    pub correlation_id: String,
    pub loop_id: String,
    pub closed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperCheckOpenCodeRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperCheckOpenCodeResponse {
    pub correlation_id: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperQuestionAnswer {
    pub question_id: String,
    pub selected_option_id: String,
    pub freeform_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperSubmitQuestionsRequest {
    pub correlation_id: String,
    pub loop_id: String,
    pub answers: Vec<LooperQuestionAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperSubmitQuestionsResponse {
    pub correlation_id: String,
    pub loop_id: String,
    pub submitted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperCloseAllRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperCloseAllResponse {
    pub correlation_id: String,
    pub closed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperImportRequest {
    pub correlation_id: String,
    pub loops: Vec<LooperLoopRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperImportResponse {
    pub correlation_id: String,
    pub imported_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperPreviewRequest {
    pub correlation_id: String,
    pub loop_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperPreviewResponse {
    pub correlation_id: String,
    pub loop_id: String,
    pub status: String,
    pub command: Option<String>,
    pub url: Option<String>,
    pub session_id: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatusRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatusResponse {
    pub correlation_id: String,
    pub engine_id: String,
    pub engine: String,
    pub ready: bool,
    pub message: String,
    pub model_path: String,
    pub secondary_path: String,
    pub voices_path: String,
    pub tokens_path: String,
    pub data_dir: String,
    pub python_path: String,
    pub script_path: String,
    pub runtime_archive_present: bool,
    pub available_model_paths: Vec<String>,
    pub available_voices: Vec<String>,
    pub selected_voice: String,
    pub speed: f32,
    pub lexicon_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsListVoicesRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsListVoicesResponse {
    pub correlation_id: String,
    pub voices: Vec<String>,
    pub selected_voice: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSpeakRequest {
    pub correlation_id: String,
    pub text: String,
    pub voice: Option<String>,
    pub speed: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSpeakResponse {
    pub correlation_id: String,
    pub engine_id: String,
    pub voice: String,
    pub speed: f32,
    pub sample_rate: u32,
    pub duration_ms: u32,
    pub audio_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStopRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStopResponse {
    pub correlation_id: String,
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSelfTestRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSelfTestResponse {
    pub correlation_id: String,
    pub ok: bool,
    pub message: String,
    pub bytes: u64,
    pub sample_rate: u32,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSettingsGetRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSettingsGetResponse {
    pub correlation_id: String,
    pub engine_id: String,
    pub engine: String,
    pub voice: String,
    pub speed: f32,
    pub model_path: String,
    pub secondary_path: String,
    pub voices_path: String,
    pub tokens_path: String,
    pub data_dir: String,
    pub python_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSettingsSetRequest {
    pub correlation_id: String,
    pub engine: Option<String>,
    pub voice: Option<String>,
    pub speed: Option<f32>,
    pub model_path: Option<String>,
    pub secondary_path: Option<String>,
    pub voices_path: Option<String>,
    pub tokens_path: Option<String>,
    pub data_dir: Option<String>,
    pub python_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSettingsSetResponse {
    pub correlation_id: String,
    pub ok: bool,
    pub engine: String,
    pub voice: String,
    pub speed: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsDownloadModelRequest {
    pub correlation_id: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsDownloadModelResponse {
    pub correlation_id: String,
    pub ok: bool,
    pub message: String,
    pub model_path: String,
    pub voices_path: String,
    pub tokens_path: String,
    pub data_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Subsystem {
    Frontend,
    Ipc,
    Service,
    Runtime,
    Registry,
    Tool,
    Memory,
    Persistence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventStage {
    Start,
    Progress,
    Complete,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventSeverity {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEvent {
    pub timestamp_ms: i64,
    pub correlation_id: String,
    pub subsystem: Subsystem,
    pub action: String,
    pub stage: EventStage,
    pub severity: EventSeverity,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceListVadMethodsRequest {
    pub correlation_id: String,
    pub include_experimental: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceListVadMethodsResponse {
    pub correlation_id: String,
    pub methods: Vec<crate::voice::vad::contracts::VadManifest>,
    pub selected_vad_method: String,
    pub state: crate::voice::session::VoiceRuntimeState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceGetVadSettingsRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceGetVadSettingsResponse {
    pub correlation_id: String,
    pub settings: crate::voice::settings::PersistedVoiceSettings,
    pub state: crate::voice::session::VoiceRuntimeState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSetVadMethodRequest {
    pub correlation_id: String,
    pub method_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRuntimeSnapshotResponse {
    pub correlation_id: String,
    pub snapshot: crate::app::voice_runtime_service::VoiceRuntimeSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceUpdateVadConfigRequest {
    pub correlation_id: String,
    pub method_id: String,
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceUpdateVadConfigResponse {
    pub correlation_id: String,
    pub settings: crate::voice::settings::PersistedVoiceSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStartSessionRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStopSessionRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRequestHandoffRequest {
    pub correlation_id: String,
    pub target_method_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSetShadowMethodRequest {
    pub correlation_id: String,
    pub method_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStartShadowEvalRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStopShadowEvalRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSetDuplexModeRequest {
    pub correlation_id: String,
    pub duplex_mode: crate::voice::settings::DuplexMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceGetRuntimeDiagnosticsRequest {
    pub correlation_id: String,
}
