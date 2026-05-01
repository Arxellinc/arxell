use crate::app_paths;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableTaskRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub task_type: String,
    pub agent_owner: String,
    pub state: String,
    pub risk_level: String,
    pub payload_kind: String,
    pub payload_json: Value,
    pub estimate_json: Value,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableTaskRunRecord {
    pub id: String,
    pub task_id: String,
    pub status: String,
    pub trigger_reason: String,
    pub policy_decision: String,
    pub policy_reason: String,
    pub result_json: Value,
    pub error: String,
    pub created_at_ms: i64,
    pub started_at_ms: Option<i64>,
    pub completed_at_ms: Option<i64>,
}

pub struct TaskAutomationService {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl TaskAutomationService {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("failed creating tasks db dir: {e}"))?;
        }
        let conn = Connection::open(&path).map_err(|e| format!("failed opening tasks db: {e}"))?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS durable_tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                task_type TEXT NOT NULL,
                agent_owner TEXT NOT NULL,
                state TEXT NOT NULL,
                risk_level TEXT NOT NULL,
                payload_kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                estimate_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_durable_tasks_project_state ON durable_tasks(project_id, state);

            CREATE TABLE IF NOT EXISTS durable_task_runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                status TEXT NOT NULL,
                trigger_reason TEXT NOT NULL,
                policy_decision TEXT NOT NULL,
                policy_reason TEXT NOT NULL,
                result_json TEXT NOT NULL,
                error TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER,
                FOREIGN KEY(task_id) REFERENCES durable_tasks(id)
            );
            CREATE INDEX IF NOT EXISTS idx_durable_task_runs_task_created ON durable_task_runs(task_id, created_at_ms DESC);
            "#,
        )
        .map_err(|e| format!("failed initializing tasks schema: {e}"))?;
        Ok(Self {
            path,
            write_lock: Mutex::new(()),
        })
    }

    pub fn default_path() -> PathBuf {
        if let Ok(raw) = std::env::var("ARXELL_TASKS_DB_PATH") {
            return PathBuf::from(raw);
        }
        app_paths::app_data_dir().join("tasks.sqlite3")
    }

    fn open_connection(&self) -> Result<Connection, String> {
        Connection::open(&self.path).map_err(|e| format!("failed opening tasks db: {e}"))
    }

    pub fn list_tasks(&self, project_id: Option<&str>) -> Result<Vec<DurableTaskRecord>, String> {
        let conn = self.open_connection()?;
        let mut out = Vec::new();
        if let Some(project) = project_id {
            let mut stmt = conn
                .prepare(
                    "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, created_at_ms, updated_at_ms FROM durable_tasks WHERE project_id = ?1 ORDER BY updated_at_ms DESC",
                )
                .map_err(|e| format!("failed preparing list_tasks query: {e}"))?;
            let rows = stmt
                .query_map(params![project], row_to_task)
                .map_err(|e| format!("failed querying tasks: {e}"))?;
            for row in rows {
                out.push(row.map_err(|e| format!("failed reading task row: {e}"))?);
            }
            return Ok(out);
        }
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, created_at_ms, updated_at_ms FROM durable_tasks ORDER BY updated_at_ms DESC",
            )
            .map_err(|e| format!("failed preparing list_tasks query: {e}"))?;
        let rows = stmt
            .query_map([], row_to_task)
            .map_err(|e| format!("failed querying tasks: {e}"))?;
        for row in rows {
            out.push(row.map_err(|e| format!("failed reading task row: {e}"))?);
        }
        Ok(out)
    }

    pub fn upsert_task(&self, task: DurableTaskRecord) -> Result<DurableTaskRecord, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        let now = now_ms();
        let created = if task.created_at_ms > 0 { task.created_at_ms } else { now };
        let updated = if task.updated_at_ms > 0 { task.updated_at_ms } else { now };
        let normalized_state = if task.state == "draft" && task.risk_level == "low" {
            "approved".to_string()
        } else {
            task.state.clone()
        };
        let payload_json = serde_json::to_string(&task.payload_json)
            .map_err(|e| format!("failed serializing task payload: {e}"))?;
        let estimate_json = serde_json::to_string(&task.estimate_json)
            .map_err(|e| format!("failed serializing task estimate: {e}"))?;
        conn.execute(
            "INSERT INTO durable_tasks (id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
               project_id = excluded.project_id,
               name = excluded.name,
               description = excluded.description,
               task_type = excluded.task_type,
               agent_owner = excluded.agent_owner,
               state = excluded.state,
               risk_level = excluded.risk_level,
               payload_kind = excluded.payload_kind,
               payload_json = excluded.payload_json,
               estimate_json = excluded.estimate_json,
               updated_at_ms = excluded.updated_at_ms",
            params![
                task.id,
                task.project_id,
                task.name,
                task.description,
                task.task_type,
                task.agent_owner,
                normalized_state,
                task.risk_level,
                task.payload_kind,
                payload_json,
                estimate_json,
                created,
                updated,
            ],
        )
        .map_err(|e| format!("failed upserting task: {e}"))?;
        Ok(DurableTaskRecord {
            created_at_ms: created,
            updated_at_ms: updated,
            state: normalized_state,
            ..task
        })
    }

    pub fn get_task(&self, task_id: &str) -> Result<Option<DurableTaskRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, created_at_ms, updated_at_ms FROM durable_tasks WHERE id = ?1 LIMIT 1",
            )
            .map_err(|e| format!("failed preparing get_task query: {e}"))?;
        let mut rows = stmt
            .query(params![task_id])
            .map_err(|e| format!("failed querying task: {e}"))?;
        let Some(row) = rows.next().map_err(|e| format!("failed reading task row: {e}"))? else {
            return Ok(None);
        };
        let task = row_to_task(row).map_err(|e| format!("failed mapping task row: {e}"))?;
        Ok(Some(task))
    }

    pub fn delete_task(&self, task_id: &str) -> Result<bool, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        conn.execute("DELETE FROM durable_task_runs WHERE task_id = ?1", params![task_id])
            .map_err(|e| format!("failed deleting task runs: {e}"))?;
        let changed = conn
            .execute("DELETE FROM durable_tasks WHERE id = ?1", params![task_id])
            .map_err(|e| format!("failed deleting task: {e}"))?;
        Ok(changed > 0)
    }

    pub fn append_run(&self, run: DurableTaskRunRecord) -> Result<DurableTaskRunRecord, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        let result_json = serde_json::to_string(&run.result_json)
            .map_err(|e| format!("failed serializing run result: {e}"))?;
        conn.execute(
            "INSERT INTO durable_task_runs (id, task_id, status, trigger_reason, policy_decision, policy_reason, result_json, error, created_at_ms, started_at_ms, completed_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                run.id,
                run.task_id,
                run.status,
                run.trigger_reason,
                run.policy_decision,
                run.policy_reason,
                result_json,
                run.error,
                run.created_at_ms,
                run.started_at_ms,
                run.completed_at_ms,
            ],
        )
        .map_err(|e| format!("failed appending run: {e}"))?;
        Ok(run)
    }

    pub fn list_runs(&self, task_id: &str) -> Result<Vec<DurableTaskRunRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, status, trigger_reason, policy_decision, policy_reason, result_json, error, created_at_ms, started_at_ms, completed_at_ms
                 FROM durable_task_runs
                 WHERE task_id = ?1
                 ORDER BY created_at_ms DESC",
            )
            .map_err(|e| format!("failed preparing list_runs query: {e}"))?;
        let rows = stmt
            .query_map(params![task_id], |row| {
                let result_json_raw: String = row.get(6)?;
                let result_json = serde_json::from_str::<Value>(&result_json_raw)
                    .unwrap_or_else(|_| Value::Object(Default::default()));
                Ok(DurableTaskRunRecord {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    status: row.get(2)?,
                    trigger_reason: row.get(3)?,
                    policy_decision: row.get(4)?,
                    policy_reason: row.get(5)?,
                    result_json,
                    error: row.get(7)?,
                    created_at_ms: row.get(8)?,
                    started_at_ms: row.get(9)?,
                    completed_at_ms: row.get(10)?,
                })
            })
            .map_err(|e| format!("failed querying runs: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("failed reading run row: {e}"))?);
        }
        Ok(out)
    }
}

fn row_to_task(row: &rusqlite::Row<'_>) -> Result<DurableTaskRecord, rusqlite::Error> {
    let payload_json_raw: String = row.get(9)?;
    let estimate_json_raw: String = row.get(10)?;
    let payload_json = serde_json::from_str::<Value>(&payload_json_raw)
        .unwrap_or_else(|_| Value::Object(Default::default()));
    let estimate_json = serde_json::from_str::<Value>(&estimate_json_raw)
        .unwrap_or_else(|_| Value::Object(Default::default()));
    Ok(DurableTaskRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        task_type: row.get(4)?,
        agent_owner: row.get(5)?,
        state: row.get(6)?,
        risk_level: row.get(7)?,
        payload_kind: row.get(8)?,
        payload_json,
        estimate_json,
        created_at_ms: row.get(11)?,
        updated_at_ms: row.get(12)?,
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{DurableTaskRecord, TaskAutomationService};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    fn temp_db_path() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "arxell-task-service-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&root);
        root.join("tasks.sqlite3")
    }

    fn base_task(state: &str, risk_level: &str) -> DurableTaskRecord {
        DurableTaskRecord {
            id: "T000001".to_string(),
            project_id: "/tmp/project".to_string(),
            name: "Task".to_string(),
            description: "Desc".to_string(),
            task_type: "code".to_string(),
            agent_owner: "agent".to_string(),
            state: state.to_string(),
            risk_level: risk_level.to_string(),
            payload_kind: "agent_prompt".to_string(),
            payload_json: json!({}),
            estimate_json: json!({}),
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn auto_approves_low_risk_draft_on_upsert() {
        let db = temp_db_path();
        let service = TaskAutomationService::new(db.clone()).expect("service");
        let task = base_task("draft", "low");
        let saved = service.upsert_task(task).expect("upsert");
        assert_eq!(saved.state, "approved");
        let _ = fs::remove_file(db);
    }

    #[test]
    fn keeps_draft_for_medium_risk() {
        let db = temp_db_path();
        let service = TaskAutomationService::new(db.clone()).expect("service");
        let task = base_task("draft", "medium");
        let saved = service.upsert_task(task).expect("upsert");
        assert_eq!(saved.state, "draft");
        let _ = fs::remove_file(db);
    }
}
