use crate::contracts::{EventSeverity, EventStage, Subsystem};
use crate::observability::EventHub;
use arx_rs::tools::Tool;
use arx_rs::types::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MAX_CHARS_PER_LINE: usize = 2000;
const MAX_LINES_PER_READ: usize = 2000;

pub struct NotepadReadTool;

pub struct NotepadWriteTool {
    hub: EventHub,
    correlation_id: String,
}

pub struct NotepadEditLinesTool {
    hub: EventHub,
    correlation_id: String,
}

impl NotepadWriteTool {
    pub fn new(hub: EventHub, correlation_id: String) -> Self {
        Self {
            hub,
            correlation_id,
        }
    }
}

impl NotepadEditLinesTool {
    pub fn new(hub: EventHub, correlation_id: String) -> Self {
        Self {
            hub,
            correlation_id,
        }
    }
}

#[async_trait]
impl Tool for NotepadReadTool {
    fn name(&self) -> &'static str {
        "notepad_read"
    }

    fn description(&self) -> &'static str {
        "Read a text document for the Notepad tool, with optional line-range pagination."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "start_line": { "type": "integer", "minimum": 1 },
                "end_line": { "type": "integer", "minimum": 1 }
            },
            "required": ["path"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        params
            .get("path")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string()
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(path) = params.get("path").and_then(|value| value.as_str()) else {
            return tool_error("missing path");
        };
        let resolved = PathBuf::from(path);
        if !resolved.exists() {
            return tool_error(format!("Document not found: {}", resolved.display()));
        }
        if !resolved.is_file() {
            return tool_error(format!("Path is not a file: {}", resolved.display()));
        }
        let Ok(content) = tokio::fs::read_to_string(&resolved).await else {
            return tool_error(format!("Failed to read document: {}", resolved.display()));
        };

        let total_lines = count_lines(&content);
        let requested_start = params
            .get("start_line")
            .and_then(|value| value.as_u64())
            .unwrap_or(1) as usize;
        let mut requested_end = params
            .get("end_line")
            .and_then(|value| value.as_u64())
            .map(|value| value as usize)
            .unwrap_or(requested_start.saturating_add(MAX_LINES_PER_READ - 1));
        if requested_start == 0 {
            return tool_error("start_line must be at least 1");
        }
        if requested_end < requested_start {
            requested_end = requested_start;
        }
        let end_line = requested_end.min(requested_start.saturating_add(MAX_LINES_PER_READ - 1));
        let rendered = render_line_range(&content, requested_start, end_line);
        let line_count = rendered.lines().count();

        ToolResult {
            success: true,
            result: Some(rendered),
            images: None,
            display: Some(format!(
                "Read {} lines from {} ({} total lines)",
                line_count,
                resolved.display(),
                total_lines
            )),
        }
    }
}

#[async_trait]
impl Tool for NotepadWriteTool {
    fn name(&self) -> &'static str {
        "notepad_write"
    }

    fn description(&self) -> &'static str {
        "Create or overwrite a text document in Notepad and open/sync it in the workspace."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" }
            },
            "required": ["path", "content"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        params
            .get("path")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string()
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(path) = params.get("path").and_then(|value| value.as_str()) else {
            return tool_error("missing path");
        };
        let Some(content) = params.get("content").and_then(|value| value.as_str()) else {
            return tool_error("missing content");
        };
        let resolved = PathBuf::from(path);
        if let Err(message) = ensure_parent_dirs(&resolved).await {
            return tool_error(message);
        }
        let existed = resolved.exists();
        if let Err(error) = tokio::fs::write(&resolved, content).await {
            return tool_error(format!("Failed to write document: {error}"));
        }
        emit_notepad_sync(
            &self.hub,
            self.correlation_id.as_str(),
            resolved.as_path(),
            content,
        );
        let action = if existed { "Updated" } else { "Created" };
        ToolResult {
            success: true,
            result: Some(format!("{} {}", action, resolved.display())),
            images: None,
            display: Some(format!("{} document {} in Notepad", action, resolved.display())),
        }
    }
}

#[async_trait]
impl Tool for NotepadEditLinesTool {
    fn name(&self) -> &'static str {
        "notepad_edit_lines"
    }

    fn description(&self) -> &'static str {
        "Edit a specific inclusive line range in a Notepad document without recreating the whole file."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "start_line": { "type": "integer", "minimum": 1 },
                "end_line": { "type": "integer", "minimum": 1 },
                "replacement": { "type": "string" }
            },
            "required": ["path", "start_line", "end_line", "replacement"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        let path = params
            .get("path")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let start = params
            .get("start_line")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let end = params
            .get("end_line")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        format!("{}:{}-{}", path, start, end)
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(path) = params.get("path").and_then(|value| value.as_str()) else {
            return tool_error("missing path");
        };
        let Some(start_line) = params.get("start_line").and_then(|value| value.as_u64()) else {
            return tool_error("missing start_line");
        };
        let Some(end_line) = params.get("end_line").and_then(|value| value.as_u64()) else {
            return tool_error("missing end_line");
        };
        let Some(replacement) = params.get("replacement").and_then(|value| value.as_str()) else {
            return tool_error("missing replacement");
        };
        let start_line = start_line as usize;
        let end_line = end_line as usize;
        if start_line == 0 || end_line == 0 {
            return tool_error("start_line and end_line must be at least 1");
        }
        if end_line < start_line {
            return tool_error("end_line must be greater than or equal to start_line");
        }

        let resolved = PathBuf::from(path);
        if !resolved.exists() {
            return tool_error(format!("Document not found: {}", resolved.display()));
        }
        let Ok(original) = tokio::fs::read_to_string(&resolved).await else {
            return tool_error(format!("Failed to read document: {}", resolved.display()));
        };
        let total_lines = count_lines(&original);
        if start_line > total_lines || end_line > total_lines {
            return tool_error(format!(
                "Requested line range {}-{} is outside document bounds ({} lines)",
                start_line, end_line, total_lines
            ));
        }

        let updated = replace_line_range(&original, start_line, end_line, replacement);
        if let Err(error) = tokio::fs::write(&resolved, &updated).await {
            return tool_error(format!("Failed to update document: {error}"));
        }
        emit_notepad_sync(
            &self.hub,
            self.correlation_id.as_str(),
            resolved.as_path(),
            &updated,
        );
        ToolResult {
            success: true,
            result: Some(format!(
                "Updated lines {}-{} in {}",
                start_line,
                end_line,
                resolved.display()
            )),
            images: None,
            display: Some(format!(
                "Updated document lines {}-{} in Notepad",
                start_line, end_line
            )),
        }
    }
}

async fn ensure_parent_dirs(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("Failed to create parent directories: {error}"))?;
    }
    Ok(())
}

fn emit_notepad_sync(hub: &EventHub, correlation_id: &str, path: &Path, content: &str) {
    hub.emit(hub.make_event(
        correlation_id,
        Subsystem::Tool,
        "notepad.document.sync",
        EventStage::Complete,
        EventSeverity::Info,
        json!({
            "path": path.display().to_string(),
            "title": path.file_name().and_then(|value| value.to_str()).unwrap_or("Document"),
            "content": content,
            "sizeBytes": content.len(),
            "activate": true,
            "focusTool": true,
            "readOnly": false
        }),
    ));
}

fn replace_line_range(content: &str, start_line: usize, end_line: usize, replacement: &str) -> String {
    let had_trailing_newline = content.ends_with('\n');
    let mut original_lines: Vec<String> = content.lines().map(ToOwned::to_owned).collect();
    let replacement_lines: Vec<String> = replacement.lines().map(ToOwned::to_owned).collect();
    original_lines.splice(start_line - 1..end_line, replacement_lines);
    let mut updated = original_lines.join("\n");
    if had_trailing_newline && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated
}

fn render_line_range(content: &str, start_line: usize, end_line: usize) -> String {
    let mut out = String::new();
    for (idx, line) in content.lines().enumerate() {
        let line_no = idx + 1;
        if line_no < start_line || line_no > end_line {
            continue;
        }
        let mut display = line.to_string();
        if display.len() > MAX_CHARS_PER_LINE {
            display.truncate(MAX_CHARS_PER_LINE);
            display.push_str(&format!(
                " [output truncated after {} chars]",
                MAX_CHARS_PER_LINE
            ));
        }
        out.push_str(&format!("{:6}\t{}\n", line_no, display));
    }
    out
}

fn count_lines(content: &str) -> usize {
    let count = content.lines().count();
    if count == 0 { 1 } else { count }
}

fn tool_error(message: impl Into<String>) -> ToolResult {
    let message = message.into();
    ToolResult {
        success: false,
        result: Some(message.clone()),
        images: None,
        display: Some(message),
    }
}
