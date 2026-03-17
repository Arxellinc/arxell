use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, ok, Tool};
use crate::types::ToolResult;

const MAX_CHARS_PER_LINE: usize = 2000;
const MAX_LINES_PER_FILE: usize = 2000;

pub struct ReadTool;

#[async_trait]
impl Tool for ReadTool {
    fn name(&self) -> &'static str {
        "read"
    }

    fn description(&self) -> &'static str {
        "Read file contents with optional offset/limit pagination."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "path":{"type":"string"},
                "offset":{"type":"integer"},
                "limit":{"type":"integer"}
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

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(path) = params.get("path").and_then(|v| v.as_str()) else {
            return err("missing path");
        };
        let offset = params.get("offset").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
        let limit = params
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(MAX_LINES_PER_FILE)
            .min(MAX_LINES_PER_FILE);

        let p = PathBuf::from(path);
        if !p.exists() {
            return err(format!("Path not found: {}", path));
        }
        if !p.is_file() {
            return err(format!("Path is not a file: {}", path));
        }

        let txt = match tokio::fs::read_to_string(&p).await {
            Ok(t) => t,
            Err(e) => return err(format!("Failed to read: {}", e)),
        };

        let mut out = String::new();
        let mut count = 0usize;
        for (idx, line) in txt.lines().enumerate().skip(offset.saturating_sub(1)) {
            if count >= limit {
                out.push_str(&format!("[output truncated after {} lines]\n", limit));
                break;
            }
            let mut line = line.to_string();
            if line.len() > MAX_CHARS_PER_LINE {
                line.truncate(MAX_CHARS_PER_LINE);
                line.push_str(&format!(
                    " [output truncated after {} chars]",
                    MAX_CHARS_PER_LINE
                ));
            }
            out.push_str(&format!("{:6}\t{}\n", idx + 1, line));
            count += 1;
        }

        ok(out.clone(), format!("Read {} lines", count))
    }
}
