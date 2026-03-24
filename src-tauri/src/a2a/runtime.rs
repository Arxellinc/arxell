use anyhow::Result;
use rusqlite::Connection;

use super::store;
use super::types::{
    next_id, A2AEvent, A2AEventEnvelope, AgentRunStatus, EdgeKind, ProcessStatus, TaskStatus,
};

pub struct A2ARuntime<'a> {
    conn: &'a Connection,
}

impl<'a> A2ARuntime<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn create_process(&self, title: &str, initiator: &str, actor: &str) -> Result<String> {
        let process_id = next_id("proc");
        let created = A2AEventEnvelope::new(
            process_id.clone(),
            actor,
            A2AEvent::ProcessCreated {
                title: title.to_string(),
                initiator: initiator.to_string(),
            },
        );
        store::append_event(self.conn, &created)?;
        self.set_process_status(&process_id, ProcessStatus::Running, None, actor)?;
        Ok(process_id)
    }

    pub fn set_process_status(
        &self,
        process_id: &str,
        status: ProcessStatus,
        reason: Option<String>,
        actor: &str,
    ) -> Result<()> {
        let event = A2AEventEnvelope::new(
            process_id,
            actor,
            A2AEvent::ProcessStatusChanged { status, reason },
        );
        store::append_event(self.conn, &event)?;
        Ok(())
    }

    pub fn retry_process(&self, process_id: &str, actor: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE a2a_tasks SET status = 'queued', last_error = NULL, updated_at_ms = strftime('%s','now') * 1000
             WHERE process_id = ?1 AND status IN ('failed', 'blocked')",
            [process_id],
        )?;
        self.conn.execute(
            "UPDATE a2a_agent_runs SET status = 'queued', last_error = NULL, updated_at_ms = strftime('%s','now') * 1000
             WHERE process_id = ?1 AND status IN ('failed', 'blocked', 'waiting')",
            [process_id],
        )?;
        self.set_process_status(
            process_id,
            ProcessStatus::Running,
            Some("retry_requested".to_string()),
            actor,
        )
    }

    pub fn create_agent_run(
        &self,
        process_id: &str,
        agent_name: &str,
        parent_run_id: Option<String>,
        actor: &str,
    ) -> Result<String> {
        let agent_run_id = next_id("run");
        let created = A2AEventEnvelope::new(
            process_id,
            actor,
            A2AEvent::AgentRunCreated {
                agent_run_id: agent_run_id.clone(),
                agent_name: agent_name.to_string(),
                parent_run_id,
            },
        );
        store::append_event(self.conn, &created)?;
        self.set_agent_run_status(
            process_id,
            &agent_run_id,
            AgentRunStatus::Running,
            None,
            actor,
        )?;
        Ok(agent_run_id)
    }

    pub fn set_agent_run_status(
        &self,
        process_id: &str,
        agent_run_id: &str,
        status: AgentRunStatus,
        reason: Option<String>,
        actor: &str,
    ) -> Result<()> {
        let event = A2AEventEnvelope::new(
            process_id,
            actor,
            A2AEvent::AgentRunStatusChanged {
                agent_run_id: agent_run_id.to_string(),
                status,
                reason,
            },
        );
        store::append_event(self.conn, &event)?;
        Ok(())
    }

    pub fn create_task(
        &self,
        process_id: &str,
        agent_run_id: Option<String>,
        title: &str,
        actor: &str,
    ) -> Result<String> {
        let task_id = next_id("task");
        let created = A2AEventEnvelope::new(
            process_id,
            actor,
            A2AEvent::TaskCreated {
                task_id: task_id.clone(),
                agent_run_id,
                title: title.to_string(),
            },
        );
        store::append_event(self.conn, &created)?;
        Ok(task_id)
    }

    pub fn set_task_status(
        &self,
        process_id: &str,
        task_id: &str,
        status: TaskStatus,
        reason: Option<String>,
        actor: &str,
    ) -> Result<()> {
        let event = A2AEventEnvelope::new(
            process_id,
            actor,
            A2AEvent::TaskStatusChanged {
                task_id: task_id.to_string(),
                status,
                reason,
            },
        );
        store::append_event(self.conn, &event)?;
        Ok(())
    }

    pub fn declare_edge(
        &self,
        process_id: &str,
        from_node: &str,
        to_node: &str,
        kind: EdgeKind,
        metadata_json: Option<String>,
        actor: &str,
    ) -> Result<String> {
        let edge_id = next_id("edge");
        let event = A2AEventEnvelope::new(
            process_id,
            actor,
            A2AEvent::EdgeDeclared {
                edge_id: edge_id.clone(),
                from_node: from_node.to_string(),
                to_node: to_node.to_string(),
                kind,
                metadata_json,
            },
        );
        store::append_event(self.conn, &event)?;
        Ok(edge_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn register_artifact(
        &self,
        process_id: &str,
        producer_task_id: Option<String>,
        path: &str,
        hash_blake3: &str,
        size_bytes: i64,
        scope: &str,
        actor: &str,
    ) -> Result<String> {
        let artifact_id = next_id("artifact");
        let event = A2AEventEnvelope::new(
            process_id,
            actor,
            A2AEvent::ArtifactRegistered {
                artifact_id: artifact_id.clone(),
                producer_task_id,
                path: path.to_string(),
                hash_blake3: hash_blake3.to_string(),
                size_bytes,
                scope: scope.to_string(),
            },
        );
        store::append_event(self.conn, &event)?;
        Ok(artifact_id)
    }

    pub fn write_memory_ref(
        &self,
        process_id: &str,
        namespace: &str,
        key: &str,
        scope: &str,
        writer: &str,
        actor: &str,
    ) -> Result<String> {
        let memory_ref_id = next_id("mem");
        let event = A2AEventEnvelope::new(
            process_id,
            actor,
            A2AEvent::MemoryRefWritten {
                memory_ref_id: memory_ref_id.clone(),
                namespace: namespace.to_string(),
                key: key.to_string(),
                scope: scope.to_string(),
                writer: writer.to_string(),
            },
        );
        store::append_event(self.conn, &event)?;
        Ok(memory_ref_id)
    }

    pub fn seed_demo_process(&self) -> Result<String> {
        let process_id = self.create_process(
            "Coordinate release readiness",
            "primary-agent",
            "primary-agent",
        )?;

        let planner_run =
            self.create_agent_run(&process_id, "planner-agent", None, "primary-agent")?;
        let executor_run = self.create_agent_run(
            &process_id,
            "executor-agent",
            Some(planner_run.clone()),
            "primary-agent",
        )?;

        let t1 = self.create_task(
            &process_id,
            Some(planner_run.clone()),
            "Assemble dependency graph",
            "planner-agent",
        )?;
        self.set_task_status(
            &process_id,
            &t1,
            TaskStatus::Succeeded,
            None,
            "planner-agent",
        )?;

        let t2 = self.create_task(
            &process_id,
            Some(executor_run.clone()),
            "Patch critical bug",
            "executor-agent",
        )?;
        self.set_task_status(
            &process_id,
            &t2,
            TaskStatus::Running,
            None,
            "executor-agent",
        )?;

        self.declare_edge(
            &process_id,
            &planner_run,
            &executor_run,
            EdgeKind::DelegatesTo,
            Some("{\"handoff\":\"release-plan\"}".to_string()),
            "primary-agent",
        )?;

        self.declare_edge(
            &process_id,
            &t1,
            &t2,
            EdgeKind::DependsOn,
            None,
            "primary-agent",
        )?;

        self.register_artifact(
            &process_id,
            Some(t1),
            "workspace/release-plan.md",
            "demo_blake3_hash",
            2048,
            "process",
            "planner-agent",
        )?;

        self.write_memory_ref(
            &process_id,
            "release",
            "risk_register",
            "shared",
            "planner-agent",
            "planner-agent",
        )?;

        Ok(process_id)
    }
}
