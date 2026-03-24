use crate::contracts::{ToolInvokeRequest, ToolInvokeResponse};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ToolError {
    #[error("invalid action: {0}")]
    InvalidAction(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("execution failed: {0}")]
    ExecutionFailed(String),
}

pub trait Tool: Send + Sync {
    fn id(&self) -> &'static str;
    fn invoke(&self, req: ToolInvokeRequest) -> Result<ToolInvokeResponse, ToolError>;
}
