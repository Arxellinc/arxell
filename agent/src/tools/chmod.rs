use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, Tool};
use crate::types::ToolResult;

pub struct ChmodTool;

#[async_trait]
impl Tool for ChmodTool {
    fn name(&self) -> &'static str {
        "chmod"
    }

    fn description(&self) -> &'static str {
        "Set unix permission mode on a file/directory (e.g. 644, 755)."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "path":{"type":"string"},
                "mode":{"type":"string"}
            },
            "required":["path","mode"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let mode = params
            .get("mode")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        format!("{} {}", mode, path)
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(path) = params.get("path").and_then(|v| v.as_str()) else {
            return err("missing path");
        };
        let Some(mode_str) = params.get("mode").and_then(|v| v.as_str()) else {
            return err("missing mode");
        };

        let p = PathBuf::from(path);
        if !p.exists() {
            return err(format!("Path not found: {}", p.display()));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = match u32::from_str_radix(mode_str, 8) {
                Ok(m) => m,
                Err(_) => return err("invalid mode; expected octal string like 644 or 755"),
            };
            match tokio::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode)).await {
                Ok(_) => ToolResult {
                    success: true,
                    result: Some(format!("Set mode {} on {}", mode_str, p.display())),
                    images: None,
                    display: Some(format!("Set mode {} on {}", mode_str, p.display())),
                },
                Err(e) => err(format!("Failed to chmod: {}", e)),
            }
        }

        #[cfg(not(unix))]
        {
            let _ = mode_str;
            err("chmod tool is currently supported on unix platforms only")
        }
    }
}
