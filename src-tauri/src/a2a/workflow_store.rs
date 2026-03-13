use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn next_id(prefix: &str) -> String {
    format!("{}_{}", prefix, Uuid::new_v4().simple())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AWorkflowRecord {
    pub workflow_id: String,
    pub name: String,
    pub active: bool,
    pub version: i64,
    pub definition_json: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AWorkflowRunRecord {
    pub run_id: String,
    pub workflow_id: String,
    pub status: String,
    pub trigger_type: String,
    pub error: Option<String>,
    pub input_json: String,
    pub output_json: Option<String>,
    pub metrics_json: String,
    pub started_at_ms: i64,
    pub finished_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AWorkflowNodeRunRecord {
    pub run_id: String,
    pub node_id: String,
    pub node_type: String,
    pub status: String,
    pub input_json: String,
    pub output_json: Option<String>,
    pub error: Option<String>,
    pub duration_ms: i64,
    pub started_at_ms: i64,
    pub finished_at_ms: i64,
    pub attempt: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ACredentialRecord {
    pub credential_id: String,
    pub name: String,
    pub kind: String,
    pub data_json: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ATemplateRecord {
    pub template_id: String,
    pub name: String,
    pub definition_json: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

pub fn init_db(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    init_schema(&conn)?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS a2a_workflows (
            workflow_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 1,
            definition_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS a2a_workflow_runs (
            run_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            status TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            error TEXT,
            input_json TEXT NOT NULL DEFAULT '[]',
            output_json TEXT,
            metrics_json TEXT NOT NULL DEFAULT '{}',
            started_at_ms INTEGER NOT NULL,
            finished_at_ms INTEGER,
            FOREIGN KEY (workflow_id) REFERENCES a2a_workflows(workflow_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS a2a_workflow_node_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            node_type TEXT NOT NULL,
            status TEXT NOT NULL,
            input_json TEXT NOT NULL DEFAULT '[]',
            output_json TEXT,
            error TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            started_at_ms INTEGER NOT NULL,
            finished_at_ms INTEGER NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (run_id) REFERENCES a2a_workflow_runs(run_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS a2a_credentials (
            credential_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS a2a_templates (
            template_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            definition_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS a2a_trigger_registry (
            trigger_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            path TEXT NOT NULL DEFAULT '',
            config_json TEXT NOT NULL DEFAULT '{}',
            active INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY (workflow_id) REFERENCES a2a_workflows(workflow_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS a2a_observability_events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY (run_id) REFERENCES a2a_workflow_runs(run_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_a2a_workflows_updated ON a2a_workflows(updated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_a2a_workflow_runs_workflow ON a2a_workflow_runs(workflow_id, started_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_a2a_workflow_runs_status ON a2a_workflow_runs(status, started_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_a2a_workflow_node_runs_run ON a2a_workflow_node_runs(run_id, started_at_ms ASC);
        CREATE INDEX IF NOT EXISTS idx_a2a_observability_run ON a2a_observability_events(run_id, sequence DESC);
        CREATE INDEX IF NOT EXISTS idx_a2a_templates_updated ON a2a_templates(updated_at_ms DESC);
        "#,
    )?;
    Ok(())
}

pub fn ensure_seed_workflows(conn: &Connection) -> Result<()> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM a2a_workflows WHERE name = ?1 LIMIT 1",
            params!["Single-Agent Query"],
            |_row| Ok(true),
        )
        .unwrap_or(false);
    if !exists {
        let definition = json!({
            "workflow_id": "",
            "name": "Single-Agent Query",
            "active": false,
            "version": 1,
            "nodes": [
                {
                    "id": "n_manual",
                    "type": "trigger.manual",
                    "name": "Manual Trigger",
                    "params": {}
                },
                {
                    "id": "n_query",
                    "type": "llm.query",
                    "name": "Query LLM",
                    "params": {
                        "prompt": "{{ $json.question }}"
                    }
                },
                {
                    "id": "n_output",
                    "type": "output.respond",
                    "name": "Output",
                    "params": {}
                }
            ],
            "edges": [
                {
                    "id": "e_1",
                    "source": "n_manual",
                    "source_output": "main",
                    "target": "n_query",
                    "target_input": "main"
                },
                {
                    "id": "e_2",
                    "source": "n_query",
                    "source_output": "main",
                    "target": "n_output",
                    "target_input": "main"
                }
            ]
        });
        let _ = create_workflow(conn, "Single-Agent Query".to_string(), definition, false)?;
    }
    Ok(())
}

pub fn list_workflows(conn: &Connection) -> Result<Vec<A2AWorkflowRecord>> {
    let mut stmt = conn.prepare(
        "SELECT workflow_id, name, active, version, definition_json, created_at_ms, updated_at_ms
         FROM a2a_workflows ORDER BY updated_at_ms DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(A2AWorkflowRecord {
            workflow_id: row.get(0)?,
            name: row.get(1)?,
            active: row.get::<_, i64>(2)? != 0,
            version: row.get(3)?,
            definition_json: row.get(4)?,
            created_at_ms: row.get(5)?,
            updated_at_ms: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_workflow(conn: &Connection, workflow_id: &str) -> Result<Option<A2AWorkflowRecord>> {
    let mut stmt = conn.prepare(
        "SELECT workflow_id, name, active, version, definition_json, created_at_ms, updated_at_ms
         FROM a2a_workflows WHERE workflow_id = ?1",
    )?;
    let mut rows = stmt.query([workflow_id])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(A2AWorkflowRecord {
            workflow_id: row.get(0)?,
            name: row.get(1)?,
            active: row.get::<_, i64>(2)? != 0,
            version: row.get(3)?,
            definition_json: row.get(4)?,
            created_at_ms: row.get(5)?,
            updated_at_ms: row.get(6)?,
        }));
    }
    Ok(None)
}

pub fn create_workflow(
    conn: &Connection,
    name: String,
    definition: Value,
    active: bool,
) -> Result<A2AWorkflowRecord> {
    let now = now_ms();
    let workflow_id = next_id("wf");
    let definition_json = serde_json::to_string(&definition)?;
    conn.execute(
        "INSERT INTO a2a_workflows (workflow_id, name, active, version, definition_json, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5)",
        params![workflow_id, name, if active { 1 } else { 0 }, definition_json, now],
    )?;
    get_workflow(conn, &workflow_id)?
        .ok_or_else(|| anyhow!("Failed to load created workflow {}", workflow_id))
}

pub fn update_workflow(
    conn: &Connection,
    workflow_id: &str,
    name: Option<String>,
    definition: Option<Value>,
    active: Option<bool>,
) -> Result<Option<A2AWorkflowRecord>> {
    let current = match get_workflow(conn, workflow_id)? {
        Some(v) => v,
        None => return Ok(None),
    };
    let next_name = name.unwrap_or(current.name);
    let next_active = active.unwrap_or(current.active);
    let next_definition_json = match definition {
        Some(v) => serde_json::to_string(&v)?,
        None => current.definition_json,
    };
    conn.execute(
        "UPDATE a2a_workflows
         SET name = ?2, active = ?3, version = version + 1, definition_json = ?4, updated_at_ms = ?5
         WHERE workflow_id = ?1",
        params![
            workflow_id,
            next_name,
            if next_active { 1 } else { 0 },
            next_definition_json,
            now_ms()
        ],
    )?;
    get_workflow(conn, workflow_id)
}

pub fn delete_workflow(conn: &Connection, workflow_id: &str) -> Result<bool> {
    Ok(conn.execute("DELETE FROM a2a_workflows WHERE workflow_id = ?1", [workflow_id])? > 0)
}

pub fn create_run(
    conn: &Connection,
    workflow_id: &str,
    trigger_type: &str,
    input_json: String,
) -> Result<A2AWorkflowRunRecord> {
    let run_id = next_id("run");
    let now = now_ms();
    conn.execute(
        "INSERT INTO a2a_workflow_runs
         (run_id, workflow_id, status, trigger_type, input_json, metrics_json, started_at_ms)
         VALUES (?1, ?2, 'running', ?3, ?4, '{}', ?5)",
        params![run_id, workflow_id, trigger_type, input_json, now],
    )?;
    get_run(conn, &run_id)?.ok_or_else(|| anyhow!("Failed to load created run {}", run_id))
}

pub fn set_run_status(
    conn: &Connection,
    run_id: &str,
    status: &str,
    error: Option<String>,
    output_json: Option<String>,
    metrics_json: Option<String>,
) -> Result<()> {
    let finished = if matches!(status, "succeeded" | "failed" | "canceled" | "timed_out") {
        Some(now_ms())
    } else {
        None
    };
    conn.execute(
        "UPDATE a2a_workflow_runs
         SET status = ?2,
             error = ?3,
             output_json = COALESCE(?4, output_json),
             metrics_json = COALESCE(?5, metrics_json),
             finished_at_ms = COALESCE(?6, finished_at_ms)
         WHERE run_id = ?1",
        params![run_id, status, error, output_json, metrics_json, finished],
    )?;
    Ok(())
}

pub fn append_node_run(conn: &Connection, row: &A2AWorkflowNodeRunRecord) -> Result<()> {
    conn.execute(
        "INSERT INTO a2a_workflow_node_runs
         (run_id, node_id, node_type, status, input_json, output_json, error, duration_ms, started_at_ms, finished_at_ms, attempt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            row.run_id,
            row.node_id,
            row.node_type,
            row.status,
            row.input_json,
            row.output_json,
            row.error,
            row.duration_ms,
            row.started_at_ms,
            row.finished_at_ms,
            row.attempt
        ],
    )?;
    Ok(())
}

pub fn append_observability_event(
    conn: &Connection,
    run_id: &str,
    event_type: &str,
    payload_json: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO a2a_observability_events (run_id, event_type, payload_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4)",
        params![run_id, event_type, payload_json, now_ms()],
    )?;
    Ok(())
}

pub fn list_runs(
    conn: &Connection,
    workflow_id: Option<&str>,
    limit: i64,
) -> Result<Vec<A2AWorkflowRunRecord>> {
    let (sql, bind_workflow) = if workflow_id.is_some() {
        (
            "SELECT run_id, workflow_id, status, trigger_type, error, input_json, output_json, metrics_json, started_at_ms, finished_at_ms
             FROM a2a_workflow_runs WHERE workflow_id = ?1 ORDER BY started_at_ms DESC LIMIT ?2",
            true,
        )
    } else {
        (
            "SELECT run_id, workflow_id, status, trigger_type, error, input_json, output_json, metrics_json, started_at_ms, finished_at_ms
             FROM a2a_workflow_runs ORDER BY started_at_ms DESC LIMIT ?1",
            false,
        )
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = if bind_workflow {
        stmt.query_map(
            params![workflow_id.unwrap_or_default(), limit],
            map_run_row,
        )?
    } else {
        stmt.query_map(params![limit], map_run_row)?
    };
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn map_run_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<A2AWorkflowRunRecord> {
    Ok(A2AWorkflowRunRecord {
        run_id: row.get(0)?,
        workflow_id: row.get(1)?,
        status: row.get(2)?,
        trigger_type: row.get(3)?,
        error: row.get(4)?,
        input_json: row.get(5)?,
        output_json: row.get(6)?,
        metrics_json: row.get(7)?,
        started_at_ms: row.get(8)?,
        finished_at_ms: row.get(9)?,
    })
}

pub fn get_run(conn: &Connection, run_id: &str) -> Result<Option<A2AWorkflowRunRecord>> {
    let mut stmt = conn.prepare(
        "SELECT run_id, workflow_id, status, trigger_type, error, input_json, output_json, metrics_json, started_at_ms, finished_at_ms
         FROM a2a_workflow_runs WHERE run_id = ?1",
    )?;
    let mut rows = stmt.query([run_id])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(map_run_row(row)?));
    }
    Ok(None)
}

pub fn list_node_runs(conn: &Connection, run_id: &str) -> Result<Vec<A2AWorkflowNodeRunRecord>> {
    let mut stmt = conn.prepare(
        "SELECT run_id, node_id, node_type, status, input_json, output_json, error, duration_ms, started_at_ms, finished_at_ms, attempt
         FROM a2a_workflow_node_runs WHERE run_id = ?1 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([run_id], |row| {
        Ok(A2AWorkflowNodeRunRecord {
            run_id: row.get(0)?,
            node_id: row.get(1)?,
            node_type: row.get(2)?,
            status: row.get(3)?,
            input_json: row.get(4)?,
            output_json: row.get(5)?,
            error: row.get(6)?,
            duration_ms: row.get(7)?,
            started_at_ms: row.get(8)?,
            finished_at_ms: row.get(9)?,
            attempt: row.get(10)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn list_credentials(conn: &Connection) -> Result<Vec<A2ACredentialRecord>> {
    let mut stmt = conn.prepare(
        "SELECT credential_id, name, kind, data_json, created_at_ms, updated_at_ms
         FROM a2a_credentials ORDER BY updated_at_ms DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(A2ACredentialRecord {
            credential_id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            data_json: row.get(3)?,
            created_at_ms: row.get(4)?,
            updated_at_ms: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_credential(
    conn: &Connection,
    name: String,
    kind: String,
    data_json: String,
) -> Result<A2ACredentialRecord> {
    let credential_id = next_id("cred");
    let now = now_ms();
    conn.execute(
        "INSERT INTO a2a_credentials (credential_id, name, kind, data_json, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![credential_id, name, kind, data_json, now],
    )?;
    let mut stmt = conn.prepare(
        "SELECT credential_id, name, kind, data_json, created_at_ms, updated_at_ms
         FROM a2a_credentials WHERE credential_id = ?1",
    )?;
    let row = stmt.query_row([credential_id], |row| {
        Ok(A2ACredentialRecord {
            credential_id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            data_json: row.get(3)?,
            created_at_ms: row.get(4)?,
            updated_at_ms: row.get(5)?,
        })
    })?;
    Ok(row)
}

pub fn delete_credential(conn: &Connection, credential_id: &str) -> Result<bool> {
    Ok(conn.execute("DELETE FROM a2a_credentials WHERE credential_id = ?1", [credential_id])? > 0)
}

pub fn get_credential(conn: &Connection, credential_id: &str) -> Result<Option<A2ACredentialRecord>> {
    let mut stmt = conn.prepare(
        "SELECT credential_id, name, kind, data_json, created_at_ms, updated_at_ms
         FROM a2a_credentials WHERE credential_id = ?1 LIMIT 1",
    )?;
    let mut rows = stmt.query([credential_id])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(A2ACredentialRecord {
            credential_id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            data_json: row.get(3)?,
            created_at_ms: row.get(4)?,
            updated_at_ms: row.get(5)?,
        }));
    }
    Ok(None)
}

pub fn list_templates(conn: &Connection) -> Result<Vec<A2ATemplateRecord>> {
    let mut stmt = conn.prepare(
        "SELECT template_id, name, definition_json, created_at_ms, updated_at_ms
         FROM a2a_templates ORDER BY updated_at_ms DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(A2ATemplateRecord {
            template_id: row.get(0)?,
            name: row.get(1)?,
            definition_json: row.get(2)?,
            created_at_ms: row.get(3)?,
            updated_at_ms: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_template(conn: &Connection, name: String, definition: Value) -> Result<A2ATemplateRecord> {
    let template_id = next_id("tpl");
    let now = now_ms();
    let definition_json = serde_json::to_string(&definition)?;
    conn.execute(
        "INSERT INTO a2a_templates (template_id, name, definition_json, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![template_id, name, definition_json, now],
    )?;
    let mut stmt = conn.prepare(
        "SELECT template_id, name, definition_json, created_at_ms, updated_at_ms
         FROM a2a_templates WHERE template_id = ?1",
    )?;
    let row = stmt.query_row([template_id], |row| {
        Ok(A2ATemplateRecord {
            template_id: row.get(0)?,
            name: row.get(1)?,
            definition_json: row.get(2)?,
            created_at_ms: row.get(3)?,
            updated_at_ms: row.get(4)?,
        })
    })?;
    Ok(row)
}

pub fn delete_template(conn: &Connection, template_id: &str) -> Result<bool> {
    Ok(conn.execute("DELETE FROM a2a_templates WHERE template_id = ?1", [template_id])? > 0)
}
