use crate::contracts::{EventSeverity, EventStage, Subsystem};
use crate::observability::EventHub;
use arx_rs::tools::Tool;
use arx_rs::types::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

const MAX_CHARS_PER_LINE: usize = 2000;
const MAX_LINES_PER_READ: usize = 2000;
const MAX_INSPECT_DOCS: usize = 20;

#[derive(Debug, Clone)]
struct SyncedDocument {
    path: String,
    title: String,
    lines: usize,
}

pub struct NotepadSyncRegistry {
    docs: Arc<RwLock<Vec<SyncedDocument>>>,
}

impl NotepadSyncRegistry {
    pub fn new() -> Self {
        Self {
            docs: Arc::new(RwLock::new(Vec::new())),
        }
    }

    fn record(&self, path: &Path, content: &str) {
        let entry = SyncedDocument {
            path: path.display().to_string(),
            title: path
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("Document")
                .to_string(),
            lines: count_lines(content),
        };
        if let Ok(mut docs) = self.docs.write() {
            docs.retain(|d| d.path != entry.path);
            docs.push(entry);
            while docs.len() > MAX_INSPECT_DOCS {
                docs.remove(0);
            }
        }
    }

    pub fn snapshot(&self) -> Vec<SyncedDocument> {
        self.docs
            .read()
            .map(|docs| docs.clone())
            .unwrap_or_default()
    }

    pub fn clone_registry(&self) -> NotepadSyncRegistry {
        NotepadSyncRegistry {
            docs: Arc::clone(&self.docs),
        }
    }
}

pub struct NotepadInspectTool {
    registry: NotepadSyncRegistry,
}

pub struct NotepadReadTool;

pub struct NotepadWriteTool {
    hub: EventHub,
    correlation_id: String,
    registry: NotepadSyncRegistry,
}

pub struct NotepadEditLinesTool {
    hub: EventHub,
    correlation_id: String,
    registry: NotepadSyncRegistry,
}

impl NotepadInspectTool {
    pub fn new(registry: NotepadSyncRegistry) -> Self {
        Self { registry }
    }
}

impl NotepadWriteTool {
    pub fn new(hub: EventHub, correlation_id: String, registry: NotepadSyncRegistry) -> Self {
        Self {
            hub,
            correlation_id,
            registry,
        }
    }
}

impl NotepadEditLinesTool {
    pub fn new(hub: EventHub, correlation_id: String, registry: NotepadSyncRegistry) -> Self {
        Self {
            hub,
            correlation_id,
            registry,
        }
    }
}

#[async_trait]
impl Tool for NotepadInspectTool {
    fn name(&self) -> &'static str {
        "notepad_inspect"
    }

    fn description(&self) -> &'static str {
        "Discover which documents are currently open or recently synced in the Notepad workspace tool. Returns paths, titles, and line counts. Always call this before reading or editing to find the correct path."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {}
        })
    }

    fn format_call(&self, _params: &Value) -> String {
        "inspect".to_string()
    }

    async fn execute(
        &self,
        _params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let docs = self.registry.snapshot();
        if docs.is_empty() {
            return ToolResult {
                success: true,
                result: Some(
                    r#"{"documents":[],"hint":"No documents have been synced yet. Use notepad_write to create one (path is optional)."}"#.to_string(),
                ),
                images: None,
                display: Some("No Notepad documents open".to_string()),
            };
        }
        let items: Vec<Value> = docs
            .iter()
            .map(|d| {
                json!({
                    "path": d.path,
                    "title": d.title,
                    "lines": d.lines
                })
            })
            .collect();
        let last = docs.last();
        let payload = json!({
            "documents": items,
            "active_path": last.as_ref().map(|d| d.path.clone()),
            "active_title": last.as_ref().map(|d| d.title.clone()),
            "active_lines": last.as_ref().map(|d| d.lines),
        });
        ToolResult {
            success: true,
            result: Some(serde_json::to_string(&payload).unwrap_or_default()),
            images: None,
            display: Some(format!("{} Notepad document(s) open", docs.len())),
        }
    }
}

#[async_trait]
impl Tool for NotepadReadTool {
    fn name(&self) -> &'static str {
        "notepad_read"
    }

    fn description(&self) -> &'static str {
        "Read a Notepad document with optional line-range pagination. Use notepad_inspect first to discover open documents and their paths. Returns numbered lines for use with notepad_edit_lines."
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
            return tool_error("missing path. Use notepad_inspect to discover available documents.");
        };
        let resolved = PathBuf::from(path);
        if !resolved.exists() {
            return tool_error(format!(
                "Document not found: {}. Use notepad_inspect to discover open documents.",
                resolved.display()
            ));
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
        "Create a new document in the Notepad workspace tool. The `path` parameter is optional — if omitted, a draft path is auto-generated under the user's Arxell/Files directory. Use this ONLY for creating new documents. For editing existing documents, prefer notepad_edit_lines to avoid rewriting the whole file."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Optional file path. If omitted, a draft path is auto-generated in the Arxell/Files directory." },
                "content": { "type": "string" }
            },
            "required": ["content"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        params
            .get("path")
            .and_then(|value| value.as_str())
            .unwrap_or("(auto-generated)")
            .to_string()
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(content) = params.get("content").and_then(|value| value.as_str()) else {
            return tool_error("missing content");
        };
        let explicit_path = params.get("path").and_then(|value| value.as_str());
        let resolved = match explicit_path {
            Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
            _ => generate_draft_path(),
        };
        if let Err(message) = ensure_parent_dirs(&resolved).await {
            return tool_error(message);
        }
        let existed = resolved.exists();
        if let Err(error) = tokio::fs::write(&resolved, content).await {
            return tool_error(format!("Failed to write document: {error}"));
        }
        self.registry.record(&resolved, content);
        emit_notepad_sync(
            &self.hub,
            self.correlation_id.as_str(),
            resolved.as_path(),
            content,
        );
        let action = if existed { "Updated" } else { "Created" };
        ToolResult {
            success: true,
            result: Some(format!(
                "{} {} ({} lines)",
                action,
                resolved.display(),
                count_lines(content)
            )),
            images: None,
            display: Some(format!(
                "{} document {} in Notepad",
                action,
                resolved.display()
            )),
        }
    }
}

#[async_trait]
impl Tool for NotepadEditLinesTool {
    fn name(&self) -> &'static str {
        "notepad_edit_lines"
    }

    fn description(&self) -> &'static str {
        "Edit specific lines in an existing Notepad document. Replaces lines start_line through end_line (inclusive, 1-indexed) with the replacement text. Always notepad_read the document first to understand its structure and get exact line numbers. Prefer this over notepad_write for ANY modification to an existing document."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "File path from notepad_inspect or a previously created document" },
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
            return tool_error("missing path. Use notepad_inspect to discover open documents.");
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
            return tool_error(format!(
                "Document not found: {}. Use notepad_inspect to discover open documents.",
                resolved.display()
            ));
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
        self.registry.record(&resolved, &updated);
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

fn generate_draft_path() -> PathBuf {
    let files_dir = resolve_arxell_files_dir();
    let _ = std::fs::create_dir_all(&files_dir);
    let base = files_dir.join("draft");
    let mut candidate = base.with_extension("md");
    if !candidate.exists() {
        return candidate;
    }
    for i in 2..100u32 {
        candidate = files_dir.join(format!("draft-{i}.md"));
        if !candidate.exists() {
            return candidate;
        }
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    files_dir.join(format!("draft-{ts}.md"))
}

fn resolve_arxell_files_dir() -> PathBuf {
    let documents_root = dirs::document_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")));
    documents_root.join("Arxell").join("Files")
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

fn replace_line_range(
    content: &str,
    start_line: usize,
    end_line: usize,
    replacement: &str,
) -> String {
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
    if count == 0 {
        1
    } else {
        count
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_draft_path_creates_sequential_names() {
        let dir = resolve_arxell_files_dir();
        let _ = std::fs::create_dir_all(&dir);
        let first = generate_draft_path();
        assert!(first.to_string_lossy().ends_with("draft.md"));
        let _ = std::fs::write(&first, "test");
        let second = generate_draft_path();
        assert!(second.to_string_lossy().ends_with("draft-2.md"));
        let _ = std::fs::remove_file(&first);
    }

    #[test]
    fn inspect_returns_empty_for_new_registry() {
        let registry = NotepadSyncRegistry::new();
        let docs = registry.snapshot();
        assert!(docs.is_empty());
    }

    #[test]
    fn inspect_tracks_synced_documents() {
        let registry = NotepadSyncRegistry::new();
        registry.record(Path::new("/tmp/test-doc.md"), "line1\nline2\n");
        let docs = registry.snapshot();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].title, "test-doc.md");
        assert_eq!(docs[0].lines, 2);
    }

    #[test]
    fn inspect_deduplicates_by_path() {
        let registry = NotepadSyncRegistry::new();
        registry.record(Path::new("/tmp/doc.md"), "v1");
        registry.record(Path::new("/tmp/doc.md"), "v2\nv3\n");
        let docs = registry.snapshot();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].lines, 2);
    }

    #[tokio::test]
    async fn write_without_path_auto_generates_draft() {
        let registry = NotepadSyncRegistry::new();
        let hub = EventHub::new();
        let tool = NotepadWriteTool::new(hub, "test-corr".to_string(), registry);
        let result = tool
            .execute(json!({"content": "hello world"}), None)
            .await;
        assert!(result.success);
        let path_str = result.result.unwrap();
        assert!(path_str.contains("draft"));
        let path = PathBuf::from(
            path_str
                .split_whitespace()
                .nth(1)
                .unwrap_or(""),
        );
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
}
