use std::time::Instant;

use arx_domain::{CorrelationId, DomainError, RunId};

#[derive(Debug, Clone, Copy)]
pub struct AgentLoopSettings {
    pub max_steps: usize,
    pub max_tool_calls: usize,
    pub max_duration_ms: u64,
}

pub struct BoundedAgentInput {
    pub correlation_id: CorrelationId,
    pub run_id: RunId,
    pub prompt: String,
    pub settings: AgentLoopSettings,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentReplayStep {
    pub index: usize,
    pub summary: String,
    pub tool_calls_used: usize,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentReplayArtifact {
    pub run_id: String,
    pub correlation_id: String,
    pub final_status: String,
    pub total_steps: usize,
    pub total_tool_calls: usize,
    pub total_elapsed_ms: u64,
    pub steps: Vec<AgentReplayStep>,
}

impl AgentReplayArtifact {
    pub fn to_json(&self) -> String {
        let steps_json = self
            .steps
            .iter()
            .map(|step| {
                format!(
                    "{{\"index\":{},\"summary\":{},\"tool_calls_used\":{},\"elapsed_ms\":{}}}",
                    step.index,
                    json_quote(&step.summary),
                    step.tool_calls_used,
                    step.elapsed_ms
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{{\"run_id\":{},\"correlation_id\":{},\"final_status\":{},\"total_steps\":{},\"total_tool_calls\":{},\"total_elapsed_ms\":{},\"steps\":[{}]}}",
            json_quote(&self.run_id),
            json_quote(&self.correlation_id),
            json_quote(&self.final_status),
            self.total_steps,
            self.total_tool_calls,
            self.total_elapsed_ms,
            steps_json
        )
    }
}

fn json_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[derive(Clone)]
pub struct AgentExecutionUpdate {
    pub summary: String,
    pub tool_calls_used: usize,
    pub done: bool,
}

pub trait AgentLoopExecutor: Send + Sync {
    fn step(&self, prompt: &str, step_index: usize) -> Result<AgentExecutionUpdate, DomainError>;
}

pub struct BoundedAgentResult {
    pub final_status: String,
    pub replay_artifact: AgentReplayArtifact,
}

pub struct RunBoundedAgentUseCase<'a> {
    pub executor: &'a dyn AgentLoopExecutor,
}

impl<'a> RunBoundedAgentUseCase<'a> {
    pub fn execute(&self, input: BoundedAgentInput) -> Result<BoundedAgentResult, DomainError> {
        if input.settings.max_steps == 0 {
            return Err(DomainError::validation(
                "max_steps",
                "must be greater than zero",
            ));
        }
        if input.settings.max_duration_ms == 0 {
            return Err(DomainError::validation(
                "max_duration_ms",
                "must be greater than zero",
            ));
        }
        if input.prompt.trim().is_empty() {
            return Err(DomainError::validation("prompt", "must not be empty"));
        }

        let started = Instant::now();
        let mut steps = Vec::new();
        let mut total_tool_calls = 0usize;
        let mut final_status = "completed".to_string();

        for index in 0..input.settings.max_steps {
            let elapsed_ms = started.elapsed().as_millis() as u64;
            if elapsed_ms > input.settings.max_duration_ms {
                final_status = "time_limit_reached".to_string();
                break;
            }
            if total_tool_calls >= input.settings.max_tool_calls {
                final_status = "tool_call_limit_reached".to_string();
                break;
            }

            let update = self.executor.step(&input.prompt, index)?;
            total_tool_calls = total_tool_calls.saturating_add(update.tool_calls_used);
            let step_elapsed_ms = started.elapsed().as_millis() as u64;
            steps.push(AgentReplayStep {
                index,
                summary: update.summary,
                tool_calls_used: update.tool_calls_used,
                elapsed_ms: step_elapsed_ms,
            });

            if total_tool_calls > input.settings.max_tool_calls {
                final_status = "tool_call_limit_reached".to_string();
                break;
            }
            if step_elapsed_ms > input.settings.max_duration_ms {
                final_status = "time_limit_reached".to_string();
                break;
            }
            if update.done {
                final_status = "completed".to_string();
                break;
            }

            if index + 1 == input.settings.max_steps {
                final_status = "step_limit_reached".to_string();
            }
        }

        let artifact = AgentReplayArtifact {
            run_id: input.run_id.as_str().to_string(),
            correlation_id: input.correlation_id.as_str().to_string(),
            final_status: final_status.clone(),
            total_steps: steps.len(),
            total_tool_calls,
            total_elapsed_ms: started.elapsed().as_millis() as u64,
            steps,
        };

        Ok(BoundedAgentResult {
            final_status,
            replay_artifact: artifact,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::thread;
    use std::time::Duration;

    use arx_domain::{CorrelationId, DomainError, RunId};

    use super::{
        AgentExecutionUpdate, AgentLoopExecutor, AgentLoopSettings, BoundedAgentInput,
        RunBoundedAgentUseCase,
    };

    struct FakeExecutor {
        updates: Vec<AgentExecutionUpdate>,
        idx: Mutex<usize>,
        sleep_ms: u64,
    }

    impl AgentLoopExecutor for FakeExecutor {
        fn step(
            &self,
            _prompt: &str,
            _step_index: usize,
        ) -> Result<AgentExecutionUpdate, DomainError> {
            if self.sleep_ms > 0 {
                thread::sleep(Duration::from_millis(self.sleep_ms));
            }
            let mut idx = self.idx.lock().map_err(|_| DomainError::Internal {
                reason: "idx lock poisoned".to_string(),
            })?;
            let out = self
                .updates
                .get(*idx)
                .cloned()
                .unwrap_or(AgentExecutionUpdate {
                    summary: "default".to_string(),
                    tool_calls_used: 0,
                    done: true,
                });
            *idx += 1;
            Ok(out)
        }
    }

    fn input(settings: AgentLoopSettings) -> BoundedAgentInput {
        BoundedAgentInput {
            correlation_id: CorrelationId::new("corr-loop-1").unwrap(),
            run_id: RunId::new("run-loop-1").unwrap(),
            prompt: "solve task".to_string(),
            settings,
        }
    }

    #[test]
    fn contract_agent_loop_enforces_step_limit() {
        let executor = FakeExecutor {
            updates: vec![
                AgentExecutionUpdate {
                    summary: "s1".to_string(),
                    tool_calls_used: 0,
                    done: false,
                },
                AgentExecutionUpdate {
                    summary: "s2".to_string(),
                    tool_calls_used: 0,
                    done: false,
                },
                AgentExecutionUpdate {
                    summary: "s3".to_string(),
                    tool_calls_used: 0,
                    done: false,
                },
            ],
            idx: Mutex::new(0),
            sleep_ms: 0,
        };
        let use_case = RunBoundedAgentUseCase {
            executor: &executor,
        };
        let result = use_case
            .execute(input(AgentLoopSettings {
                max_steps: 2,
                max_tool_calls: 10,
                max_duration_ms: 1000,
            }))
            .unwrap();
        assert_eq!(result.final_status, "step_limit_reached");
        assert_eq!(result.replay_artifact.total_steps, 2);
    }

    #[test]
    fn contract_agent_loop_enforces_tool_call_limit() {
        let executor = FakeExecutor {
            updates: vec![AgentExecutionUpdate {
                summary: "uses tools".to_string(),
                tool_calls_used: 3,
                done: false,
            }],
            idx: Mutex::new(0),
            sleep_ms: 0,
        };
        let use_case = RunBoundedAgentUseCase {
            executor: &executor,
        };
        let result = use_case
            .execute(input(AgentLoopSettings {
                max_steps: 5,
                max_tool_calls: 2,
                max_duration_ms: 1000,
            }))
            .unwrap();
        assert_eq!(result.final_status, "tool_call_limit_reached");
    }

    #[test]
    fn contract_agent_loop_enforces_duration_limit() {
        let executor = FakeExecutor {
            updates: vec![AgentExecutionUpdate {
                summary: "slow step".to_string(),
                tool_calls_used: 0,
                done: false,
            }],
            idx: Mutex::new(0),
            sleep_ms: 20,
        };
        let use_case = RunBoundedAgentUseCase {
            executor: &executor,
        };
        let result = use_case
            .execute(input(AgentLoopSettings {
                max_steps: 5,
                max_tool_calls: 5,
                max_duration_ms: 5,
            }))
            .unwrap();
        assert_eq!(result.final_status, "time_limit_reached");
    }

    #[test]
    fn contract_replay_artifact_is_deterministic_json_shape() {
        let executor = FakeExecutor {
            updates: vec![AgentExecutionUpdate {
                summary: "done quickly".to_string(),
                tool_calls_used: 1,
                done: true,
            }],
            idx: Mutex::new(0),
            sleep_ms: 0,
        };
        let use_case = RunBoundedAgentUseCase {
            executor: &executor,
        };
        let result = use_case
            .execute(input(AgentLoopSettings {
                max_steps: 5,
                max_tool_calls: 5,
                max_duration_ms: 1000,
            }))
            .unwrap();

        let json = result.replay_artifact.to_json();
        assert!(json.contains("\"run_id\":\"run-loop-1\""));
        assert!(json.contains("\"correlation_id\":\"corr-loop-1\""));
        assert!(json.contains("\"steps\":["));
        assert!(json.contains("\"summary\":\"done quickly\""));
    }
}
