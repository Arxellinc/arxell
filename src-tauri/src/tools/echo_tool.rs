use crate::contracts::{ToolInvokeRequest, ToolInvokeResponse};
use crate::tools::tool::{Tool, ToolError};

pub struct EchoTool;

impl Tool for EchoTool {
    fn id(&self) -> &'static str {
        "echo"
    }

    fn invoke(&self, req: ToolInvokeRequest) -> Result<ToolInvokeResponse, ToolError> {
        if req.action != "echo.say" {
            return Err(ToolError::InvalidAction(req.action));
        }

        Ok(ToolInvokeResponse {
            correlation_id: req.correlation_id,
            tool_id: req.tool_id,
            action: "echo.say".to_string(),
            ok: true,
            data: req.payload,
            error: None,
        })
    }
}
