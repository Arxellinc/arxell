pub mod ports;
pub mod tool_runtime;
pub mod usecases;

pub use ports::{EventPublisher, MessageStore, RunStore};
pub use tool_runtime::{
    InMemoryToolRegistry, ToolRegistry, ToolRunInput, ToolRunResult, ToolRunner,
};
pub use usecases::cancel_run::{CancelRunInput, CancelRunResult, CancelRunUseCase};
pub use usecases::extract_memory::{
    ExtractMemoryInput, ExtractMemoryResult, ExtractMemoryUseCase, MemoryExtractionFlag,
};
pub use usecases::retrieve_memory::{
    RetrieveMemoryInput, RetrieveMemoryResult, RetrieveMemoryUseCase,
};
pub use usecases::run_bounded_agent::{
    AgentLoopExecutor, AgentLoopSettings, AgentReplayArtifact, AgentReplayStep, BoundedAgentInput,
    BoundedAgentResult, RunBoundedAgentUseCase,
};
pub use usecases::send_message::{SendMessageInput, SendMessageResult, SendMessageUseCase};

#[cfg(test)]
mod contract_tests;
