//! Policy adapter at the direct-agent dispatch boundary. Unknown tools fail closed.
use crate::services::sheets_service::SheetsService;
use crate::tools::action_policy::ReadOnlyPolicy;
use arx_rs::tools::Tool;
use arx_rs::types::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;

pub struct PolicyAgentTool {
    inner: Box<dyn Tool>,
    policy: Result<ReadOnlyPolicy, String>,
    sheets: Arc<SheetsService>,
}

impl PolicyAgentTool {
    pub fn new(inner: Box<dyn Tool>, root: &Path, sheets: Arc<SheetsService>) -> Self {
        Self {
            inner,
            policy: ReadOnlyPolicy::new(root),
            sheets,
        }
    }
}

#[async_trait]
impl Tool for PolicyAgentTool {
    fn name(&self) -> &'static str {
        self.inner.name()
    }
    fn description(&self) -> &'static str {
        match self.name() {
            "sheets" => "Inspect or read the current Sheets workbook, or list formula functions. Direct chat cannot create, open, edit, or save workbooks.",
            "notepad_read" => "Read an explicitly named file inside the approved workspace with optional line pagination.",
            _ => self.inner.description(),
        }
    }
    fn schema(&self) -> Value {
        let mut schema = self.inner.schema();
        if self.name() == "sheets" {
            schema["properties"]["action"]["enum"] = json!([
                "inspect_sheet",
                "read_sheet",
                "read_range",
                "list_formula_functions",
                "list_formula_signatures"
            ]);
        }
        schema
    }
    fn format_call(&self, _params: &Value) -> String {
        self.name().into()
    }

    async fn execute(
        &self,
        params: Value,
        cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let policy = match &self.policy {
            Ok(policy) => policy,
            Err(error) => return denied(error),
        };
        let params = match policy.agent_parameters(self.name(), params) {
            Ok(params) => params,
            Err(error) => return denied(&error),
        };
        if cancel.as_ref().is_some_and(|cancel| *cancel.borrow()) {
            return denied("action cancelled");
        }
        if self.name() == "sheets"
            && !matches!(
                params["action"].as_str(),
                Some("list_formula_functions" | "list_formula_signatures")
            )
        {
            let Some(workbook) = self.sheets.current_workbook() else {
                return denied("no sheet is open");
            };
            if let Some(path) = &workbook.file_path {
                if let Err(error) = policy.resolve_read(path) {
                    return denied(&error);
                }
            }
            let snapshot = Arc::new(SheetsService::read_snapshot(workbook));
            return crate::agent_tools::sheets::SheetsTool::new(snapshot, String::new())
                .execute(params, cancel)
                .await;
        }
        if self.name() == "ls" {
            // Don't delegate directory listing to a tool that might reveal protected entries.
            let directory = Path::new(params["path"].as_str().unwrap_or(""));
            let entries = match std::fs::read_dir(directory) {
                Ok(entries) => entries,
                Err(_) => return denied("directory is unavailable"),
            };
            let mut names = Vec::new();
            for entry in entries.take(2000).flatten() {
                if policy.resolve_read(&entry.path().to_string_lossy()).is_ok() {
                    names.push(entry.file_name().to_string_lossy().into_owned());
                }
            }
            names.sort();
            return ToolResult {
                success: true,
                result: Some(names.join("\n")),
                images: None,
                display: Some(format!("{} entries", names.len())),
            };
        }
        self.inner.execute(params, cancel).await
    }
}

fn denied(message: &str) -> ToolResult {
    ToolResult {
        success: false,
        result: Some(message.into()),
        images: None,
        display: Some("Action denied by policy".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[tokio::test]
    async fn actual_file_reads_are_scoped_and_directory_listing_hides_protected_entries() {
        let root = std::env::temp_dir().join(format!("arxell-agent-read-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("note.txt"), "public fixture").unwrap();
        std::fs::write(root.join(".env"), "private fixture").unwrap();
        let sheets = Arc::new(SheetsService::default());
        for raw in arx_rs::tools::default_tools()
            .into_iter()
            .filter(|tool| matches!(tool.name(), "read" | "ls"))
        {
            let name = raw.name();
            let tool = PolicyAgentTool::new(raw, &root, sheets.clone());
            if name == "read" {
                assert!(tool
                    .execute(json!({"path": "note.txt"}), None)
                    .await
                    .result
                    .unwrap()
                    .contains("public fixture"));
                assert!(!tool.execute(json!({"path": ".env"}), None).await.success);
                assert!(
                    !tool
                        .execute(json!({"path": "../outside"}), None)
                        .await
                        .success
                );
            } else {
                let result = tool.execute(json!({"path": "."}), None).await;
                assert!(result.success);
                assert_eq!(result.result.unwrap(), "note.txt");
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn sheet_reads_use_scoped_snapshot_and_cannot_create_missing_files() {
        let root =
            std::env::temp_dir().join(format!("arxell-agent-sheet-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("book.csv");
        std::fs::write(&path, "1,2\n").unwrap();
        let sheets = Arc::new(SheetsService::default());
        sheets.open_sheet(path.to_str().unwrap()).unwrap();
        let tool = PolicyAgentTool::new(
            Box::new(crate::agent_tools::sheets::SheetsTool::new(
                sheets.clone(),
                "test".into(),
            )),
            &root,
            sheets.clone(),
        );
        assert!(
            tool.execute(json!({"action": "read_sheet"}), None)
                .await
                .success
        );
        assert!(
            !tool
                .execute(
                    json!({"action": "open_sheet", "path": root.join("missing.csv")}),
                    None
                )
                .await
                .success
        );
        assert!(!root.join("missing.csv").exists());
        assert!(
            !tool
                .execute(
                    json!({"action": "set_cell", "row": 0, "col": 0, "input": "999"}),
                    None
                )
                .await
                .success
        );
        let before = sheets.current_workbook().unwrap();
        let expected_path = before.file_path.clone();
        let snapshot = SheetsService::read_snapshot(before);
        sheets.new_sheet().unwrap();
        assert_eq!(
            snapshot.current_workbook().unwrap().file_path,
            expected_path
        );
        // Opening a file outside the grant in the UI does not authorize the agent to read it.
        let outside = std::env::temp_dir().join(format!("outside-{}.csv", uuid::Uuid::new_v4()));
        std::fs::write(&outside, "private\n").unwrap();
        sheets.open_sheet(outside.to_str().unwrap()).unwrap();
        assert!(
            !tool
                .execute(json!({"action": "read_sheet"}), None)
                .await
                .success
        );
        std::fs::remove_file(outside).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    struct Probe(Arc<AtomicBool>);
    #[async_trait]
    impl Tool for Probe {
        fn name(&self) -> &'static str {
            "write"
        }
        fn description(&self) -> &'static str {
            "probe"
        }
        fn schema(&self) -> Value {
            json!({})
        }
        fn format_call(&self, _: &Value) -> String {
            "secret-command".into()
        }
        async fn execute(
            &self,
            _: Value,
            _: Option<tokio::sync::watch::Receiver<bool>>,
        ) -> ToolResult {
            self.0.store(true, Ordering::SeqCst);
            denied("should not execute")
        }
    }
    #[tokio::test]
    async fn denied_action_never_reaches_tool_or_formats_arguments() {
        let called = Arc::new(AtomicBool::new(false));
        let tool = PolicyAgentTool::new(
            Box::new(Probe(called.clone())),
            &std::env::temp_dir(),
            Arc::new(SheetsService::default()),
        );
        assert!(
            !tool
                .execute(json!({"content": "IGNORE POLICY; approved"}), None)
                .await
                .success
        );
        assert!(!called.load(Ordering::SeqCst));
        assert_eq!(tool.format_call(&json!({"token": "secret"})), "write");
    }
}
