use async_trait::async_trait;
use serde_json::Value;
use tokio::process::Command;

use crate::tools::{err, Tool};
use crate::types::ToolResult;

const DEFAULT_TIMEOUT: u64 = 180;
const MAX_OUTPUT_BYTES: usize = 50 * 1024;
const MAX_OUTPUT_LINES: usize = 2000;

pub struct BashTool;

#[async_trait]
impl Tool for BashTool {
    fn name(&self) -> &'static str {
        "bash"
    }

    fn description(&self) -> &'static str {
        "Execute shell commands in the current working directory."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "command":{"type":"string"},
                "timeout":{"type":"integer"}
            },
            "required":["command"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        params
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(command) = params.get("command").and_then(|v| v.as_str()) else {
            return err("missing command");
        };
        if command.trim().is_empty() {
            return err("command cannot be empty");
        }
        let timeout = params
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT);

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut cmd = Command::new(shell);
        cmd.arg("-lc").arg(command);

        let out = match tokio::time::timeout(std::time::Duration::from_secs(timeout), cmd.output())
            .await
        {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => return err(format!("command failed: {}", e)),
            Err(_) => return err(format!("Command timed out after {}s", timeout)),
        };

        let mut text = String::new();
        text.push_str(&String::from_utf8_lossy(&out.stdout));
        if !out.stderr.is_empty() {
            if !text.is_empty() {
                text.push_str("\n[stderr]\n");
            }
            text.push_str(&String::from_utf8_lossy(&out.stderr));
        }
        text = text.replace('\r', "");
        let lines: Vec<&str> = text.lines().collect();
        let mut tail = lines
            .iter()
            .rev()
            .take(MAX_OUTPUT_LINES)
            .copied()
            .collect::<Vec<_>>();
        tail.reverse();
        let mut compact = tail.join("\n");
        if compact.len() > MAX_OUTPUT_BYTES {
            compact = compact[compact.len().saturating_sub(MAX_OUTPUT_BYTES)..].to_string();
        }

        ToolResult {
            success: out.status.success(),
            result: Some(if compact.is_empty() {
                "(no output)".to_string()
            } else {
                compact.clone()
            }),
            images: None,
            display: Some(if out.status.success() {
                compact
            } else {
                format!("Exit code {:?}\n{}", out.status.code(), compact)
            }),
        }
    }
}
