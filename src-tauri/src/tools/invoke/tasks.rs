#![cfg(feature = "tauri-runtime")]

use crate::app::tasks_service::{DurableTaskRecord, DurableTaskRunRecord};
use crate::ipc::tauri_bridge::TauriBridgeState;
use crate::tools::invoke::build_registry;
use crate::tools::invoke::registry::{InvokeRegistry, ToolInvokeFuture};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListTasksRequest {
    project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertTaskRequest {
    task: DurableTaskRecord,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteTaskRequest {
    task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunTaskNowRequest {
    task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListTaskRunsRequest {
    task_id: String,
}

pub fn register(registry: &mut InvokeRegistry) {
    registry.register("tasks", &["list"], list_tasks_handler);
    registry.register("tasks", &["upsert"], upsert_task_handler);
    registry.register("tasks", &["delete"], delete_task_handler);
    registry.register("tasks", &["run-now", "runNow"], run_task_now_handler);
    registry.register("tasks", &["list-runs", "listRuns"], list_task_runs_handler);
}

fn list_tasks_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(list_tasks(state, payload))
}

fn upsert_task_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(upsert_task(state, payload))
}

fn delete_task_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(delete_task(state, payload))
}

fn run_task_now_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(run_task_now(state, payload))
}

fn list_task_runs_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(list_task_runs(state, payload))
}

async fn list_tasks(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let req: ListTasksRequest = decode_payload(payload)?;
    let tasks = state.tasks.list_tasks(req.project_id.as_deref())?;
    Ok(json!({ "tasks": tasks }))
}

async fn upsert_task(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let req: UpsertTaskRequest = decode_payload(payload)?;
    validate_task_state(req.task.state.as_str())?;
    validate_risk_level(req.task.risk_level.as_str())?;
    let task = state.tasks.upsert_task(req.task)?;
    Ok(json!({ "task": task }))
}

async fn delete_task(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let req: DeleteTaskRequest = decode_payload(payload)?;
    let deleted = state.tasks.delete_task(req.task_id.as_str())?;
    Ok(json!({ "deleted": deleted }))
}

async fn run_task_now(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let req: RunTaskNowRequest = decode_payload(payload)?;
    let Some(task) = state.tasks.get_task(req.task_id.as_str())? else {
        return Err("task not found".to_string());
    };
    if task.state != "approved" {
        return Err("task must be approved before run".to_string());
    }
    let canonical_root = resolve_project_root(task.project_id.as_str())?;
    let now = now_ms();
    let (status, policy_decision, policy_reason, result_json, error) =
        execute_task_payload(state, &task, canonical_root.as_path()).await;
    let run = DurableTaskRunRecord {
        id: format!("R{}", now),
        task_id: req.task_id,
        status,
        trigger_reason: "manual".to_string(),
        policy_decision,
        policy_reason,
        result_json,
        error,
        created_at_ms: now,
        started_at_ms: Some(now),
        completed_at_ms: Some(now),
    };
    let appended = state.tasks.append_run(run)?;
    Ok(json!({ "run": appended }))
}

async fn execute_task_payload(
    state: &TauriBridgeState,
    task: &DurableTaskRecord,
    canonical_root: &Path,
) -> (String, String, String, Value, String) {
    if task.risk_level != "low" {
        return (
            "blocked".to_string(),
            "deny".to_string(),
            "risk_not_low".to_string(),
            json!({}),
            "auto-safe allows low-risk tasks only".to_string(),
        );
    }
    match task.payload_kind.as_str() {
        "agent_prompt" => (
            "succeeded".to_string(),
            "allow".to_string(),
            "agent_prompt_placeholder".to_string(),
            json!({ "note": "Agent prompt run recorded." }),
            String::new(),
        ),
        "tool_invoke" => run_tool_invoke_payload(state, task, canonical_root).await,
        "looper_run" => run_looper_payload(state, task, canonical_root).await,
        _ => (
            "failed".to_string(),
            "deny".to_string(),
            "unsupported_payload_kind".to_string(),
            json!({}),
            format!("unsupported payload kind: {}", task.payload_kind),
        ),
    }
}

async fn run_tool_invoke_payload(
    state: &TauriBridgeState,
    task: &DurableTaskRecord,
    canonical_root: &Path,
) -> (String, String, String, Value, String) {
    let tool_id = task
        .payload_json
        .get("toolId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let action = task
        .payload_json
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let payload = task
        .payload_json
        .get("payload")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if tool_id.is_empty() || action.is_empty() {
        return (
            "failed".to_string(),
            "deny".to_string(),
            "invalid_tool_payload".to_string(),
            json!({}),
            "tool_invoke payload must include toolId and action".to_string(),
        );
    }
    if tool_id == "files" {
        if let Err(err) = validate_files_payload_in_scope(&payload, canonical_root) {
            return (
                "blocked".to_string(),
                "deny".to_string(),
                "project_scope_violation".to_string(),
                json!({}),
                err,
            );
        }
    }
    let registry = build_registry();
    let Some(handler) = registry.get(tool_id.as_str(), action.as_str()) else {
        return (
            "failed".to_string(),
            "deny".to_string(),
            "unsupported_tool_action".to_string(),
            json!({}),
            format!("unsupported tool invoke target: {}.{}", tool_id, action),
        );
    };
    match handler(state, payload).await {
        Ok(data) => (
            "succeeded".to_string(),
            "allow".to_string(),
            "tool_invoke".to_string(),
            data,
            String::new(),
        ),
        Err(err) => (
            "failed".to_string(),
            "allow".to_string(),
            "tool_invoke".to_string(),
            json!({}),
            err,
        ),
    }
}

async fn run_looper_payload(
    state: &TauriBridgeState,
    task: &DurableTaskRecord,
    canonical_root: &Path,
) -> (String, String, String, Value, String) {
    let payload = task
        .payload_json
        .get("payload")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
        match resolve_candidate_path(cwd) {
            Ok(candidate) if candidate.starts_with(canonical_root) => {}
            Ok(candidate) => {
                return (
                    "blocked".to_string(),
                    "deny".to_string(),
                    "project_scope_violation".to_string(),
                    json!({}),
                    format!(
                        "looper cwd '{}' is outside project root '{}'",
                        candidate.display(),
                        canonical_root.display()
                    ),
                )
            }
            Err(err) => {
                return (
                    "blocked".to_string(),
                    "deny".to_string(),
                    "project_scope_violation".to_string(),
                    json!({}),
                    err,
                )
            }
        }
    }
    let registry = build_registry();
    let Some(handler) = registry.get("looper", "start") else {
        return (
            "failed".to_string(),
            "deny".to_string(),
            "looper_unavailable".to_string(),
            json!({}),
            "looper.start handler unavailable".to_string(),
        );
    };
    match handler(state, payload).await {
        Ok(data) => (
            "succeeded".to_string(),
            "allow".to_string(),
            "looper_run".to_string(),
            data,
            String::new(),
        ),
        Err(err) => (
            "failed".to_string(),
            "allow".to_string(),
            "looper_run".to_string(),
            json!({}),
            err,
        ),
    }
}

fn validate_files_payload_in_scope(payload: &Value, project_root: &Path) -> Result<(), String> {
    let canonical_root = project_root
        .canonicalize()
        .map_err(|e| format!("failed canonicalizing project root: {e}"))?;
    let keys = ["path", "from", "to", "targetDirectory"];
    for key in keys {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            let candidate = resolve_candidate_path(value)?;
            if !candidate.starts_with(canonical_root.as_path()) {
                return Err(format!(
                    "file path '{}' is outside project root '{}'",
                    candidate.display(),
                    canonical_root.display()
                ));
            }
        }
    }
    Ok(())
}

fn resolve_candidate_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|e| format!("failed reading current dir: {e}"))?
            .join(path)
    };
    if absolute.exists() {
        return absolute
            .canonicalize()
            .map_err(|e| format!("failed canonicalizing path: {e}"));
    }
    let parent = absolute
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("failed canonicalizing parent path: {e}"))?;
    let name = absolute
        .file_name()
        .ok_or_else(|| "path has no filename".to_string())?;
    Ok(canonical_parent.join(name))
}

fn resolve_project_root(raw: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(raw);
    if !root.is_absolute() {
        return Err("project root must be absolute".to_string());
    }
    if !root.exists() {
        return Err("project root does not exist".to_string());
    }
    root.canonicalize()
        .map_err(|e| format!("failed canonicalizing project root: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{resolve_candidate_path, validate_files_payload_in_scope};
    use serde_json::json;
    use std::fs;

    #[test]
    fn validates_path_within_project_root() {
        let tmp = std::env::temp_dir().join(format!(
            "arxell-tasks-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let root = tmp.join("project");
        let files = root.join("files");
        fs::create_dir_all(&files).expect("create test dirs");
        let payload = json!({ "path": files.join("todo.md").to_string_lossy().to_string() });
        let result = validate_files_payload_in_scope(&payload, root.as_path());
        let _ = fs::remove_dir_all(&tmp);
        assert!(result.is_ok());
    }

    #[test]
    fn blocks_path_outside_project_root() {
        let tmp = std::env::temp_dir().join(format!(
            "arxell-tasks-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let root = tmp.join("project");
        let outside = tmp.join("outside");
        fs::create_dir_all(&root).expect("create project root");
        fs::create_dir_all(&outside).expect("create outside dir");
        let payload = json!({ "path": outside.join("todo.md").to_string_lossy().to_string() });
        let result = validate_files_payload_in_scope(&payload, root.as_path());
        let _ = fs::remove_dir_all(&tmp);
        assert!(result.is_err());
    }

    #[test]
    fn resolves_relative_path() {
        let resolved = resolve_candidate_path(".");
        assert!(resolved.is_ok());
    }
}

async fn list_task_runs(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let req: ListTaskRunsRequest = decode_payload(payload)?;
    let runs = state.tasks.list_runs(req.task_id.as_str())?;
    Ok(json!({ "runs": runs }))
}

fn decode_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|e| format!("invalid tasks payload: {e}"))
}

fn validate_task_state(state: &str) -> Result<(), String> {
    match state {
        "draft" | "approved" | "complete" | "rejected" => Ok(()),
        _ => Err(format!("invalid task state: {state}")),
    }
}

fn validate_risk_level(risk_level: &str) -> Result<(), String> {
    match risk_level {
        "low" | "medium" | "high" => Ok(()),
        _ => Err(format!("invalid risk level: {risk_level}")),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
