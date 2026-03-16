use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, ok, Tool};
use crate::types::ToolResult;

pub struct EditTool;

#[async_trait]
impl Tool for EditTool {
    fn name(&self) -> &'static str {
        "edit"
    }

    fn description(&self) -> &'static str {
        "Edit a file by replacing exact text; supports replace_all."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "path":{"type":"string"},
                "old_string":{"type":"string"},
                "new_string":{"type":"string"},
                "replace_all":{"type":"boolean"}
            },
            "required":["path","old_string","new_string"]
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
        let Some(old_string) = params.get("old_string").and_then(|v| v.as_str()) else {
            return err("missing old_string");
        };
        let Some(new_string) = params.get("new_string").and_then(|v| v.as_str()) else {
            return err("missing new_string");
        };
        let replace_all = params
            .get("replace_all")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let p = PathBuf::from(path);
        if !p.exists() {
            return err(format!("File not found: {}", path));
        }

        let original = match tokio::fs::read_to_string(&p).await {
            Ok(t) => t,
            Err(e) => return err(format!("Failed to read file: {}", e)),
        };

        if !original.contains(old_string) {
            return err("old_string not found in file");
        }

        let updated = if replace_all {
            original.replace(old_string, new_string)
        } else {
            original.replacen(old_string, new_string, 1)
        };

        if let Err(e) = tokio::fs::write(&p, &updated).await {
            return err(format!("Failed to write file: {}", e));
        }

        let added = updated.lines().count() as i64;
        let removed = original.lines().count() as i64;
        ok(
            format!("Updated {} +{} -{}", p.display(), added, removed),
            format!("Updated {} +{} -{}", p.display(), added, removed),
        )
    }
}
