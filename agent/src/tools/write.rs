use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, ok, Tool};
use crate::types::ToolResult;

pub struct WriteTool;

#[async_trait]
impl Tool for WriteTool {
    fn name(&self) -> &'static str {
        "write"
    }

    fn description(&self) -> &'static str {
        "Write content to a file; creates parent directories as needed."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "path":{"type":"string"},
                "content":{"type":"string"}
            },
            "required":["path","content"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        params
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(path) = params.get("path").and_then(|v| v.as_str()) else {
            return err("missing path");
        };
        let Some(content) = params.get("content").and_then(|v| v.as_str()) else {
            return err("missing content");
        };

        let p = PathBuf::from(path);
        if let Some(parent) = p.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                return err(format!("failed to create parent directories: {}", e));
            }
        }

        let existed = p.exists();
        if let Err(e) = tokio::fs::write(&p, content).await {
            return err(format!("failed to write file: {}", e));
        }

        let lines = content.lines().count().max(1);
        let action = if existed { "Overwrote" } else { "Created" };
        ok(
            format!("{} {} +{}", action, p.display(), lines),
            format!("{} {} +{}", action, p.display(), lines),
        )
    }
}
