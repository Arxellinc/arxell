import { invoke } from "@tauri-apps/api/core";
import type {
  Conversation,
  Message,
  Project,
} from "../types";
import type { ToolInvokeRequest } from "../core/tooling/types";

// Settings
export const settingsGet = (key: string) =>
  invoke<string | null>("cmd_settings_get", { key });

export const settingsSet = (key: string, value: string) =>
  invoke<void>("cmd_settings_set", { key, value });

export const settingsGetAll = () =>
  invoke<Record<string, string>>("cmd_settings_get_all");

export interface ToolPackRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  install_path: string;
  executable_path: string | null;
  source_repo: string;
  source_ref: string;
  installed_at: number;
}

export interface ToolPackIndexEntry {
  id: string;
  name: string;
  description: string;
  latest: string;
  manifest_path?: string | null;
}

export interface ToolPackInstallRequest {
  id: string;
  repo?: string;
  ref?: string;
  manifest_path?: string;
  enable?: boolean;
}

export const toolPacksList = () =>
  invoke<ToolPackRecord[]>("cmd_tool_packs_list");

export const toolPacksIndex = (repo?: string, ref?: string) =>
  invoke<ToolPackIndexEntry[]>("cmd_tool_packs_index", { repo, gitRef: ref });

export const toolPackInstall = (request: ToolPackInstallRequest) =>
  invoke<ToolPackRecord>("cmd_tool_pack_install", { request });

export const toolPackSetEnabled = (id: string, enabled: boolean) =>
  invoke<void>("cmd_tool_pack_set_enabled", { request: { id, enabled } });

export const toolPackRemove = (id: string, remove_files = true) =>
  invoke<void>("cmd_tool_pack_remove", { request: { id, removeFiles: remove_files } });

export const modelsList = () => invoke<string[]>("cmd_models_list");

// Model Configs
export interface ModelConfig {
  id: string;
  name: string;
  api_type: string;
  model_id: string;
  base_url: string;
  api_key: string;
  parameter_count: number | null;
  speed_tps: number | null;
  context_length: number | null;
  monthly_cost: number | null;
  cost_per_million_tokens: number | null;
  last_available: boolean;
  last_check_message: string;
  last_check_at: number | null;
  is_primary: boolean;
  created_at: number;
}

export const modelListAll = () => invoke<ModelConfig[]>("cmd_model_list_all");

export const modelAdd = (
  name: string,
  model_id: string,
  base_url: string,
  api_key?: string,
  is_primary?: boolean,
  extras?: {
    api_type?: string;
    parameter_count?: number;
    speed_tps?: number;
    context_length?: number;
    monthly_cost?: number;
    cost_per_million_tokens?: number;
  }
) =>
  invoke<ModelConfig>("cmd_model_add", {
    name,
    modelId: model_id,
    baseUrl: base_url,
    apiKey: api_key,
    apiType: extras?.api_type,
    parameterCount: extras?.parameter_count,
    speedTps: extras?.speed_tps,
    contextLength: extras?.context_length,
    monthlyCost: extras?.monthly_cost,
    costPerMillionTokens: extras?.cost_per_million_tokens,
    isPrimary: is_primary,
  });

export const modelUpdate = (
  id: string,
  params: {
    name?: string;
    model_id?: string;
    base_url?: string;
    api_key?: string;
    api_type?: string;
    parameter_count?: number;
    speed_tps?: number;
    context_length?: number;
    monthly_cost?: number;
    cost_per_million_tokens?: number;
    is_primary?: boolean;
  }
) =>
  invoke<void>("cmd_model_update", {
    id,
    name: params.name,
    modelId: params.model_id,
    baseUrl: params.base_url,
    apiKey: params.api_key,
    apiType: params.api_type,
    parameterCount: params.parameter_count,
    speedTps: params.speed_tps,
    contextLength: params.context_length,
    monthlyCost: params.monthly_cost,
    costPerMillionTokens: params.cost_per_million_tokens,
    isPrimary: params.is_primary,
  });

export const modelDelete = (id: string) =>
  invoke<void>("cmd_model_delete", { id });

export const modelSetPrimary = (id: string) =>
  invoke<void>("cmd_model_set_primary", { id });

export interface ModelVerifyResult {
  ok: boolean;
  reachable: boolean;
  model_found: boolean;
  response_ok: boolean;
  status_code: number | null;
  latency_ms: number;
  message: string;
}

export const modelVerify = (id: string, test_response?: boolean) =>
  invoke<ModelVerifyResult>("cmd_model_verify", {
    id,
    testResponse: test_response,
  });

// Skills
export type SkillCategory = "always_active" | "user_selectable";

export interface SkillMeta {
  id: string;
  name: string;
  path: string;
  description: string;
  category: SkillCategory;
}
export interface SkillsResolveResult {
  available: SkillMeta[];
  enabled_ids: string[];
  context_markdown: string;
}
export const skillsList = (workspacePath?: string) =>
  invoke<SkillMeta[]>("cmd_skills_list", { workspacePath });
export const skillsDir = () => invoke<string>("cmd_skills_dir");
export const skillsResolve = (params: {
  conversationId?: string | null;
  workspacePath?: string;
  modeId?: "chat" | "voice" | "tools" | "full";
}) =>
  invoke<SkillsResolveResult>("cmd_skills_resolve", {
    conversationId: params.conversationId ?? null,
    workspacePath: params.workspacePath,
    modeId: params.modeId,
  });

export const skillsSetEnabled = (params: {
  conversationId: string;
  enabledIds: string[];
  workspacePath?: string;
  modeId?: "chat" | "voice" | "tools" | "full";
}) =>
  invoke<SkillsResolveResult>("cmd_skills_set_enabled", {
    conversationId: params.conversationId,
    enabledIds: params.enabledIds,
    workspacePath: params.workspacePath,
    modeId: params.modeId,
  });

// Projects
export const projectCreate = (name: string, workspacePath: string) =>
  invoke<Project>("cmd_project_create", { name, workspacePath });

export const projectList = () => invoke<Project[]>("cmd_project_list");

export const projectDelete = (id: string) =>
  invoke<void>("cmd_project_delete", { id });

export const projectUpdate = (
  id: string,
  params: { name?: string; description?: string; workspacePath?: string }
) => invoke<void>("cmd_project_update", { id, ...params });

// Conversations
export const conversationCreate = (projectId: string | null, title: string) =>
  invoke<Conversation>("cmd_conversation_create", { projectId, title });

export const conversationList = (projectId: string) =>
  invoke<Conversation[]>("cmd_conversation_list", { projectId });

export const conversationListAll = () =>
  invoke<Conversation[]>("cmd_conversation_list_all");

export const conversationGetLast = () =>
  invoke<Conversation | null>("cmd_conversation_get_last");

export const conversationDelete = (id: string) =>
  invoke<void>("cmd_conversation_delete", { id });

export const conversationUpdateTitle = (id: string, title: string) =>
  invoke<void>("cmd_conversation_update_title", { id, title });

export const conversationAssignProject = (id: string, projectId: string | null) =>
  invoke<void>("cmd_conversation_assign_project", { id, projectId });

export const conversationBranchFromMessage = (
  sourceConversationId: string | null,
  projectId: string | null,
  content: string,
  title?: string
) =>
  invoke<Conversation>("cmd_conversation_branch_from_message", {
    sourceConversationId,
    projectId,
    content,
    title,
  });

// Chat
export const chatStream = (
  conversationId: string,
  content: string,
  extraContext?: string,
  thinkingEnabled?: boolean,
  assistantMsgId?: string,
  screenshotBase64?: string,
  modeId?: "chat" | "voice" | "tools" | "full"
) =>
  invoke<Message>("cmd_chat_stream", {
    conversationId,
    content,
    extraContext,
    thinkingEnabled,
    assistantMsgId,
    screenshotBase64,
    modeId,
  });


export const chatCancel = () => invoke<void>("cmd_chat_cancel");

export const prefillWarmup = (conversationId: string, partialText?: string) =>
  invoke<void>("cmd_prefill_warmup", { conversationId, partialText });

export const chatGetMessages = (conversationId: string) =>
  invoke<Message[]>("cmd_chat_get_messages", { conversationId });

export const chatClear = (conversationId: string) =>
  invoke<void>("cmd_chat_clear", { conversationId });

export const chatRegenerateLastPrompt = (conversationId: string) =>
  invoke<string>("cmd_chat_regenerate_last_prompt", { conversationId });

export const delegateModelStream = (params: {
  delegationId: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  prompt: string;
}) =>
  invoke<void>("cmd_delegate_stream", {
    delegationId: params.delegationId,
    modelId: params.modelId,
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    prompt: params.prompt,
  });

// Voice
export const voiceStart = () => invoke<void>("cmd_voice_start");
export const voiceStop = () => invoke<void>("cmd_voice_stop");

export interface VoiceEndpointStatus {
  stt: boolean;
  tts: boolean;
  stt_url: string;
  tts_url: string;
}

export interface TtsSpeakResult {
  audioBytes: number[];
  phonemes: string | null;
}

export const ttsSpeak = (text: string) =>
  invoke<TtsSpeakResult>("cmd_tts_speak", { text });

export const checkVoiceEndpoints = () =>
  invoke<VoiceEndpointStatus>("cmd_check_voice_endpoints");

export interface AudioDevices {
  inputs: string[];
  outputs: string[];
  default_input: string | null;
  default_output: string | null;
}

export const listAudioDevices = () =>
  invoke<AudioDevices>("cmd_list_audio_devices");

export interface TtsEngineStatus {
  kokoro: boolean;
  kokoro_reason: string | null;
  espeak: boolean;
  espeak_reason: string | null;
  external: boolean;
  external_reason: string | null;
  current_engine: string;
}

export interface TtsSelfTestResult {
  current_engine: string;
  ok: boolean;
  check_reason: string | null;
  synth_bytes: number;
  synth_reason: string | null;
  engines: TtsEngineStatus;
}

export interface KokoroBootstrapStatus {
  phase: string;
  message: string;
  progressPercent: number;
  modelReady: boolean;
  runtimeReady: boolean;
  done: boolean;
  ok: boolean;
  error: string | null;
}

export const getKokoroBootstrapStatus = () =>
  invoke<KokoroBootstrapStatus>("cmd_get_kokoro_bootstrap_status");

export const checkTtsEngines = () =>
  invoke<TtsEngineStatus>("cmd_tts_check_engines");

export const ttsSelfTest = () =>
  invoke<TtsSelfTestResult>("cmd_tts_self_test");

export interface SttEngineStatus {
  whisper_rs: boolean;
  whisper_py: boolean;
  external: boolean;
  current_engine: string;
}

export const checkSttEngines = () =>
  invoke<SttEngineStatus>("cmd_stt_check_engines");

export const listWhisperModels = (dir: string) =>
  invoke<string[]>("cmd_stt_list_whisper_models", { dir });

export const listTtsVoices = () =>
  invoke<string[]>("cmd_tts_list_voices");

// Diagnostics
export interface DiagResult {
  name: string;
  ok: boolean;
  detail: string;
}

export const runVoiceDiagnostics = () =>
  invoke<DiagResult[]>("cmd_voice_diagnostics");

// Tool Gateway
export const toolInvoke = <T>(request: ToolInvokeRequest) =>
  invoke<T>("cmd_tool_invoke", { request });

// Browser (routed via tool gateway)
export const browserFetch = async (url: string, mode?: string) => {
  const result = await toolInvoke<{ content: string }>({
    toolId: "web",
    action: "browser.fetch",
    mode: "sandbox",
    payload: { url, mode },
  });
  return result.content;
};

export interface BrowserSearchResult {
  query: string;
  mode: string;
  items: Array<Record<string, unknown>>;
  organic: Array<Record<string, unknown>>;
  answerBox?: Record<string, unknown> | null;
  knowledgeGraph?: Record<string, unknown> | null;
  peopleAlsoAsk: Array<Record<string, unknown>>;
  relatedSearches: string[];
  raw: Record<string, unknown>;
}

export interface BrowserSearchKeyStatus {
  configured: boolean;
  masked: string;
}

export interface BrowserSearchKeyTestResult {
  ok: boolean;
  status: number | null;
  message: string;
  detail?: string;
}

export const browserSearch = async (query: string, mode?: string, num?: number, page?: number) => {
  const result = await toolInvoke<{ result: BrowserSearchResult }>({
    toolId: "web",
    action: "browser.search",
    mode: "sandbox",
    payload: { query, mode, num, page },
  });
  return result.result;
};

export const browserSearchSetKey = async (apiKey: string) => {
  await toolInvoke<{ ok: boolean }>({
    toolId: "web",
    action: "browser.search.key_set",
    mode: "sandbox",
    payload: { apiKey },
  });
};

export const browserSearchKeyStatus = async () => {
  const result = await toolInvoke<{ status: BrowserSearchKeyStatus }>({
    toolId: "web",
    action: "browser.search.key_status",
    mode: "sandbox",
    payload: {},
  });
  return result.status;
};

export const browserSearchKeyTest = async () => {
  const result = await toolInvoke<{ result: BrowserSearchKeyTestResult }>({
    toolId: "web",
    action: "browser.search.key_test",
    mode: "sandbox",
    payload: {},
  });
  return result.result;
};

export const browserSearchKeyValidate = async (apiKey: string) => {
  const result = await toolInvoke<{ result: BrowserSearchKeyTestResult }>({
    toolId: "web",
    action: "browser.search.key_validate",
    mode: "sandbox",
    payload: { apiKey },
  });
  return result.result;
};

// A2A process state (Agents panel)
export interface A2AProcessSummary {
  process_id: string;
  title: string;
  initiator: string;
  status: string;
  created_at_ms: number;
  updated_at_ms: number;
  task_count: number;
  running_task_count: number;
  blocked_task_count: number;
}

export interface A2AProcessRecord {
  process_id: string;
  title: string;
  initiator: string;
  status: string;
  last_error: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface A2AAgentRunRecord {
  agent_run_id: string;
  process_id: string;
  agent_name: string;
  parent_run_id: string | null;
  status: string;
  last_error: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface A2ATaskRecord {
  task_id: string;
  process_id: string;
  agent_run_id: string | null;
  title: string;
  status: string;
  last_error: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface A2AEdgeRecord {
  edge_id: string;
  process_id: string;
  from_node: string;
  to_node: string;
  kind: string;
  metadata_json: string | null;
  created_at_ms: number;
}

export interface A2AArtifactRecord {
  artifact_id: string;
  process_id: string;
  producer_task_id: string | null;
  path: string;
  hash_blake3: string;
  size_bytes: number;
  scope: string;
  created_at_ms: number;
}

export interface A2AMemoryRefRecord {
  memory_ref_id: string;
  process_id: string;
  namespace: string;
  key: string;
  scope: string;
  last_writer: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface A2AStoredEvent {
  sequence: number;
  event_id: string;
  process_id: string;
  event_type: string;
  actor: string;
  payload_json: string;
  occurred_at_ms: number;
}

export interface A2AProcessDetail {
  process: A2AProcessRecord;
  agent_runs: A2AAgentRunRecord[];
  tasks: A2ATaskRecord[];
  edges: A2AEdgeRecord[];
  artifacts: A2AArtifactRecord[];
  memory_refs: A2AMemoryRefRecord[];
}

export const a2aProcessList = (limit = 50, offset = 0) =>
  invoke<A2AProcessSummary[]>("cmd_a2a_process_list", { limit, offset });

export const a2aProcessGet = (processId: string) =>
  invoke<A2AProcessDetail | null>("cmd_a2a_process_get", { processId });

export const a2aProcessEvents = (processId: string, limit = 200) =>
  invoke<A2AStoredEvent[]>("cmd_a2a_process_events", { processId, limit });

export const a2aSeedDemoProcess = () =>
  invoke<string>("cmd_a2a_seed_demo_process");

export const a2aProcessCreate = (
  title: string,
  initiator?: string,
  actor?: string
) =>
  invoke<string>("cmd_a2a_process_create", { title, initiator, actor });

export const a2aProcessSetStatus = (
  processId: string,
  status: "queued" | "running" | "blocked" | "failed" | "succeeded" | "canceled",
  reason?: string,
  actor?: string
) =>
  invoke<void>("cmd_a2a_process_set_status", { processId, status, reason, actor });

export const a2aProcessRetry = (processId: string, actor?: string) =>
  invoke<void>("cmd_a2a_process_retry", { processId, actor });

export interface A2AAgentCard {
  card_id: string;
  name: string;
  role: string;
  description: string;
  protocol_version: string;
  version: string;
  url: string;
  preferred_model_id: string;
  fallback_model_ids_json: string;
  skills_json: string;
  capabilities_json: string;
  default_input_modes_json: string;
  default_output_modes_json: string;
  additional_interfaces_json: string;
  logic_language: string;
  logic_source: string;
  color: string;
  enabled: boolean;
  sort_order: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export const a2aAgentCardsList = () =>
  invoke<A2AAgentCard[]>("cmd_a2a_agent_cards_list");

export const a2aAgentCardCreate = (params: {
  name: string;
  role: string;
  description: string;
  protocol_version?: string;
  version?: string;
  url?: string;
  preferred_model_id?: string;
  fallback_model_ids_json?: string;
  skills_json?: string;
  capabilities_json?: string;
  default_input_modes_json?: string;
  default_output_modes_json?: string;
  additional_interfaces_json?: string;
  logic_language?: string;
  logic_source?: string;
  color?: string;
  enabled?: boolean;
  sort_order?: number;
}) =>
  invoke<A2AAgentCard>("cmd_a2a_agent_card_create", {
    name: params.name,
    role: params.role,
    description: params.description,
    protocolVersion: params.protocol_version,
    version: params.version,
    url: params.url,
    preferredModelId: params.preferred_model_id,
    fallbackModelIdsJson: params.fallback_model_ids_json,
    skillsJson: params.skills_json,
    capabilitiesJson: params.capabilities_json,
    defaultInputModesJson: params.default_input_modes_json,
    defaultOutputModesJson: params.default_output_modes_json,
    additionalInterfacesJson: params.additional_interfaces_json,
    logicLanguage: params.logic_language,
    logicSource: params.logic_source,
    color: params.color,
    enabled: params.enabled,
    sortOrder: params.sort_order,
  });

export const a2aAgentCardUpdate = (
  card_id: string,
  params: {
    name?: string;
    role?: string;
    description?: string;
    protocol_version?: string;
    version?: string;
    url?: string;
    preferred_model_id?: string;
    fallback_model_ids_json?: string;
    skills_json?: string;
    capabilities_json?: string;
    default_input_modes_json?: string;
    default_output_modes_json?: string;
    additional_interfaces_json?: string;
    logic_language?: string;
    logic_source?: string;
    color?: string;
    enabled?: boolean;
    sort_order?: number;
  }
) =>
  invoke<A2AAgentCard>("cmd_a2a_agent_card_update", {
    cardId: card_id,
    name: params.name,
    role: params.role,
    description: params.description,
    protocolVersion: params.protocol_version,
    version: params.version,
    url: params.url,
    preferredModelId: params.preferred_model_id,
    fallbackModelIdsJson: params.fallback_model_ids_json,
    skillsJson: params.skills_json,
    capabilitiesJson: params.capabilities_json,
    defaultInputModesJson: params.default_input_modes_json,
    defaultOutputModesJson: params.default_output_modes_json,
    additionalInterfacesJson: params.additional_interfaces_json,
    logicLanguage: params.logic_language,
    logicSource: params.logic_source,
    color: params.color,
    enabled: params.enabled,
    sortOrder: params.sort_order,
  });

export const a2aAgentCardDelete = (card_id: string) =>
  invoke<void>("cmd_a2a_agent_card_delete", { cardId: card_id });

// A2A workflow editor/runtime (dedicated A2A DB)
export interface A2AWorkflowRecord {
  workflow_id: string;
  name: string;
  active: boolean;
  version: number;
  definition_json: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface A2AWorkflowRunRecord {
  run_id: string;
  workflow_id: string;
  status: string;
  trigger_type: string;
  error: string | null;
  input_json: string;
  output_json: string | null;
  metrics_json: string;
  started_at_ms: number;
  finished_at_ms: number | null;
}

export interface A2AWorkflowNodeRunRecord {
  run_id: string;
  node_id: string;
  node_type: string;
  status: string;
  input_json: string;
  output_json: string | null;
  error: string | null;
  duration_ms: number;
  started_at_ms: number;
  finished_at_ms: number;
  attempt: number;
}

export interface A2AWorkflowRunDetail {
  run: A2AWorkflowRunRecord;
  node_runs: A2AWorkflowNodeRunRecord[];
}

export interface A2ACredentialRecord {
  credential_id: string;
  name: string;
  kind: string;
  data_json: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface A2ATemplateRecord {
  template_id: string;
  name: string;
  definition_json: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface A2AWorkflowNode {
  id: string;
  type: string;
  name: string;
  params: Record<string, unknown>;
  position?: { x: number; y: number };
  group_id?: string;
}

export interface A2AWorkflowEdge {
  id: string;
  source: string;
  source_output: string;
  target: string;
  target_input: string;
}

export interface A2AWorkflowGroup {
  id: string;
  label: string;
  node_ids: string[];
  color?: string;
}

export interface A2AWorkflowDefinition {
  workflow_id: string;
  name: string;
  active?: boolean;
  version?: number;
  nodes: A2AWorkflowNode[];
  edges: A2AWorkflowEdge[];
  groups?: A2AWorkflowGroup[];
}

export interface A2AExecutionItem {
  json: Record<string, unknown>;
  binary?: Record<string, unknown> | null;
  pairedItem?: { item: number } | null;
}

export type A2ANodeTier = "stable" | "beta" | "hidden";

export interface A2ANodeTypeDef {
  id: string;
  label: string;
  category: string;
  tier: A2ANodeTier;
  description: string;
  side_effecting: boolean;
}

export interface A2AWorkflowPreflightIssue {
  kind: string;
  node_id: string | null;
  node_type: string | null;
  message: string;
  blocking: boolean;
}

export interface A2AWorkflowPreflightResult {
  ok: boolean;
  issues: A2AWorkflowPreflightIssue[];
}

export const a2aWorkflowList = () =>
  invoke<A2AWorkflowRecord[]>("cmd_a2a_workflow_list");

export const a2aWorkflowGet = (workflow_id: string) =>
  invoke<A2AWorkflowRecord | null>("cmd_a2a_workflow_get", { workflowId: workflow_id });

export const a2aWorkflowCreate = (name: string, definition: A2AWorkflowDefinition, active = false) =>
  invoke<A2AWorkflowRecord>("cmd_a2a_workflow_create", {
    payload: { name, definition, active },
  });

export const a2aWorkflowUpdate = (
  workflow_id: string,
  params: { name?: string; definition?: A2AWorkflowDefinition; active?: boolean }
) =>
  invoke<A2AWorkflowRecord | null>("cmd_a2a_workflow_update", {
    payload: { workflowId: workflow_id, ...params },
  });

export const a2aWorkflowDelete = (workflow_id: string) =>
  invoke<boolean>("cmd_a2a_workflow_delete", { workflowId: workflow_id });

export const a2aWorkflowRunStart = (
  workflow_id: string,
  input: unknown,
  trigger_type = "manual",
  timeout_ms?: number
) =>
  invoke<A2AWorkflowRunRecord>("cmd_a2a_workflow_run_start", {
    payload: { workflowId: workflow_id, triggerType: trigger_type, input, timeoutMs: timeout_ms },
  });

export const a2aWorkflowRunCancel = (run_id: string) =>
  invoke<boolean>("cmd_a2a_workflow_run_cancel", { runId: run_id });

export const a2aWorkflowRunPause = (run_id: string) =>
  invoke<boolean>("cmd_a2a_workflow_run_pause", { runId: run_id });

export const a2aWorkflowRunResume = (run_id: string) =>
  invoke<boolean>("cmd_a2a_workflow_run_resume", { runId: run_id });

export const a2aWorkflowRunList = (workflow_id?: string, limit = 50) =>
  invoke<A2AWorkflowRunRecord[]>("cmd_a2a_workflow_run_list", { workflowId: workflow_id, limit });

export const a2aWorkflowRunGet = (run_id: string) =>
  invoke<A2AWorkflowRunDetail | null>("cmd_a2a_workflow_run_get", { runId: run_id });

export const a2aNodeTypeList = () =>
  invoke<A2ANodeTypeDef[]>("cmd_a2a_node_type_list");

export const a2aWorkflowPreflight = (definition: A2AWorkflowDefinition) =>
  invoke<A2AWorkflowPreflightResult>("cmd_a2a_workflow_preflight", { definition });

export const a2aWorkflowNodeTest = (node: A2AWorkflowNode, input_items: A2AExecutionItem[]) =>
  invoke<Record<string, A2AExecutionItem[]>>("cmd_a2a_workflow_node_test", {
    payload: { node, inputItems: input_items },
  });

export const a2aCredentialList = () =>
  invoke<A2ACredentialRecord[]>("cmd_a2a_credential_list");

export const a2aCredentialCreate = (
  name: string,
  kind: string,
  data: Record<string, unknown>
) =>
  invoke<A2ACredentialRecord>("cmd_a2a_credential_create", {
    payload: { name, kind, data },
  });

export const a2aCredentialDelete = (credential_id: string) =>
  invoke<boolean>("cmd_a2a_credential_delete", { credentialId: credential_id });

export const a2aTemplateList = () =>
  invoke<A2ATemplateRecord[]>("cmd_a2a_template_list");

export const a2aTemplateCreate = (name: string, definition: A2AWorkflowDefinition) =>
  invoke<A2ATemplateRecord>("cmd_a2a_template_create", {
    payload: { name, definition },
  });

export const a2aTemplateDelete = (template_id: string) =>
  invoke<boolean>("cmd_a2a_template_delete", { templateId: template_id });

// ─── Agent Memory ──────────────────────────────────────────────────────────────

export interface MemoryEntry {
  namespace: string;
  key: string;
  value: string;
  updated_at: number;
}

export const memoryUpsert = (namespace: string, key: string, value: string) =>
  invoke<void>("cmd_memory_upsert", { namespace, key, value });

export const memoryList = (namespace: string) =>
  invoke<MemoryEntry[]>("cmd_memory_list", { namespace });

export const memoryDelete = (namespace: string, key: string) =>
  invoke<boolean>("cmd_memory_delete", { namespace, key });

export const memoryGetDir = () =>
  invoke<string>("cmd_memory_get_dir");
