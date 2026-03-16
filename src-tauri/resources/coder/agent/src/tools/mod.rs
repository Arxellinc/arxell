pub mod bash;
pub mod chmod;
pub mod edit;
pub mod find;
pub mod grep;
pub mod ls;
pub mod mkdir;
pub mod move_file;
pub mod read;
pub mod write;

use async_trait::async_trait;
use serde_json::Value;

use crate::types::{ToolDefinition, ToolResult};

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn schema(&self) -> Value;
    fn format_call(&self, params: &Value) -> String;
    async fn execute(&self, params: Value, cancel: Option<tokio::sync::watch::Receiver<bool>>) -> ToolResult;
}

pub fn default_tools() -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(read::ReadTool),
        Box::new(edit::EditTool),
        Box::new(write::WriteTool),
        Box::new(ls::LsTool),
        Box::new(mkdir::MkdirTool),
        Box::new(move_file::MoveTool),
        Box::new(chmod::ChmodTool),
        Box::new(bash::BashTool),
        Box::new(grep::GrepTool),
        Box::new(find::FindTool),
    ]
}

pub fn tool_definitions(tools: &[Box<dyn Tool>]) -> Vec<ToolDefinition> {
    tools
        .iter()
        .map(|t| ToolDefinition {
            name: t.name().to_string(),
            description: t.description().to_string(),
            parameters: t.schema(),
        })
        .collect()
}

pub fn tool_by_name<'a>(tools: &'a [Box<dyn Tool>], name: &str) -> Option<&'a dyn Tool> {
    tools.iter().find(|t| t.name() == name).map(|t| t.as_ref())
}

pub(crate) fn err(msg: impl Into<String>) -> ToolResult {
    ToolResult {
        success: false,
        result: None,
        images: None,
        display: Some(msg.into()),
    }
}

pub(crate) fn ok(result: impl Into<String>, display: impl Into<String>) -> ToolResult {
    ToolResult {
        success: true,
        result: Some(result.into()),
        images: None,
        display: Some(display.into()),
    }
}
