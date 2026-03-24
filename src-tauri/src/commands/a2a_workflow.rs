use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::a2a::workflow_store;
use crate::memory;
use crate::AppState;

const A2A_MAX_GLOBAL_CONCURRENCY: usize = 4;
const A2A_MAX_PER_WORKFLOW_CONCURRENCY: usize = 2;

static A2A_ACTIVE_RUNS_GLOBAL: AtomicUsize = AtomicUsize::new(0);
static A2A_ACTIVE_RUNS_BY_WORKFLOW: LazyLock<Mutex<HashMap<String, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static A2A_RUN_CONTROLS: LazyLock<Mutex<HashMap<String, RunControl>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone)]
struct RunControl {
    cancelled: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}

impl RunControl {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn set_run_control(run_id: &str, control: RunControl) -> Result<(), String> {
    let mut map = A2A_RUN_CONTROLS.lock().map_err(|e| e.to_string())?;
    map.insert(run_id.to_string(), control);
    Ok(())
}

fn get_run_control(run_id: &str) -> Option<RunControl> {
    A2A_RUN_CONTROLS
        .lock()
        .ok()
        .and_then(|map| map.get(run_id).cloned())
}

fn remove_run_control(run_id: &str) {
    if let Ok(mut map) = A2A_RUN_CONTROLS.lock() {
        map.remove(run_id);
    }
}

struct RunPermit {
    workflow_id: String,
}

impl Drop for RunPermit {
    fn drop(&mut self) {
        A2A_ACTIVE_RUNS_GLOBAL.fetch_sub(1, Ordering::SeqCst);
        if let Ok(mut lock) = A2A_ACTIVE_RUNS_BY_WORKFLOW.lock() {
            if let Some(count) = lock.get_mut(self.workflow_id.as_str()) {
                if *count > 0 {
                    *count -= 1;
                }
                if *count == 0 {
                    lock.remove(self.workflow_id.as_str());
                }
            }
        }
    }
}

fn acquire_run_permit(workflow_id: &str) -> Result<RunPermit, String> {
    let current_global = A2A_ACTIVE_RUNS_GLOBAL.load(Ordering::SeqCst);
    if current_global >= A2A_MAX_GLOBAL_CONCURRENCY {
        return Err(format!(
            "Global A2A concurrency limit reached ({}). Try again shortly.",
            A2A_MAX_GLOBAL_CONCURRENCY
        ));
    }
    {
        let mut by_wf = A2A_ACTIVE_RUNS_BY_WORKFLOW
            .lock()
            .map_err(|e| e.to_string())?;
        let current = *by_wf.get(workflow_id).unwrap_or(&0usize);
        if current >= A2A_MAX_PER_WORKFLOW_CONCURRENCY {
            return Err(format!(
                "Workflow concurrency limit reached for {} ({}).",
                workflow_id, A2A_MAX_PER_WORKFLOW_CONCURRENCY
            ));
        }
        by_wf.insert(workflow_id.to_string(), current + 1);
    }
    A2A_ACTIVE_RUNS_GLOBAL.fetch_add(1, Ordering::SeqCst);
    Ok(RunPermit {
        workflow_id: workflow_id.to_string(),
    })
}

#[derive(Debug, Clone, Serialize)]
struct A2AWorkflowChangedEvent<'a> {
    kind: &'a str,
    workflow_id: Option<&'a str>,
    run_id: Option<&'a str>,
}

fn emit_changed(app: &AppHandle, kind: &str, workflow_id: Option<&str>, run_id: Option<&str>) {
    let _ = app.emit(
        "a2a:workflow_changed",
        A2AWorkflowChangedEvent {
            kind,
            workflow_id,
            run_id,
        },
    );
}

#[derive(Debug, Clone, Serialize)]
struct A2ARunTraceEvent<'a> {
    run_id: &'a str,
    node_id: &'a str,
    status: &'a str,
    detail: Value,
}

fn emit_trace(app: &AppHandle, run_id: &str, node_id: &str, status: &str, detail: Value) {
    let _ = app.emit(
        "a2a:run_trace_chunk",
        A2ARunTraceEvent {
            run_id,
            node_id,
            status,
            detail,
        },
    );
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AWorkflowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub position: Option<Value>,
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AWorkflowEdge {
    pub id: String,
    pub source: String,
    #[serde(default = "default_edge_pin")]
    pub source_output: String,
    pub target: String,
    #[serde(default = "default_edge_pin")]
    pub target_input: String,
}

fn default_edge_pin() -> String {
    "main".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AWorkflowDefinition {
    pub workflow_id: String,
    pub name: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default = "default_version")]
    pub version: i64,
    #[serde(default)]
    pub nodes: Vec<A2AWorkflowNode>,
    #[serde(default)]
    pub edges: Vec<A2AWorkflowEdge>,
    #[serde(default)]
    pub groups: Vec<Value>,
}

fn default_version() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AExecutionItem {
    pub json: Value,
    #[serde(default)]
    pub binary: Option<Value>,
    #[serde(default, rename = "pairedItem")]
    pub paired_item: Option<Value>,
}

impl A2AExecutionItem {
    fn from_json(value: Value, index: usize) -> Self {
        Self {
            json: value,
            binary: None,
            paired_item: Some(json!({ "item": index })),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2AWorkflowCreatePayload {
    pub name: String,
    pub definition: Value,
    #[serde(default)]
    pub active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2AWorkflowUpdatePayload {
    pub workflow_id: String,
    pub name: Option<String>,
    pub definition: Option<Value>,
    pub active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2AWorkflowRunStartPayload {
    pub workflow_id: String,
    #[serde(default)]
    pub trigger_type: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2AWorkflowNodeTestPayload {
    pub node: A2AWorkflowNode,
    #[serde(default)]
    pub input_items: Vec<A2AExecutionItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2ACredentialCreatePayload {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2ATemplateCreatePayload {
    pub name: String,
    pub definition: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2AWorkflowRunDetail {
    pub run: workflow_store::A2AWorkflowRunRecord,
    pub node_runs: Vec<workflow_store::A2AWorkflowNodeRunRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum A2ANodeTier {
    Stable,
    Beta,
    Hidden,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2ANodeTypeDef {
    pub id: &'static str,
    pub label: &'static str,
    pub category: &'static str,
    pub tier: A2ANodeTier,
    pub description: &'static str,
    pub side_effecting: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2AWorkflowPreflightIssue {
    pub kind: String,
    pub node_id: Option<String>,
    pub node_type: Option<String>,
    pub message: String,
    pub blocking: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2AWorkflowPreflightResult {
    pub ok: bool,
    pub issues: Vec<A2AWorkflowPreflightIssue>,
}

fn node_type_defs() -> Vec<A2ANodeTypeDef> {
    vec![
        A2ANodeTypeDef {
            id: "ai.agent",
            label: "Agent",
            category: "primary",
            tier: A2ANodeTier::Stable,
            description: "Agent-style prompt planning node",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "trigger.manual",
            label: "Manual Trigger",
            category: "triggers",
            tier: A2ANodeTier::Stable,
            description: "Manually start a workflow",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "trigger.schedule",
            label: "Schedule Trigger",
            category: "triggers",
            tier: A2ANodeTier::Beta,
            description: "Schedule-based trigger",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "trigger.webhook",
            label: "Webhook Trigger",
            category: "triggers",
            tier: A2ANodeTier::Beta,
            description: "Webhook-based trigger",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "trigger.error",
            label: "Error Trigger",
            category: "triggers",
            tier: A2ANodeTier::Beta,
            description: "Error-path trigger",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "logic.if",
            label: "IF",
            category: "flow_control",
            tier: A2ANodeTier::Stable,
            description: "Conditional branch",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "logic.switch",
            label: "Switch",
            category: "flow_control",
            tier: A2ANodeTier::Stable,
            description: "Route by rules or expression",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "core.merge",
            label: "Merge",
            category: "flow_control",
            tier: A2ANodeTier::Stable,
            description: "Merge streams",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "core.split_in_batches",
            label: "Split In Batches",
            category: "flow_control",
            tier: A2ANodeTier::Stable,
            description: "Split stream into loop+done outputs",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "core.noop",
            label: "NoOp",
            category: "flow_control",
            tier: A2ANodeTier::Stable,
            description: "Pass-through node",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "core.stop_and_error",
            label: "Stop And Error",
            category: "flow_control",
            tier: A2ANodeTier::Stable,
            description: "Stop run with explicit error",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "core.wait",
            label: "Wait",
            category: "flow_control",
            tier: A2ANodeTier::Stable,
            description: "Wait before passing output",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.set",
            label: "Set",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Set object fields",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.map",
            label: "Map",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Map fields",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.filter",
            label: "Filter",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Filter items by conditions",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.sort",
            label: "Sort",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Sort records by field",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.limit",
            label: "Limit",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Limit first/last items",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.remove_duplicates",
            label: "Remove Duplicates",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Drop duplicate records",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.aggregate",
            label: "Aggregate",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Aggregate records into collection",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.summarize",
            label: "Summarize",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Summarize grouped records",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.rename_keys",
            label: "Rename Keys",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Rename object keys",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.compare_datasets",
            label: "Compare Datasets",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Compare two datasets",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "transform.item_lists",
            label: "Item Lists",
            category: "transform",
            tier: A2ANodeTier::Stable,
            description: "Split/aggregate list fields",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "http.request",
            label: "HTTP Request",
            category: "utility",
            tier: A2ANodeTier::Stable,
            description: "HTTP request node",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "util.http_request",
            label: "HTTP Request",
            category: "utility",
            tier: A2ANodeTier::Stable,
            description: "HTTP request utility node",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "util.respond_to_webhook",
            label: "Respond To Webhook",
            category: "utility",
            tier: A2ANodeTier::Beta,
            description: "Webhook response node",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "util.read_write_file",
            label: "Read/Write File",
            category: "utility",
            tier: A2ANodeTier::Beta,
            description: "Filesystem read/write operation",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "util.crypto",
            label: "Crypto",
            category: "utility",
            tier: A2ANodeTier::Stable,
            description: "Hash/value transformation",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "util.datetime",
            label: "DateTime",
            category: "utility",
            tier: A2ANodeTier::Stable,
            description: "Date/time helper node",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "util.execute_workflow",
            label: "Execute Workflow",
            category: "utility",
            tier: A2ANodeTier::Hidden,
            description: "Inline subworkflow execution (not enabled)",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "util.send_email",
            label: "Send Email",
            category: "utility",
            tier: A2ANodeTier::Beta,
            description: "SMTP email send",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "util.sticky_note",
            label: "Sticky Note",
            category: "utility",
            tier: A2ANodeTier::Stable,
            description: "Non-executing note node",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "db.sqlite",
            label: "SQLite",
            category: "datastore",
            tier: A2ANodeTier::Beta,
            description: "SQLite query node",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "db.postgres",
            label: "Postgres",
            category: "datastore",
            tier: A2ANodeTier::Beta,
            description: "Postgres query node",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "db.redis",
            label: "Redis",
            category: "datastore",
            tier: A2ANodeTier::Beta,
            description: "Redis operation node",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "db.mysql",
            label: "MySQL",
            category: "datastore",
            tier: A2ANodeTier::Hidden,
            description: "MySQL runtime disabled",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "db.mariadb",
            label: "MariaDB",
            category: "datastore",
            tier: A2ANodeTier::Hidden,
            description: "MariaDB runtime disabled",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "db.mssql",
            label: "Microsoft SQL",
            category: "datastore",
            tier: A2ANodeTier::Hidden,
            description: "MSSQL runtime disabled",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "db.mongodb",
            label: "MongoDB",
            category: "datastore",
            tier: A2ANodeTier::Hidden,
            description: "MongoDB runtime disabled",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "llm.query",
            label: "LLM Query",
            category: "ai",
            tier: A2ANodeTier::Stable,
            description: "Prompt a model and return response",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "ai.chat_model",
            label: "Chat Model",
            category: "ai",
            tier: A2ANodeTier::Beta,
            description: "AI chat model connector",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "ai.memory",
            label: "Memory Connector",
            category: "ai",
            tier: A2ANodeTier::Beta,
            description: "AI memory connector",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "ai.tool",
            label: "Tool Connector",
            category: "ai",
            tier: A2ANodeTier::Beta,
            description: "AI tool connector",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "tool.invoke",
            label: "Tool Invoke",
            category: "ai",
            tier: A2ANodeTier::Beta,
            description: "Invoke tool action bridge",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "memory.read",
            label: "Memory Read",
            category: "ai",
            tier: A2ANodeTier::Stable,
            description: "Read memory entries",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "memory.write",
            label: "Memory Write",
            category: "ai",
            tier: A2ANodeTier::Stable,
            description: "Write memory entries",
            side_effecting: true,
        },
        A2ANodeTypeDef {
            id: "skill.run",
            label: "Skill Run",
            category: "ai",
            tier: A2ANodeTier::Beta,
            description: "Skill execution bridge",
            side_effecting: false,
        },
        A2ANodeTypeDef {
            id: "output.respond",
            label: "Output",
            category: "outputs",
            tier: A2ANodeTier::Stable,
            description: "Output/response node",
            side_effecting: false,
        },
    ]
}

fn preflight_workflow_definition(definition: &A2AWorkflowDefinition) -> A2AWorkflowPreflightResult {
    let defs = node_type_defs();
    let mut supported = std::collections::HashSet::new();
    for d in &defs {
        if !matches!(d.tier, A2ANodeTier::Hidden) {
            supported.insert(d.id);
        }
    }

    let mut issues = Vec::new();
    for node in &definition.nodes {
        if !supported.contains(node.node_type.as_str()) {
            issues.push(A2AWorkflowPreflightIssue {
                kind: "unsupported_node_type".to_string(),
                node_id: Some(node.id.clone()),
                node_type: Some(node.node_type.clone()),
                message: format!(
                    "Node type '{}' is not supported in this build",
                    node.node_type
                ),
                blocking: true,
            });
        }

        let needs_credential = matches!(
            node.node_type.as_str(),
            "db.postgres" | "db.redis" | "util.send_email"
        );
        if needs_credential {
            let credential_id = node
                .params
                .get("credentialId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if credential_id.is_empty() {
                issues.push(A2AWorkflowPreflightIssue {
                    kind: "missing_credential".to_string(),
                    node_id: Some(node.id.clone()),
                    node_type: Some(node.node_type.clone()),
                    message: format!(
                        "Node '{}' ({}) requires params.credentialId",
                        node.name, node.node_type
                    ),
                    blocking: true,
                });
            }
        }
    }

    if let Err(e) = topological_sort(&definition.nodes, &definition.edges) {
        issues.push(A2AWorkflowPreflightIssue {
            kind: "graph_invalid".to_string(),
            node_id: None,
            node_type: None,
            message: e,
            blocking: true,
        });
    }

    let ok = !issues.iter().any(|i| i.blocking);
    A2AWorkflowPreflightResult { ok, issues }
}

#[derive(Debug, Clone)]
struct NodeContext {
    items_by_name: HashMap<String, Vec<A2AExecutionItem>>,
}

fn as_input_items(input: &Value) -> Vec<A2AExecutionItem> {
    match input {
        Value::Array(arr) => arr
            .iter()
            .enumerate()
            .map(|(idx, v)| A2AExecutionItem::from_json(v.clone(), idx))
            .collect(),
        Value::Null => Vec::new(),
        other => vec![A2AExecutionItem::from_json(other.clone(), 0)],
    }
}

fn topological_sort(
    nodes: &[A2AWorkflowNode],
    edges: &[A2AWorkflowEdge],
) -> Result<Vec<String>, String> {
    let mut indegree: HashMap<&str, usize> = HashMap::new();
    let mut out: HashMap<&str, Vec<&str>> = HashMap::new();
    for n in nodes {
        indegree.insert(n.id.as_str(), 0);
        out.insert(n.id.as_str(), Vec::new());
    }
    for e in edges {
        if !indegree.contains_key(e.source.as_str()) || !indegree.contains_key(e.target.as_str()) {
            return Err(format!(
                "Edge references unknown nodes: {} -> {}",
                e.source, e.target
            ));
        }
        *indegree
            .get_mut(e.target.as_str())
            .expect("target in indegree") += 1;
        out.get_mut(e.source.as_str())
            .expect("source in out")
            .push(e.target.as_str());
    }

    let mut q: VecDeque<&str> = indegree
        .iter()
        .filter_map(|(id, deg)| if *deg == 0 { Some(*id) } else { None })
        .collect();
    let mut order = Vec::with_capacity(nodes.len());

    while let Some(id) = q.pop_front() {
        order.push(id.to_string());
        if let Some(children) = out.get(id) {
            for child in children {
                if let Some(entry) = indegree.get_mut(child) {
                    *entry -= 1;
                    if *entry == 0 {
                        q.push_back(child);
                    }
                }
            }
        }
    }

    if order.len() != nodes.len() {
        return Err("Workflow graph contains a cycle".to_string());
    }
    Ok(order)
}

fn evaluate_template(template: &str, item: &A2AExecutionItem, ctx: &NodeContext) -> Value {
    let trimmed = template.trim();
    if !(trimmed.starts_with("{{") && trimmed.ends_with("}}")) {
        return Value::String(template.to_string());
    }
    let expr = trimmed.trim_start_matches('{').trim_end_matches('}').trim();

    if expr == "$now" {
        return Value::String(chrono::Utc::now().to_rfc3339());
    }
    if expr == "$today" {
        return Value::String(chrono::Utc::now().date_naive().to_string());
    }

    if let Some(path) = expr.strip_prefix("$json.") {
        return read_json_path(&item.json, path);
    }

    if let Some(rest) = expr.strip_prefix("$node[\"") {
        if let Some(end_quote) = rest.find("\"]") {
            let name = &rest[..end_quote];
            let remainder = &rest[end_quote + 2..];
            if let Some(path) = remainder.strip_prefix(".json.") {
                if let Some(items) = ctx.items_by_name.get(name) {
                    if let Some(first) = items.first() {
                        return read_json_path(&first.json, path);
                    }
                }
            }
        }
    }

    Value::Null
}

fn read_json_path(root: &Value, path: &str) -> Value {
    let mut current = root;
    for part in path.split('.') {
        match current {
            Value::Object(map) => {
                if let Some(v) = map.get(part) {
                    current = v;
                } else {
                    return Value::Null;
                }
            }
            Value::Array(arr) => {
                let Ok(idx) = part.parse::<usize>() else {
                    return Value::Null;
                };
                if let Some(v) = arr.get(idx) {
                    current = v;
                } else {
                    return Value::Null;
                }
            }
            _ => return Value::Null,
        }
    }
    current.clone()
}

fn evaluate_condition(item: &A2AExecutionItem, ctx: &NodeContext, cond: &Value) -> bool {
    let value1 = cond
        .get("value1")
        .map(|v| match v {
            Value::String(s) => evaluate_template(s, item, ctx),
            other => other.clone(),
        })
        .unwrap_or(Value::Null);
    let value2 = cond
        .get("value2")
        .map(|v| match v {
            Value::String(s) => evaluate_template(s, item, ctx),
            other => other.clone(),
        })
        .unwrap_or(Value::Null);
    let op = cond
        .get("operation")
        .and_then(|v| v.as_str())
        .unwrap_or("equal")
        .to_ascii_lowercase();

    match op.as_str() {
        "equal" => value1 == value2,
        "notequal" => value1 != value2,
        "contains" => match (&value1, &value2) {
            (Value::String(a), Value::String(b)) => a.contains(b),
            (Value::Array(a), _) => a.contains(&value2),
            _ => false,
        },
        "notcontains" => match (&value1, &value2) {
            (Value::String(a), Value::String(b)) => !a.contains(b),
            (Value::Array(a), _) => !a.contains(&value2),
            _ => true,
        },
        "startswith" => match (&value1, &value2) {
            (Value::String(a), Value::String(b)) => a.starts_with(b),
            _ => false,
        },
        "endswith" => match (&value1, &value2) {
            (Value::String(a), Value::String(b)) => a.ends_with(b),
            _ => false,
        },
        "greaterthan" => value1.as_f64().unwrap_or(0.0) > value2.as_f64().unwrap_or(0.0),
        "lessthan" => value1.as_f64().unwrap_or(0.0) < value2.as_f64().unwrap_or(0.0),
        "greaterthanorequal" => value1.as_f64().unwrap_or(0.0) >= value2.as_f64().unwrap_or(0.0),
        "lessthanorequal" => value1.as_f64().unwrap_or(0.0) <= value2.as_f64().unwrap_or(0.0),
        "isempty" => match value1 {
            Value::Null => true,
            Value::String(ref s) => s.trim().is_empty(),
            Value::Array(ref a) => a.is_empty(),
            Value::Object(ref o) => o.is_empty(),
            _ => false,
        },
        "isnotempty" => match value1 {
            Value::Null => false,
            Value::String(ref s) => !s.trim().is_empty(),
            Value::Array(ref a) => !a.is_empty(),
            Value::Object(ref o) => !o.is_empty(),
            _ => true,
        },
        "istrue" => value1.as_bool().unwrap_or(false),
        "isfalse" => !value1.as_bool().unwrap_or(false),
        _ => false,
    }
}

fn pass_through(
    outputs: &mut HashMap<String, Vec<A2AExecutionItem>>,
    input_items: &[A2AExecutionItem],
) {
    outputs.insert("main".to_string(), input_items.to_vec());
}

fn credential_data_for_node(
    state: &AppState,
    node: &A2AWorkflowNode,
    expected_kind: &[&str],
) -> Result<Value, String> {
    let credential_id = node
        .params
        .get("credentialId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{} requires params.credentialId", node.node_type))?;
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let cred = workflow_store::get_credential(&db, credential_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Credential not found: {credential_id}"))?;
    if !expected_kind.is_empty() && !expected_kind.iter().any(|k| *k == cred.kind) {
        return Err(format!(
            "Credential {} has kind '{}' but node {} expects one of {:?}",
            cred.credential_id, cred.kind, node.node_type, expected_kind
        ));
    }
    serde_json::from_str::<Value>(&cred.data_json).map_err(|e| e.to_string())
}

fn as_string(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn get_setting(state: &AppState, key: &str, default: &str) -> String {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| default.to_string())
}

fn has_version_suffix(base: &str) -> bool {
    base.rsplit('/')
        .next()
        .map(|seg| {
            seg.len() > 1
                && seg.as_bytes()[0].eq_ignore_ascii_case(&b'v')
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false)
}

fn chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if has_version_suffix(base) {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    }
}

async fn execute_node(
    app: &AppHandle,
    state: &AppState,
    run_control: Option<&RunControl>,
    node: &A2AWorkflowNode,
    input_items: &[A2AExecutionItem],
    ctx: &NodeContext,
) -> Result<HashMap<String, Vec<A2AExecutionItem>>, String> {
    let mut outputs: HashMap<String, Vec<A2AExecutionItem>> = HashMap::new();

    match node.node_type.as_str() {
        "trigger.manual"
        | "trigger.webhook"
        | "trigger.schedule"
        | "trigger.error"
        | "output.respond"
        | "util.respond_to_webhook"
        | "core.noop"
        | "util.sticky_note" => {
            pass_through(&mut outputs, input_items);
        }
        "transform.map" | "transform.set" => {
            let fields = node
                .params
                .get("fields")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            let include_other = node
                .params
                .get("includeOtherFields")
                .and_then(|v| v.as_bool())
                .unwrap_or(node.node_type == "transform.map");
            let mapped = input_items
                .iter()
                .map(|it| {
                    let mut obj = if include_other {
                        it.json.as_object().cloned().unwrap_or_default()
                    } else {
                        serde_json::Map::new()
                    };
                    for (k, v) in &fields {
                        let out = match v {
                            Value::String(s) => evaluate_template(s, it, ctx),
                            other => other.clone(),
                        };
                        obj.insert(k.clone(), out);
                    }
                    A2AExecutionItem {
                        json: Value::Object(obj),
                        binary: it.binary.clone(),
                        paired_item: it.paired_item.clone(),
                    }
                })
                .collect::<Vec<_>>();
            outputs.insert("main".to_string(), mapped);
        }
        "logic.if" | "transform.filter" => {
            let combine = node
                .params
                .get("combineConditions")
                .and_then(|v| v.as_str())
                .unwrap_or("all")
                .to_ascii_lowercase();
            let conditions = node
                .params
                .get("conditions")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let expr = node.params.get("expression").and_then(|v| v.as_str());

            let mut yes = Vec::new();
            let mut no = Vec::new();
            for it in input_items {
                let pass = if !conditions.is_empty() {
                    let flags = conditions
                        .iter()
                        .map(|c| evaluate_condition(it, ctx, c))
                        .collect::<Vec<_>>();
                    if combine == "any" {
                        flags.iter().any(|f| *f)
                    } else {
                        flags.iter().all(|f| *f)
                    }
                } else {
                    let template = expr.unwrap_or("{{ $json }}");
                    let v = evaluate_template(template, it, ctx);
                    match v {
                        Value::Bool(b) => b,
                        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
                        Value::String(ref s) => !s.trim().is_empty() && s != "false" && s != "0",
                        Value::Null => false,
                        Value::Array(ref a) => !a.is_empty(),
                        Value::Object(ref o) => !o.is_empty(),
                    }
                };
                if pass {
                    yes.push(it.clone());
                } else {
                    no.push(it.clone());
                }
            }
            if node.node_type == "transform.filter" {
                outputs.insert("main".to_string(), yes);
            } else {
                outputs.insert("true".to_string(), yes);
                outputs.insert("false".to_string(), no);
            }
        }
        "logic.switch" => {
            let mode = node
                .params
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("rules");
            let rules = node
                .params
                .get("rules")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let value_expr = node
                .params
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("{{ $json.value }}");
            let fallback = node
                .params
                .get("fallbackOutput")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let mut bins: HashMap<String, Vec<A2AExecutionItem>> = HashMap::new();
            for it in input_items {
                let mut out_idx = fallback;
                if mode == "expression" {
                    out_idx = evaluate_template(value_expr, it, ctx)
                        .as_i64()
                        .unwrap_or(fallback);
                } else {
                    let needle = evaluate_template(value_expr, it, ctx);
                    for rule in &rules {
                        let rule_value = rule.get("value").cloned().unwrap_or(Value::Null);
                        if needle == rule_value {
                            out_idx = rule
                                .get("outputIndex")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(fallback);
                            break;
                        }
                    }
                }
                bins.entry(format!("out_{out_idx}"))
                    .or_default()
                    .push(it.clone());
            }
            outputs.extend(bins);
        }
        "core.split_in_batches" => {
            let size = node
                .params
                .get("batchSize")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as usize;
            let size = size.max(1);
            let mut loop_items = Vec::new();
            let mut done_items = Vec::new();
            for (i, it) in input_items.iter().enumerate() {
                if i < size {
                    loop_items.push(it.clone());
                } else {
                    done_items.push(it.clone());
                }
            }
            outputs.insert("loop".to_string(), loop_items);
            outputs.insert("done".to_string(), done_items);
        }
        "core.stop_and_error" => {
            let msg = node
                .params
                .get("errorMessage")
                .and_then(|v| v.as_str())
                .unwrap_or("Stopped by node");
            return Err(msg.to_string());
        }
        "core.wait" => {
            let amount = node
                .params
                .get("amount")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let unit = node
                .params
                .get("unit")
                .and_then(|v| v.as_str())
                .unwrap_or("seconds");
            let ms = match unit {
                "milliseconds" => amount,
                "seconds" => amount * 1_000,
                "minutes" => amount * 60_000,
                "hours" => amount * 3_600_000,
                _ => amount * 1_000,
            };
            if ms > 0 {
                let mut remaining = ms.min(60_000);
                while remaining > 0 {
                    if let Some(ctrl) = run_control {
                        if ctrl.cancelled.load(Ordering::SeqCst) {
                            return Err("Workflow canceled".to_string());
                        }
                        while ctrl.paused.load(Ordering::SeqCst) {
                            if ctrl.cancelled.load(Ordering::SeqCst) {
                                return Err("Workflow canceled".to_string());
                            }
                            tokio::time::sleep(Duration::from_millis(200)).await;
                        }
                    }
                    let step = remaining.min(250);
                    tokio::time::sleep(Duration::from_millis(step)).await;
                    remaining = remaining.saturating_sub(step);
                }
            }
            pass_through(&mut outputs, input_items);
        }
        "core.merge" => {
            // Engine currently provides a merged incoming stream; merge modes are
            // normalized to pass-through for lightweight interoperability.
            pass_through(&mut outputs, input_items);
        }
        "transform.sort" => {
            let mut out = input_items.to_vec();
            let field = node
                .params
                .get("sortField")
                .and_then(|v| v.get("fieldName"))
                .and_then(|v| v.as_str())
                .unwrap_or("id");
            let order = node
                .params
                .get("sortField")
                .and_then(|v| v.get("order"))
                .and_then(|v| v.as_str())
                .unwrap_or("ascending");
            out.sort_by(|a, b| {
                let av = read_json_path(&a.json, field);
                let bv = read_json_path(&b.json, field);
                let cmp = av.to_string().cmp(&bv.to_string());
                if order == "descending" {
                    cmp.reverse()
                } else {
                    cmp
                }
            });
            outputs.insert("main".to_string(), out);
        }
        "transform.limit" => {
            let max_items = node
                .params
                .get("maxItems")
                .and_then(|v| v.as_u64())
                .unwrap_or(input_items.len() as u64) as usize;
            let keep = node
                .params
                .get("keep")
                .and_then(|v| v.as_str())
                .unwrap_or("firstItems");
            let slice = if keep == "lastItems" {
                input_items
                    .iter()
                    .rev()
                    .take(max_items)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect()
            } else {
                input_items.iter().take(max_items).cloned().collect()
            };
            outputs.insert("main".to_string(), slice);
        }
        "transform.remove_duplicates" => {
            let fields = node
                .params
                .get("fields")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>();
            let mut seen = std::collections::HashSet::new();
            let mut out = Vec::new();
            for it in input_items {
                let key = if fields.is_empty() {
                    it.json.to_string()
                } else {
                    fields
                        .iter()
                        .map(|f| read_json_path(&it.json, f).to_string())
                        .collect::<Vec<_>>()
                        .join("|")
                };
                if seen.insert(key) {
                    out.push(it.clone());
                }
            }
            outputs.insert("main".to_string(), out);
        }
        "transform.rename_keys" => {
            let keys = node
                .params
                .get("keys")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let out = input_items
                .iter()
                .map(|it| {
                    let mut obj = it.json.as_object().cloned().unwrap_or_default();
                    for pair in &keys {
                        let from = pair
                            .get("currentKey")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let to = pair.get("newKey").and_then(|v| v.as_str()).unwrap_or("");
                        if from.is_empty() || to.is_empty() {
                            continue;
                        }
                        if let Some(v) = obj.remove(from) {
                            obj.insert(to.to_string(), v);
                        }
                    }
                    A2AExecutionItem {
                        json: Value::Object(obj),
                        binary: it.binary.clone(),
                        paired_item: it.paired_item.clone(),
                    }
                })
                .collect::<Vec<_>>();
            outputs.insert("main".to_string(), out);
        }
        "transform.aggregate" => {
            let destination = node
                .params
                .get("destinationField")
                .and_then(|v| v.as_str())
                .unwrap_or("items");
            outputs.insert(
                "main".to_string(),
                vec![A2AExecutionItem::from_json(
                    json!({ destination: input_items.iter().map(|i| i.json.clone()).collect::<Vec<_>>() }),
                    0,
                )],
            );
        }
        "transform.summarize" => {
            let split_fields = node
                .params
                .get("fieldsToSplitBy")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>();
            let summarize_fields = node
                .params
                .get("fieldsToSummarize")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let mut groups: HashMap<String, Vec<&A2AExecutionItem>> = HashMap::new();
            for it in input_items {
                let key = if split_fields.is_empty() {
                    "__all__".to_string()
                } else {
                    split_fields
                        .iter()
                        .map(|f| read_json_path(&it.json, f).to_string())
                        .collect::<Vec<_>>()
                        .join("|")
                };
                groups.entry(key).or_default().push(it);
            }

            let mut out = Vec::new();
            for (idx, (_k, items)) in groups.into_iter().enumerate() {
                let mut obj = serde_json::Map::new();
                if let Some(first) = items.first() {
                    for field in &split_fields {
                        obj.insert(field.clone(), read_json_path(&first.json, field));
                    }
                }
                for spec in &summarize_fields {
                    let aggregation = spec
                        .get("aggregation")
                        .and_then(|v| v.as_str())
                        .unwrap_or("count")
                        .to_ascii_lowercase();
                    let field = spec.get("field").and_then(|v| v.as_str()).unwrap_or("");
                    let output_field = spec
                        .get("outputField")
                        .and_then(|v| v.as_str())
                        .unwrap_or(field);
                    let values = items
                        .iter()
                        .map(|it| read_json_path(&it.json, field))
                        .collect::<Vec<_>>();
                    let aggregate_val = match aggregation.as_str() {
                        "count" => json!(values.len() as i64),
                        "sum" => json!(values
                            .iter()
                            .map(|v| v.as_f64().unwrap_or(0.0))
                            .sum::<f64>()),
                        "min" => {
                            let nums = values.iter().filter_map(|v| v.as_f64()).collect::<Vec<_>>();
                            nums.into_iter()
                                .reduce(|a, b| a.min(b))
                                .map_or(Value::Null, |v| json!(v))
                        }
                        "max" => {
                            let nums = values.iter().filter_map(|v| v.as_f64()).collect::<Vec<_>>();
                            nums.into_iter()
                                .reduce(|a, b| a.max(b))
                                .map_or(Value::Null, |v| json!(v))
                        }
                        "append" => json!(values),
                        "countunique" => {
                            let set = values
                                .iter()
                                .map(|v| v.to_string())
                                .collect::<std::collections::HashSet<_>>();
                            json!(set.len() as i64)
                        }
                        _ => json!(values.len() as i64),
                    };
                    obj.insert(output_field.to_string(), aggregate_val);
                }
                out.push(A2AExecutionItem::from_json(Value::Object(obj), idx));
            }
            outputs.insert("main".to_string(), out);
        }
        "transform.compare_datasets" => {
            // Single-stream prototype: emit all items as "in-both"/output0.
            outputs.insert("out_0".to_string(), input_items.to_vec());
            outputs.insert("out_1".to_string(), Vec::new());
            outputs.insert("out_2".to_string(), Vec::new());
            outputs.insert("out_3".to_string(), Vec::new());
        }
        "transform.item_lists" => {
            let op = node
                .params
                .get("operation")
                .and_then(|v| v.as_str())
                .unwrap_or("splitOutItems");
            if op == "aggregateItems" {
                outputs.insert(
                    "main".to_string(),
                    vec![A2AExecutionItem::from_json(
                        json!({ "items": input_items.iter().map(|i| i.json.clone()).collect::<Vec<_>>() }),
                        0,
                    )],
                );
            } else {
                let field = node
                    .params
                    .get("fieldToSplitOut")
                    .and_then(|v| v.as_str())
                    .unwrap_or("items");
                let mut out = Vec::new();
                for it in input_items {
                    let v = read_json_path(&it.json, field);
                    if let Some(arr) = v.as_array() {
                        for (idx, entry) in arr.iter().enumerate() {
                            out.push(A2AExecutionItem::from_json(entry.clone(), idx));
                        }
                    }
                }
                outputs.insert("main".to_string(), out);
            }
        }
        "http.request" | "util.http_request" => {
            let method = node
                .params
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_ascii_uppercase();
            let url = node
                .params
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "http.request requires params.url".to_string())?;
            let body_template = node.params.get("body").cloned();

            let mut out = Vec::new();
            for (idx, it) in input_items.iter().enumerate() {
                let body_value = body_template
                    .as_ref()
                    .map(|v| match v {
                        Value::String(s) => evaluate_template(s, it, ctx),
                        other => other.clone(),
                    })
                    .unwrap_or(Value::Null);
                let req = match method.as_str() {
                    "POST" => state.http_client.post(url),
                    "PUT" => state.http_client.put(url),
                    "PATCH" => state.http_client.patch(url),
                    "DELETE" => state.http_client.delete(url),
                    _ => state.http_client.get(url),
                };
                let req = if matches!(method.as_str(), "POST" | "PUT" | "PATCH") {
                    req.json(&body_value)
                } else {
                    req
                };
                let resp = req.send().await.map_err(|e| e.to_string())?;
                let status = resp.status().as_u16();
                let text = resp.text().await.map_err(|e| e.to_string())?;
                out.push(A2AExecutionItem {
                    json: json!({
                        "status": status,
                        "body": text,
                        "source_index": idx,
                    }),
                    binary: None,
                    paired_item: it.paired_item.clone(),
                });
            }
            outputs.insert("main".to_string(), out);
        }
        "llm.query" => {
            let prompt_template = node
                .params
                .get("prompt")
                .and_then(|v| v.as_str())
                .unwrap_or("{{ $json.question }}");
            let system = node
                .params
                .get("system")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            let model_override = node
                .params
                .get("model")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            let temperature = node.params.get("temperature").and_then(|v| v.as_f64());

            let base_url = get_setting(state, "base_url", "http://localhost:11434/v1");
            let api_key = get_setting(state, "api_key", "ollama");
            let default_model = get_setting(state, "model", "llama3.2");
            let model = model_override.unwrap_or(default_model);
            let endpoint = chat_completions_url(base_url.as_str());

            let mut out = Vec::new();
            for it in input_items {
                let prompt_value = evaluate_template(prompt_template, it, ctx);
                let prompt_text = match prompt_value {
                    Value::String(s) => s,
                    other => other.to_string(),
                };

                let mut messages = Vec::new();
                if let Some(ref system_text) = system {
                    messages.push(json!({ "role": "system", "content": system_text }));
                }
                messages.push(json!({ "role": "user", "content": prompt_text }));

                let mut body = json!({
                    "model": model,
                    "messages": messages
                });
                if let Some(t) = temperature {
                    if let Some(obj) = body.as_object_mut() {
                        obj.insert("temperature".to_string(), json!(t));
                    }
                }

                let resp = state
                    .http_client
                    .post(endpoint.as_str())
                    .header("Authorization", format!("Bearer {api_key}"))
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let status = resp.status().as_u16();
                let response_json: Value = resp.json().await.map_err(|e| e.to_string())?;

                let answer = response_json
                    .get("choices")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|first| first.get("message"))
                    .and_then(|m| m.get("content"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        response_json
                            .get("output_text")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_default();

                out.push(A2AExecutionItem {
                    json: json!({
                        "model": model,
                        "status": status,
                        "answer": answer,
                        "raw": response_json
                    }),
                    binary: it.binary.clone(),
                    paired_item: it.paired_item.clone(),
                });
            }
            outputs.insert("main".to_string(), out);
        }
        "ai.agent" => {
            // Lightweight agent primitive: delegates to llm.query-style generation
            // with optional system message and iteration budget metadata.
            let text_template = node
                .params
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("{{ $json.question }}");
            let system = node
                .params
                .get("systemMessage")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            let max_iterations = node
                .params
                .get("maxIterations")
                .and_then(|v| v.as_u64())
                .unwrap_or(3);
            let mut skill_bindings = node
                .params
                .get("skills")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if skill_bindings.is_empty() {
                if let Some(legacy) = node
                    .params
                    .get("skill")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    skill_bindings.push(legacy.to_string());
                }
            }
            let mut tool_bindings = node
                .params
                .get("tools")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if tool_bindings.is_empty() {
                if let Some(legacy) = node
                    .params
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    tool_bindings.push(legacy.to_string());
                }
            }
            let mut memory_bindings = node
                .params
                .get("memory_refs")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| {
                            let namespace = v.get("namespace")?.as_str()?.trim();
                            let key = v.get("key")?.as_str()?.trim();
                            if namespace.is_empty() || key.is_empty() {
                                return None;
                            }
                            Some((namespace.to_string(), key.to_string()))
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if memory_bindings.is_empty() {
                if let Some(legacy) = node
                    .params
                    .get("memory")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    if let Some((namespace, key)) = legacy.split_once('/') {
                        if !namespace.trim().is_empty() && !key.trim().is_empty() {
                            memory_bindings
                                .push((namespace.trim().to_string(), key.trim().to_string()));
                        }
                    } else {
                        memory_bindings.push(("user".to_string(), legacy.to_string()));
                    }
                }
            }

            let mut memory_values_by_namespace: HashMap<String, HashMap<String, String>> =
                HashMap::new();
            if !memory_bindings.is_empty() {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                for (namespace, _key) in &memory_bindings {
                    if memory_values_by_namespace.contains_key(namespace) {
                        continue;
                    }
                    let rows = memory::list(&db, namespace).map_err(|e| e.to_string())?;
                    let map = rows
                        .into_iter()
                        .map(|row| (row.key, row.value))
                        .collect::<HashMap<_, _>>();
                    memory_values_by_namespace.insert(namespace.clone(), map);
                }
            }

            let mut out = Vec::new();
            for it in input_items {
                let question = evaluate_template(text_template, it, ctx)
                    .as_str()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| evaluate_template(text_template, it, ctx).to_string());
                let memory_context = memory_bindings
                    .iter()
                    .filter_map(|(namespace, key)| {
                        memory_values_by_namespace
                            .get(namespace)
                            .and_then(|rows| rows.get(key))
                            .map(|value| {
                                json!({
                                    "namespace": namespace,
                                    "key": key,
                                    "value": value
                                })
                            })
                    })
                    .collect::<Vec<_>>();
                let bindings_note = if skill_bindings.is_empty()
                    && tool_bindings.is_empty()
                    && memory_context.is_empty()
                {
                    String::new()
                } else {
                    format!(
                        "\n\n[Agent bindings]\nskills: {}\ntools: {}\nmemory: {}",
                        if skill_bindings.is_empty() {
                            "none".to_string()
                        } else {
                            skill_bindings.join(", ")
                        },
                        if tool_bindings.is_empty() {
                            "none".to_string()
                        } else {
                            tool_bindings.join(", ")
                        },
                        if memory_context.is_empty() {
                            "none".to_string()
                        } else {
                            memory_context
                                .iter()
                                .map(|entry| {
                                    let ns = entry
                                        .get("namespace")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");
                                    let key =
                                        entry.get("key").and_then(|v| v.as_str()).unwrap_or("");
                                    format!("{ns}/{key}")
                                })
                                .collect::<Vec<_>>()
                                .join(", ")
                        }
                    )
                };
                let prompt = if let Some(ref sys) = system {
                    format!("{sys}\n\nUser: {question}{bindings_note}")
                } else {
                    format!("{question}{bindings_note}")
                };
                let prompt_without_bindings = if let Some(ref sys) = system {
                    format!("{sys}\n\nUser: {question}")
                } else {
                    question
                };
                out.push(A2AExecutionItem {
                    json: json!({
                        "agent_prompt": prompt,
                        "agent_prompt_user": prompt_without_bindings,
                        "max_iterations": max_iterations,
                        "agent_context": {
                            "skills": skill_bindings.clone(),
                            "tools": tool_bindings.clone(),
                            "memory": memory_context.clone()
                        },
                        "note": "Use llm.query downstream for final completion."
                    }),
                    binary: it.binary.clone(),
                    paired_item: it.paired_item.clone(),
                });
            }
            outputs.insert("main".to_string(), out);
        }
        "ai.chat_model" | "ai.memory" | "ai.tool" => {
            pass_through(&mut outputs, input_items);
        }
        "memory.read" => {
            let namespace = node
                .params
                .get("namespace")
                .and_then(|v| v.as_str())
                .unwrap_or("user");
            let rows = {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                memory::list(&db, namespace).map_err(|e| e.to_string())?
            };
            let out = rows
                .into_iter()
                .enumerate()
                .map(|(idx, r)| {
                    A2AExecutionItem::from_json(
                        json!({
                            "namespace": r.namespace,
                            "key": r.key,
                            "value": r.value,
                            "updated_at": r.updated_at
                        }),
                        idx,
                    )
                })
                .collect::<Vec<_>>();
            outputs.insert("main".to_string(), out);
        }
        "memory.write" => {
            let namespace = node
                .params
                .get("namespace")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string();
            let mut written = 0usize;
            {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                for it in input_items {
                    let key = it
                        .json
                        .get("key")
                        .and_then(|v| v.as_str())
                        .unwrap_or("item")
                        .to_string();
                    let value = it
                        .json
                        .get("value")
                        .map(|v| {
                            if let Some(s) = v.as_str() {
                                s.to_string()
                            } else {
                                v.to_string()
                            }
                        })
                        .unwrap_or_else(|| "{}".to_string());
                    memory::upsert(&db, &namespace, &key, &value).map_err(|e| e.to_string())?;
                    memory::write_file(&db, &namespace, &state.memory_dir)
                        .map_err(|e| e.to_string())?;
                    written += 1;
                }
            }
            outputs.insert(
                "main".to_string(),
                vec![A2AExecutionItem::from_json(
                    json!({ "written": written, "namespace": namespace }),
                    0,
                )],
            );
        }
        "skill.run" => {
            let mode = node
                .params
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("list");
            if mode == "list" {
                let skills = crate::commands::skills::cmd_skills_list(app.clone(), None)
                    .map_err(|e| e.to_string())?;
                let out = skills
                    .into_iter()
                    .enumerate()
                    .map(|(idx, s)| {
                        A2AExecutionItem::from_json(
                            json!({
                                "id": s.id,
                                "name": s.name,
                                "description": s.description,
                                "path": s.path,
                                "category": s.category,
                            }),
                            idx,
                        )
                    })
                    .collect::<Vec<_>>();
                outputs.insert("main".to_string(), out);
            } else {
                return Err(format!("Unsupported skill.run mode: {mode}"));
            }
        }
        "tool.invoke" => {
            // Lightweight bridge for prototype. Supports browser fetch + memory/skills shortcuts.
            let action = node
                .params
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let result = match action {
                "browser.fetch" => {
                    let url = node
                        .params
                        .get("url")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "tool.invoke browser.fetch requires url".to_string())?;
                    let body = state
                        .http_client
                        .get(url)
                        .send()
                        .await
                        .map_err(|e| e.to_string())?
                        .text()
                        .await
                        .map_err(|e| e.to_string())?;
                    json!({ "url": url, "content": body })
                }
                "browser.search" => {
                    let query = node
                        .params
                        .get("query")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "tool.invoke browser.search requires query".to_string())?;
                    let mode = node
                        .params
                        .get("mode")
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string());
                    let num = node
                        .params
                        .get("num")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32);
                    let page = node
                        .params
                        .get("page")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32);
                    let result = crate::commands::browser::serper_search(
                        state,
                        query.to_string(),
                        mode,
                        num,
                        page,
                    )
                    .await?;
                    json!(result)
                }
                "memory.list" => {
                    let ns = node
                        .params
                        .get("namespace")
                        .and_then(|v| v.as_str())
                        .unwrap_or("user");
                    let rows = {
                        let db = state.db.lock().map_err(|e| e.to_string())?;
                        memory::list(&db, ns).map_err(|e| e.to_string())?
                    };
                    json!({ "namespace": ns, "items": rows })
                }
                "skills.list" => {
                    let skills = crate::commands::skills::cmd_skills_list(app.clone(), None)
                        .map_err(|e| e.to_string())?;
                    json!({ "items": skills })
                }
                other => return Err(format!("Unsupported tool.invoke action: {other}")),
            };
            outputs.insert(
                "main".to_string(),
                vec![A2AExecutionItem::from_json(result, 0)],
            );
        }
        "util.datetime" => {
            let action = node
                .params
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("getCurrentTime");
            let out = input_items
                .iter()
                .map(|it| {
                    let mut obj = it.json.as_object().cloned().unwrap_or_default();
                    let now = chrono::Utc::now();
                    let value = match action {
                        "getCurrentTime" => json!(now.to_rfc3339()),
                        "extractDate" => json!(now.date_naive().to_string()),
                        _ => json!(now.to_rfc3339()),
                    };
                    obj.insert("dateTime".to_string(), value);
                    A2AExecutionItem {
                        json: Value::Object(obj),
                        binary: it.binary.clone(),
                        paired_item: it.paired_item.clone(),
                    }
                })
                .collect::<Vec<_>>();
            outputs.insert("main".to_string(), out);
        }
        "util.crypto" => {
            use std::hash::{Hash, Hasher};
            let value_template = node
                .params
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("{{ $json.value }}");
            let output_field = node
                .params
                .get("dataPropertyName")
                .and_then(|v| v.as_str())
                .unwrap_or("crypto");
            let out = input_items
                .iter()
                .map(|it| {
                    let value = evaluate_template(value_template, it, ctx).to_string();
                    let mut hasher = std::collections::hash_map::DefaultHasher::new();
                    value.hash(&mut hasher);
                    let digest = format!("{:x}", hasher.finish());
                    let mut obj = it.json.as_object().cloned().unwrap_or_default();
                    obj.insert(output_field.to_string(), Value::String(digest));
                    A2AExecutionItem {
                        json: Value::Object(obj),
                        binary: it.binary.clone(),
                        paired_item: it.paired_item.clone(),
                    }
                })
                .collect::<Vec<_>>();
            outputs.insert("main".to_string(), out);
        }
        "util.read_write_file" => {
            let operation = node
                .params
                .get("operation")
                .and_then(|v| v.as_str())
                .unwrap_or("read");
            let file_path = node
                .params
                .get("filePath")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "util.read_write_file requires filePath".to_string())?;
            if operation == "write" {
                let payload = node
                    .params
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                std::fs::write(file_path, payload).map_err(|e| e.to_string())?;
                outputs.insert(
                    "main".to_string(),
                    vec![A2AExecutionItem::from_json(
                        json!({ "written": true, "path": file_path }),
                        0,
                    )],
                );
            } else {
                let content = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
                outputs.insert(
                    "main".to_string(),
                    vec![A2AExecutionItem::from_json(
                        json!({ "path": file_path, "content": content }),
                        0,
                    )],
                );
            }
        }
        "db.sqlite" => {
            let operation = node
                .params
                .get("operation")
                .and_then(|v| v.as_str())
                .unwrap_or("executeQuery");
            if operation != "executeQuery" {
                return Err("db.sqlite currently supports operation=executeQuery".to_string());
            }
            let query = node
                .params
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "db.sqlite executeQuery requires query".to_string())?;
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = db.prepare(query).map_err(|e| e.to_string())?;
            let cols = stmt.column_count();
            let names = (0..cols)
                .map(|i| stmt.column_name(i).unwrap_or("").to_string())
                .collect::<Vec<_>>();
            let rows = stmt
                .query_map([], |row| {
                    let mut obj = serde_json::Map::new();
                    for (idx, name) in names.iter().enumerate() {
                        let val: rusqlite::types::Value = row.get(idx)?;
                        let json_val = match val {
                            rusqlite::types::Value::Null => Value::Null,
                            rusqlite::types::Value::Integer(i) => json!(i),
                            rusqlite::types::Value::Real(f) => json!(f),
                            rusqlite::types::Value::Text(t) => json!(t),
                            rusqlite::types::Value::Blob(b) => json!(format!("<blob:{}>", b.len())),
                        };
                        obj.insert(name.clone(), json_val);
                    }
                    Ok(Value::Object(obj))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            let out = rows
                .into_iter()
                .enumerate()
                .map(|(idx, v)| A2AExecutionItem::from_json(v, idx))
                .collect::<Vec<_>>();
            outputs.insert("main".to_string(), out);
        }
        "db.postgres" => {
            use tokio_postgres::NoTls;
            let cred = credential_data_for_node(state, node, &["postgres", "db.postgres"])?;
            let conn_str = as_string(&cred, "connectionString")
                .or_else(|| as_string(&cred, "url"))
                .ok_or_else(|| "postgres credential requires connectionString/url".to_string())?;
            let query = node
                .params
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "db.postgres requires params.query".to_string())?;
            let (client, connection) = tokio_postgres::connect(conn_str.as_str(), NoTls)
                .await
                .map_err(|e| e.to_string())?;
            tauri::async_runtime::spawn(async move {
                let _ = connection.await;
            });
            let rows = client.query(query, &[]).await.map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for (idx, row) in rows.iter().enumerate() {
                let mut obj = serde_json::Map::new();
                for (i, col) in row.columns().iter().enumerate() {
                    let name = col.name();
                    let val = row
                        .try_get::<usize, bool>(i)
                        .map(|v| json!(v))
                        .or_else(|_| row.try_get::<usize, i64>(i).map(|v| json!(v)))
                        .or_else(|_| row.try_get::<usize, f64>(i).map(|v| json!(v)))
                        .or_else(|_| row.try_get::<usize, String>(i).map(|v| json!(v)))
                        .unwrap_or(Value::Null);
                    obj.insert(name.to_string(), val);
                }
                out.push(A2AExecutionItem::from_json(Value::Object(obj), idx));
            }
            outputs.insert("main".to_string(), out);
        }
        "db.mysql" | "db.mariadb" => {
            let _ = credential_data_for_node(
                state,
                node,
                &["mysql", "mariadb", "db.mysql", "db.mariadb"],
            )?;
            return Err("db.mysql/db.mariadb runtime is disabled in this build".to_string());
        }
        "db.mongodb" => {
            let _ = credential_data_for_node(state, node, &["mongodb", "db.mongodb"])?;
            return Err("db.mongodb runtime is disabled in this build".to_string());
        }
        "db.redis" => {
            use redis::AsyncCommands;
            let cred = credential_data_for_node(state, node, &["redis", "db.redis"])?;
            let url = as_string(&cred, "url")
                .ok_or_else(|| "redis credential requires url".to_string())?;
            let operation = node
                .params
                .get("operation")
                .and_then(|v| v.as_str())
                .unwrap_or("get")
                .to_ascii_lowercase();
            let key = node
                .params
                .get("key")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let client = redis::Client::open(url).map_err(|e| e.to_string())?;
            let mut conn = client
                .get_multiplexed_async_connection()
                .await
                .map_err(|e| e.to_string())?;
            let result = match operation.as_str() {
                "set" => {
                    let value = node
                        .params
                        .get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let _: () = conn.set(key, value).await.map_err(|e| e.to_string())?;
                    json!({ "ok": true, "key": key, "operation": "set" })
                }
                "delete" => {
                    let deleted: i64 = conn.del(key).await.map_err(|e| e.to_string())?;
                    json!({ "deleted": deleted, "key": key })
                }
                "incr" => {
                    let by = node.params.get("by").and_then(|v| v.as_i64()).unwrap_or(1);
                    let val: i64 = conn.incr(key, by).await.map_err(|e| e.to_string())?;
                    json!({ "value": val, "key": key })
                }
                "keys" => {
                    let pattern = if key.is_empty() { "*" } else { key };
                    let keys: Vec<String> = conn.keys(pattern).await.map_err(|e| e.to_string())?;
                    json!({ "keys": keys })
                }
                _ => {
                    let value: Option<String> = conn.get(key).await.map_err(|e| e.to_string())?;
                    json!({ "key": key, "value": value })
                }
            };
            outputs.insert(
                "main".to_string(),
                vec![A2AExecutionItem::from_json(result, 0)],
            );
        }
        "db.mssql" => {
            return Err("db.mssql is not yet implemented in this build".to_string());
        }
        "util.execute_workflow" => {
            let workflow_id = node
                .params
                .get("workflowId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            outputs.insert(
                "main".to_string(),
                vec![A2AExecutionItem::from_json(
                    json!({
                        "queued": false,
                        "status": "not_implemented_inline",
                        "workflow_id": workflow_id,
                        "note": "Use agents/project workflow.run action for subworkflow invocation in this prototype"
                    }),
                    0,
                )],
            );
        }
        "util.send_email" => {
            use lettre::transport::smtp::authentication::Credentials;
            use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
            let cred =
                credential_data_for_node(state, node, &["smtp", "email.smtp", "util.send_email"])?;
            let host = as_string(&cred, "host")
                .ok_or_else(|| "smtp credential requires host".to_string())?;
            let port = cred.get("port").and_then(|v| v.as_u64()).unwrap_or(587) as u16;
            let username = as_string(&cred, "username");
            let password = as_string(&cred, "password");
            let from = node
                .params
                .get("from")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| as_string(&cred, "from"))
                .ok_or_else(|| {
                    "util.send_email requires params.from or credential.from".to_string()
                })?;
            let to = node
                .params
                .get("to")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "util.send_email requires params.to".to_string())?;
            let subject = node
                .params
                .get("subject")
                .and_then(|v| v.as_str())
                .unwrap_or("(no subject)");
            let text = node
                .params
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let mut builder =
                Message::builder().from(from.parse().map_err(|e| format!("invalid from: {e}"))?);
            for recipient in to.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                builder = builder.to(recipient.parse().map_err(|e| format!("invalid to: {e}"))?);
            }
            let email = builder
                .subject(subject)
                .body(text.to_string())
                .map_err(|e| e.to_string())?;

            let mut transport_builder = AsyncSmtpTransport::<Tokio1Executor>::relay(host.as_str())
                .map_err(|e| e.to_string())?
                .port(port);
            if let (Some(user), Some(pass)) = (username, password) {
                transport_builder = transport_builder.credentials(Credentials::new(user, pass));
            }
            let transport = transport_builder.build();
            transport.send(email).await.map_err(|e| e.to_string())?;
            outputs.insert(
                "main".to_string(),
                vec![A2AExecutionItem::from_json(
                    json!({ "sent": true, "to": to, "subject": subject }),
                    0,
                )],
            );
        }
        other => return Err(format!("Unsupported node type: {other}")),
    }

    Ok(outputs)
}

async fn execute_workflow_run(
    app: &AppHandle,
    state: &AppState,
    run_id: &str,
    definition: &A2AWorkflowDefinition,
    input_items: Vec<A2AExecutionItem>,
    timeout_ms: u64,
) -> Result<Vec<A2AExecutionItem>, String> {
    let started = Instant::now();
    let run_control = get_run_control(run_id);
    let order = topological_sort(&definition.nodes, &definition.edges)?;
    let node_by_id: HashMap<&str, &A2AWorkflowNode> = definition
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n))
        .collect();

    let mut outputs_by_node: HashMap<String, HashMap<String, Vec<A2AExecutionItem>>> =
        HashMap::new();
    let mut outputs_by_name: HashMap<String, Vec<A2AExecutionItem>> = HashMap::new();
    let mut final_items = Vec::new();

    for node_id in order {
        if let Some(ctrl) = &run_control {
            if ctrl.cancelled.load(Ordering::SeqCst) {
                return Err("Workflow canceled".to_string());
            }
            while ctrl.paused.load(Ordering::SeqCst) {
                if ctrl.cancelled.load(Ordering::SeqCst) {
                    return Err("Workflow canceled".to_string());
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
        if started.elapsed() > Duration::from_millis(timeout_ms) {
            return Err("Workflow timed out".to_string());
        }
        let Some(node) = node_by_id.get(node_id.as_str()) else {
            return Err(format!("Missing node {node_id}"));
        };

        let node_input = if node.node_type.starts_with("trigger.") {
            input_items.clone()
        } else {
            let mut merged = Vec::new();
            for edge in definition.edges.iter().filter(|e| e.target == node.id) {
                if let Some(src_out) = outputs_by_node.get(&edge.source) {
                    if let Some(items) = src_out.get(&edge.source_output) {
                        merged.extend(items.clone());
                    }
                }
            }
            merged
        };

        let node_started = Instant::now();
        let node_started_ms = chrono::Utc::now().timestamp_millis();
        emit_trace(
            app,
            run_id,
            &node.id,
            "running",
            json!({ "input_count": node_input.len(), "node_type": node.node_type }),
        );

        let execution_ctx = NodeContext {
            items_by_name: outputs_by_name.clone(),
        };
        let result = execute_node(
            app,
            state,
            run_control.as_ref(),
            node,
            &node_input,
            &execution_ctx,
        )
        .await;
        let node_finished_ms = chrono::Utc::now().timestamp_millis();
        let duration_ms = node_started.elapsed().as_millis() as i64;

        match result {
            Ok(node_outputs) => {
                if node.node_type == "output.respond" {
                    final_items = node_outputs.get("main").cloned().unwrap_or_default();
                }
                outputs_by_name.insert(
                    node.name.clone(),
                    node_outputs.get("main").cloned().unwrap_or_default(),
                );
                outputs_by_node.insert(node.id.clone(), node_outputs.clone());

                let row = workflow_store::A2AWorkflowNodeRunRecord {
                    run_id: run_id.to_string(),
                    node_id: node.id.clone(),
                    node_type: node.node_type.clone(),
                    status: "succeeded".to_string(),
                    input_json: serde_json::to_string(&node_input).map_err(|e| e.to_string())?,
                    output_json: Some(
                        serde_json::to_string(&node_outputs).map_err(|e| e.to_string())?,
                    ),
                    error: None,
                    duration_ms,
                    started_at_ms: node_started_ms,
                    finished_at_ms: node_finished_ms,
                    attempt: 1,
                };
                {
                    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
                    workflow_store::append_node_run(&db, &row).map_err(|e| e.to_string())?;
                    workflow_store::append_observability_event(
                        &db,
                        run_id,
                        "node_succeeded",
                        &json!({
                            "node_id": node.id,
                            "node_type": node.node_type,
                            "duration_ms": duration_ms
                        })
                        .to_string(),
                    )
                    .map_err(|e| e.to_string())?;
                }
                emit_trace(
                    app,
                    run_id,
                    &node.id,
                    "succeeded",
                    json!({ "duration_ms": duration_ms }),
                );
            }
            Err(err) => {
                let row = workflow_store::A2AWorkflowNodeRunRecord {
                    run_id: run_id.to_string(),
                    node_id: node.id.clone(),
                    node_type: node.node_type.clone(),
                    status: "failed".to_string(),
                    input_json: serde_json::to_string(&node_input).map_err(|e| e.to_string())?,
                    output_json: None,
                    error: Some(err.clone()),
                    duration_ms,
                    started_at_ms: node_started_ms,
                    finished_at_ms: node_finished_ms,
                    attempt: 1,
                };
                {
                    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
                    workflow_store::append_node_run(&db, &row).map_err(|e| e.to_string())?;
                    workflow_store::append_observability_event(
                        &db,
                        run_id,
                        "node_failed",
                        &json!({
                            "node_id": node.id,
                            "node_type": node.node_type,
                            "error": err,
                            "duration_ms": duration_ms
                        })
                        .to_string(),
                    )
                    .map_err(|e| e.to_string())?;
                }
                emit_trace(app, run_id, &node.id, "failed", json!({ "error": err }));
                return Err(err);
            }
        }
    }

    if final_items.is_empty() {
        // fallback: return output of last node main output if output.respond wasn't used
        if let Some(last_id) = definition.nodes.last().map(|n| n.id.clone()) {
            final_items = outputs_by_node
                .get(&last_id)
                .and_then(|m| m.get("main"))
                .cloned()
                .unwrap_or_default();
        }
    }

    Ok(final_items)
}

#[tauri::command]
pub fn cmd_a2a_workflow_list(
    state: State<'_, AppState>,
) -> Result<Vec<workflow_store::A2AWorkflowRecord>, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    workflow_store::list_workflows(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_a2a_workflow_get(
    state: State<'_, AppState>,
    workflow_id: String,
) -> Result<Option<workflow_store::A2AWorkflowRecord>, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    workflow_store::get_workflow(&db, workflow_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_a2a_workflow_create(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: A2AWorkflowCreatePayload,
) -> Result<workflow_store::A2AWorkflowRecord, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let row =
        workflow_store::create_workflow(&db, payload.name, payload.definition, payload.active)
            .map_err(|e| e.to_string())?;
    emit_changed(
        &app,
        "workflow_created",
        Some(row.workflow_id.as_str()),
        None,
    );
    Ok(row)
}

#[tauri::command]
pub fn cmd_a2a_workflow_update(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: A2AWorkflowUpdatePayload,
) -> Result<Option<workflow_store::A2AWorkflowRecord>, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let updated = workflow_store::update_workflow(
        &db,
        payload.workflow_id.trim(),
        payload.name,
        payload.definition,
        payload.active,
    )
    .map_err(|e| e.to_string())?;
    if let Some(ref row) = updated {
        emit_changed(
            &app,
            "workflow_updated",
            Some(row.workflow_id.as_str()),
            None,
        );
    }
    Ok(updated)
}

#[tauri::command]
pub fn cmd_a2a_workflow_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
) -> Result<bool, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let deleted =
        workflow_store::delete_workflow(&db, workflow_id.trim()).map_err(|e| e.to_string())?;
    if deleted {
        emit_changed(&app, "workflow_deleted", Some(workflow_id.trim()), None);
    }
    Ok(deleted)
}

#[tauri::command]
pub fn cmd_a2a_workflow_run_list(
    state: State<'_, AppState>,
    workflow_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<workflow_store::A2AWorkflowRunRecord>, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    workflow_store::list_runs(&db, workflow_id.as_deref(), limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_a2a_workflow_run_get(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<Option<A2AWorkflowRunDetail>, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let Some(run) = workflow_store::get_run(&db, run_id.trim()).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let node_runs =
        workflow_store::list_node_runs(&db, run_id.trim()).map_err(|e| e.to_string())?;
    Ok(Some(A2AWorkflowRunDetail { run, node_runs }))
}

#[tauri::command]
pub fn cmd_a2a_node_type_list() -> Result<Vec<A2ANodeTypeDef>, String> {
    Ok(node_type_defs())
}

#[tauri::command]
pub fn cmd_a2a_workflow_preflight(
    definition: A2AWorkflowDefinition,
) -> Result<A2AWorkflowPreflightResult, String> {
    Ok(preflight_workflow_definition(&definition))
}

#[tauri::command]
pub async fn cmd_a2a_workflow_run_start(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: A2AWorkflowRunStartPayload,
) -> Result<workflow_store::A2AWorkflowRunRecord, String> {
    let trigger = if payload.trigger_type.trim().is_empty() {
        "manual".to_string()
    } else {
        payload.trigger_type
    };
    let timeout_ms = payload.timeout_ms.unwrap_or(60_000).max(1_000);

    let workflow = {
        let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
        let Some(workflow) = workflow_store::get_workflow(&db, payload.workflow_id.trim())
            .map_err(|e| e.to_string())?
        else {
            return Err(format!("Workflow not found: {}", payload.workflow_id));
        };
        workflow
    };

    let definition: A2AWorkflowDefinition =
        serde_json::from_str(&workflow.definition_json).map_err(|e| e.to_string())?;
    let preflight = preflight_workflow_definition(&definition);
    if !preflight.ok {
        let msg = preflight
            .issues
            .iter()
            .filter(|i| i.blocking)
            .map(|i| i.message.clone())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("Workflow preflight failed: {msg}"));
    }
    let _permit = acquire_run_permit(workflow.workflow_id.as_str())?;
    let run = {
        let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
        workflow_store::create_run(
            &db,
            workflow.workflow_id.as_str(),
            trigger.as_str(),
            payload.input.to_string(),
        )
        .map_err(|e| e.to_string())?
    };
    emit_changed(
        &app,
        "run_started",
        Some(workflow.workflow_id.as_str()),
        Some(run.run_id.as_str()),
    );

    let input_items = as_input_items(&payload.input);
    let run_id = run.run_id.clone();
    let workflow_id = workflow.workflow_id.clone();
    let metrics_json = json!({
        "node_count": definition.nodes.len(),
        "edge_count": definition.edges.len(),
        "timeout_ms": timeout_ms
    })
    .to_string();
    let run_control = RunControl::new();
    if let Err(e) = set_run_control(run_id.as_str(), run_control) {
        let db = state
            .a2a_db
            .lock()
            .map_err(|lock_err| lock_err.to_string())?;
        workflow_store::set_run_status(
            &db,
            run_id.as_str(),
            "failed",
            Some(format!("Failed to initialize run control: {e}")),
            None,
            Some(metrics_json.clone()),
        )
        .map_err(|status_err| status_err.to_string())?;
        return Err(e);
    }
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let _permit = _permit;
        let state_ref = app_clone.state::<AppState>();
        let execute_result = execute_workflow_run(
            &app_clone,
            &state_ref,
            run_id.as_str(),
            &definition,
            input_items,
            timeout_ms,
        )
        .await;

        let db = match state_ref.a2a_db.lock() {
            Ok(db) => db,
            Err(e) => {
                log::error!("Failed to lock a2a_db for run finalization: {}", e);
                remove_run_control(run_id.as_str());
                return;
            }
        };

        match execute_result {
            Ok(out_items) => {
                let output_json = match serde_json::to_string(&out_items) {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!("Failed to serialize workflow output: {}", e);
                        String::new()
                    }
                };
                let _ = workflow_store::set_run_status(
                    &db,
                    run_id.as_str(),
                    "succeeded",
                    None,
                    Some(output_json),
                    Some(metrics_json.clone()),
                );
            }
            Err(err) => {
                let current = workflow_store::get_run(&db, run_id.as_str()).ok().flatten();
                if current
                    .as_ref()
                    .map(|r| r.status.as_str() == "canceled")
                    .unwrap_or(false)
                {
                    let _ = workflow_store::set_run_status(
                        &db,
                        run_id.as_str(),
                        "canceled",
                        Some(err),
                        None,
                        Some(metrics_json.clone()),
                    );
                } else {
                    let status = if err.to_ascii_lowercase().contains("timed out") {
                        "timed_out"
                    } else if err.to_ascii_lowercase().contains("canceled") {
                        "canceled"
                    } else {
                        "failed"
                    };
                    let _ = workflow_store::set_run_status(
                        &db,
                        run_id.as_str(),
                        status,
                        Some(err),
                        None,
                        Some(metrics_json.clone()),
                    );
                }
            }
        }
        drop(db);
        remove_run_control(run_id.as_str());
        emit_changed(
            &app_clone,
            "run_finished",
            Some(workflow_id.as_str()),
            Some(run_id.as_str()),
        );
    });

    Ok(run)
}

#[tauri::command]
pub async fn cmd_a2a_workflow_node_test(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: A2AWorkflowNodeTestPayload,
) -> Result<HashMap<String, Vec<A2AExecutionItem>>, String> {
    let ctx = NodeContext {
        items_by_name: HashMap::new(),
    };
    execute_node(
        &app,
        &state,
        None,
        &payload.node,
        &payload.input_items,
        &ctx,
    )
    .await
}

#[tauri::command]
pub fn cmd_a2a_workflow_run_cancel(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<bool, String> {
    let run_id = run_id.trim().to_string();
    if run_id.is_empty() {
        return Err("run_id is required".to_string());
    }

    let control = get_run_control(&run_id);
    if let Some(ctrl) = control {
        ctrl.cancelled.store(true, Ordering::SeqCst);
        ctrl.paused.store(false, Ordering::SeqCst);
    }

    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let run = workflow_store::get_run(&db, &run_id).map_err(|e| e.to_string())?;
    let Some(run) = run else {
        return Ok(false);
    };
    if matches!(
        run.status.as_str(),
        "succeeded" | "failed" | "canceled" | "timed_out"
    ) {
        return Ok(false);
    }
    workflow_store::set_run_status(
        &db,
        &run_id,
        "canceled",
        Some("Canceled by user".to_string()),
        None,
        None,
    )
    .map_err(|e| e.to_string())?;
    emit_changed(
        &app,
        "run_canceled",
        Some(run.workflow_id.as_str()),
        Some(run_id.as_str()),
    );
    Ok(true)
}

#[tauri::command]
pub fn cmd_a2a_workflow_run_pause(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<bool, String> {
    let run_id = run_id.trim().to_string();
    if run_id.is_empty() {
        return Err("run_id is required".to_string());
    }

    let control = get_run_control(&run_id);
    let Some(ctrl) = control else {
        return Ok(false);
    };
    ctrl.paused.store(true, Ordering::SeqCst);

    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let run = workflow_store::get_run(&db, &run_id).map_err(|e| e.to_string())?;
    let Some(run) = run else {
        return Ok(false);
    };
    if run.status != "running" {
        return Ok(false);
    }
    workflow_store::set_run_status(&db, &run_id, "paused", None, None, None)
        .map_err(|e| e.to_string())?;
    emit_changed(
        &app,
        "run_paused",
        Some(run.workflow_id.as_str()),
        Some(run_id.as_str()),
    );
    Ok(true)
}

#[tauri::command]
pub fn cmd_a2a_workflow_run_resume(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<bool, String> {
    let run_id = run_id.trim().to_string();
    if run_id.is_empty() {
        return Err("run_id is required".to_string());
    }

    let control = get_run_control(&run_id);
    let Some(ctrl) = control else {
        return Ok(false);
    };
    ctrl.paused.store(false, Ordering::SeqCst);

    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let run = workflow_store::get_run(&db, &run_id).map_err(|e| e.to_string())?;
    let Some(run) = run else {
        return Ok(false);
    };
    if run.status != "paused" {
        return Ok(false);
    }
    workflow_store::set_run_status(&db, &run_id, "running", None, None, None)
        .map_err(|e| e.to_string())?;
    emit_changed(
        &app,
        "run_resumed",
        Some(run.workflow_id.as_str()),
        Some(run_id.as_str()),
    );
    Ok(true)
}

#[tauri::command]
pub fn cmd_a2a_credential_list(
    state: State<'_, AppState>,
) -> Result<Vec<workflow_store::A2ACredentialRecord>, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    workflow_store::list_credentials(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_a2a_credential_create(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: A2ACredentialCreatePayload,
) -> Result<workflow_store::A2ACredentialRecord, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let row = workflow_store::create_credential(
        &db,
        payload.name,
        payload.kind,
        payload.data.to_string(),
    )
    .map_err(|e| e.to_string())?;
    emit_changed(&app, "credential_created", None, None);
    Ok(row)
}

#[tauri::command]
pub fn cmd_a2a_credential_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    credential_id: String,
) -> Result<bool, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let deleted =
        workflow_store::delete_credential(&db, credential_id.trim()).map_err(|e| e.to_string())?;
    if deleted {
        emit_changed(&app, "credential_deleted", None, None);
    }
    Ok(deleted)
}

#[tauri::command]
pub fn cmd_a2a_template_list(
    state: State<'_, AppState>,
) -> Result<Vec<workflow_store::A2ATemplateRecord>, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    workflow_store::list_templates(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_a2a_template_create(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: A2ATemplateCreatePayload,
) -> Result<workflow_store::A2ATemplateRecord, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let row = workflow_store::create_template(&db, payload.name, payload.definition)
        .map_err(|e| e.to_string())?;
    emit_changed(&app, "template_created", None, None);
    Ok(row)
}

#[tauri::command]
pub fn cmd_a2a_template_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    template_id: String,
) -> Result<bool, String> {
    let db = state.a2a_db.lock().map_err(|e| e.to_string())?;
    let deleted =
        workflow_store::delete_template(&db, template_id.trim()).map_err(|e| e.to_string())?;
    if deleted {
        emit_changed(&app, "template_deleted", None, None);
    }
    Ok(deleted)
}
