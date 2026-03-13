use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessStatus {
    Queued,
    Running,
    Blocked,
    Failed,
    Succeeded,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunStatus {
    Queued,
    Running,
    Waiting,
    Blocked,
    Failed,
    Succeeded,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Running,
    Blocked,
    Failed,
    Succeeded,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    DelegatesTo,
    DependsOn,
    ReadsFile,
    WritesFile,
    ReadsMemory,
    WritesMemory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum A2AEvent {
    ProcessCreated {
        title: String,
        initiator: String,
    },
    ProcessStatusChanged {
        status: ProcessStatus,
        reason: Option<String>,
    },
    AgentRunCreated {
        agent_run_id: String,
        agent_name: String,
        parent_run_id: Option<String>,
    },
    AgentRunStatusChanged {
        agent_run_id: String,
        status: AgentRunStatus,
        reason: Option<String>,
    },
    TaskCreated {
        task_id: String,
        agent_run_id: Option<String>,
        title: String,
    },
    TaskStatusChanged {
        task_id: String,
        status: TaskStatus,
        reason: Option<String>,
    },
    EdgeDeclared {
        edge_id: String,
        from_node: String,
        to_node: String,
        kind: EdgeKind,
        metadata_json: Option<String>,
    },
    ArtifactRegistered {
        artifact_id: String,
        producer_task_id: Option<String>,
        path: String,
        hash_blake3: String,
        size_bytes: i64,
        scope: String,
    },
    MemoryRefWritten {
        memory_ref_id: String,
        namespace: String,
        key: String,
        scope: String,
        writer: String,
    },
}

impl A2AEvent {
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::ProcessCreated { .. } => "process_created",
            Self::ProcessStatusChanged { .. } => "process_status_changed",
            Self::AgentRunCreated { .. } => "agent_run_created",
            Self::AgentRunStatusChanged { .. } => "agent_run_status_changed",
            Self::TaskCreated { .. } => "task_created",
            Self::TaskStatusChanged { .. } => "task_status_changed",
            Self::EdgeDeclared { .. } => "edge_declared",
            Self::ArtifactRegistered { .. } => "artifact_registered",
            Self::MemoryRefWritten { .. } => "memory_ref_written",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AEventEnvelope {
    pub event_id: String,
    pub process_id: String,
    pub actor: String,
    pub occurred_at_ms: i64,
    pub event: A2AEvent,
}

impl A2AEventEnvelope {
    pub fn new(process_id: impl Into<String>, actor: impl Into<String>, event: A2AEvent) -> Self {
        Self {
            event_id: format!("evt_{}", Uuid::new_v4().simple()),
            process_id: process_id.into(),
            actor: actor.into(),
            occurred_at_ms: now_ms(),
            event,
        }
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn next_id(prefix: &str) -> String {
    format!("{}_{}", prefix, Uuid::new_v4().simple())
}
