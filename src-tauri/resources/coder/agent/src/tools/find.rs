use async_trait::async_trait;
use globset::Glob;
use ignore::WalkBuilder;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, Tool};
use crate::types::ToolResult;

const MAX_RESULTS: usize = 100;

pub struct FindTool;

#[async_trait]
impl Tool for FindTool {
    fn name(&self) -> &'static str {
        "find"
    }

    fn description(&self) -> &'static str {
        "Find files by glob pattern, respecting .gitignore."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "pattern":{"type":"string"},
                "path":{"type":"string"}
            },
            "required":["pattern"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        let pattern = params.get("pattern").and_then(|v| v.as_str()).unwrap_or_default();
        let path = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        format!("{} in {}", pattern, path)
    }

    async fn execute(&self, params: Value, _cancel: Option<tokio::sync::watch::Receiver<bool>>) -> ToolResult {
        let Some(pattern) = params.get("pattern").and_then(|v| v.as_str()) else {
            return err("missing pattern");
        };
        let root = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let root = PathBuf::from(root);
        if !root.exists() {
            return err(format!("Path not found: {}", root.display()));
        }

        let glob = match Glob::new(pattern) {
            Ok(g) => g.compile_matcher(),
            Err(e) => return err(format!("invalid glob pattern: {}", e)),
        };

        let mut items: Vec<(String, u128)> = Vec::new();
        let walker = WalkBuilder::new(&root).hidden(false).build();
        for dent in walker.flatten() {
            let p = dent.path();
            if !p.is_file() {
                continue;
            }
            let rel = p.strip_prefix(&root).unwrap_or(p).to_string_lossy().to_string();
            if glob.is_match(&rel) {
                let mtime = std::fs::metadata(p)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .map(|d| d.as_millis())
                    .unwrap_or(u128::MAX);
                items.push((rel, mtime));
            }
        }

        items.sort_by_key(|(_, age)| *age);
        items.truncate(MAX_RESULTS);

        if items.is_empty() {
            return ToolResult {
                success: true,
                result: Some("No files found matching pattern".to_string()),
                images: None,
                display: Some("No files found".to_string()),
            };
        }

        let result = items.into_iter().map(|x| x.0).collect::<Vec<_>>().join("\n");
        ToolResult {
            success: true,
            result: Some(result.clone()),
            images: None,
            display: Some(format!("{} files found", result.lines().count())),
        }
    }
}
