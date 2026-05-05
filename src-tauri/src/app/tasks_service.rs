use crate::app_paths;
use chrono::{Datelike, Duration, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
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
                scheduled_at_ms INTEGER,
                repeat TEXT NOT NULL DEFAULT 'none',
                repeat_time_of_day_ms INTEGER,
                repeat_timezone TEXT NOT NULL DEFAULT 'UTC',
                is_schedule_enabled INTEGER NOT NULL DEFAULT 1,
                next_run_at_ms INTEGER,
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
        ensure_column(&conn, "durable_tasks", "repeat", "TEXT NOT NULL DEFAULT 'none'")?;
        ensure_column(
            &conn,
            "durable_tasks",
            "repeat_time_of_day_ms",
            "INTEGER",
        )?;
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
                    "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms FROM durable_tasks WHERE project_id = ?1 ORDER BY updated_at_ms DESC",
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
                "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms FROM durable_tasks ORDER BY updated_at_ms DESC",
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
        let mut normalized = task.clone();
        if normalized.repeat.trim().is_empty() {
            normalized.repeat = "none".to_string();
        }
        normalized.next_run_at_ms = compute_next_run_at_ms(
            normalized.scheduled_at_ms,
            normalized.repeat.as_str(),
            normalized.repeat_time_of_day_ms,
            normalized.repeat_timezone.as_str(),
            normalized.is_schedule_enabled,
            now,
        );
        conn.execute(
            "INSERT INTO durable_tasks (id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
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
                updated_at_ms = excluded.updated_at_ms",
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

    pub fn list_due_scheduled_tasks(&self, now_ms: i64, limit: usize) -> Result<Vec<DurableTaskRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms
                 FROM durable_tasks
                 WHERE state = 'approved' AND is_schedule_enabled = 1 AND next_run_at_ms IS NOT NULL AND next_run_at_ms <= ?1
                 ORDER BY next_run_at_ms ASC
                 LIMIT ?2",
            )
            .map_err(|e| format!("failed preparing due tasks query: {e}"))?;
        let rows = stmt
            .query_map(params![now_ms, limit as i64], row_to_task)
            .map_err(|e| format!("failed querying due tasks: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("failed reading due task row: {e}"))?);
        }
        Ok(out)
    }

    pub fn advance_next_run_at(&self, task_id: &str, now_ms: i64) -> Result<(), String> {
        let Some(task) = self.get_task(task_id)? else {
            return Ok(());
        };
        let next = compute_next_run_at_ms(
            task.scheduled_at_ms,
            task.repeat.as_str(),
            task.repeat_time_of_day_ms,
            task.repeat_timezone.as_str(),
            task.is_schedule_enabled,
            now_ms,
        );
        let _guard = self.write_lock.lock().map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        conn.execute(
            "UPDATE durable_tasks SET next_run_at_ms = ?2, updated_at_ms = ?3 WHERE id = ?1",
            params![task_id, next, now_ms],
        )
        .map_err(|e| format!("failed updating next run: {e}"))?;
        Ok(())
    }

    pub fn get_task(&self, task_id: &str) -> Result<Option<DurableTaskRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, description, task_type, agent_owner, state, risk_level, payload_kind, payload_json, estimate_json, scheduled_at_ms, repeat, repeat_time_of_day_ms, repeat_timezone, is_schedule_enabled, next_run_at_ms, created_at_ms, updated_at_ms FROM durable_tasks WHERE id = ?1 LIMIT 1",
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

    pub fn upsert_notification(&self, mut row: DurableNotificationRecord) -> Result<DurableNotificationRecord, String> {
        let _guard = self.write_lock.lock().map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        let now = now_ms();
        if row.created_at_ms <= 0 {
            row.created_at_ms = now;
        }
        row.updated_at_ms = if row.updated_at_ms > 0 { row.updated_at_ms } else { now };
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
        let _guard = self.write_lock.lock().map_err(|_| "tasks write lock poisoned".to_string())?;
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
        let _guard = self.write_lock.lock().map_err(|_| "tasks write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        let changed = conn
            .execute("DELETE FROM durable_notifications WHERE id = ?1", params![id])
            .map_err(|e| format!("failed dismissing notification: {e}"))?;
        Ok(changed > 0)
    }
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<(), String> {
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
        name: row.get(2)?,
        description: row.get(3)?,
        task_type: row.get(4)?,
        agent_owner: row.get(5)?,
        state: row.get(6)?,
        risk_level: row.get(7)?,
        payload_kind: row.get(8)?,
        payload_json,
        estimate_json,
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
) -> Option<i64> {
    if !is_schedule_enabled {
        return None;
    }
    let tz: Tz = repeat_timezone.parse().ok().unwrap_or(chrono_tz::UTC);
    let anchor = scheduled_at_ms.or(repeat_time_of_day_ms.map(|tod| now_ms - (now_ms % 86_400_000) + tod));
    let Some(mut next) = anchor else { return None; };
    if repeat == "none" {
        return Some(next);
    }
    if repeat == "hourly" {
        while next <= now_ms {
            next += 3_600_000;
        }
        return Some(next);
    }

    let anchor_dt_utc = Utc.timestamp_millis_opt(anchor?).single()?;
    let anchor_local = anchor_dt_utc.with_timezone(&tz);
    let mut probe = Utc.timestamp_millis_opt(now_ms).single()?.with_timezone(&tz);
    if probe <= anchor_local {
        return Some(anchor_local.with_timezone(&Utc).timestamp_millis());
    }
    let hh = anchor_local.hour();
    let mm = anchor_local.minute();
    let ss = anchor_local.second();
    let ns = anchor_local.nanosecond();

    loop {
        probe = match repeat {
            "daily" => probe + Duration::days(1),
            "weekly" => probe + Duration::weeks(1),
            "monthly" => {
                let mut y = probe.year();
                let mut m = probe.month() as i32 + 1;
                if m > 12 { m = 1; y += 1; }
                let d = anchor_local.day().min(days_in_month(y, m as u32));
                tz.with_ymd_and_hms(y, m as u32, d, hh, mm, ss).single()?.with_nanosecond(ns)?
            }
            "yearly" => {
                let y = probe.year() + 1;
                let m = anchor_local.month();
                let d = anchor_local.day().min(days_in_month(y, m));
                tz.with_ymd_and_hms(y, m, d, hh, mm, ss).single()?.with_nanosecond(ns)?
            }
            _ => break,
        };
        let utc_ms = probe.with_timezone(&Utc).timestamp_millis();
        if utc_ms > now_ms {
            return Some(utc_ms);
        }
    }
    Some(next)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
            if leap { 29 } else { 28 }
        }
        _ => 30,
    }
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
        let _ = service.upsert_notification(row).expect("upsert notification");
        let rows = service.list_notifications().expect("list notifications");
        assert!(rows.iter().any(|item| item.id == "N-test-1"));
        let _ = fs::remove_file(db);
    }
}
