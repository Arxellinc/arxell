use crate::app_paths;
use chrono::{Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{params, Connection, TransactionBehavior};
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
    #[serde(default)]
    pub project_root: String,
    pub name: String,
    pub description: String,
    pub task_type: String,
    pub agent_owner: String,
    pub state: String,
    pub risk_level: String,
    pub payload_kind: String,
    pub payload_json: Value,
    pub estimate_json: Value,
    #[serde(default)]
    pub starred: bool,
    #[serde(default = "default_task_source")]
    pub source: String,
    pub scheduled_at_ms: Option<i64>,
    pub repeat: String,
    pub repeat_time_of_day_ms: Option<i64>,
    pub repeat_timezone: String,
    pub is_schedule_enabled: bool,
    pub next_run_at_ms: Option<i64>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableNotificationRecord {
    pub id: String,
    pub title: String,
    pub description: String,
    pub tone: String,
    pub read: bool,
    pub actions_json: Value,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

const TASK_CLAIM_LEASE_MS: i64 = 30 * 60 * 1000;

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
                project_root TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                task_type TEXT NOT NULL,
                agent_owner TEXT NOT NULL,
                state TEXT NOT NULL,
                risk_level TEXT NOT NULL,
                payload_kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                estimate_json TEXT NOT NULL,
                starred INTEGER NOT NULL DEFAULT 0,
                source TEXT NOT NULL DEFAULT 'user',
                scheduled_at_ms INTEGER,
                repeat TEXT NOT NULL DEFAULT 'none',
                repeat_time_of_day_ms INTEGER,
                repeat_timezone TEXT NOT NULL DEFAULT 'UTC',
                is_schedule_enabled INTEGER NOT NULL DEFAULT 1,
                next_run_at_ms INTEGER,
                schedule_claimed_at_ms INTEGER,
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

            CREATE TABLE IF NOT EXISTS durable_notifications (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                tone TEXT NOT NULL,
                read INTEGER NOT NULL,
                actions_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_durable_notifications_created ON durable_notifications(created_at_ms DESC);
            "#,
        )
        .map_err(|e| format!("failed initializing tasks schema: {e}"))?;
        ensure_column(
            &conn,
            "durable_tasks",
            "project_root",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_column(
            &conn,
            "durable_tasks",
            "starred",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            &conn,
            "durable_tasks",
            "source",
            "TEXT NOT NULL DEFAULT 'user'",
        )?;
        ensure_column(
            &conn,
            "durable_tasks",
            "repeat",
            "TEXT NOT NULL DEFAULT 'none'",
        )?;
        ensure_column(&conn, "durable_tasks", "repeat_time_of_day_ms", "INTEGER")?;
        ensure_column(
            &conn,
            "durable_tasks",
            "repeat_timezone",
            "TEXT NOT NULL DEFAULT 'UTC'",
        )?;
        ensure_column(
            &conn,
            "durable_tasks",
            "is_schedule_enabled",
            "INTEGER NOT NULL DEFAULT 1",
        )?;
        ensure_column(&conn, "durable_tasks", "next_run_at_ms", "INTEGER")?;
        ensure_column(&conn, "durable_tasks", "schedule_claimed_at_ms", "INTEGER")?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_durable_tasks_next_run ON durable_tasks(next_run_at_ms)",
            [],
        )
        .map_err(|e| format!("failed creating tasks next-run index: {e}"))?;
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
                    "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms, project_root, starred, source FROM durable_tasks WHERE project_id = ?1 ORDER BY updated_at_ms DESC",
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
                "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms, project_root, starred, source FROM durable_tasks ORDER BY updated_at_ms DESC",
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
        let created = if task.created_at_ms > 0 {
            task.created_at_ms
        } else {
            now
        };
        let updated = if task.updated_at_ms > 0 {
            task.updated_at_ms
        } else {
            now
        };
        let normalized_state = if task.state == "draft" && task.risk_level == "low" {
            "approved".to_string()
        } else {
            task.state.clone()
        };
        let payload_json = serde_json::to_string(&task.payload_json)
            .map_err(|e| format!("failed serializing task payload: {e}"))?;
        let estimate_json = serde_json::to_string(&task.estimate_json)
            .map_err(|e| format!("failed serializing task estimate: {e}"))?;
        let mut normalized = task.clone();
        if normalized.repeat.trim().is_empty() {
            normalized.repeat = "none".to_string();
        }
        if normalized.source != "agent" {
            normalized.source = "user".to_string();
        }
        normalized.next_run_at_ms = compute_next_run_at_ms(
            normalized.scheduled_at_ms,
            normalized.repeat.as_str(),
            normalized.repeat_time_of_day_ms,
            normalized.repeat_timezone.as_str(),
            normalized.is_schedule_enabled,
            now,
        )?;
        conn.execute(
            "INSERT INTO durable_tasks (id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms, project_root, starred, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
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
                scheduled_at_ms = excluded.scheduled_at_ms,
                repeat = excluded.repeat,
                repeat_time_of_day_ms = excluded.repeat_time_of_day_ms,
                repeat_timezone = excluded.repeat_timezone,
                is_schedule_enabled = excluded.is_schedule_enabled,
                next_run_at_ms = excluded.next_run_at_ms,
                updated_at_ms = excluded.updated_at_ms,
                project_root = excluded.project_root,
                starred = excluded.starred,
                source = excluded.source",
            params![
                normalized.id,
                normalized.project_id,
                normalized.name,
                normalized.description,
                normalized.task_type,
                normalized.agent_owner,
                normalized_state,
                normalized.risk_level,
                normalized.payload_kind,
                payload_json,
                estimate_json,
                normalized.scheduled_at_ms,
                normalized.repeat,
                normalized.repeat_time_of_day_ms,
                normalized.repeat_timezone,
                if normalized.is_schedule_enabled { 1 } else { 0 },
                normalized.next_run_at_ms,
                created,
                updated,
                normalized.project_root,
                if normalized.starred { 1 } else { 0 },
                normalized.source,
            ],
        )
        .map_err(|e| format!("failed upserting task: {e}"))?;
        Ok(DurableTaskRecord {
            created_at_ms: created,
            updated_at_ms: updated,
            state: normalized_state,
            ..normalized
        })
    }

    pub fn list_due_scheduled_tasks(
        &self,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<DurableTaskRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms
, project_root, starred, source
                 FROM durable_tasks
                 WHERE state = 'approved'
                   AND is_schedule_enabled = 1
                   AND next_run_at_ms IS NOT NULL
                   AND next_run_at_ms <= ?1
                   AND (schedule_claimed_at_ms IS NULL OR schedule_claimed_at_ms <= ?1 - ?3)
                 ORDER BY next_run_at_ms ASC
                 LIMIT ?2",
            )
            .map_err(|e| format!("failed preparing due tasks query: {e}"))?;
        let rows = stmt
            .query_map(
                params![now_ms, limit as i64, TASK_CLAIM_LEASE_MS],
                row_to_task,
            )
            .map_err(|e| format!("failed querying due tasks: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("failed reading due task row: {e}"))?);
        }
        Ok(out)
    }

    pub fn claim_due_scheduled_tasks(
        &self,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<DurableTaskRecord>, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("failed starting task claim transaction: {e}"))?;
        let claimed = {
            let mut stmt = tx
                .prepare(
                    "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms, project_root, starred, source
                     FROM durable_tasks
                     WHERE state = 'approved'
                       AND is_schedule_enabled = 1
                       AND next_run_at_ms IS NOT NULL
                       AND next_run_at_ms <= ?1
                       AND (schedule_claimed_at_ms IS NULL OR schedule_claimed_at_ms <= ?1 - ?3)
                     ORDER BY next_run_at_ms ASC
                     LIMIT ?2",
                )
                .map_err(|e| format!("failed preparing task claim query: {e}"))?;
            let rows = stmt
                .query_map(
                    params![now_ms, limit as i64, TASK_CLAIM_LEASE_MS],
                    row_to_task,
                )
                .map_err(|e| format!("failed querying claimable tasks: {e}"))?;
            let mut tasks = Vec::new();
            for row in rows {
                tasks.push(row.map_err(|e| format!("failed reading claimable task: {e}"))?);
            }
            tasks
        };
        for task in &claimed {
            tx.execute(
                "UPDATE durable_tasks SET schedule_claimed_at_ms = ?2 WHERE id = ?1",
                params![task.id, now_ms],
            )
            .map_err(|e| format!("failed claiming scheduled task: {e}"))?;
        }
        tx.commit()
            .map_err(|e| format!("failed committing task claims: {e}"))?;
        Ok(claimed)
    }

    pub fn claim_task_for_run(&self, task_id: &str, now_ms: i64) -> Result<bool, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        let changed = conn
            .execute(
                "UPDATE durable_tasks
                 SET schedule_claimed_at_ms = ?2
                 WHERE id = ?1
                   AND (schedule_claimed_at_ms IS NULL OR schedule_claimed_at_ms <= ?2 - ?3)",
                params![task_id, now_ms, TASK_CLAIM_LEASE_MS],
            )
            .map_err(|e| format!("failed claiming task run: {e}"))?;
        Ok(changed == 1)
    }

    pub fn release_task_claim(&self, task_id: &str) -> Result<(), String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        conn.execute(
            "UPDATE durable_tasks SET schedule_claimed_at_ms = NULL WHERE id = ?1",
            params![task_id],
        )
        .map_err(|e| format!("failed releasing task claim: {e}"))?;
        Ok(())
    }

    pub fn advance_next_run_at(&self, task_id: &str, now_ms: i64) -> Result<(), String> {
        let Some(task) = self.get_task(task_id)? else {
            return Ok(());
        };
        let next = if task.repeat == "none" {
            None
        } else {
            compute_next_run_at_ms(
                task.scheduled_at_ms,
                task.repeat.as_str(),
                task.repeat_time_of_day_ms,
                task.repeat_timezone.as_str(),
                task.is_schedule_enabled,
                now_ms,
            )?
        };
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        conn.execute(
            "UPDATE durable_tasks SET next_run_at_ms = ?2, schedule_claimed_at_ms = NULL, updated_at_ms = ?3 WHERE id = ?1",
            params![task_id, next, now_ms],
        )
        .map_err(|e| format!("failed updating next run: {e}"))?;
        Ok(())
    }

    pub fn get_task(&self, task_id: &str) -> Result<Option<DurableTaskRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms, project_root, starred, source FROM durable_tasks WHERE id = ?1 LIMIT 1",
            )
            .map_err(|e| format!("failed preparing get_task query: {e}"))?;
        let mut rows = stmt
            .query(params![task_id])
            .map_err(|e| format!("failed querying task: {e}"))?;
        let Some(row) = rows
            .next()
            .map_err(|e| format!("failed reading task row: {e}"))?
        else {
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
        conn.execute(
            "DELETE FROM durable_task_runs WHERE task_id = ?1",
            params![task_id],
        )
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

    pub fn list_notifications(&self) -> Result<Vec<DurableNotificationRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, description, tone, read, actions_json, created_at_ms, updated_at_ms FROM durable_notifications ORDER BY created_at_ms DESC",
            )
            .map_err(|e| format!("failed preparing list_notifications query: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let actions_json_raw: String = row.get(5)?;
                let actions_json = serde_json::from_str::<Value>(&actions_json_raw)
                    .unwrap_or_else(|_| Value::Array(Vec::new()));
                Ok(DurableNotificationRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    tone: row.get(3)?,
                    read: row.get::<_, i64>(4)? != 0,
                    actions_json,
                    created_at_ms: row.get(6)?,
                    updated_at_ms: row.get(7)?,
                })
            })
            .map_err(|e| format!("failed querying notifications: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("failed reading notification row: {e}"))?);
        }
        Ok(out)
    }

    pub fn upsert_notification(
        &self,
        mut row: DurableNotificationRecord,
    ) -> Result<DurableNotificationRecord, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        let now = now_ms();
        if row.created_at_ms <= 0 {
            row.created_at_ms = now;
        }
        row.updated_at_ms = if row.updated_at_ms > 0 {
            row.updated_at_ms
        } else {
            now
        };
        let actions_json = serde_json::to_string(&row.actions_json)
            .map_err(|e| format!("failed serializing notification actions: {e}"))?;
        conn.execute(
            "INSERT INTO durable_notifications (id, title, description, tone, read, actions_json, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               description = excluded.description,
               tone = excluded.tone,
               read = excluded.read,
               actions_json = excluded.actions_json,
               updated_at_ms = excluded.updated_at_ms",
            params![
                row.id,
                row.title,
                row.description,
                row.tone,
                if row.read { 1 } else { 0 },
                actions_json,
                row.created_at_ms,
                row.updated_at_ms,
            ],
        )
        .map_err(|e| format!("failed upserting notification: {e}"))?;
        Ok(row)
    }

    pub fn mark_notification_read(&self, id: &str, read: bool) -> Result<bool, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        let changed = conn
            .execute(
                "UPDATE durable_notifications SET read = ?2, updated_at_ms = ?3 WHERE id = ?1",
                params![id, if read { 1 } else { 0 }, now_ms()],
            )
            .map_err(|e| format!("failed marking notification read: {e}"))?;
        Ok(changed > 0)
    }

    pub fn dismiss_notification(&self, id: &str) -> Result<bool, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        let changed = conn
            .execute(
                "DELETE FROM durable_notifications WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("failed dismissing notification: {e}"))?;
        Ok(changed > 0)
    }
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
    match conn.execute(&sql, []) {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("duplicate column name") {
                Ok(())
            } else {
                Err(format!("failed ensuring {table}.{column}: {e}"))
            }
        }
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
        project_root: row.get(19)?,
        name: row.get(2)?,
        description: row.get(3)?,
        task_type: row.get(4)?,
        agent_owner: row.get(5)?,
        state: row.get(6)?,
        risk_level: row.get(7)?,
        payload_kind: row.get(8)?,
        payload_json,
        estimate_json,
        starred: row.get::<_, i64>(20)? != 0,
        source: row.get(21)?,
        scheduled_at_ms: row.get(11)?,
        repeat: row.get(12)?,
        repeat_time_of_day_ms: row.get(13)?,
        repeat_timezone: row.get(14)?,
        is_schedule_enabled: row.get::<_, i64>(15)? != 0,
        next_run_at_ms: row.get(16)?,
        created_at_ms: row.get(17)?,
        updated_at_ms: row.get(18)?,
    })
}

fn default_task_source() -> String {
    "user".to_string()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn compute_next_run_at_ms(
    scheduled_at_ms: Option<i64>,
    repeat: &str,
    repeat_time_of_day_ms: Option<i64>,
    repeat_timezone: &str,
    is_schedule_enabled: bool,
    now_ms: i64,
) -> Result<Option<i64>, String> {
    if !is_schedule_enabled {
        return Ok(None);
    }
    if !matches!(
        repeat,
        "none" | "hourly" | "daily" | "weekly" | "monthly" | "yearly"
    ) {
        return Err(format!("invalid task recurrence: {repeat}"));
    }
    let tz: Tz = repeat_timezone
        .parse()
        .map_err(|_| format!("invalid task timezone: {repeat_timezone}"))?;
    let now_utc = Utc
        .timestamp_millis_opt(now_ms)
        .single()
        .ok_or_else(|| "invalid current task scheduler timestamp".to_string())?;
    let anchor_ms = if let Some(value) = scheduled_at_ms {
        value
    } else if let Some(time_of_day_ms) = repeat_time_of_day_ms {
        if !(0..86_400_000).contains(&time_of_day_ms) {
            return Err("repeat time must be within a local calendar day".to_string());
        }
        let local_now = now_utc.with_timezone(&tz);
        let seconds = (time_of_day_ms / 1000) as u32;
        let nanos = ((time_of_day_ms % 1000) * 1_000_000) as u32;
        let time = NaiveTime::from_num_seconds_from_midnight_opt(seconds, nanos)
            .ok_or_else(|| "invalid repeat time".to_string())?;
        resolve_local_datetime(&tz, local_now.date_naive().and_time(time))?
            .with_timezone(&Utc)
            .timestamp_millis()
    } else {
        return Ok(None);
    };

    if repeat == "none" {
        return Ok(Some(anchor_ms));
    }
    if repeat == "hourly" {
        if anchor_ms > now_ms {
            return Ok(Some(anchor_ms));
        }
        let elapsed = now_ms.saturating_sub(anchor_ms);
        let intervals = elapsed / 3_600_000 + 1;
        return Ok(anchor_ms.checked_add(intervals.saturating_mul(3_600_000)));
    }

    let anchor_utc = Utc
        .timestamp_millis_opt(anchor_ms)
        .single()
        .ok_or_else(|| "invalid task schedule timestamp".to_string())?;
    let anchor_local = anchor_utc.with_timezone(&tz);
    if anchor_ms > now_ms {
        return Ok(Some(anchor_ms));
    }

    for occurrence in 1..=200_000_i64 {
        let date = recurrence_date(anchor_local.date_naive(), repeat, occurrence)?;
        let local = resolve_local_datetime(&tz, date.and_time(anchor_local.time()))?;
        let candidate = local.with_timezone(&Utc).timestamp_millis();
        if candidate > now_ms {
            return Ok(Some(candidate));
        }
    }
    Err("task recurrence exceeds supported search range".to_string())
}

fn recurrence_date(anchor: NaiveDate, repeat: &str, occurrence: i64) -> Result<NaiveDate, String> {
    match repeat {
        "daily" => anchor
            .checked_add_signed(Duration::days(occurrence))
            .ok_or_else(|| "daily task recurrence is out of range".to_string()),
        "weekly" => anchor
            .checked_add_signed(Duration::weeks(occurrence))
            .ok_or_else(|| "weekly task recurrence is out of range".to_string()),
        "monthly" => {
            let month_index =
                i64::from(anchor.year()) * 12 + i64::from(anchor.month0()) + occurrence;
            let year = i32::try_from(month_index.div_euclid(12))
                .map_err(|_| "monthly task recurrence year is out of range".to_string())?;
            let month = u32::try_from(month_index.rem_euclid(12) + 1)
                .map_err(|_| "monthly task recurrence month is out of range".to_string())?;
            let day = anchor.day().min(days_in_month(year, month));
            NaiveDate::from_ymd_opt(year, month, day)
                .ok_or_else(|| "invalid monthly task recurrence date".to_string())
        }
        "yearly" => {
            let year =
                anchor
                    .year()
                    .checked_add(i32::try_from(occurrence).map_err(|_| {
                        "yearly task recurrence interval is out of range".to_string()
                    })?)
                    .ok_or_else(|| "yearly task recurrence year is out of range".to_string())?;
            let day = anchor.day().min(days_in_month(year, anchor.month()));
            NaiveDate::from_ymd_opt(year, anchor.month(), day)
                .ok_or_else(|| "invalid yearly task recurrence date".to_string())
        }
        _ => Err(format!("invalid calendar recurrence: {repeat}")),
    }
}

fn resolve_local_datetime(tz: &Tz, naive: NaiveDateTime) -> Result<chrono::DateTime<Tz>, String> {
    for minute_offset in 0..=180 {
        let candidate = naive
            .checked_add_signed(Duration::minutes(minute_offset))
            .ok_or_else(|| "task local schedule is out of range".to_string())?;
        match tz.from_local_datetime(&candidate) {
            LocalResult::Single(value) => return Ok(value),
            LocalResult::Ambiguous(first, second) => {
                return Ok(if first.timestamp_millis() <= second.timestamp_millis() {
                    first
                } else {
                    second
                });
            }
            LocalResult::None => continue,
        }
    }
    Err("task local schedule falls outside a resolvable timezone window".to_string())
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
            if leap {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

#[cfg(test)]
mod tests {
    use super::{compute_next_run_at_ms, DurableTaskRecord, TaskAutomationService};
    use chrono::{TimeZone, Utc};
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
            project_id: "p123456".to_string(),
            project_root: "/tmp/project".to_string(),
            name: "Task".to_string(),
            description: "Desc".to_string(),
            task_type: "code".to_string(),
            agent_owner: "agent".to_string(),
            state: state.to_string(),
            risk_level: risk_level.to_string(),
            payload_kind: "agent_prompt".to_string(),
            payload_json: json!({}),
            estimate_json: json!({}),
            starred: false,
            source: "user".to_string(),
            scheduled_at_ms: None,
            repeat: "none".to_string(),
            repeat_time_of_day_ms: None,
            repeat_timezone: "UTC".to_string(),
            is_schedule_enabled: true,
            next_run_at_ms: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn daily_and_weekly_recurrence_preserve_anchor_time() {
        let anchor = Utc
            .with_ymd_and_hms(2024, 1, 1, 9, 30, 0)
            .single()
            .expect("anchor")
            .timestamp_millis();
        let now = Utc
            .with_ymd_and_hms(2024, 1, 2, 12, 0, 0)
            .single()
            .expect("now")
            .timestamp_millis();

        let daily = compute_next_run_at_ms(Some(anchor), "daily", None, "UTC", true, now)
            .expect("daily")
            .expect("next daily");
        let weekly = compute_next_run_at_ms(Some(anchor), "weekly", None, "UTC", true, now)
            .expect("weekly")
            .expect("next weekly");

        assert_eq!(
            daily,
            Utc.with_ymd_and_hms(2024, 1, 3, 9, 30, 0)
                .single()
                .expect("daily expected")
                .timestamp_millis()
        );
        assert_eq!(
            weekly,
            Utc.with_ymd_and_hms(2024, 1, 8, 9, 30, 0)
                .single()
                .expect("weekly expected")
                .timestamp_millis()
        );
    }

    #[test]
    fn monthly_and_yearly_recurrence_clamp_calendar_days() {
        let monthly_anchor = Utc
            .with_ymd_and_hms(2024, 1, 31, 9, 0, 0)
            .single()
            .expect("monthly anchor")
            .timestamp_millis();
        let monthly_now = Utc
            .with_ymd_and_hms(2024, 2, 1, 0, 0, 0)
            .single()
            .expect("monthly now")
            .timestamp_millis();
        let monthly = compute_next_run_at_ms(
            Some(monthly_anchor),
            "monthly",
            None,
            "UTC",
            true,
            monthly_now,
        )
        .expect("monthly")
        .expect("next monthly");
        assert_eq!(
            monthly,
            Utc.with_ymd_and_hms(2024, 2, 29, 9, 0, 0)
                .single()
                .expect("monthly expected")
                .timestamp_millis()
        );

        let yearly_now = Utc
            .with_ymd_and_hms(2024, 3, 1, 0, 0, 0)
            .single()
            .expect("yearly now")
            .timestamp_millis();
        let yearly = compute_next_run_at_ms(Some(monthly), "yearly", None, "UTC", true, yearly_now)
            .expect("yearly")
            .expect("next yearly");
        assert_eq!(
            yearly,
            Utc.with_ymd_and_hms(2025, 2, 28, 9, 0, 0)
                .single()
                .expect("yearly expected")
                .timestamp_millis()
        );
    }

    #[test]
    fn time_of_day_recurrence_uses_the_selected_timezone() {
        let now = Utc
            .with_ymd_and_hms(2024, 1, 1, 15, 0, 0)
            .single()
            .expect("now")
            .timestamp_millis();
        let next = compute_next_run_at_ms(
            None,
            "daily",
            Some(9 * 60 * 60 * 1000),
            "America/New_York",
            true,
            now,
        )
        .expect("daily")
        .expect("next");
        assert_eq!(
            next,
            Utc.with_ymd_and_hms(2024, 1, 2, 14, 0, 0)
                .single()
                .expect("expected")
                .timestamp_millis()
        );
    }

    #[test]
    fn invalid_scheduler_timezone_is_rejected() {
        let result = compute_next_run_at_ms(None, "daily", Some(0), "Mars/Olympus", true, 0);
        assert!(result.is_err());
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
    fn persists_project_identity_and_frontend_metadata() {
        let db = temp_db_path();
        let service = TaskAutomationService::new(db.clone()).expect("service");
        let mut task = base_task("approved", "low");
        task.project_id = "pABC123".to_string();
        task.project_root = "/tmp/project-a".to_string();
        task.starred = true;
        task.source = "agent".to_string();

        let saved = service.upsert_task(task).expect("upsert");
        let loaded = service
            .get_task(saved.id.as_str())
            .expect("get task")
            .expect("saved task");

        assert_eq!(loaded.project_id, "pABC123");
        assert_eq!(loaded.project_root, "/tmp/project-a");
        assert!(loaded.starred);
        assert_eq!(loaded.source, "agent");
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

    #[test]
    fn lists_due_scheduled_tasks_for_approved_items() {
        let db = temp_db_path();
        let service = TaskAutomationService::new(db.clone()).expect("service");
        let mut task = base_task("approved", "low");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        task.scheduled_at_ms = Some(now - 60_000);
        task.repeat = "none".to_string();
        task.is_schedule_enabled = true;
        let saved = service.upsert_task(task).expect("upsert");
        let due = service.list_due_scheduled_tasks(now, 10).expect("due");
        assert!(due.iter().any(|row| row.id == saved.id));
        let _ = fs::remove_file(db);
    }

    #[test]
    fn due_tasks_are_leased_to_only_one_scheduler() {
        let db = temp_db_path();
        let service = TaskAutomationService::new(db.clone()).expect("service");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut task = base_task("approved", "low");
        task.scheduled_at_ms = Some(now - 60_000);
        let saved = service.upsert_task(task).expect("upsert");

        let first = service
            .claim_due_scheduled_tasks(now, 10)
            .expect("first claim");
        let second = service
            .claim_due_scheduled_tasks(now, 10)
            .expect("second claim");

        assert_eq!(first.iter().filter(|row| row.id == saved.id).count(), 1);
        assert!(second.iter().all(|row| row.id != saved.id));
        service
            .release_task_claim(saved.id.as_str())
            .expect("release claim");
        let reclaimed = service.claim_due_scheduled_tasks(now, 10).expect("reclaim");
        assert!(reclaimed.iter().any(|row| row.id == saved.id));
        let _ = fs::remove_file(db);
    }

    #[test]
    fn advancing_one_time_schedule_clears_it_after_execution() {
        let db = temp_db_path();
        let service = TaskAutomationService::new(db.clone()).expect("service");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut task = base_task("approved", "low");
        task.scheduled_at_ms = Some(now - 60_000);
        task.repeat = "none".to_string();
        let saved = service.upsert_task(task).expect("upsert");

        service
            .advance_next_run_at(saved.id.as_str(), now)
            .expect("advance schedule");

        let advanced = service
            .get_task(saved.id.as_str())
            .expect("get task")
            .expect("saved task");
        assert_eq!(advanced.next_run_at_ms, None);
        let due = service.list_due_scheduled_tasks(now, 10).expect("due");
        assert!(due.iter().all(|row| row.id != saved.id));
        let _ = fs::remove_file(db);
    }

    #[test]
    fn persists_and_lists_notifications() {
        use super::DurableNotificationRecord;
        use serde_json::json;

        let db = temp_db_path();
        let service = TaskAutomationService::new(db.clone()).expect("service");
        let row = DurableNotificationRecord {
            id: "N-test-1".to_string(),
            title: "Task complete".to_string(),
            description: "Scheduled run succeeded.".to_string(),
            tone: "success".to_string(),
            read: false,
            actions_json: json!([{ "id": "open-task:T123", "label": "Open Task" }]),
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        let _ = service
            .upsert_notification(row)
            .expect("upsert notification");
        let rows = service.list_notifications().expect("list notifications");
        assert!(rows.iter().any(|item| item.id == "N-test-1"));
        let _ = fs::remove_file(db);
    }
}
