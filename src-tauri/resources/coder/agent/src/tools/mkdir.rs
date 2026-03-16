use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, Tool};
use crate::types::ToolResult;

pub struct MkdirTool;

#[async_trait]
impl Tool for MkdirTool {
    fn name(&self) -> &'static str {
        "mkdir"
    }

    fn description(&self) -> &'static str {
        "Create one or more directories (mkdir -p semantics)."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "path":{"type":"string"},
                "parents":{"type":"boolean"}
            },
            "required":["path"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        params
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    }

    async fn execute(&self, params: Value, _cancel: Option<tokio::sync::watch::Receiver<bool>>) -> ToolResult {
        let Some(path) = params.get("path").and_then(|v| v.as_str()) else {
            return err("missing path");
        };
        let parents = params.get("parents").and_then(|v| v.as_bool()).unwrap_or(true);
        let p = PathBuf::from(path);

        let res = if parents {
            tokio::fs::create_dir_all(&p).await
        } else {
            tokio::fs::create_dir(&p).await
        };

        match res {
            Ok(_) => ToolResult {
                success: true,
                result: Some(format!("Created directory {}", p.display())),
                images: None,
                display: Some(format!("Created directory {}", p.display())),
            },
            Err(e) => err(format!("Failed to create directory: {}", e)),
        }
    }
}
