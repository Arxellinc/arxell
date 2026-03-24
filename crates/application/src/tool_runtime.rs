use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use arx_domain::{tool::ToolContext, AppEvent, CorrelationId, DomainError, RunId, Tool, ToolInput};

use crate::EventPublisher;

const DEFAULT_TIMEOUT_MS: u64 = 15_000;
const MIN_TIMEOUT_MS: u64 = 1;
const MAX_TIMEOUT_MS: u64 = 300_000;

pub trait ToolRegistry: Send + Sync {
    fn get(&self, tool_id: &str) -> Option<&dyn Tool>;
}

#[derive(Default)]
pub struct InMemoryToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl InMemoryToolRegistry {
    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        let id = tool.descriptor().id.clone();
        self.tools.insert(id, tool);
    }
}

impl ToolRegistry for InMemoryToolRegistry {
    fn get(&self, tool_id: &str) -> Option<&dyn Tool> {
        self.tools.get(tool_id).map(|tool| tool.as_ref())
    }
}

#[derive(Debug, Clone)]
pub struct ToolRunInput {
    pub correlation_id: CorrelationId,
    pub run_id: RunId,
    pub tool_call_id: String,
    pub tool_id: String,
    pub payload_json: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolRunResult {
    pub payload_json: String,
}

pub struct ToolRunner<'a> {
    pub registry: &'a dyn ToolRegistry,
    pub event_publisher: &'a dyn EventPublisher,
}

impl<'a> ToolRunner<'a> {
    pub fn run_with_cancel_check(
        &self,
        input: ToolRunInput,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<ToolRunResult, DomainError> {
        let tool_call_id = input.tool_call_id.trim().to_string();
        if tool_call_id.is_empty() {
            return Err(DomainError::validation("tool_call_id", "must not be empty"));
        }

        let tool_id = input.tool_id.trim().to_string();
        if tool_id.is_empty() {
            return Err(DomainError::validation("tool_id", "must not be empty"));
        }

        if is_cancelled() {
            return Err(DomainError::Conflict {
                reason: "tool call cancelled before execution".to_string(),
            });
        }

        let tool = self
            .registry
            .get(&tool_id)
            .ok_or_else(|| DomainError::NotFound {
                entity: "tool",
                id: tool_id.clone(),
            })?;

        let timeout_ms = input
            .timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
        let now_ms = now_unix_ms();
        let deadline_ms = now_ms.saturating_add(timeout_ms);
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);

        self.event_publisher.publish(AppEvent::ToolCallStarted {
            correlation_id: input.correlation_id.clone(),
            run_id: input.run_id.clone(),
            tool_call_id: tool_call_id.clone(),
            tool_id: tool_id.clone(),
        })?;

        let context = RunnerToolContext {
            deadline_ms: Some(deadline_ms),
            is_cancelled,
        };
        let execute_result = tool.execute(
            &context,
            ToolInput {
                payload_json: input.payload_json,
            },
        );

        let result = match execute_result {
            Ok(output) => {
                if is_cancelled() {
                    Err(DomainError::Conflict {
                        reason: "tool call cancelled during execution".to_string(),
                    })
                } else if Instant::now() > deadline {
                    Err(DomainError::Conflict {
                        reason: format!("tool call timed out after {}ms", timeout_ms),
                    })
                } else {
                    Ok(ToolRunResult {
                        payload_json: output.payload_json,
                    })
                }
            }
            Err(error) => Err(error),
        };

        self.event_publisher.publish(AppEvent::ToolCallFinished {
            correlation_id: input.correlation_id,
            run_id: input.run_id,
            tool_call_id,
        })?;

        result
    }
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

struct RunnerToolContext<'a> {
    deadline_ms: Option<u64>,
    is_cancelled: &'a dyn Fn() -> bool,
}

impl ToolContext for RunnerToolContext<'_> {
    fn deadline_ms(&self) -> Option<u64> {
        self.deadline_ms
    }

    fn is_cancelled(&self) -> bool {
        (self.is_cancelled)()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    use arx_domain::{
        AppEvent, CorrelationId, DomainError, RunId, Tool, ToolDescriptor, ToolInput, ToolOutput,
    };

    use crate::EventPublisher;

    use super::{InMemoryToolRegistry, ToolRunInput, ToolRunner};

    struct TestEventPublisher {
        events: Mutex<Vec<AppEvent>>,
    }

    impl TestEventPublisher {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }
    }

    impl EventPublisher for TestEventPublisher {
        fn publish(&self, event: AppEvent) -> Result<(), DomainError> {
            let mut guard = self.events.lock().map_err(|_| DomainError::Internal {
                reason: "event lock poisoned".to_string(),
            })?;
            guard.push(event);
            Ok(())
        }
    }

    struct EchoTool;

    impl Tool for EchoTool {
        fn descriptor(&self) -> &ToolDescriptor {
            static DESCRIPTOR: std::sync::OnceLock<ToolDescriptor> = std::sync::OnceLock::new();
            DESCRIPTOR.get_or_init(|| ToolDescriptor {
                id: "echo".to_string(),
                version: "1.0.0".to_string(),
                description: "Echo payload".to_string(),
            })
        }

        fn execute(
            &self,
            _context: &dyn arx_domain::tool::ToolContext,
            input: ToolInput,
        ) -> Result<ToolOutput, DomainError> {
            Ok(ToolOutput {
                payload_json: input.payload_json,
            })
        }
    }

    struct SleepTool;

    impl Tool for SleepTool {
        fn descriptor(&self) -> &ToolDescriptor {
            static DESCRIPTOR: std::sync::OnceLock<ToolDescriptor> = std::sync::OnceLock::new();
            DESCRIPTOR.get_or_init(|| ToolDescriptor {
                id: "sleep".to_string(),
                version: "1.0.0".to_string(),
                description: "Sleeps briefly".to_string(),
            })
        }

        fn execute(
            &self,
            _context: &dyn arx_domain::tool::ToolContext,
            input: ToolInput,
        ) -> Result<ToolOutput, DomainError> {
            thread::sleep(Duration::from_millis(15));
            Ok(ToolOutput {
                payload_json: input.payload_json,
            })
        }
    }

    fn test_input(tool_call_id: &str, tool_id: &str, timeout_ms: Option<u64>) -> ToolRunInput {
        ToolRunInput {
            correlation_id: CorrelationId::new("corr-tool-run-1").unwrap(),
            run_id: RunId::new("run-tool-run-1").unwrap(),
            tool_call_id: tool_call_id.to_string(),
            tool_id: tool_id.to_string(),
            payload_json: "{\"ok\":true}".to_string(),
            timeout_ms,
        }
    }

    #[test]
    fn contract_tool_runner_emits_started_and_finished_with_tool_call_id() {
        let mut registry = InMemoryToolRegistry::default();
        registry.register(Arc::new(EchoTool));
        let event_publisher = TestEventPublisher::new();

        let runner = ToolRunner {
            registry: &registry,
            event_publisher: &event_publisher,
        };

        let result = runner
            .run_with_cancel_check(test_input("call-1", "echo", Some(100)), &|| false)
            .unwrap();
        assert_eq!(result.payload_json, "{\"ok\":true}");

        let events = event_publisher.events.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0],
            AppEvent::ToolCallStarted {
                tool_call_id,
                tool_id,
                ..
            } if tool_call_id == "call-1" && tool_id == "echo"
        ));
        assert!(matches!(
            &events[1],
            AppEvent::ToolCallFinished { tool_call_id, .. } if tool_call_id == "call-1"
        ));
    }

    #[test]
    fn contract_tool_runner_enforces_timeout() {
        let mut registry = InMemoryToolRegistry::default();
        registry.register(Arc::new(SleepTool));
        let event_publisher = TestEventPublisher::new();
        let runner = ToolRunner {
            registry: &registry,
            event_publisher: &event_publisher,
        };

        let err = runner
            .run_with_cancel_check(test_input("call-timeout", "sleep", Some(1)), &|| false)
            .unwrap_err();
        assert!(matches!(err, DomainError::Conflict { .. }));
        assert!(format!("{err}").contains("timed out"));

        let events = event_publisher.events.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], AppEvent::ToolCallStarted { .. }));
        assert!(matches!(events[1], AppEvent::ToolCallFinished { .. }));
    }

    #[test]
    fn contract_tool_runner_enforces_cancellation() {
        let mut registry = InMemoryToolRegistry::default();
        registry.register(Arc::new(EchoTool));
        let event_publisher = TestEventPublisher::new();
        let runner = ToolRunner {
            registry: &registry,
            event_publisher: &event_publisher,
        };

        let err = runner
            .run_with_cancel_check(test_input("call-cancelled", "echo", Some(100)), &|| true)
            .unwrap_err();
        assert!(matches!(err, DomainError::Conflict { .. }));
        assert!(format!("{err}").contains("cancelled"));

        let events = event_publisher.events.lock().unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn contract_tool_runner_validates_required_fields() {
        let registry = InMemoryToolRegistry::default();
        let event_publisher = TestEventPublisher::new();
        let runner = ToolRunner {
            registry: &registry,
            event_publisher: &event_publisher,
        };

        let err = runner
            .run_with_cancel_check(test_input("", "echo", Some(100)), &|| false)
            .unwrap_err();
        assert!(matches!(err, DomainError::Validation { field, .. } if field == "tool_call_id"));
    }
}
