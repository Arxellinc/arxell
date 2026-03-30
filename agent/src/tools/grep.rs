use async_trait::async_trait;
use globset::Glob;
use ignore::WalkBuilder;
use regex::Regex;
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::{err, Tool};
use crate::types::ToolResult;

const MAX_MATCHES: usize = 100;
const MAX_LINE_LENGTH: usize = 2000;

pub struct GrepTool;

#[async_trait]
impl Tool for GrepTool {
    fn name(&self) -> &'static str {
        "grep"
    }

    fn description(&self) -> &'static str {
        "Search file contents with regex, respecting .gitignore."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type":"object",
            "properties":{
                "pattern":{"type":"string"},
                "path":{"type":"string"},
                "include":{"type":"string"}
            },
            "required":["pattern"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        let pattern = params
            .get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let path = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        format!("{} in {}", pattern, path)
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(pattern) = params.get("pattern").and_then(|v| v.as_str()) else {
            return err("missing pattern");
        };
        let root = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let include = params.get("include").and_then(|v| v.as_str());

        let root = PathBuf::from(root);
        if !root.exists() {
            return err(format!("Path not found: {}", root.display()));
        }

        let re = match Regex::new(pattern) {
            Ok(r) => r,
            Err(e) => return err(format!("invalid regex pattern: {}", e)),
        };
        let include_matcher = include
            .and_then(|g| Glob::new(g).ok())
            .map(|g| g.compile_matcher());

        let mut matches: Vec<(String, usize, String, u128)> = Vec::new();
        let walker = WalkBuilder::new(&root).hidden(false).build();

        for dent in walker.flatten() {
            let p = dent.path();
            if !p.is_file() {
                continue;
            }
            let rel = p
                .strip_prefix(&root)
                .unwrap_or(p)
                .to_string_lossy()
                .to_string();
            if let Some(glob) = &include_matcher {
                if !glob.is_match(&rel) {
                    continue;
                }
            }

            let content = match std::fs::read_to_string(p) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let age = std::fs::metadata(p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .map(|d| d.as_millis())
                .unwrap_or(u128::MAX);

            for (i, line) in content.lines().enumerate() {
                if re.is_match(line) {
                    let mut s = line.to_string();
                    if s.len() > MAX_LINE_LENGTH {
                        s.truncate(MAX_LINE_LENGTH);
                        s.push_str("...");
                    }
                    matches.push((rel.clone(), i + 1, s, age));
                    if matches.len() >= MAX_MATCHES {
                        break;
                    }
                }
            }
            if matches.len() >= MAX_MATCHES {
                break;
            }
        }

        matches.sort_by_key(|m| m.3);

        if matches.is_empty() {
            return ToolResult {
                success: true,
                result: Some("No matches found".to_string()),
                images: None,
                display: Some("No matches found".to_string()),
            };
        }

        let mut out = String::new();
        out.push_str(&format!("Found {} matches\n", matches.len()));
        let mut cur = String::new();
        for (path, line_no, line, _) in matches {
            if path != cur {
                cur = path.clone();
                out.push_str(&format!("\n{}:\n", path));
            }
            out.push_str(&format!("  Line {}: {}\n", line_no, line));
        }

        ToolResult {
            success: true,
            result: Some(out.clone()),
            images: None,
            display: Some(format!("{} matches", out.matches("  Line ").count())),
        }
    }
}
