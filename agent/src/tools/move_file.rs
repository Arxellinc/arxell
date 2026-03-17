use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, Tool};
use crate::types::ToolResult;

pub struct MoveTool;

#[async_trait]
impl Tool for MoveTool {
    fn name(&self) -> &'static str {
        "move"
    }

    fn description(&self) -> &'static str {
        "Move or rename a file/directory."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "from":{"type":"string"},
                "to":{"type":"string"}
            },
            "required":["from","to"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        let from = params
            .get("from")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let to = params
            .get("to")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        format!("{} -> {}", from, to)
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(from) = params.get("from").and_then(|v| v.as_str()) else {
            return err("missing from");
        };
        let Some(to) = params.get("to").and_then(|v| v.as_str()) else {
            return err("missing to");
        };

        let src = PathBuf::from(from);
        let dst = PathBuf::from(to);
        if !src.exists() {
            return err(format!("Source not found: {}", src.display()));
        }

        if let Some(parent) = dst.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                return err(format!("Failed to create destination directory: {}", e));
            }
        }

        match tokio::fs::rename(&src, &dst).await {
            Ok(_) => ToolResult {
                success: true,
                result: Some(format!("Moved {} -> {}", src.display(), dst.display())),
                images: None,
                display: Some(format!("Moved {} -> {}", src.display(), dst.display())),
            },
            Err(e) => err(format!("Failed to move: {}", e)),
        }
    }
}
