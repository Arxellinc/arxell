use arx_application::{
    EventPublisher as AppEventPublisher, InMemoryToolRegistry, ToolRunInput, ToolRunner,
};
use arx_domain::{
    tool::ToolContext, AppEvent, CorrelationId, DomainError, RunId, Tool, ToolDescriptor,
    ToolInput, ToolOutput,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, State};

use super::{
    a2a, a2a_workflow, browser, coder_runtime, logs, model, models, terminal, voice, workspace,
};
use crate::{a2a::workflow_store, AppState};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvokeRequest {
    pub tool_id: String,
    pub action: String,
    pub mode: ToolMode,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolMode {
    Sandbox,
    Shell,
    Root,
}

#[derive(Debug, Clone, Copy)]
struct ToolPolicy {
    tool_id: &'static str,
    action: &'static str,
    allowed_modes: &'static [ToolMode],
}

const SANDBOX_ONLY: &[ToolMode] = &[ToolMode::Sandbox];
const SANDBOX_SHELL: &[ToolMode] = &[ToolMode::Sandbox, ToolMode::Shell];
const SANDBOX_SHELL_ROOT: &[ToolMode] = &[ToolMode::Sandbox, ToolMode::Shell, ToolMode::Root];
static NEXT_TOOL_CALL_SEQ: AtomicU64 = AtomicU64::new(1);

const TOOL_POLICIES: &[ToolPolicy] = &[
    ToolPolicy {
        tool_id: "web",
        action: "browser.fetch",
        allowed_modes: SANDBOX_SHELL,
    },
    ToolPolicy {
        tool_id: "web",
        action: "browser.search",
        allowed_modes: SANDBOX_SHELL,
    },
    ToolPolicy {
        tool_id: "web",
        action: "browser.search.key_set",
        allowed_modes: SANDBOX_SHELL,
    },
    ToolPolicy {
        tool_id: "web",
        action: "browser.search.key_status",
        allowed_modes: SANDBOX_SHELL,
    },
    ToolPolicy {
        tool_id: "web",
        action: "browser.search.key_test",
        allowed_modes: SANDBOX_SHELL,
    },
    ToolPolicy {
        tool_id: "web",
        action: "browser.search.key_validate",
        allowed_modes: SANDBOX_SHELL,
    },
    ToolPolicy {
        tool_id: "help",
        action: "workspace.list_dir",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "help",
        action: "workspace.read_file",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "terminal",
        action: "terminal.resolve_path",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "terminal",
        action: "terminal.exec",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "terminal",
        action: "terminal.session_start",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "terminal",
        action: "terminal.session_write",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "terminal",
        action: "terminal.session_read",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "terminal",
        action: "terminal.session_resize",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "terminal",
        action: "terminal.session_close",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "codex",
        action: "coder.pi_prompt",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "coder",
        action: "coder.pi_prompt",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "codex",
        action: "coder.pi_version",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "coder",
        action: "coder.pi_version",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "codex",
        action: "coder.pi_diagnostics",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "coder",
        action: "coder.pi_diagnostics",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "code",
        action: "workspace.read_file",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "code",
        action: "workspace.write_file",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "code",
        action: "workspace.list_dir",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "code",
        action: "workspace.create_file",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "code",
        action: "workspace.delete_path",
        allowed_modes: SANDBOX_SHELL_ROOT,
    },
    ToolPolicy {
        tool_id: "devices",
        action: "system.storage",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "devices",
        action: "system.display",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "devices",
        action: "system.identity",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "devices",
        action: "system.peripherals",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "devices",
        action: "audio.list_devices",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "new",
        action: "system.storage",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "new",
        action: "system.display",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "new",
        action: "system.identity",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "new",
        action: "system.peripherals",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "new",
        action: "audio.list_devices",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "llm",
        action: "model.list_all",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "llm",
        action: "model.add",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "llm",
        action: "model.update",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "llm",
        action: "model.delete",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "llm",
        action: "model.set_primary",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "llm",
        action: "model.verify",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.card_list",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.card_create",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.card_update",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.card_delete",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.process_create",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.process_set_status",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.process_retry",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.workflow_list",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "project",
        action: "project.workflow_run",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "flow",
        action: "workflow.list",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "flow",
        action: "workflow.run",
        allowed_modes: SANDBOX_ONLY,
    },
    // Backward-compatible aliases for pre-rename clients.
    ToolPolicy {
        tool_id: "agents",
        action: "agents.card_list",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "agents",
        action: "agents.card_create",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "agents",
        action: "agents.card_update",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "agents",
        action: "agents.card_delete",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "agents",
        action: "agents.process_create",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "agents",
        action: "agents.process_set_status",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "agents",
        action: "agents.process_retry",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "agents",
        action: "agents.workflow_list",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "agents",
        action: "agents.workflow_run",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "a2a",
        action: "workflow.list",
        allowed_modes: SANDBOX_ONLY,
    },
    ToolPolicy {
        tool_id: "a2a",
        action: "workflow.run",
        allowed_modes: SANDBOX_ONLY,
    },
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserFetchPayload {
    url: String,
    mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserSearchPayload {
    query: String,
    mode: Option<String>,
    num: Option<u32>,
    page: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserSearchKeySetPayload {
    api_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePathPayload {
    path: String,
    root_guard: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceWritePayload {
    path: String,
    content: String,
    root_guard: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResolvePayload {
    path: String,
    cwd: Option<String>,
    root_guard: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExecPayload {
    command: String,
    cwd: Option<String>,
    root_guard: Option<String>,
    timeout_ms: Option<u64>,
    #[serde(default)]
    confirm_root: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionStartPayload {
    cwd: Option<String>,
    root_guard: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    #[serde(default)]
    coder_isolation: bool,
    coder_model: Option<String>,
    #[serde(default)]
    confirm_root: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionWritePayload {
    session_id: u64,
    input: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionReadPayload {
    session_id: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionResizePayload {
    session_id: u64,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionClosePayload {
    session_id: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoderPiPromptPayload {
    prompt: String,
    cwd: Option<String>,
    root_guard: Option<String>,
    timeout_ms: Option<u64>,
    executable: Option<String>,
    model: Option<String>,
    #[serde(default)]
    confirm_root: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoderPiVersionPayload {
    cwd: Option<String>,
    root_guard: Option<String>,
    timeout_ms: Option<u64>,
    executable: Option<String>,
    #[serde(default)]
    confirm_root: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoderPiDiagnosticsPayload {
    cwd: Option<String>,
    root_guard: Option<String>,
    executable: Option<String>,
    #[serde(default)]
    confirm_root: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelAddPayload {
    name: String,
    model_id: String,
    base_url: String,
    api_key: Option<String>,
    api_type: Option<String>,
    parameter_count: Option<i64>,
    speed_tps: Option<f64>,
    context_length: Option<i64>,
    monthly_cost: Option<f64>,
    cost_per_million_tokens: Option<f64>,
    is_primary: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelUpdatePayload {
    id: String,
    name: Option<String>,
    model_id: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    api_type: Option<String>,
    parameter_count: Option<i64>,
    speed_tps: Option<f64>,
    context_length: Option<i64>,
    monthly_cost: Option<f64>,
    cost_per_million_tokens: Option<f64>,
    is_primary: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdPayload {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelVerifyPayload {
    id: String,
    test_response: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCardCreatePayload {
    name: String,
    role: String,
    description: String,
    protocol_version: Option<String>,
    version: Option<String>,
    url: Option<String>,
    preferred_model_id: Option<String>,
    fallback_model_ids_json: Option<String>,
    skills_json: Option<String>,
    capabilities_json: Option<String>,
    default_input_modes_json: Option<String>,
    default_output_modes_json: Option<String>,
    additional_interfaces_json: Option<String>,
    logic_language: Option<String>,
    logic_source: Option<String>,
    color: Option<String>,
    enabled: Option<bool>,
    sort_order: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCardUpdatePayload {
    card_id: String,
    name: Option<String>,
    role: Option<String>,
    description: Option<String>,
    protocol_version: Option<String>,
    version: Option<String>,
    url: Option<String>,
    preferred_model_id: Option<String>,
    fallback_model_ids_json: Option<String>,
    skills_json: Option<String>,
    capabilities_json: Option<String>,
    default_input_modes_json: Option<String>,
    default_output_modes_json: Option<String>,
    additional_interfaces_json: Option<String>,
    logic_language: Option<String>,
    logic_source: Option<String>,
    color: Option<String>,
    enabled: Option<bool>,
    sort_order: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCardDeletePayload {
    card_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProcessCreatePayload {
    title: String,
    initiator: Option<String>,
    actor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProcessSetStatusPayload {
    process_id: String,
    status: String,
    reason: Option<String>,
    actor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProcessRetryPayload {
    process_id: String,
    actor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentWorkflowRunPayload {
    workflow_id: Option<String>,
    workflow_name: Option<String>,
    input: Option<serde_json::Value>,
    trigger_type: Option<String>,
    timeout_ms: Option<u64>,
}

struct GatewayEventPublisher;

impl AppEventPublisher for GatewayEventPublisher {
    fn publish(&self, event: AppEvent) -> Result<(), DomainError> {
        match event {
            AppEvent::ToolCallStarted {
                correlation_id,
                run_id,
                tool_call_id,
                tool_id,
            } => {
                logs::info(&format!(
                    "[tool-call start] correlation_id={} run_id={} tool_call_id={} tool_id={}",
                    correlation_id.as_str(),
                    run_id.as_str(),
                    tool_call_id,
                    tool_id
                ));
            }
            AppEvent::ToolCallFinished {
                correlation_id,
                run_id,
                tool_call_id,
            } => {
                logs::info(&format!(
                    "[tool-call finish] correlation_id={} run_id={} tool_call_id={}",
                    correlation_id.as_str(),
                    run_id.as_str(),
                    tool_call_id
                ));
            }
            _ => {}
        }
        Ok(())
    }
}

struct HelpListDirTool;

impl Tool for HelpListDirTool {
    fn descriptor(&self) -> &ToolDescriptor {
        static DESCRIPTOR: OnceLock<ToolDescriptor> = OnceLock::new();
        DESCRIPTOR.get_or_init(|| ToolDescriptor {
            id: "help.workspace.list_dir".to_string(),
            version: "1.0.0".to_string(),
            description: "List a workspace directory and return child entries".to_string(),
        })
    }

    fn execute(
        &self,
        _context: &dyn ToolContext,
        input: ToolInput,
    ) -> Result<ToolOutput, DomainError> {
        let payload: WorkspacePathPayload = serde_json::from_str(&input.payload_json)
            .map_err(|e| DomainError::validation("payload_json", format!("invalid JSON: {e}")))?;
        if payload.path.trim().is_empty() {
            return Err(DomainError::validation("path", "must not be empty"));
        }
        let entries = workspace::cmd_workspace_list_dir(payload.path).map_err(|reason| {
            DomainError::Internal {
                reason: format!("workspace.list_dir failed: {reason}"),
            }
        })?;
        let payload_json = serde_json::to_string(&serde_json::json!({ "entries": entries }))
            .map_err(|e| DomainError::Internal {
                reason: format!("failed to serialize list_dir output: {e}"),
            })?;
        Ok(ToolOutput { payload_json })
    }
}

struct HelpReadFileTool;

impl Tool for HelpReadFileTool {
    fn descriptor(&self) -> &ToolDescriptor {
        static DESCRIPTOR: OnceLock<ToolDescriptor> = OnceLock::new();
        DESCRIPTOR.get_or_init(|| ToolDescriptor {
            id: "help.workspace.read_file".to_string(),
            version: "1.0.0".to_string(),
            description: "Read a workspace file and return text content".to_string(),
        })
    }

    fn execute(
        &self,
        _context: &dyn ToolContext,
        input: ToolInput,
    ) -> Result<ToolOutput, DomainError> {
        let payload: WorkspacePathPayload = serde_json::from_str(&input.payload_json)
            .map_err(|e| DomainError::validation("payload_json", format!("invalid JSON: {e}")))?;
        if payload.path.trim().is_empty() {
            return Err(DomainError::validation("path", "must not be empty"));
        }
        let content = workspace::cmd_workspace_read_file(payload.path).map_err(|reason| {
            DomainError::Internal {
                reason: format!("workspace.read_file failed: {reason}"),
            }
        })?;
        let payload_json = serde_json::to_string(&serde_json::json!({ "content": content }))
            .map_err(|e| DomainError::Internal {
                reason: format!("failed to serialize read_file output: {e}"),
            })?;
        Ok(ToolOutput { payload_json })
    }
}

fn build_tier1_registry() -> InMemoryToolRegistry {
    let mut registry = InMemoryToolRegistry::default();
    registry.register(Arc::new(HelpListDirTool));
    registry.register(Arc::new(HelpReadFileTool));
    registry
}

fn resolve_tool_run_ids(
    request: &ToolInvokeRequest,
) -> Result<(CorrelationId, RunId, String), String> {
    let seq = NEXT_TOOL_CALL_SEQ.fetch_add(1, Ordering::Relaxed);
    let correlation_raw = request
        .correlation_id
        .clone()
        .unwrap_or_else(|| format!("tool-corr-{seq}"));
    let run_raw = request
        .run_id
        .clone()
        .unwrap_or_else(|| format!("tool-run-{seq}"));
    let tool_call_id = request
        .tool_call_id
        .clone()
        .unwrap_or_else(|| format!("tool-call-{seq}"));

    let correlation_id =
        CorrelationId::new(correlation_raw).map_err(|e| format!("invalid correlation_id: {e}"))?;
    let run_id = RunId::new(run_raw).map_err(|e| format!("invalid run_id: {e}"))?;
    Ok((correlation_id, run_id, tool_call_id))
}

fn run_tier1_tool(
    request: &ToolInvokeRequest,
    tool_id: &str,
    payload_json: String,
    timeout_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    let (correlation_id, run_id, tool_call_id) = resolve_tool_run_ids(request)?;
    let registry = build_tier1_registry();
    let publisher = GatewayEventPublisher;
    let runner = ToolRunner {
        registry: &registry,
        event_publisher: &publisher,
    };
    let output = runner
        .run_with_cancel_check(
            ToolRunInput {
                correlation_id,
                run_id,
                tool_call_id,
                tool_id: tool_id.to_string(),
                payload_json,
                timeout_ms,
            },
            &|| false,
        )
        .map_err(|e| format!("tool runtime failure: {e}"))?;
    serde_json::from_str::<serde_json::Value>(&output.payload_json)
        .map_err(|e| format!("tool runtime returned invalid JSON payload: {e}"))
}

fn mode_allowed(mode: &ToolMode, allowed: &[ToolMode]) -> bool {
    allowed
        .iter()
        .any(|m| std::mem::discriminant(m) == std::mem::discriminant(mode))
}

fn lookup_policy<'a>(tool_id: &str, action: &str) -> Option<&'a ToolPolicy> {
    TOOL_POLICIES
        .iter()
        .find(|policy| policy.tool_id == tool_id && policy.action == action)
}

fn ensure_policy_allows(request: &ToolInvokeRequest) -> Result<(), String> {
    let policy =
        lookup_policy(request.tool_id.as_str(), request.action.as_str()).ok_or_else(|| {
            format!(
                "Tool/action not allowed: {}.{}",
                request.tool_id, request.action
            )
        })?;

    if !mode_allowed(&request.mode, policy.allowed_modes) {
        return Err(format!(
            "Mode {:?} not allowed for {}.{}",
            request.mode, request.tool_id, request.action
        ));
    }

    Ok(())
}

fn ensure_within_help_docs_root_existing(path: &Path, workspace_root: &Path) -> Result<(), String> {
    let target = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve path '{}': {}", path.display(), e))?;
    let mut allowed_roots: Vec<PathBuf> = Vec::new();
    for candidate in ["help", "docs"] {
        let candidate_path = workspace_root.join(candidate);
        if candidate_path.exists() {
            if let Ok(root) = canonical_dir(&candidate_path) {
                allowed_roots.push(root);
            }
        }
    }
    if allowed_roots.iter().any(|root| target.starts_with(root)) {
        return Ok(());
    }
    let roots = if allowed_roots.is_empty() {
        "<none>".to_string()
    } else {
        allowed_roots
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    };
    Err(format!(
        "Help path '{}' is outside allowed roots: {}",
        target.display(),
        roots
    ))
}

fn has_nonempty_root_guard(root_guard: Option<&String>) -> bool {
    root_guard.map(|s| !s.trim().is_empty()).unwrap_or(false)
}

fn first_segment_command(token: &str) -> String {
    token.split_whitespace().next().unwrap_or("").to_lowercase()
}

fn has_shell_elevation(command: &str) -> bool {
    command
        .split(&['|', '&', ';', '\n'][..])
        .map(first_segment_command)
        .any(|cmd| cmd == "sudo")
}

#[cfg(test)]
fn shell_quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(test)]
fn resolve_coder_executable(raw: Option<&String>) -> String {
    let candidate = raw.map(|s| s.trim()).unwrap_or("");
    if candidate.is_empty() {
        "codex".to_string()
    } else {
        candidate.to_string()
    }
}

#[cfg(test)]
fn build_coder_prompt_command(executable: &str, prompt: &str, model: Option<&str>) -> String {
    let exec = shell_quote_literal(executable);
    let prompt_q = shell_quote_literal(prompt);
    let model_part = model
        .map(|m| m.trim())
        .filter(|m| !m.is_empty())
        .map(|m| format!(" --model {}", shell_quote_literal(m)))
        .unwrap_or_default();
    format!("{exec} exec{model_part} {prompt_q}")
}

#[cfg(test)]
#[allow(dead_code)]
fn build_coder_version_command(executable: &str) -> String {
    format!("{} --version", shell_quote_literal(executable))
}

fn canonical_dir(path: &Path) -> Result<PathBuf, String> {
    let canon = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve path '{}': {}", path.display(), e))?;
    if !canon.is_dir() {
        return Err(format!("Path is not a directory: {}", canon.display()));
    }
    Ok(canon)
}

fn ensure_within_root_existing(path: &Path, root: &Path) -> Result<(), String> {
    let target = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve path '{}': {}", path.display(), e))?;
    let root_canon = canonical_dir(root)?;
    if !target.starts_with(&root_canon) {
        return Err(format!(
            "Path '{}' is outside allowed root '{}'",
            target.display(),
            root_canon.display()
        ));
    }
    Ok(())
}

fn ensure_within_root_write_target(path: &Path, root: &Path) -> Result<(), String> {
    let root_canon = canonical_dir(root)?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let parent_canon = if parent.exists() {
        canonical_dir(parent)?
    } else {
        let mut probe = parent.to_path_buf();
        while !probe.exists() {
            match probe.parent() {
                Some(next) => probe = next.to_path_buf(),
                None => break,
            }
        }
        canonical_dir(&probe)?
    };

    if !parent_canon.starts_with(&root_canon) {
        return Err(format!(
            "Path '{}' is outside allowed root '{}'",
            path.display(),
            root_canon.display()
        ));
    }
    Ok(())
}

fn audit_allow(request: &ToolInvokeRequest) {
    logs::info(&format!(
        "[tool-gateway allow] tool={} action={} mode={:?}",
        request.tool_id, request.action, request.mode
    ));
}

fn audit_deny(request: &ToolInvokeRequest, reason: &str) {
    logs::warn(&format!(
        "[tool-gateway deny] tool={} action={} mode={:?} reason={}",
        request.tool_id, request.action, request.mode, reason
    ));
}

fn deny<T>(request: &ToolInvokeRequest, reason: impl Into<String>) -> Result<T, String> {
    let message = reason.into();
    audit_deny(request, &message);
    Err(message)
}

#[tauri::command]
pub async fn cmd_tool_invoke(
    request: ToolInvokeRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    if let Err(e) = ensure_policy_allows(&request) {
        return deny(&request, e);
    }

    match (request.tool_id.as_str(), request.action.as_str()) {
        ("web", "browser.fetch") => {
            let payload: BrowserFetchPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for browser.fetch: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if payload.url.trim().is_empty() {
                return deny(&request, "browser.fetch requires non-empty url");
            }

            let content = browser::cmd_browser_fetch(payload.url, payload.mode).await?;
            audit_allow(&request);
            Ok(serde_json::json!({ "content": content }))
        }
        ("web", "browser.search") => {
            let payload: BrowserSearchPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for browser.search: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if payload.query.trim().is_empty() {
                return deny(&request, "browser.search requires non-empty query");
            }

            let result = browser::serper_search(
                state.inner(),
                payload.query,
                payload.mode,
                payload.num,
                payload.page,
            )
            .await?;
            audit_allow(&request);
            Ok(serde_json::json!({ "result": result }))
        }
        ("web", "browser.search.key_set") => {
            let payload: BrowserSearchKeySetPayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for browser.search.key_set: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            browser::serper_key_set(state.inner(), payload.api_key)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("web", "browser.search.key_status") => {
            let status = browser::serper_key_status(state.inner())?;
            audit_allow(&request);
            Ok(serde_json::json!({ "status": status }))
        }
        ("web", "browser.search.key_test") => {
            let status = browser::serper_key_test(state.inner()).await?;
            audit_allow(&request);
            Ok(serde_json::json!({ "result": status }))
        }
        ("web", "browser.search.key_validate") => {
            let payload: BrowserSearchKeySetPayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for browser.search.key_validate: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            let status = browser::serper_key_validate(payload.api_key).await?;
            audit_allow(&request);
            Ok(serde_json::json!({ "result": status }))
        }
        ("help", "workspace.list_dir") => {
            let payload: WorkspacePathPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for workspace.list_dir: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if !has_nonempty_root_guard(payload.root_guard.as_ref()) {
                return deny(
                    &request,
                    "help workspace access requires non-empty rootGuard",
                );
            }
            let root = payload.root_guard.as_ref().unwrap();
            ensure_within_help_docs_root_existing(Path::new(&payload.path), Path::new(root))?;

            let runtime_payload = serde_json::to_string(&payload).map_err(|e| {
                format!("Failed to serialize workspace.list_dir payload for runner: {e}")
            })?;
            let output = run_tier1_tool(
                &request,
                "help.workspace.list_dir",
                runtime_payload,
                Some(5_000),
            )?;
            audit_allow(&request);
            Ok(output)
        }
        ("help", "workspace.read_file") => {
            let payload: WorkspacePathPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for workspace.read_file: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if !has_nonempty_root_guard(payload.root_guard.as_ref()) {
                return deny(
                    &request,
                    "help workspace access requires non-empty rootGuard",
                );
            }
            let root = payload.root_guard.as_ref().unwrap();
            ensure_within_help_docs_root_existing(Path::new(&payload.path), Path::new(root))?;

            let runtime_payload = serde_json::to_string(&payload).map_err(|e| {
                format!("Failed to serialize workspace.read_file payload for runner: {e}")
            })?;
            let output = run_tier1_tool(
                &request,
                "help.workspace.read_file",
                runtime_payload,
                Some(5_000),
            )?;
            audit_allow(&request);
            Ok(output)
        }
        ("terminal", "terminal.resolve_path") => {
            let payload: TerminalResolvePayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                let msg = format!("Invalid payload for terminal.resolve_path: {}", e);
                audit_deny(&request, &msg);
                msg
            })?;

            let root_guard = match request.mode {
                ToolMode::Sandbox => {
                    if !has_nonempty_root_guard(payload.root_guard.as_ref()) {
                        return deny(
                            &request,
                            "Sandbox mode requires a non-empty rootGuard for terminal.resolve_path",
                        );
                    }
                    payload.root_guard
                }
                _ => payload.root_guard,
            };

            let path = terminal::cmd_terminal_resolve_path(payload.path, payload.cwd, root_guard)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "path": path }))
        }
        ("terminal", "terminal.exec") => {
            let payload: TerminalExecPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for terminal.exec: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if payload.command.trim().is_empty() {
                return deny(&request, "terminal.exec requires non-empty command");
            }

            if matches!(request.mode, ToolMode::Shell) && has_shell_elevation(&payload.command) {
                return deny(&request, "Shell mode blocks sudo; use root mode explicitly");
            }

            if matches!(request.mode, ToolMode::Root) && !payload.confirm_root {
                return deny(&request, "Root mode requires explicit confirmRoot=true");
            }

            let root_guard = match request.mode {
                ToolMode::Sandbox => {
                    if !has_nonempty_root_guard(payload.root_guard.as_ref()) {
                        return deny(
                            &request,
                            "Sandbox mode requires a non-empty rootGuard for terminal.exec",
                        );
                    }
                    payload.root_guard
                }
                _ => payload.root_guard,
            };

            let result = terminal::cmd_terminal_exec(
                payload.command,
                payload.cwd,
                root_guard,
                payload.timeout_ms,
            )
            .await?;
            audit_allow(&request);

            serde_json::to_value(result)
                .map_err(|e| format!("Failed to serialize terminal.exec result: {}", e))
        }
        ("terminal", "terminal.session_start") => {
            let payload: TerminalSessionStartPayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for terminal.session_start: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if matches!(request.mode, ToolMode::Root) && !payload.confirm_root {
                return deny(&request, "Root mode requires explicit confirmRoot=true");
            }

            let root_guard = match request.mode {
                ToolMode::Sandbox => {
                    if !has_nonempty_root_guard(payload.root_guard.as_ref()) {
                        return deny(
                            &request,
                            "Sandbox mode requires a non-empty rootGuard for terminal.session_start",
                        );
                    }
                    payload.root_guard
                }
                _ => payload.root_guard,
            };

            let env_overrides = if payload.coder_isolation {
                Some(
                    coder_runtime::build_isolated_terminal_env(
                        &app,
                        payload.coder_model.as_deref(),
                    )
                    .await,
                )
            } else {
                None
            };
            let result = terminal::cmd_terminal_session_start(
                payload.cwd,
                root_guard,
                payload.cols,
                payload.rows,
                env_overrides,
            )?;
            audit_allow(&request);

            serde_json::to_value(result)
                .map_err(|e| format!("Failed to serialize terminal.session_start result: {}", e))
        }
        ("terminal", "terminal.session_write") => {
            let payload: TerminalSessionWritePayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for terminal.session_write: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if payload.input.is_empty() {
                return deny(&request, "terminal.session_write requires non-empty input");
            }
            terminal::cmd_terminal_session_write(payload.session_id, payload.input)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("terminal", "terminal.session_read") => {
            let payload: TerminalSessionReadPayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for terminal.session_read: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            let result = terminal::cmd_terminal_session_read(payload.session_id)?;
            audit_allow(&request);

            serde_json::to_value(result)
                .map_err(|e| format!("Failed to serialize terminal.session_read result: {}", e))
        }
        ("terminal", "terminal.session_resize") => {
            let payload: TerminalSessionResizePayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for terminal.session_resize: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            terminal::cmd_terminal_session_resize(payload.session_id, payload.cols, payload.rows)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("terminal", "terminal.session_close") => {
            let payload: TerminalSessionClosePayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for terminal.session_close: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            terminal::cmd_terminal_session_close(payload.session_id)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("codex" | "coder", "coder.pi_prompt") => {
            let payload: CoderPiPromptPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for coder.pi_prompt: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if payload.prompt.trim().is_empty() {
                return deny(&request, "coder.pi_prompt requires non-empty prompt");
            }

            if matches!(request.mode, ToolMode::Root) && !payload.confirm_root {
                return deny(&request, "Root mode requires explicit confirmRoot=true");
            }

            let root_guard = match request.mode {
                ToolMode::Sandbox => {
                    if !has_nonempty_root_guard(payload.root_guard.as_ref()) {
                        return deny(
                            &request,
                            "Sandbox mode requires a non-empty rootGuard for coder.pi_prompt",
                        );
                    }
                    payload.root_guard
                }
                _ => payload.root_guard,
            };

            let result = coder_runtime::run_pi_prompt(
                &app,
                payload.prompt,
                payload.cwd,
                root_guard,
                payload.timeout_ms,
                payload.executable,
                payload.model,
            )
            .await?;
            audit_allow(&request);
            serde_json::to_value(result)
                .map_err(|e| format!("Failed to serialize coder.pi_prompt result: {}", e))
        }
        ("codex" | "coder", "coder.pi_version") => {
            let payload: CoderPiVersionPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for coder.pi_version: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if matches!(request.mode, ToolMode::Root) && !payload.confirm_root {
                return deny(&request, "Root mode requires explicit confirmRoot=true");
            }

            let root_guard = match request.mode {
                ToolMode::Sandbox => {
                    if !has_nonempty_root_guard(payload.root_guard.as_ref()) {
                        return deny(
                            &request,
                            "Sandbox mode requires a non-empty rootGuard for coder.pi_version",
                        );
                    }
                    payload.root_guard
                }
                _ => payload.root_guard,
            };

            let result = coder_runtime::run_pi_version(
                &app,
                payload.cwd,
                root_guard,
                payload.timeout_ms,
                payload.executable,
            )
            .await?;
            audit_allow(&request);
            serde_json::to_value(result)
                .map_err(|e| format!("Failed to serialize coder.pi_version result: {}", e))
        }
        ("codex" | "coder", "coder.pi_diagnostics") => {
            let payload: CoderPiDiagnosticsPayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for coder.pi_diagnostics: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            if matches!(request.mode, ToolMode::Root) && !payload.confirm_root {
                return deny(&request, "Root mode requires explicit confirmRoot=true");
            }

            let root_guard = match request.mode {
                ToolMode::Sandbox => {
                    if !has_nonempty_root_guard(payload.root_guard.as_ref()) {
                        return deny(
                            &request,
                            "Sandbox mode requires a non-empty rootGuard for coder.pi_diagnostics",
                        );
                    }
                    payload.root_guard
                }
                _ => payload.root_guard,
            };

            let result =
                coder_runtime::pi_diagnostics(&app, payload.cwd, root_guard, payload.executable)?;
            audit_allow(&request);
            serde_json::to_value(result)
                .map_err(|e| format!("Failed to serialize coder.pi_diagnostics result: {}", e))
        }
        ("code", "workspace.read_file") => {
            let payload: WorkspacePathPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for code.workspace.read_file: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            if matches!(request.mode, ToolMode::Sandbox)
                && !has_nonempty_root_guard(payload.root_guard.as_ref())
            {
                return deny(
                    &request,
                    "Sandbox mode requires rootGuard for code.workspace.read_file",
                );
            }
            if let Some(root) = payload.root_guard.as_ref() {
                ensure_within_root_existing(Path::new(&payload.path), Path::new(root))?;
            }
            let content = workspace::cmd_workspace_read_file(payload.path)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "content": content }))
        }
        ("code", "workspace.write_file") => {
            let payload: WorkspaceWritePayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for code.workspace.write_file: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            if matches!(request.mode, ToolMode::Sandbox)
                && !has_nonempty_root_guard(payload.root_guard.as_ref())
            {
                return deny(
                    &request,
                    "Sandbox mode requires rootGuard for code.workspace.write_file",
                );
            }
            if let Some(root) = payload.root_guard.as_ref() {
                ensure_within_root_write_target(Path::new(&payload.path), Path::new(root))?;
            }
            workspace::cmd_workspace_write_file(payload.path, payload.content)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("code", "workspace.list_dir") => {
            let payload: WorkspacePathPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for code.workspace.list_dir: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            if matches!(request.mode, ToolMode::Sandbox)
                && !has_nonempty_root_guard(payload.root_guard.as_ref())
            {
                return deny(
                    &request,
                    "Sandbox mode requires rootGuard for code.workspace.list_dir",
                );
            }
            if let Some(root) = payload.root_guard.as_ref() {
                ensure_within_root_existing(Path::new(&payload.path), Path::new(root))?;
            }
            let entries = workspace::cmd_workspace_list_dir(payload.path)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "entries": entries }))
        }
        ("code", "workspace.create_file") => {
            let payload: WorkspacePathPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for code.workspace.create_file: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            if matches!(request.mode, ToolMode::Sandbox)
                && !has_nonempty_root_guard(payload.root_guard.as_ref())
            {
                return deny(
                    &request,
                    "Sandbox mode requires rootGuard for code.workspace.create_file",
                );
            }
            if let Some(root) = payload.root_guard.as_ref() {
                ensure_within_root_write_target(Path::new(&payload.path), Path::new(root))?;
            }
            workspace::cmd_workspace_create_file(payload.path)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("code", "workspace.delete_path") => {
            let payload: WorkspacePathPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for code.workspace.delete_path: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            if matches!(request.mode, ToolMode::Sandbox)
                && !has_nonempty_root_guard(payload.root_guard.as_ref())
            {
                return deny(
                    &request,
                    "Sandbox mode requires rootGuard for code.workspace.delete_path",
                );
            }
            if let Some(root) = payload.root_guard.as_ref() {
                ensure_within_root_existing(Path::new(&payload.path), Path::new(root))?;
            }
            workspace::cmd_workspace_delete_path(payload.path)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("new", "system.storage") | ("devices", "system.storage") => {
            let devices = model::cmd_get_storage_devices()?;
            audit_allow(&request);
            Ok(serde_json::json!({ "devices": devices }))
        }
        ("new", "system.display") | ("devices", "system.display") => {
            let displays = model::cmd_get_display_info(app)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "displays": displays }))
        }
        ("new", "system.identity") | ("devices", "system.identity") => {
            let identity = model::cmd_get_system_identity()?;
            audit_allow(&request);
            Ok(serde_json::json!({ "identity": identity }))
        }
        ("new", "system.peripherals") | ("devices", "system.peripherals") => {
            let peripherals = model::cmd_get_peripheral_devices()?;
            audit_allow(&request);
            Ok(serde_json::json!({ "peripherals": peripherals }))
        }
        ("new", "audio.list_devices") | ("devices", "audio.list_devices") => {
            let audio = voice::cmd_list_audio_devices()?;
            audit_allow(&request);
            Ok(serde_json::json!({ "audio": audio }))
        }
        ("llm", "model.list_all") => {
            let models = models::cmd_model_list_all(state)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "models": models }))
        }
        ("llm", "model.add") => {
            let payload: ModelAddPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for model.add: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            let model = models::cmd_model_add(
                state,
                payload.name,
                payload.model_id,
                payload.base_url,
                payload.api_key,
                payload.api_type,
                payload.parameter_count,
                payload.speed_tps,
                payload.context_length,
                payload.monthly_cost,
                payload.cost_per_million_tokens,
                payload.is_primary,
            )?;
            audit_allow(&request);
            Ok(serde_json::json!({ "model": model }))
        }
        ("llm", "model.update") => {
            let payload: ModelUpdatePayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for model.update: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            models::cmd_model_update(
                state,
                payload.id,
                payload.name,
                payload.model_id,
                payload.base_url,
                payload.api_key,
                payload.api_type,
                payload.parameter_count,
                payload.speed_tps,
                payload.context_length,
                payload.monthly_cost,
                payload.cost_per_million_tokens,
                payload.is_primary,
            )?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("llm", "model.delete") => {
            let payload: IdPayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for model.delete: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            models::cmd_model_delete(state, payload.id)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("llm", "model.set_primary") => {
            let payload: IdPayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for model.set_primary: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            models::cmd_model_set_primary(state, payload.id)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("llm", "model.verify") => {
            let payload: ModelVerifyPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for model.verify: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            let result = models::cmd_model_verify(state, payload.id, payload.test_response).await?;
            audit_allow(&request);
            Ok(serde_json::json!({ "result": result }))
        }
        ("project", "project.card_list") | ("agents", "agents.card_list") => {
            let cards = a2a::cmd_a2a_agent_cards_list(state)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "cards": cards }))
        }
        ("project", "project.card_create") | ("agents", "agents.card_create") => {
            let payload: AgentCardCreatePayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                let msg = format!("Invalid payload for project.card_create: {}", e);
                audit_deny(&request, &msg);
                msg
            })?;
            let card = a2a::cmd_a2a_agent_card_create(
                app.clone(),
                state,
                payload.name,
                payload.role,
                payload.description,
                payload.protocol_version,
                payload.version,
                payload.url,
                payload.preferred_model_id,
                payload.fallback_model_ids_json,
                payload.skills_json,
                payload.capabilities_json,
                payload.default_input_modes_json,
                payload.default_output_modes_json,
                payload.additional_interfaces_json,
                payload.logic_language,
                payload.logic_source,
                payload.color,
                payload.enabled,
                payload.sort_order,
            )?;
            audit_allow(&request);
            Ok(serde_json::json!({ "card": card }))
        }
        ("project", "project.card_update") | ("agents", "agents.card_update") => {
            let payload: AgentCardUpdatePayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                let msg = format!("Invalid payload for project.card_update: {}", e);
                audit_deny(&request, &msg);
                msg
            })?;
            let card = a2a::cmd_a2a_agent_card_update(
                app.clone(),
                state,
                payload.card_id,
                payload.name,
                payload.role,
                payload.description,
                payload.protocol_version,
                payload.version,
                payload.url,
                payload.preferred_model_id,
                payload.fallback_model_ids_json,
                payload.skills_json,
                payload.capabilities_json,
                payload.default_input_modes_json,
                payload.default_output_modes_json,
                payload.additional_interfaces_json,
                payload.logic_language,
                payload.logic_source,
                payload.color,
                payload.enabled,
                payload.sort_order,
            )?;
            audit_allow(&request);
            Ok(serde_json::json!({ "card": card }))
        }
        ("project", "project.card_delete") | ("agents", "agents.card_delete") => {
            let payload: AgentCardDeletePayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                let msg = format!("Invalid payload for project.card_delete: {}", e);
                audit_deny(&request, &msg);
                msg
            })?;
            a2a::cmd_a2a_agent_card_delete(app.clone(), state, payload.card_id)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("project", "project.process_create") | ("agents", "agents.process_create") => {
            let payload: AgentProcessCreatePayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for project.process_create: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            let process_id = a2a::cmd_a2a_process_create(
                app.clone(),
                state,
                payload.title,
                payload.initiator,
                payload.actor,
            )?;
            audit_allow(&request);
            Ok(serde_json::json!({ "process_id": process_id }))
        }
        ("project", "project.process_set_status") | ("agents", "agents.process_set_status") => {
            let payload: AgentProcessSetStatusPayload =
                serde_json::from_value(request.payload.clone()).map_err(|e| {
                    let msg = format!("Invalid payload for project.process_set_status: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            a2a::cmd_a2a_process_set_status(
                app.clone(),
                state,
                payload.process_id,
                payload.status,
                payload.reason,
                payload.actor,
            )?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("project", "project.process_retry") | ("agents", "agents.process_retry") => {
            let payload: AgentProcessRetryPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for project.process_retry: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;
            a2a::cmd_a2a_process_retry(app.clone(), state, payload.process_id, payload.actor)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "ok": true }))
        }
        ("project", "project.workflow_list")
        | ("agents", "agents.workflow_list")
        | ("flow", "workflow.list")
        | ("a2a", "workflow.list") => {
            let rows = a2a_workflow::cmd_a2a_workflow_list(state)?;
            audit_allow(&request);
            Ok(serde_json::json!({ "workflows": rows }))
        }
        ("project", "project.workflow_run")
        | ("agents", "agents.workflow_run")
        | ("flow", "workflow.run")
        | ("a2a", "workflow.run") => {
            let payload: AgentWorkflowRunPayload = serde_json::from_value(request.payload.clone())
                .map_err(|e| {
                    let msg = format!("Invalid payload for workflow run: {}", e);
                    audit_deny(&request, &msg);
                    msg
                })?;

            let workflow_id = if let Some(id) = payload
                .workflow_id
                .as_ref()
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
            {
                id.to_string()
            } else if let Some(name) = payload
                .workflow_name
                .as_ref()
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
            {
                let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
                let rows = workflow_store::list_workflows(&db).map_err(|e| e.to_string())?;
                let lower = name.to_ascii_lowercase();
                rows.into_iter()
                    .find(|wf| {
                        wf.name.trim().eq_ignore_ascii_case(name)
                            || wf.name.to_ascii_lowercase().contains(lower.as_str())
                    })
                    .map(|wf| wf.workflow_id)
                    .ok_or_else(|| format!("Workflow not found for name: {name}"))?
            } else {
                return deny(&request, "workflow_id or workflow_name is required");
            };

            let run = a2a_workflow::cmd_a2a_workflow_run_start(
                app.clone(),
                state,
                a2a_workflow::A2AWorkflowRunStartPayload {
                    workflow_id,
                    trigger_type: payload.trigger_type.unwrap_or_else(|| "agent".to_string()),
                    input: payload.input.unwrap_or_else(|| serde_json::json!([])),
                    timeout_ms: payload.timeout_ms,
                },
            )
            .await?;
            audit_allow(&request);
            Ok(serde_json::json!({ "run": run }))
        }
        _ => deny(
            &request,
            format!(
                "Tool/action not allowed: {}.{}",
                request.tool_id, request.action
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct NoopToolContext;

    impl ToolContext for NoopToolContext {
        fn deadline_ms(&self) -> Option<u64> {
            None
        }

        fn is_cancelled(&self) -> bool {
            false
        }
    }

    #[test]
    fn test_lookup_policy() {
        let policy = lookup_policy("terminal", "terminal.exec");
        assert!(policy.is_some());
        let missing = lookup_policy("terminal", "terminal.nope");
        assert!(missing.is_none());
    }

    #[test]
    fn test_mode_allowed() {
        let allowed = [ToolMode::Sandbox, ToolMode::Shell];
        assert!(mode_allowed(&ToolMode::Sandbox, &allowed));
        assert!(mode_allowed(&ToolMode::Shell, &allowed));
        assert!(!mode_allowed(&ToolMode::Root, &allowed));
    }

    #[test]
    fn test_has_shell_elevation() {
        assert!(has_shell_elevation("sudo ls -la"));
        assert!(has_shell_elevation("echo hi && sudo whoami"));
        assert!(!has_shell_elevation("ls -la"));
    }

    #[test]
    fn test_lookup_policy_codex() {
        assert!(lookup_policy("codex", "coder.pi_prompt").is_some());
        assert!(lookup_policy("codex", "coder.pi_version").is_some());
        assert!(lookup_policy("codex", "coder.pi_diagnostics").is_some());
        assert!(lookup_policy("coder", "coder.pi_prompt").is_some());
        assert!(lookup_policy("coder", "coder.pi_version").is_some());
        assert!(lookup_policy("coder", "coder.pi_diagnostics").is_some());
    }

    #[test]
    fn test_shell_quote_literal() {
        assert_eq!(shell_quote_literal("hello"), "'hello'");
        assert_eq!(shell_quote_literal("a'b"), "'a'\"'\"'b'");
    }

    #[test]
    fn test_build_coder_prompt_command() {
        let cmd = build_coder_prompt_command("codex", "fix bug", Some("qwen2.5-coder"));
        assert_eq!(cmd, "'codex' exec --model 'qwen2.5-coder' 'fix bug'");
        let cmd_no_model = build_coder_prompt_command("/opt/codex bin/codex", "x", None);
        assert_eq!(cmd_no_model, "'/opt/codex bin/codex' exec 'x'");
    }

    #[test]
    fn test_resolve_coder_executable() {
        assert_eq!(resolve_coder_executable(None), "codex");
        assert_eq!(resolve_coder_executable(Some(&"".to_string())), "codex");
        assert_eq!(
            resolve_coder_executable(Some(&"/usr/local/bin/codex".to_string())),
            "/usr/local/bin/codex"
        );
    }

    #[test]
    fn test_resolve_tool_run_ids_generates_defaults() {
        let request = ToolInvokeRequest {
            tool_id: "help".to_string(),
            action: "workspace.read_file".to_string(),
            mode: ToolMode::Sandbox,
            payload: serde_json::json!({}),
            correlation_id: None,
            run_id: None,
            tool_call_id: None,
        };
        let (correlation_id, run_id, tool_call_id) = resolve_tool_run_ids(&request).unwrap();
        assert!(correlation_id.as_str().starts_with("tool-corr-"));
        assert!(run_id.as_str().starts_with("tool-run-"));
        assert!(tool_call_id.starts_with("tool-call-"));
    }

    #[test]
    fn test_resolve_tool_run_ids_rejects_invalid_ids() {
        let request = ToolInvokeRequest {
            tool_id: "help".to_string(),
            action: "workspace.read_file".to_string(),
            mode: ToolMode::Sandbox,
            payload: serde_json::json!({}),
            correlation_id: Some("".to_string()),
            run_id: Some("run-1".to_string()),
            tool_call_id: Some("call-1".to_string()),
        };
        let err = resolve_tool_run_ids(&request).unwrap_err();
        assert!(err.contains("invalid correlation_id"));
    }

    #[test]
    fn contract_help_read_file_tool_reads_content() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("arx-tool-gateway-{unique}"));
        fs::create_dir_all(&root).unwrap();
        let file_path = root.join("sample.txt");
        fs::write(&file_path, "hello-tier1").unwrap();

        let tool = HelpReadFileTool;
        let output = tool
            .execute(
                &NoopToolContext,
                ToolInput {
                    payload_json: serde_json::json!({
                        "path": file_path.to_string_lossy().to_string(),
                        "rootGuard": root.to_string_lossy().to_string()
                    })
                    .to_string(),
                },
            )
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&output.payload_json).unwrap();
        assert_eq!(
            value.get("content").and_then(|v| v.as_str()),
            Some("hello-tier1")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn contract_help_list_dir_tool_lists_children() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("arx-tool-gateway-list-{unique}"));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.txt"), "x").unwrap();

        let tool = HelpListDirTool;
        let output = tool
            .execute(
                &NoopToolContext,
                ToolInput {
                    payload_json: serde_json::json!({
                        "path": root.to_string_lossy().to_string(),
                        "rootGuard": root.to_string_lossy().to_string()
                    })
                    .to_string(),
                },
            )
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&output.payload_json).unwrap();
        let entries = value
            .get("entries")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(!entries.is_empty());

        let _ = fs::remove_dir_all(root);
    }
}
