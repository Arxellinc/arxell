import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "../../types";
import type { ToolInvokeRequest, ToolMode } from "./types";

export const toolInvoke = <T>(request: ToolInvokeRequest) =>
  invoke<T>("cmd_tool_invoke", { request });

function sandboxRequest(toolId: ToolInvokeRequest["toolId"], action: string, payload?: unknown, mode: ToolMode = "sandbox"): ToolInvokeRequest {
  return { toolId, action, mode, payload };
}

export async function helpListDir(path: string): Promise<FileEntry[]> {
  const result = await toolInvoke<{ entries: FileEntry[] }>(
    sandboxRequest("help", "workspace.list_dir", { path })
  );
  return result.entries;
}

export async function helpListDirScoped(path: string, rootGuard: string): Promise<FileEntry[]> {
  const result = await toolInvoke<{ entries: FileEntry[] }>(
    sandboxRequest("help", "workspace.list_dir", { path, rootGuard })
  );
  return result.entries;
}

export async function helpReadFile(path: string, rootGuard?: string): Promise<string> {
  const result = await toolInvoke<{ content: string }>(
    sandboxRequest("help", "workspace.read_file", { path, rootGuard })
  );
  return result.content;
}

export async function browserFetchViaGateway(url: string, mode?: string): Promise<string> {
  const result = await toolInvoke<{ content: string }>(
    sandboxRequest("web", "browser.fetch", { url, mode })
  );
  return result.content;
}

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

export async function browserSearch(query: string, mode?: string, num?: number, page?: number): Promise<BrowserSearchResult> {
  const result = await toolInvoke<{ result: BrowserSearchResult }>(
    sandboxRequest("web", "browser.search", { query, mode, num, page })
  );
  return result.result;
}

export async function browserSearchKeySet(apiKey: string): Promise<void> {
  await toolInvoke<{ ok: boolean }>(
    sandboxRequest("web", "browser.search.key_set", { apiKey })
  );
}

export async function browserSearchKeyStatus(): Promise<BrowserSearchKeyStatus> {
  const result = await toolInvoke<{ status: BrowserSearchKeyStatus }>(
    sandboxRequest("web", "browser.search.key_status", {})
  );
  return result.status;
}

export async function browserSearchKeyTest(): Promise<BrowserSearchKeyTestResult> {
  const result = await toolInvoke<{ result: BrowserSearchKeyTestResult }>(
    sandboxRequest("web", "browser.search.key_test", {})
  );
  return result.result;
}

export async function browserSearchKeyValidate(apiKey: string): Promise<BrowserSearchKeyTestResult> {
  const result = await toolInvoke<{ result: BrowserSearchKeyTestResult }>(
    sandboxRequest("web", "browser.search.key_validate", { apiKey })
  );
  return result.result;
}

export interface StorageDevice {
  name: string;
  mountPoint: string;
  fileSystem: string;
  kind: string;
  totalMb: number;
  availableMb: number;
  usedMb: number;
  usagePercent: number;
  isRemovable: boolean;
}

export interface DisplayInfo {
  name: string | null;
  width: number;
  height: number;
  scaleFactor: number;
  x: number;
  y: number;
  isPrimary: boolean;
}

export interface SystemIdentity {
  osName: string | null;
  osVersion: string | null;
  kernelVersion: string | null;
  hostName: string | null;
  uptimeSecs: number;
  bootTimeSecs: number;
  userName: string | null;
  cpuName: string;
  cpuArch: string;
  cpuPhysicalCores: number;
  cpuLogicalCores: number;
}

export interface AudioDevices {
  inputs: string[];
  outputs: string[];
  default_input: string | null;
  default_output: string | null;
}

export interface PeripheralDevice {
  name: string;
  kind: string;
}

export async function systemGetStorageDevices(): Promise<StorageDevice[]> {
  const result = await toolInvoke<{ devices: StorageDevice[] }>({
    toolId: "devices",
    action: "system.storage",
    mode: "sandbox",
  });
  return result.devices;
}

export async function systemGetDisplayInfo(): Promise<DisplayInfo[]> {
  const result = await toolInvoke<{ displays: DisplayInfo[] }>({
    toolId: "devices",
    action: "system.display",
    mode: "sandbox",
  });
  return result.displays;
}

export async function systemGetIdentity(): Promise<SystemIdentity> {
  const result = await toolInvoke<{ identity: SystemIdentity }>({
    toolId: "devices",
    action: "system.identity",
    mode: "sandbox",
  });
  return result.identity;
}

export async function systemListAudioDevices(): Promise<AudioDevices> {
  const result = await toolInvoke<{ audio: AudioDevices }>({
    toolId: "devices",
    action: "audio.list_devices",
    mode: "sandbox",
  });
  return result.audio;
}

export async function systemListPeripheralDevices(): Promise<PeripheralDevice[]> {
  const result = await toolInvoke<{ peripherals: PeripheralDevice[] }>({
    toolId: "devices",
    action: "system.peripherals",
    mode: "sandbox",
  });
  return result.peripherals;
}

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

export interface ModelVerifyResult {
  ok: boolean;
  reachable: boolean;
  model_found: boolean;
  response_ok: boolean;
  status_code: number | null;
  latency_ms: number;
  message: string;
}

export async function llmModelListAll(): Promise<ModelConfig[]> {
  const result = await toolInvoke<{ models: ModelConfig[] }>({
    toolId: "llm",
    action: "model.list_all",
    mode: "sandbox",
  });
  return result.models;
}

export interface LlmModelUpsertPayload {
  name: string;
  model_id: string;
  base_url: string;
  api_key?: string;
  api_type?: string;
  parameter_count?: number;
  speed_tps?: number;
  context_length?: number;
  monthly_cost?: number;
  cost_per_million_tokens?: number;
  is_primary?: boolean;
}

export async function llmModelAdd(payload: LlmModelUpsertPayload): Promise<ModelConfig> {
  const result = await toolInvoke<{ model: ModelConfig }>({
    toolId: "llm",
    action: "model.add",
    mode: "sandbox",
    payload,
  });
  return result.model;
}

export async function llmModelUpdate(
  id: string,
  payload: Partial<LlmModelUpsertPayload>
): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "llm",
    action: "model.update",
    mode: "sandbox",
    payload: { id, ...payload },
  });
}

export async function llmModelDelete(id: string): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "llm",
    action: "model.delete",
    mode: "sandbox",
    payload: { id },
  });
}

export async function llmModelSetPrimary(id: string): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "llm",
    action: "model.set_primary",
    mode: "sandbox",
    payload: { id },
  });
}

export async function llmModelVerify(id: string, test_response?: boolean): Promise<ModelVerifyResult> {
  const result = await toolInvoke<{ result: ModelVerifyResult }>({
    toolId: "llm",
    action: "model.verify",
    mode: "sandbox",
    payload: { id, test_response },
  });
  return result.result;
}

export async function codeReadFile(
  path: string,
  rootGuard?: string | null,
  mode: ToolMode = "sandbox"
): Promise<string> {
  const result = await toolInvoke<{ content: string }>(
    {
      toolId: "code",
      action: "workspace.read_file",
      mode,
      payload: { path, rootGuard },
    }
  );
  return result.content;
}

export async function codeWriteFile(
  path: string,
  content: string,
  rootGuard?: string | null,
  mode: ToolMode = "sandbox"
): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "code",
    action: "workspace.write_file",
    mode,
    payload: { path, content, rootGuard },
  });
}

export async function codeListDir(
  path: string,
  rootGuard?: string | null,
  mode: ToolMode = "sandbox"
): Promise<FileEntry[]> {
  const result = await toolInvoke<{ entries: FileEntry[] }>({
    toolId: "code",
    action: "workspace.list_dir",
    mode,
    payload: { path, rootGuard },
  });
  return result.entries;
}

export async function codeCreateFile(
  path: string,
  rootGuard?: string | null,
  mode: ToolMode = "sandbox"
): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "code",
    action: "workspace.create_file",
    mode,
    payload: { path, rootGuard },
  });
}

export async function codeDeletePath(
  path: string,
  rootGuard?: string | null,
  mode: ToolMode = "sandbox"
): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "code",
    action: "workspace.delete_path",
    mode,
    payload: { path, rootGuard },
  });
}

export interface TerminalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  cwd: string;
}

export interface TerminalSessionStartResult {
  sessionId: number;
  cwd: string;
}

export interface TerminalSessionReadResult {
  output: string;
  exited: boolean;
  exitCode: number | null;
}

export interface CoderPiCandidateDiagnostic {
  source: string;
  path: string;
  exists: boolean;
  isFile: boolean;
  isExecutable: boolean;
}

export interface CoderPiDiagnosticsResult {
  cwd: string;
  rootGuard: string | null;
  requestedExecutable: string | null;
  fallbackBinary: string;
  pathProbe: string | null;
  candidates: CoderPiCandidateDiagnostic[];
}

export async function terminalResolvePath(
  path: string,
  cwd?: string | null,
  rootGuard?: string | null,
  mode: ToolMode = "sandbox"
): Promise<string> {
  const result = await toolInvoke<{ path: string }>(
    sandboxRequest("terminal", "terminal.resolve_path", { path, cwd, rootGuard }, mode)
  );
  return result.path;
}

export async function terminalExec(
  command: string,
  cwd?: string | null,
  rootGuard?: string | null,
  timeoutMs?: number,
  mode: ToolMode = "sandbox",
  confirmRoot = false
): Promise<TerminalExecResult> {
  return toolInvoke<TerminalExecResult>(
    sandboxRequest(
      "terminal",
      "terminal.exec",
      { command, cwd, rootGuard, timeoutMs, confirmRoot },
      mode
    )
  );
}

export async function terminalSessionStart(
  cwd?: string | null,
  rootGuard?: string | null,
  cols?: number,
  rows?: number,
  mode: ToolMode = "sandbox",
  confirmRoot = false,
  coderIsolation = false,
  coderModel?: string | null
): Promise<TerminalSessionStartResult> {
  return toolInvoke<TerminalSessionStartResult>(
    sandboxRequest(
      "terminal",
      "terminal.session_start",
      { cwd, rootGuard, cols, rows, confirmRoot, coderIsolation, coderModel },
      mode
    )
  );
}

export async function terminalSessionWrite(
  sessionId: number,
  input: string,
  mode: ToolMode = "sandbox"
): Promise<void> {
  await toolInvoke<{ ok: boolean }>(
    sandboxRequest(
      "terminal",
      "terminal.session_write",
      { sessionId, input },
      mode
    )
  );
}

export async function terminalSessionRead(
  sessionId: number,
  mode: ToolMode = "sandbox"
): Promise<TerminalSessionReadResult> {
  return toolInvoke<TerminalSessionReadResult>(
    sandboxRequest(
      "terminal",
      "terminal.session_read",
      { sessionId },
      mode
    )
  );
}

export async function terminalSessionResize(
  sessionId: number,
  cols: number,
  rows: number,
  mode: ToolMode = "sandbox"
): Promise<void> {
  await toolInvoke<{ ok: boolean }>(
    sandboxRequest(
      "terminal",
      "terminal.session_resize",
      { sessionId, cols, rows },
      mode
    )
  );
}

export async function terminalSessionClose(
  sessionId: number,
  mode: ToolMode = "sandbox"
): Promise<void> {
  await toolInvoke<{ ok: boolean }>(
    sandboxRequest(
      "terminal",
      "terminal.session_close",
      { sessionId },
      mode
    )
  );
}

export async function coderPiPrompt(
  prompt: string,
  cwd?: string | null,
  rootGuard?: string | null,
  timeoutMs?: number,
  executable?: string | null,
  model?: string | null,
  mode: ToolMode = "sandbox",
  confirmRoot = false
): Promise<TerminalExecResult> {
  return toolInvoke<TerminalExecResult>({
    toolId: "codex",
    action: "coder.pi_prompt",
    mode,
    payload: { prompt, cwd, rootGuard, timeoutMs, executable, model, confirmRoot },
  });
}

export async function coderPiVersion(
  cwd?: string | null,
  rootGuard?: string | null,
  timeoutMs?: number,
  executable?: string | null,
  mode: ToolMode = "sandbox",
  confirmRoot = false
): Promise<TerminalExecResult> {
  return toolInvoke<TerminalExecResult>({
    toolId: "codex",
    action: "coder.pi_version",
    mode,
    payload: { cwd, rootGuard, timeoutMs, executable, confirmRoot },
  });
}

export async function coderPiDiagnostics(
  cwd?: string | null,
  rootGuard?: string | null,
  executable?: string | null,
  mode: ToolMode = "sandbox",
  confirmRoot = false
): Promise<CoderPiDiagnosticsResult> {
  return toolInvoke<CoderPiDiagnosticsResult>({
    toolId: "codex",
    action: "coder.pi_diagnostics",
    mode,
    payload: { cwd, rootGuard, executable, confirmRoot },
  });
}

export interface AgentCardRecord {
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

export async function projectCardList(mode: ToolMode = "sandbox"): Promise<AgentCardRecord[]> {
  const result = await toolInvoke<{ cards: AgentCardRecord[] }>({
    toolId: "project",
    action: "project.card_list",
    mode,
  });
  return result.cards;
}

export async function projectCardCreate(
  payload: {
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
  },
  mode: ToolMode = "sandbox"
): Promise<AgentCardRecord> {
  const result = await toolInvoke<{ card: AgentCardRecord }>({
    toolId: "project",
    action: "project.card_create",
    mode,
    payload: {
      name: payload.name,
      role: payload.role,
      description: payload.description,
      protocolVersion: payload.protocol_version,
      version: payload.version,
      url: payload.url,
      preferredModelId: payload.preferred_model_id,
      fallbackModelIdsJson: payload.fallback_model_ids_json,
      skillsJson: payload.skills_json,
      capabilitiesJson: payload.capabilities_json,
      defaultInputModesJson: payload.default_input_modes_json,
      defaultOutputModesJson: payload.default_output_modes_json,
      additionalInterfacesJson: payload.additional_interfaces_json,
      logicLanguage: payload.logic_language,
      logicSource: payload.logic_source,
      color: payload.color,
      enabled: payload.enabled,
      sortOrder: payload.sort_order,
    },
  });
  return result.card;
}

export async function projectCardUpdate(
  payload: {
    card_id: string;
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
  },
  mode: ToolMode = "sandbox"
): Promise<AgentCardRecord> {
  const result = await toolInvoke<{ card: AgentCardRecord }>({
    toolId: "project",
    action: "project.card_update",
    mode,
    payload: {
      cardId: payload.card_id,
      name: payload.name,
      role: payload.role,
      description: payload.description,
      protocolVersion: payload.protocol_version,
      version: payload.version,
      url: payload.url,
      preferredModelId: payload.preferred_model_id,
      fallbackModelIdsJson: payload.fallback_model_ids_json,
      skillsJson: payload.skills_json,
      capabilitiesJson: payload.capabilities_json,
      defaultInputModesJson: payload.default_input_modes_json,
      defaultOutputModesJson: payload.default_output_modes_json,
      additionalInterfacesJson: payload.additional_interfaces_json,
      logicLanguage: payload.logic_language,
      logicSource: payload.logic_source,
      color: payload.color,
      enabled: payload.enabled,
      sortOrder: payload.sort_order,
    },
  });
  return result.card;
}

export async function projectCardDelete(card_id: string, mode: ToolMode = "sandbox"): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "project",
    action: "project.card_delete",
    mode,
    payload: { cardId: card_id },
  });
}

export async function projectProcessCreate(
  title: string,
  initiator?: string,
  actor?: string,
  mode: ToolMode = "sandbox"
): Promise<string> {
  const result = await toolInvoke<{ process_id: string }>({
    toolId: "project",
    action: "project.process_create",
    mode,
    payload: { title, initiator, actor },
  });
  return result.process_id;
}

export async function projectProcessSetStatus(
  process_id: string,
  status: string,
  reason?: string,
  actor?: string,
  mode: ToolMode = "sandbox"
): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "project",
    action: "project.process_set_status",
    mode,
    payload: { processId: process_id, status, reason, actor },
  });
}

export async function projectProcessRetry(
  process_id: string,
  actor?: string,
  mode: ToolMode = "sandbox"
): Promise<void> {
  await toolInvoke<{ ok: boolean }>({
    toolId: "project",
    action: "project.process_retry",
    mode,
    payload: { processId: process_id, actor },
  });
}

export interface AgentWorkflowRecord {
  workflow_id: string;
  name: string;
  active: boolean;
  version: number;
  definition_json: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface AgentWorkflowRunRecord {
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

export async function projectWorkflowList(mode: ToolMode = "sandbox"): Promise<AgentWorkflowRecord[]> {
  const result = await toolInvoke<{ workflows: AgentWorkflowRecord[] }>({
    toolId: "project",
    action: "project.workflow_list",
    mode,
  });
  return result.workflows;
}

export async function projectWorkflowRun(
  payload: {
    workflow_id?: string;
    workflow_name?: string;
    input?: unknown;
    trigger_type?: string;
    timeout_ms?: number;
  },
  mode: ToolMode = "sandbox"
): Promise<AgentWorkflowRunRecord> {
  const result = await toolInvoke<{ run: AgentWorkflowRunRecord }>({
    toolId: "project",
    action: "project.workflow_run",
    mode,
    payload: {
      workflowId: payload.workflow_id,
      workflowName: payload.workflow_name,
      input: payload.input,
      triggerType: payload.trigger_type,
      timeoutMs: payload.timeout_ms,
    },
  });
  return result.run;
}

// Backward-compatible aliases for pre-rename imports.
export const agentsCardList = projectCardList;
export const agentsCardCreate = projectCardCreate;
export const agentsCardUpdate = projectCardUpdate;
export const agentsCardDelete = projectCardDelete;
export const agentsProcessCreate = projectProcessCreate;
export const agentsProcessSetStatus = projectProcessSetStatus;
export const agentsProcessRetry = projectProcessRetry;
export const agentsWorkflowList = projectWorkflowList;
export const agentsWorkflowRun = projectWorkflowRun;
