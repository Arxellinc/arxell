use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::types::{
    next_id, now_ms, A2AEvent, A2AEventEnvelope, AgentRunStatus, ProcessStatus, TaskStatus,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AProcessSummary {
    pub process_id: String,
    pub title: String,
    pub initiator: String,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub task_count: i64,
    pub running_task_count: i64,
    pub blocked_task_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AProcessRecord {
    pub process_id: String,
    pub title: String,
    pub initiator: String,
    pub status: String,
    pub last_error: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AAgentRunRecord {
    pub agent_run_id: String,
    pub process_id: String,
    pub agent_name: String,
    pub parent_run_id: Option<String>,
    pub status: String,
    pub last_error: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ATaskRecord {
    pub task_id: String,
    pub process_id: String,
    pub agent_run_id: Option<String>,
    pub title: String,
    pub status: String,
    pub last_error: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AEdgeRecord {
    pub edge_id: String,
    pub process_id: String,
    pub from_node: String,
    pub to_node: String,
    pub kind: String,
    pub metadata_json: Option<String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AArtifactRecord {
    pub artifact_id: String,
    pub process_id: String,
    pub producer_task_id: Option<String>,
    pub path: String,
    pub hash_blake3: String,
    pub size_bytes: i64,
    pub scope: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AMemoryRefRecord {
    pub memory_ref_id: String,
    pub process_id: String,
    pub namespace: String,
    pub key: String,
    pub scope: String,
    pub last_writer: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AStoredEvent {
    pub sequence: i64,
    pub event_id: String,
    pub process_id: String,
    pub event_type: String,
    pub actor: String,
    pub payload_json: String,
    pub occurred_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AProcessDetail {
    pub process: A2AProcessRecord,
    pub agent_runs: Vec<A2AAgentRunRecord>,
    pub tasks: Vec<A2ATaskRecord>,
    pub edges: Vec<A2AEdgeRecord>,
    pub artifacts: Vec<A2AArtifactRecord>,
    pub memory_refs: Vec<A2AMemoryRefRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AAgentCardRecord {
    pub card_id: String,
    pub name: String,
    pub role: String,
    pub description: String,
    pub protocol_version: String,
    pub version: String,
    pub url: String,
    pub preferred_model_id: String,
    pub fallback_model_ids_json: String,
    pub skills_json: String,
    pub capabilities_json: String,
    pub default_input_modes_json: String,
    pub default_output_modes_json: String,
    pub additional_interfaces_json: String,
    pub logic_language: String,
    pub logic_source: String,
    pub color: String,
    pub enabled: bool,
    pub sort_order: i64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS a2a_processes (
            process_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            initiator TEXT NOT NULL,
            status TEXT NOT NULL,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS a2a_agent_runs (
            agent_run_id TEXT PRIMARY KEY,
            process_id TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            parent_run_id TEXT,
            status TEXT NOT NULL,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY (process_id) REFERENCES a2a_processes(process_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS a2a_tasks (
            task_id TEXT PRIMARY KEY,
            process_id TEXT NOT NULL,
            agent_run_id TEXT,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY (process_id) REFERENCES a2a_processes(process_id) ON DELETE CASCADE,
            FOREIGN KEY (agent_run_id) REFERENCES a2a_agent_runs(agent_run_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS a2a_edges (
            edge_id TEXT PRIMARY KEY,
            process_id TEXT NOT NULL,
            from_node TEXT NOT NULL,
            to_node TEXT NOT NULL,
            kind TEXT NOT NULL,
            metadata_json TEXT,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY (process_id) REFERENCES a2a_processes(process_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS a2a_artifacts (
            artifact_id TEXT PRIMARY KEY,
            process_id TEXT NOT NULL,
            producer_task_id TEXT,
            path TEXT NOT NULL,
            hash_blake3 TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            scope TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY (process_id) REFERENCES a2a_processes(process_id) ON DELETE CASCADE,
            FOREIGN KEY (producer_task_id) REFERENCES a2a_tasks(task_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS a2a_memory_refs (
            memory_ref_id TEXT PRIMARY KEY,
            process_id TEXT NOT NULL,
            namespace TEXT NOT NULL,
            key TEXT NOT NULL,
            scope TEXT NOT NULL,
            last_writer TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY (process_id) REFERENCES a2a_processes(process_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS a2a_events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            process_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            actor TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            occurred_at_ms INTEGER NOT NULL,
            FOREIGN KEY (process_id) REFERENCES a2a_processes(process_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS a2a_agent_cards (
            card_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            description TEXT NOT NULL,
            protocol_version TEXT NOT NULL DEFAULT '0.3.0',
            version TEXT NOT NULL DEFAULT '0.1.0',
            url TEXT NOT NULL DEFAULT '',
            preferred_model_id TEXT NOT NULL DEFAULT '',
            fallback_model_ids_json TEXT NOT NULL DEFAULT '[]',
            skills_json TEXT NOT NULL DEFAULT '[]',
            capabilities_json TEXT NOT NULL DEFAULT '{}',
            default_input_modes_json TEXT NOT NULL DEFAULT '[\"text\"]',
            default_output_modes_json TEXT NOT NULL DEFAULT '[\"text\"]',
            additional_interfaces_json TEXT NOT NULL DEFAULT '[]',
            logic_language TEXT NOT NULL DEFAULT 'typescript',
            logic_source TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_a2a_process_status ON a2a_processes(status, updated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_a2a_events_process_seq ON a2a_events(process_id, sequence DESC);
        CREATE INDEX IF NOT EXISTS idx_a2a_tasks_process_status ON a2a_tasks(process_id, status, updated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_a2a_agent_runs_process_status ON a2a_agent_runs(process_id, status, updated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_a2a_agent_cards_sort ON a2a_agent_cards(sort_order ASC, updated_at_ms DESC);
        "#,
    )?;

    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN protocol_version TEXT NOT NULL DEFAULT '0.3.0'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN version TEXT NOT NULL DEFAULT '0.1.0'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN url TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN preferred_model_id TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN fallback_model_ids_json TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN default_input_modes_json TEXT NOT NULL DEFAULT '[\"text\"]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN default_output_modes_json TEXT NOT NULL DEFAULT '[\"text\"]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN additional_interfaces_json TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN logic_language TEXT NOT NULL DEFAULT 'typescript'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE a2a_agent_cards ADD COLUMN logic_source TEXT NOT NULL DEFAULT ''",
        [],
    );

    ensure_default_agent_cards(conn)?;

    Ok(())
}

fn ensure_default_agent_cards(conn: &Connection) -> Result<()> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM a2a_agent_cards", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let now = now_ms();
    let defaults = [
        (
            "Planner",
            "planning",
            "Break goals into executable sub-tasks.",
            "text-cyan-300",
        ),
        (
            "Research",
            "information",
            "Gather sources, references, and constraints.",
            "text-sky-300",
        ),
        (
            "Coder",
            "engineering",
            "Implement code and propose patches.",
            "text-emerald-300",
        ),
        (
            "Reviewer",
            "analysis",
            "Validate output quality and risks.",
            "text-amber-300",
        ),
    ];

    for (idx, (name, role, description, color)) in defaults.iter().enumerate() {
        let skills_json = serde_json::json!([
            {
                "id": role.to_string(),
                "name": name.to_string(),
                "description": description.to_string(),
                "tags": [role.to_string()]
            }
        ])
        .to_string();
        conn.execute(
            "INSERT INTO a2a_agent_cards (card_id, name, role, description, protocol_version, version, url, preferred_model_id, fallback_model_ids_json, skills_json, capabilities_json, default_input_modes_json, default_output_modes_json, additional_interfaces_json, logic_language, logic_source, color, enabled, sort_order, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, '0.3.0', '0.1.0', '', '', '[]', ?5, '{}', '[\"text\"]', '[\"text\"]', '[]', 'typescript', '', ?6, 1, ?7, ?8, ?8)",
            params![next_id("card"), name, role, description, skills_json, color, idx as i64, now],
        )?;
    }
    Ok(())
}

pub fn append_event(conn: &Connection, envelope: &A2AEventEnvelope) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;

    apply_projection(&tx, envelope)?;

    let payload_json = serde_json::to_string(&envelope.event)?;
    tx.execute(
        "INSERT OR IGNORE INTO a2a_events (event_id, process_id, event_type, actor, payload_json, occurred_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            envelope.event_id,
            envelope.process_id,
            envelope.event.event_type(),
            envelope.actor,
            payload_json,
            envelope.occurred_at_ms
        ],
    )?;

    let sequence = tx.last_insert_rowid();
    tx.commit()?;
    Ok(sequence)
}

fn apply_projection(conn: &Connection, envelope: &A2AEventEnvelope) -> Result<()> {
    match &envelope.event {
        A2AEvent::ProcessCreated { title, initiator } => {
            conn.execute(
                "INSERT OR IGNORE INTO a2a_processes (process_id, title, initiator, status, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![envelope.process_id, title, initiator, serde_json::to_string(&ProcessStatus::Queued)? .trim_matches('"'), envelope.occurred_at_ms],
            )?;
        }
        A2AEvent::ProcessStatusChanged { status, reason } => {
            conn.execute(
                "UPDATE a2a_processes SET status = ?2, last_error = ?3, updated_at_ms = ?4 WHERE process_id = ?1",
                params![envelope.process_id, enum_name(status)?, reason, envelope.occurred_at_ms],
            )?;
        }
        A2AEvent::AgentRunCreated {
            agent_run_id,
            agent_name,
            parent_run_id,
        } => {
            conn.execute(
                "INSERT OR IGNORE INTO a2a_agent_runs (agent_run_id, process_id, agent_name, parent_run_id, status, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    agent_run_id,
                    envelope.process_id,
                    agent_name,
                    parent_run_id,
                    enum_name(&AgentRunStatus::Queued)?,
                    envelope.occurred_at_ms
                ],
            )?;
        }
        A2AEvent::AgentRunStatusChanged {
            agent_run_id,
            status,
            reason,
        } => {
            conn.execute(
                "UPDATE a2a_agent_runs SET status = ?2, last_error = ?3, updated_at_ms = ?4 WHERE agent_run_id = ?1",
                params![agent_run_id, enum_name(status)?, reason, envelope.occurred_at_ms],
            )?;
        }
        A2AEvent::TaskCreated {
            task_id,
            agent_run_id,
            title,
        } => {
            conn.execute(
                "INSERT OR IGNORE INTO a2a_tasks (task_id, process_id, agent_run_id, title, status, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    task_id,
                    envelope.process_id,
                    agent_run_id,
                    title,
                    enum_name(&TaskStatus::Queued)?,
                    envelope.occurred_at_ms
                ],
            )?;
        }
        A2AEvent::TaskStatusChanged {
            task_id,
            status,
            reason,
        } => {
            conn.execute(
                "UPDATE a2a_tasks SET status = ?2, last_error = ?3, updated_at_ms = ?4 WHERE task_id = ?1",
                params![task_id, enum_name(status)?, reason, envelope.occurred_at_ms],
            )?;
        }
        A2AEvent::EdgeDeclared {
            edge_id,
            from_node,
            to_node,
            kind,
            metadata_json,
        } => {
            conn.execute(
                "INSERT OR REPLACE INTO a2a_edges (edge_id, process_id, from_node, to_node, kind, metadata_json, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    edge_id,
                    envelope.process_id,
                    from_node,
                    to_node,
                    enum_name(kind)?,
                    metadata_json,
                    envelope.occurred_at_ms
                ],
            )?;
        }
        A2AEvent::ArtifactRegistered {
            artifact_id,
            producer_task_id,
            path,
            hash_blake3,
            size_bytes,
            scope,
        } => {
            conn.execute(
                "INSERT OR REPLACE INTO a2a_artifacts (artifact_id, process_id, producer_task_id, path, hash_blake3, size_bytes, scope, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    artifact_id,
                    envelope.process_id,
                    producer_task_id,
                    path,
                    hash_blake3,
                    size_bytes,
                    scope,
                    envelope.occurred_at_ms
                ],
            )?;
        }
        A2AEvent::MemoryRefWritten {
            memory_ref_id,
            namespace,
            key,
            scope,
            writer,
        } => {
            let created_at_ms: i64 = conn
                .query_row(
                    "SELECT created_at_ms FROM a2a_memory_refs WHERE memory_ref_id = ?1",
                    params![memory_ref_id],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or(envelope.occurred_at_ms);

            conn.execute(
                "INSERT OR REPLACE INTO a2a_memory_refs (memory_ref_id, process_id, namespace, key, scope, last_writer, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    memory_ref_id,
                    envelope.process_id,
                    namespace,
                    key,
                    scope,
                    writer,
                    created_at_ms,
                    envelope.occurred_at_ms
                ],
            )?;
        }
    }

    Ok(())
}

fn enum_name<T: Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_string(value)?.trim_matches('"').to_string())
}

pub fn list_processes(
    conn: &Connection,
    limit: i64,
    offset: i64,
) -> Result<Vec<A2AProcessSummary>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            p.process_id,
            p.title,
            p.initiator,
            p.status,
            p.created_at_ms,
            p.updated_at_ms,
            COALESCE((SELECT COUNT(*) FROM a2a_tasks t WHERE t.process_id = p.process_id), 0) AS task_count,
            COALESCE((SELECT COUNT(*) FROM a2a_tasks t WHERE t.process_id = p.process_id AND t.status = 'running'), 0) AS running_task_count,
            COALESCE((SELECT COUNT(*) FROM a2a_tasks t WHERE t.process_id = p.process_id AND t.status = 'blocked'), 0) AS blocked_task_count
        FROM a2a_processes p
        ORDER BY p.updated_at_ms DESC
        LIMIT ?1 OFFSET ?2
        "#,
    )?;

    let rows = stmt
        .query_map(params![limit.max(1), offset.max(0)], |row| {
            Ok(A2AProcessSummary {
                process_id: row.get(0)?,
                title: row.get(1)?,
                initiator: row.get(2)?,
                status: row.get(3)?,
                created_at_ms: row.get(4)?,
                updated_at_ms: row.get(5)?,
                task_count: row.get(6)?,
                running_task_count: row.get(7)?,
                blocked_task_count: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(rows)
}

pub fn get_process_detail(conn: &Connection, process_id: &str) -> Result<Option<A2AProcessDetail>> {
    let process = conn
        .query_row(
            "SELECT process_id, title, initiator, status, last_error, created_at_ms, updated_at_ms FROM a2a_processes WHERE process_id = ?1",
            params![process_id],
            |row| {
                Ok(A2AProcessRecord {
                    process_id: row.get(0)?,
                    title: row.get(1)?,
                    initiator: row.get(2)?,
                    status: row.get(3)?,
                    last_error: row.get(4)?,
                    created_at_ms: row.get(5)?,
                    updated_at_ms: row.get(6)?,
                })
            },
        )
        .optional()?;

    let Some(process) = process else {
        return Ok(None);
    };

    let agent_runs = collect_query(
        conn,
        "SELECT agent_run_id, process_id, agent_name, parent_run_id, status, last_error, created_at_ms, updated_at_ms FROM a2a_agent_runs WHERE process_id = ?1 ORDER BY updated_at_ms DESC",
        process_id,
        |row| {
            Ok(A2AAgentRunRecord {
                agent_run_id: row.get(0)?,
                process_id: row.get(1)?,
                agent_name: row.get(2)?,
                parent_run_id: row.get(3)?,
                status: row.get(4)?,
                last_error: row.get(5)?,
                created_at_ms: row.get(6)?,
                updated_at_ms: row.get(7)?,
            })
        },
    )?;

    let tasks = collect_query(
        conn,
        "SELECT task_id, process_id, agent_run_id, title, status, last_error, created_at_ms, updated_at_ms FROM a2a_tasks WHERE process_id = ?1 ORDER BY updated_at_ms DESC",
        process_id,
        |row| {
            Ok(A2ATaskRecord {
                task_id: row.get(0)?,
                process_id: row.get(1)?,
                agent_run_id: row.get(2)?,
                title: row.get(3)?,
                status: row.get(4)?,
                last_error: row.get(5)?,
                created_at_ms: row.get(6)?,
                updated_at_ms: row.get(7)?,
            })
        },
    )?;

    let edges = collect_query(
        conn,
        "SELECT edge_id, process_id, from_node, to_node, kind, metadata_json, created_at_ms FROM a2a_edges WHERE process_id = ?1 ORDER BY created_at_ms DESC",
        process_id,
        |row| {
            Ok(A2AEdgeRecord {
                edge_id: row.get(0)?,
                process_id: row.get(1)?,
                from_node: row.get(2)?,
                to_node: row.get(3)?,
                kind: row.get(4)?,
                metadata_json: row.get(5)?,
                created_at_ms: row.get(6)?,
            })
        },
    )?;

    let artifacts = collect_query(
        conn,
        "SELECT artifact_id, process_id, producer_task_id, path, hash_blake3, size_bytes, scope, created_at_ms FROM a2a_artifacts WHERE process_id = ?1 ORDER BY created_at_ms DESC",
        process_id,
        |row| {
            Ok(A2AArtifactRecord {
                artifact_id: row.get(0)?,
                process_id: row.get(1)?,
                producer_task_id: row.get(2)?,
                path: row.get(3)?,
                hash_blake3: row.get(4)?,
                size_bytes: row.get(5)?,
                scope: row.get(6)?,
                created_at_ms: row.get(7)?,
            })
        },
    )?;

    let memory_refs = collect_query(
        conn,
        "SELECT memory_ref_id, process_id, namespace, key, scope, last_writer, created_at_ms, updated_at_ms FROM a2a_memory_refs WHERE process_id = ?1 ORDER BY updated_at_ms DESC",
        process_id,
        |row| {
            Ok(A2AMemoryRefRecord {
                memory_ref_id: row.get(0)?,
                process_id: row.get(1)?,
                namespace: row.get(2)?,
                key: row.get(3)?,
                scope: row.get(4)?,
                last_writer: row.get(5)?,
                created_at_ms: row.get(6)?,
                updated_at_ms: row.get(7)?,
            })
        },
    )?;

    Ok(Some(A2AProcessDetail {
        process,
        agent_runs,
        tasks,
        edges,
        artifacts,
        memory_refs,
    }))
}

pub fn list_process_events(
    conn: &Connection,
    process_id: &str,
    limit: i64,
) -> Result<Vec<A2AStoredEvent>> {
    let mut stmt = conn.prepare(
        "SELECT sequence, event_id, process_id, event_type, actor, payload_json, occurred_at_ms FROM a2a_events WHERE process_id = ?1 ORDER BY sequence DESC LIMIT ?2",
    )?;

    let rows = stmt
        .query_map(params![process_id, limit.max(1)], |row| {
            Ok(A2AStoredEvent {
                sequence: row.get(0)?,
                event_id: row.get(1)?,
                process_id: row.get(2)?,
                event_type: row.get(3)?,
                actor: row.get(4)?,
                payload_json: row.get(5)?,
                occurred_at_ms: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(rows)
}

pub fn list_agent_cards(conn: &Connection) -> Result<Vec<A2AAgentCardRecord>> {
    let mut stmt = conn.prepare(
        "SELECT card_id, name, role, description, protocol_version, version, url, preferred_model_id, fallback_model_ids_json, skills_json, capabilities_json, default_input_modes_json, default_output_modes_json, additional_interfaces_json, logic_language, logic_source, color, enabled, sort_order, created_at_ms, updated_at_ms
         FROM a2a_agent_cards
         ORDER BY sort_order ASC, updated_at_ms DESC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(A2AAgentCardRecord {
                card_id: row.get(0)?,
                name: row.get(1)?,
                role: row.get(2)?,
                description: row.get(3)?,
                protocol_version: row.get(4)?,
                version: row.get(5)?,
                url: row.get(6)?,
                preferred_model_id: row.get(7)?,
                fallback_model_ids_json: row.get(8)?,
                skills_json: row.get(9)?,
                capabilities_json: row.get(10)?,
                default_input_modes_json: row.get(11)?,
                default_output_modes_json: row.get(12)?,
                additional_interfaces_json: row.get(13)?,
                logic_language: row.get(14)?,
                logic_source: row.get(15)?,
                color: row.get(16)?,
                enabled: row.get::<_, i64>(17)? != 0,
                sort_order: row.get(18)?,
                created_at_ms: row.get(19)?,
                updated_at_ms: row.get(20)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub fn create_agent_card(
    conn: &Connection,
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
) -> Result<A2AAgentCardRecord> {
    let now = now_ms();
    let card_id = next_id("card");
    let order = if let Some(v) = sort_order {
        v
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM a2a_agent_cards",
            [],
            |row| row.get::<_, i64>(0),
        )?
    };
    let record = A2AAgentCardRecord {
        card_id: card_id.clone(),
        name,
        role,
        description,
        protocol_version: protocol_version.unwrap_or_else(|| "0.3.0".to_string()),
        version: version.unwrap_or_else(|| "0.1.0".to_string()),
        url: url.unwrap_or_default(),
        preferred_model_id: preferred_model_id.unwrap_or_default(),
        fallback_model_ids_json: fallback_model_ids_json.unwrap_or_else(|| "[]".to_string()),
        skills_json: skills_json.unwrap_or_else(|| "[]".to_string()),
        capabilities_json: capabilities_json.unwrap_or_else(|| "{}".to_string()),
        default_input_modes_json: default_input_modes_json
            .unwrap_or_else(|| "[\"text\"]".to_string()),
        default_output_modes_json: default_output_modes_json
            .unwrap_or_else(|| "[\"text\"]".to_string()),
        additional_interfaces_json: additional_interfaces_json.unwrap_or_else(|| "[]".to_string()),
        logic_language: logic_language.unwrap_or_else(|| "typescript".to_string()),
        logic_source: logic_source.unwrap_or_default(),
        color: color.unwrap_or_else(|| "text-text-med".to_string()),
        enabled: enabled.unwrap_or(true),
        sort_order: order,
        created_at_ms: now,
        updated_at_ms: now,
    };
    conn.execute(
        "INSERT INTO a2a_agent_cards (card_id, name, role, description, protocol_version, version, url, preferred_model_id, fallback_model_ids_json, skills_json, capabilities_json, default_input_modes_json, default_output_modes_json, additional_interfaces_json, logic_language, logic_source, color, enabled, sort_order, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20)",
        params![
            record.card_id,
            record.name,
            record.role,
            record.description,
            record.protocol_version,
            record.version,
            record.url,
            record.preferred_model_id,
            record.fallback_model_ids_json,
            record.skills_json,
            record.capabilities_json,
            record.default_input_modes_json,
            record.default_output_modes_json,
            record.additional_interfaces_json,
            record.logic_language,
            record.logic_source,
            record.color,
            if record.enabled { 1_i64 } else { 0_i64 },
            record.sort_order,
            record.created_at_ms
        ],
    )?;
    Ok(record)
}

#[allow(clippy::too_many_arguments)]
pub fn update_agent_card(
    conn: &Connection,
    card_id: &str,
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
) -> Result<Option<A2AAgentCardRecord>> {
    let current = conn
        .query_row(
            "SELECT card_id, name, role, description, protocol_version, version, url, preferred_model_id, fallback_model_ids_json, skills_json, capabilities_json, default_input_modes_json, default_output_modes_json, additional_interfaces_json, logic_language, logic_source, color, enabled, sort_order, created_at_ms, updated_at_ms FROM a2a_agent_cards WHERE card_id = ?1",
            params![card_id],
            |row| {
                Ok(A2AAgentCardRecord {
                    card_id: row.get(0)?,
                    name: row.get(1)?,
                    role: row.get(2)?,
                    description: row.get(3)?,
                    protocol_version: row.get(4)?,
                    version: row.get(5)?,
                    url: row.get(6)?,
                    preferred_model_id: row.get(7)?,
                    fallback_model_ids_json: row.get(8)?,
                    skills_json: row.get(9)?,
                    capabilities_json: row.get(10)?,
                    default_input_modes_json: row.get(11)?,
                    default_output_modes_json: row.get(12)?,
                    additional_interfaces_json: row.get(13)?,
                    logic_language: row.get(14)?,
                    logic_source: row.get(15)?,
                    color: row.get(16)?,
                    enabled: row.get::<_, i64>(17)? != 0,
                    sort_order: row.get(18)?,
                    created_at_ms: row.get(19)?,
                    updated_at_ms: row.get(20)?,
                })
            },
        )
        .optional()?;
    let Some(mut record) = current else {
        return Ok(None);
    };

    if let Some(v) = name {
        record.name = v;
    }
    if let Some(v) = role {
        record.role = v;
    }
    if let Some(v) = description {
        record.description = v;
    }
    if let Some(v) = protocol_version {
        record.protocol_version = v;
    }
    if let Some(v) = version {
        record.version = v;
    }
    if let Some(v) = url {
        record.url = v;
    }
    if let Some(v) = preferred_model_id {
        record.preferred_model_id = v;
    }
    if let Some(v) = fallback_model_ids_json {
        record.fallback_model_ids_json = v;
    }
    if let Some(v) = skills_json {
        record.skills_json = v;
    }
    if let Some(v) = capabilities_json {
        record.capabilities_json = v;
    }
    if let Some(v) = default_input_modes_json {
        record.default_input_modes_json = v;
    }
    if let Some(v) = default_output_modes_json {
        record.default_output_modes_json = v;
    }
    if let Some(v) = additional_interfaces_json {
        record.additional_interfaces_json = v;
    }
    if let Some(v) = logic_language {
        record.logic_language = v;
    }
    if let Some(v) = logic_source {
        record.logic_source = v;
    }
    if let Some(v) = color {
        record.color = v;
    }
    if let Some(v) = enabled {
        record.enabled = v;
    }
    if let Some(v) = sort_order {
        record.sort_order = v;
    }
    record.updated_at_ms = now_ms();

    conn.execute(
        "UPDATE a2a_agent_cards
         SET name = ?2, role = ?3, description = ?4, protocol_version = ?5, version = ?6, url = ?7, preferred_model_id = ?8, fallback_model_ids_json = ?9, skills_json = ?10, capabilities_json = ?11, default_input_modes_json = ?12, default_output_modes_json = ?13, additional_interfaces_json = ?14, logic_language = ?15, logic_source = ?16, color = ?17, enabled = ?18, sort_order = ?19, updated_at_ms = ?20
         WHERE card_id = ?1",
        params![
            record.card_id,
            record.name,
            record.role,
            record.description,
            record.protocol_version,
            record.version,
            record.url,
            record.preferred_model_id,
            record.fallback_model_ids_json,
            record.skills_json,
            record.capabilities_json,
            record.default_input_modes_json,
            record.default_output_modes_json,
            record.additional_interfaces_json,
            record.logic_language,
            record.logic_source,
            record.color,
            if record.enabled { 1_i64 } else { 0_i64 },
            record.sort_order,
            record.updated_at_ms
        ],
    )?;

    Ok(Some(record))
}

pub fn delete_agent_card(conn: &Connection, card_id: &str) -> Result<bool> {
    let deleted = conn.execute(
        "DELETE FROM a2a_agent_cards WHERE card_id = ?1",
        params![card_id],
    )?;
    Ok(deleted > 0)
}

fn collect_query<T, F>(conn: &Connection, sql: &str, process_id: &str, mut map: F) -> Result<Vec<T>>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![process_id], |row| map(row))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::a2a::types::{next_id, A2AEvent, A2AEventEnvelope, ProcessStatus};

    #[test]
    fn event_append_projects_state() {
        let conn = Connection::open_in_memory().expect("in memory db");
        init_schema(&conn).expect("schema");

        let process_id = next_id("proc");
        let created = A2AEventEnvelope::new(
            process_id.clone(),
            "primary",
            A2AEvent::ProcessCreated {
                title: "Draft release plan".to_string(),
                initiator: "primary-agent".to_string(),
            },
        );
        append_event(&conn, &created).expect("append process created");

        let status = A2AEventEnvelope::new(
            process_id.clone(),
            "primary",
            A2AEvent::ProcessStatusChanged {
                status: ProcessStatus::Running,
                reason: None,
            },
        );
        append_event(&conn, &status).expect("append status changed");

        let list = list_processes(&conn, 10, 0).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].status, "running");

        let events = list_process_events(&conn, &process_id, 10).expect("events");
        assert_eq!(events.len(), 2);
    }
}
