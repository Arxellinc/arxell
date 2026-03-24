use crate::contracts::{EventSeverity, EventStage, Subsystem, ToolInvokeRequest, ToolInvokeResponse};
use crate::observability::EventHub;
use crate::tools::tool::{Tool, ToolError};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

pub struct ToolRegistry {
    hub: EventHub,
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new(hub: EventHub) -> Self {
        Self {
            hub,
            tools: HashMap::new(),
        }
    }

    pub fn register<T: Tool + 'static>(&mut self, tool: T) {
        self.tools.insert(tool.id().to_string(), Arc::new(tool));
    }

    pub fn invoke(&self, req: ToolInvokeRequest) -> Result<ToolInvokeResponse, ToolError> {
        let correlation_id = req.correlation_id.clone();
        self.hub.emit(self.hub.make_event(
            &correlation_id,
            Subsystem::Registry,
            "tool.invoke",
            EventStage::Start,
            EventSeverity::Info,
            json!({"toolId": req.tool_id, "action": req.action, "mode": req.mode}),
        ));

        let tool = self
            .tools
            .get(req.tool_id.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed(format!("unknown tool: {}", req.tool_id)))?;

        let result = tool.invoke(req);

        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Registry,
                "tool.invoke",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"toolId": response.tool_id, "action": response.action, "ok": response.ok}),
            )),
            Err(err) => self.hub.emit(self.hub.make_event(
                &correlation_id,
                Subsystem::Registry,
                "tool.invoke",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": err.to_string()}),
            )),
        }

        result
    }
}
