use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, Tool};
use crate::types::ToolResult;

pub struct LsTool;

#[async_trait]
impl Tool for LsTool {
    fn name(&self) -> &'static str {
        "ls"
    }

    fn description(&self) -> &'static str {
        "List directory entries with basic metadata."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "path":{"type":"string"},
                "all":{"type":"boolean"}
            },
            "required":[]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        params
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(".")
            .to_string()
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let path = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let show_all = params.get("all").and_then(|v| v.as_bool()).unwrap_or(false);

        let p = PathBuf::from(path);
        if !p.exists() {
            return err(format!("Path not found: {}", p.display()));
        }
        if !p.is_dir() {
            return err(format!("Path is not a directory: {}", p.display()));
        }

        let mut entries = match tokio::fs::read_dir(&p).await {
            Ok(e) => e,
            Err(e) => return err(format!("Failed to read directory: {}", e)),
        };

        let mut out: Vec<String> = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !show_all && name.starts_with('.') {
                continue;
            }
            let md = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };
            let ty = if md.is_dir() { "d" } else { "f" };
            let size = md.len();
            out.push(format!("{} {:>10} {}", ty, size, name));
        }
        out.sort();

        let result = if out.is_empty() {
            "(empty directory)".to_string()
        } else {
            out.join("\n")
        };

        ToolResult {
            success: true,
            result: Some(result.clone()),
            images: None,
            display: Some(format!("{} entries", out.len())),
        }
    }
}
