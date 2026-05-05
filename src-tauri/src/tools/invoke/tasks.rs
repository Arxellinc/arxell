#![cfg(feature = "tauri-runtime")]

use crate::app::tasks_service::{DurableNotificationRecord, DurableTaskRecord, DurableTaskRunRecord};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertNotificationRequest {
    notification: DurableNotificationRecord,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkNotificationReadRequest {
    id: String,
    read: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DismissNotificationRequest {
    id: String,
}

pub fn register(registry: &mut InvokeRegistry) {
    registry.register("tasks", &["list"], list_tasks_handler);
    registry.register("tasks", &["upsert"], upsert_task_handler);
    registry.register("tasks", &["delete"], delete_task_handler);
    registry.register("tasks", &["run-now", "runNow"], run_task_now_handler);
    registry.register("tasks", &["list-runs", "listRuns"], list_task_runs_handler);
    registry.register("tasks", &["notifications-list", "notificationsList"], list_notifications_handler);
    registry.register("tasks", &["notifications-upsert", "notificationsUpsert"], upsert_notification_handler);
    registry.register("tasks", &["notifications-mark-read", "notificationsMarkRead"], mark_notification_read_handler);
    registry.register("tasks", &["notifications-dismiss", "notificationsDismiss"], dismiss_notification_handler);
    registry.register("tasks", &["scheduler-status", "schedulerStatus"], scheduler_status_handler);
    registry.register("tasks", &["scheduler-run-due-now", "schedulerRunDueNow"], scheduler_run_due_now_handler);
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

fn list_notifications_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(list_notifications(state, payload))
}

fn upsert_notification_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(upsert_notification(state, payload))
}

fn mark_notification_read_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(mark_notification_read(state, payload))
}

fn dismiss_notification_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(dismiss_notification(state, payload))
}

fn scheduler_status_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(scheduler_status(state, payload))
}

fn scheduler_run_due_now_handler(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    Box::pin(scheduler_run_due_now(state, payload))
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
    let task_id = req.task_id.clone();
    let run = DurableTaskRunRecord {
        id: format!("R{}", now),
        task_id,
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
    let _ = emit_task_run_notification(state, &task, appended.status.as_str(), appended.error.as_str(), "manual", now);
    let _ = state.tasks.advance_next_run_at(req.task_id.as_str(), now);
    Ok(json!({ "run": appended }))
}

pub async fn run_due_scheduled_tasks(state: &TauriBridgeState, limit: usize) -> Result<usize, String> {
    let now = now_ms();
    let due = state.tasks.list_due_scheduled_tasks(now, limit)?;
    if due.is_empty() {
        return Ok(0);
    }
    let mut executed = 0usize;
    for task in due {
        let canonical_root = match resolve_project_root(task.project_id.as_str()) {
            Ok(root) => root,
            Err(_) => {
                let _ = state.tasks.advance_next_run_at(task.id.as_str(), now);
                continue;
            }
        };
        let (status, policy_decision, policy_reason, result_json, error) =
            execute_task_payload(state, &task, canonical_root.as_path()).await;
        let run = DurableTaskRunRecord {
            id: format!("R{}{}", now, executed),
            task_id: task.id.clone(),
            status,
            trigger_reason: "scheduled".to_string(),
            policy_decision,
            policy_reason,
            result_json,
            error,
            created_at_ms: now,
            started_at_ms: Some(now),
            completed_at_ms: Some(now),
        };
        let _ = state.tasks.append_run(run.clone());
        let _ = emit_task_run_notification(
            state,
            &task,
            run.status.as_str(),
            run.error.as_str(),
            "scheduled",
            now,
        );
        let _ = state.tasks.advance_next_run_at(task.id.as_str(), now);
        executed += 1;
    }
    Ok(executed)
}

fn emit_task_run_notification(
    state: &TauriBridgeState,
    task: &DurableTaskRecord,
    status: &str,
    error: &str,
    trigger_reason: &str,
    now: i64,
) -> Result<(), String> {
    let (title, tone) = match status {
        "succeeded" => (format!("Task complete: {}", task.name), "success"),
        "blocked" => (format!("Task blocked: {}", task.name), "warning"),
        _ => (format!("Task failed: {}", task.name), "error"),
    };
    let mut description = format!("{} run for task {}.", trigger_reason, task.id);
    if !error.trim().is_empty() {
        description.push(' ');
        description.push_str(error.trim());
    }
    let row = DurableNotificationRecord {
        id: format!("N{}{}", now, task.id),
        title,
        description,
        tone: tone.to_string(),
        read: false,
        actions_json: json!([
            { "id": format!("open-task:{}", task.id), "label": "Open Task" }
        ]),
        created_at_ms: now,
        updated_at_ms: now,
    };
    let _ = state.tasks.upsert_notification(row)?;
    Ok(())
}

async fn scheduler_status(state: &TauriBridgeState, _payload: Value) -> Result<Value, String> {
    let now = now_ms();
    let due = state.tasks.list_due_scheduled_tasks(now, 1000)?;
    Ok(json!({
        "nowMs": now,
        "dueCount": due.len(),
        "sampleTaskIds": due.iter().take(10).map(|t| t.id.clone()).collect::<Vec<String>>()
    }))
}

async fn scheduler_run_due_now(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let limit = payload
        .get("limit")
        .and_then(Value::as_u64)
        .map(|v| v as usize)
        .unwrap_or(16)
        .clamp(1, 256);
    let executed = run_due_scheduled_tasks(state, limit).await?;
    Ok(json!({ "executed": executed, "limit": limit, "nowMs": now_ms() }))
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
    use crate::app::tasks_service::DurableTaskRecord;
    use crate::app::AppContext;
    use super::{now_ms, resolve_candidate_path, validate_files_payload_in_scope};
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

    #[tokio::test]
    async fn scheduled_due_run_creates_run_and_notification() {
        let tmp = std::env::temp_dir().join(format!(
            "arxell-scheduler-integration-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&tmp).expect("create test dir");
        let db_path = tmp.join("tasks.sqlite3");
        std::env::set_var("ARXELL_TASKS_DB_PATH", db_path.to_string_lossy().to_string());

        let app = AppContext::new().expect("app context");
        let state = app.tauri_bridge_state();
        let now = now_ms();
        let task = DurableTaskRecord {
            id: "T-SCHED-INT-1".to_string(),
            project_id: std::env::current_dir()
                .expect("cwd")
                .canonicalize()
                .expect("canonical cwd")
                .to_string_lossy()
                .to_string(),
            name: "Integration scheduled reminder".to_string(),
            description: "test".to_string(),
            task_type: "write".to_string(),
            agent_owner: "agent".to_string(),
            state: "approved".to_string(),
            risk_level: "low".to_string(),
            payload_kind: "agent_prompt".to_string(),
            payload_json: json!({}),
            estimate_json: json!({}),
            scheduled_at_ms: Some(now - 10_000),
            repeat: "none".to_string(),
            repeat_time_of_day_ms: None,
            repeat_timezone: "UTC".to_string(),
            is_schedule_enabled: true,
            next_run_at_ms: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        let saved = state.tasks.upsert_task(task).expect("upsert task");
        let executed = super::run_due_scheduled_tasks(&state, 16)
            .await
            .expect("run due tasks");
        assert_eq!(executed, 1);
        let runs = state.tasks.list_runs(saved.id.as_str()).expect("list runs");
        assert!(runs.iter().any(|row| row.trigger_reason == "scheduled"));
        let notifs = state.tasks.list_notifications().expect("list notifications");
        assert!(notifs.iter().any(|n| n.title.contains("Task complete") || n.title.contains("Task failed") || n.title.contains("Task blocked")));

        std::env::remove_var("ARXELL_TASKS_DB_PATH");
        let _ = fs::remove_file(db_path);
        let _ = fs::remove_dir_all(tmp);
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

async fn list_notifications(state: &TauriBridgeState, _payload: Value) -> Result<Value, String> {
    let rows = state.tasks.list_notifications()?;
    Ok(json!({ "notifications": rows }))
}

async fn upsert_notification(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let req: UpsertNotificationRequest = decode_payload(payload)?;
    let row = state.tasks.upsert_notification(req.notification)?;
    Ok(json!({ "notification": row }))
}

async fn mark_notification_read(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let req: MarkNotificationReadRequest = decode_payload(payload)?;
    let changed = state.tasks.mark_notification_read(req.id.as_str(), req.read)?;
    Ok(json!({ "updated": changed }))
}

async fn dismiss_notification(state: &TauriBridgeState, payload: Value) -> Result<Value, String> {
    let req: DismissNotificationRequest = decode_payload(payload)?;
    let deleted = state.tasks.dismiss_notification(req.id.as_str())?;
    Ok(json!({ "deleted": deleted }))
}
