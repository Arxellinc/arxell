use crate::services::sheets_service::SheetsService;
use crate::services::sheets_types::EditSource;
use arx_rs::tools::Tool;
use arx_rs::types::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct SheetsTool {
    service: Arc<SheetsService>,
    correlation_id: String,
}

impl SheetsTool {
    pub fn new(service: Arc<SheetsService>, correlation_id: String) -> Self {
        Self {
            service,
            correlation_id,
        }
    }
}

#[async_trait]
impl Tool for SheetsTool {
    fn name(&self) -> &'static str {
        "sheets"
    }

    fn description(&self) -> &'static str {
        "Create, open, inspect, and edit Sheets workbooks. Relative paths resolve under the user's Arxell/Files directory. Use this for structured spreadsheet tasks including creating a new sheet when none is open."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "create_sheet",
                        "open_sheet",
                        "inspect_sheet",
                        "read_sheet",
                        "list_formula_functions",
                        "list_formula_signatures",
                        "read_range",
                        "set_cell",
                        "write_range",
                        "insert_rows",
                        "delete_rows",
                        "insert_columns",
                        "delete_columns",
                        "save_sheet"
                    ]
                },
                "startRow": { "type": "integer", "minimum": 0 },
                "startCol": { "type": "integer", "minimum": 0 },
                "endRow": { "type": "integer", "minimum": 0 },
                "endCol": { "type": "integer", "minimum": 0 },
                "row": { "type": "integer", "minimum": 0 },
                "col": { "type": "integer", "minimum": 0 },
                "input": { "type": "string" },
                "values": {
                    "type": "array",
                    "items": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "index": { "type": "integer", "minimum": 0 },
                "count": { "type": "integer", "minimum": 1 },
                "path": { "type": ["string", "null"] }
            },
            "required": ["action"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        let action = params
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or("inspect_sheet");
        format!("sheets(action={action})")
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let Some(action) = params.get("action").and_then(|value| value.as_str()) else {
            return tool_error("sheets requires an action");
        };
        match action {
            "create_sheet" => match self.service.new_sheet() {
                Ok(result) => tool_ok_json(&result, "Created new sheet"),
                Err(error) => tool_error(error.message()),
            },
            "open_sheet" => {
                let Some(path) = params.get("path").and_then(|value| value.as_str()) else {
                    return tool_error("open_sheet requires path");
                };
                let resolved_path = resolve_sheet_path(path);
                let resolved = resolved_path.to_string_lossy().to_string();
                match self.service.open_sheet(resolved.as_str()) {
                    Ok(result) => tool_ok_json(&result, "Opened sheet"),
                    Err(error) => {
                        let message = error.message();
                        if looks_like_missing_path_error(message.as_str()) {
                            match self.service.new_sheet() {
                                Ok(_) => match self.service.save_sheet(Some(resolved.as_str())) {
                                    Ok(saved) => tool_ok_json(
                                        &json!({
                                            "mode": "created",
                                            "reason": "path_missing",
                                            "path": resolved,
                                            "save": saved,
                                        }),
                                        "Created new sheet because path did not exist",
                                    ),
                                    Err(save_error) => tool_error(save_error.message()),
                                },
                                Err(create_error) => tool_error(create_error.message()),
                            }
                        } else {
                            tool_error(message)
                        }
                    }
                }
            }
            "inspect_sheet" => match self.service.inspect_sheet() {
                Ok(result) => tool_ok_json(&result, "Inspected current sheet"),
                Err(error) => tool_error(error.message()),
            },
            "read_sheet" => match self.service.inspect_sheet() {
                Ok(meta) => {
                    let cells = if let Some(range) = meta.used_range.as_ref() {
                        match self.service.read_range(
                            range.start_row,
                            range.start_col,
                            range.end_row,
                            range.end_col,
                        ) {
                            Ok(range_result) => range_result.cells,
                            Err(error) => return tool_error(error.message()),
                        }
                    } else {
                        Vec::new()
                    };

                    tool_ok_json(
                        &json!({
                            "filePath": meta.file_path,
                            "fileName": meta.file_name,
                            "rowCount": meta.row_count,
                            "columnCount": meta.column_count,
                            "usedRange": meta.used_range,
                            "dirty": meta.dirty,
                            "revision": meta.revision,
                            "capabilities": meta.capabilities,
                            "aiModelId": meta.ai_model_id,
                            "cells": cells,
                        }),
                        "Read current sheet",
                    )
                }
                Err(error) => tool_error(error.message()),
            },
            "list_formula_functions" => {
                let functions = self.service.list_supported_formula_functions();
                tool_ok_json(
                    &json!({
                        "functions": functions,
                        "count": functions.len(),
                    }),
                    "Listed supported Sheets formula functions",
                )
            },
            "list_formula_signatures" => {
                let signatures = self.service.list_supported_formula_signatures();
                tool_ok_json(
                    &json!({
                        "functions": signatures,
                        "count": signatures.len(),
                    }),
                    "Listed supported Sheets formula signatures",
                )
            },
            "read_range" => {
                let Some(start_row) = read_usize_arg(&params, &["startRow", "start_row", "rowStart"])
                else {
                    return tool_error("read_range requires startRow (or start_row)");
                };
                let Some(start_col) = read_usize_arg(&params, &["startCol", "start_col", "colStart"])
                else {
                    return tool_error("read_range requires startCol (or start_col)");
                };
                let Some(end_row) = read_usize_arg(&params, &["endRow", "end_row", "rowEnd"]) else {
                    return tool_error("read_range requires endRow (or end_row)");
                };
                let Some(end_col) = read_usize_arg(&params, &["endCol", "end_col", "colEnd"]) else {
                    return tool_error("read_range requires endCol (or end_col)");
                };
                match self.service.read_range(
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                ) {
                    Ok(result) => tool_ok_json(&result, "Read sheet range"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "set_cell" => {
                let Some(row) = read_usize_arg(&params, &["row", "startRow", "start_row"]) else {
                    return tool_error("set_cell requires row");
                };
                let Some(col) = read_usize_arg(&params, &["col", "startCol", "start_col"]) else {
                    return tool_error("set_cell requires col");
                };
                let Some(input) = params.get("input").and_then(|value| value.as_str()) else {
                    return tool_error("set_cell requires input");
                };
                match self.service.set_cell_input(
                    row,
                    col,
                    input,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Updated one sheet cell"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "write_range" => {
                let Some(start_row) = read_usize_arg(&params, &["startRow", "start_row", "row", "rowStart"])
                else {
                    return tool_error("write_range requires startRow (or start_row)");
                };
                let Some(start_col) = read_usize_arg(&params, &["startCol", "start_col", "col", "colStart"])
                else {
                    return tool_error("write_range requires startCol (or start_col)");
                };
                let Some(values) = params.get("values").and_then(as_string_matrix) else {
                    return tool_error("write_range requires values as string[][]");
                };
                match self.service.write_range(
                    start_row,
                    start_col,
                    &values,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Updated a rectangular sheet range"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "insert_rows" => {
                let Some(index) = read_usize_arg(&params, &["index", "row", "startRow", "start_row"]) else {
                    return tool_error("insert_rows requires index");
                };
                let Some(count) = read_usize_arg(&params, &["count"]) else {
                    return tool_error("insert_rows requires count");
                };
                match self.service.insert_rows(
                    index,
                    count,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Inserted rows into sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "insert_columns" => {
                let Some(index) = read_usize_arg(&params, &["index", "col", "startCol", "start_col"]) else {
                    return tool_error("insert_columns requires index");
                };
                let Some(count) = read_usize_arg(&params, &["count"]) else {
                    return tool_error("insert_columns requires count");
                };
                match self.service.insert_columns(
                    index,
                    count,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Inserted columns into sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "delete_rows" => {
                let Some(index) = read_usize_arg(&params, &["index", "row", "startRow", "start_row"]) else {
                    return tool_error("delete_rows requires index");
                };
                let Some(count) = read_usize_arg(&params, &["count"]) else {
                    return tool_error("delete_rows requires count");
                };
                match self.service.delete_rows(
                    index,
                    count,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Deleted rows from sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "delete_columns" => {
                let Some(index) = read_usize_arg(&params, &["index", "col", "startCol", "start_col"]) else {
                    return tool_error("delete_columns requires index");
                };
                let Some(count) = read_usize_arg(&params, &["count"]) else {
                    return tool_error("delete_columns requires count");
                };
                match self.service.delete_columns(
                    index,
                    count,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Deleted columns from sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "save_sheet" => {
                let explicit_path = params
                    .get("path")
                    .and_then(|value| value.as_str())
                    .and_then(|value| {
                        let trimmed = value.trim();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed)
                        }
                    });
                let existing_path = self
                    .service
                    .current_workbook()
                    .and_then(|workbook| workbook.file_path);
                let target_path = explicit_path
                    .map(resolve_sheet_path)
                    .or_else(|| existing_path.map(PathBuf::from))
                    .unwrap_or_else(default_sheet_save_path);
                let target = target_path.to_string_lossy().to_string();
                match self.service.save_sheet(Some(target.as_str())) {
                    Ok(result) => tool_ok_json(&result, "Saved current sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            _ => tool_error(format!("unsupported sheets action: {action}")),
        }
    }
}

fn as_string_matrix(value: &Value) -> Option<Vec<Vec<String>>> {
    let rows = value.as_array()?;
    let mut matrix = Vec::with_capacity(rows.len());
    for row in rows {
        let items = row.as_array()?;
        matrix.push(
            items
                .iter()
                .map(|item| item.as_str().map(ToOwned::to_owned))
                .collect::<Option<Vec<_>>>()?,
        );
    }
    Some(matrix)
}

fn read_usize_arg(params: &Value, keys: &[&str]) -> Option<usize> {
    keys.iter().find_map(|key| {
        params
            .get(*key)
            .and_then(|value| value.as_u64())
            .and_then(|value| usize::try_from(value).ok())
    })
}

fn tool_ok_json<T: serde::Serialize>(value: &T, display: &str) -> ToolResult {
    ToolResult {
        success: true,
        result: Some(serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())),
        images: None,
        display: Some(display.to_string()),
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

fn looks_like_missing_path_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("failed resolving path")
        || lower.contains("no such file or directory")
}

fn resolve_sheet_path(path: &str) -> PathBuf {
    let candidate = PathBuf::from(path.trim());
    if candidate.is_absolute() {
        return candidate;
    }
    resolve_arxell_files_dir().join(candidate)
}

fn default_sheet_save_path() -> PathBuf {
    let files_dir = resolve_arxell_files_dir();
    let _ = std::fs::create_dir_all(&files_dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    files_dir.join(format!("sheet-{ts}.jsonl"))
}

fn resolve_arxell_files_dir() -> PathBuf {
    let documents_root = dirs::document_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")));
    documents_root.join(Path::new("Arxell")).join("Files")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_service_with_open_sheet() -> (Arc<SheetsService>, std::path::PathBuf) {
        let service = Arc::new(SheetsService::default());
        let path = std::env::temp_dir().join(format!(
            "arxell-agent-sheets-{}-{}-{}.csv",
            std::process::id(),
            std::thread::current().name().unwrap_or("test"),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        ));
        fs::write(&path, "1,2\n").unwrap();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        (service, path)
    }

    #[tokio::test]
    async fn agent_set_cell_and_direct_user_set_cell_share_backend_semantics() {
        let (service, path) = make_service_with_open_sheet();
        let tool = SheetsTool::new(Arc::clone(&service), "corr-agent".to_string());
        let result = tool
            .execute(
                json!({"action": "set_cell", "row": 0, "col": 1, "input": "=A1+4"}),
                None,
            )
            .await;
        assert!(result.success);
        let after_agent = service.current_workbook().unwrap();
        let service_two = Arc::new(SheetsService::default());
        service_two.open_sheet(path.to_str().unwrap()).unwrap();
        service_two
            .set_cell_input(0, 1, "=A1+4", EditSource::User, None)
            .unwrap();
        let after_user = service_two.current_workbook().unwrap();
        assert_eq!(after_agent.sheets[0].cells, after_user.sheets[0].cells);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn agent_edits_are_tagged_as_agent() {
        let (service, path) = make_service_with_open_sheet();
        let tool = SheetsTool::new(Arc::clone(&service), "corr-agent".to_string());
        let _ = tool
            .execute(
                json!({"action": "set_cell", "row": 0, "col": 0, "input": "7"}),
                None,
            )
            .await;
        let workbook = service.current_workbook().unwrap();
        assert_eq!(
            workbook.edit_log.last().map(|item| item.source.clone()),
            Some(EditSource::Agent)
        );
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn save_sheet_uses_current_open_workbook() {
        let (service, path) = make_service_with_open_sheet();
        let save_path = path.with_file_name("arxell-agent-save.csv");
        let tool = SheetsTool::new(Arc::clone(&service), "corr-agent".to_string());
        let result = tool
            .execute(
                json!({"action": "save_sheet", "path": save_path.to_string_lossy().to_string()}),
                None,
            )
            .await;
        assert!(result.success);
        assert!(save_path.exists());
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(save_path);
    }

    #[tokio::test]
    async fn create_sheet_action_creates_workbook_when_missing() {
        let service = Arc::new(SheetsService::default());
        let tool = SheetsTool::new(Arc::clone(&service), "corr-agent".to_string());
        let result = tool
            .execute(json!({"action": "create_sheet"}), None)
            .await;
        assert!(result.success);
        let inspected = service.inspect_sheet().unwrap();
        assert!(inspected.row_count >= 1);
        assert!(inspected.column_count >= 1);
    }

    #[test]
    fn resolve_sheet_path_places_relative_paths_under_arxell_files() {
        let resolved = resolve_sheet_path("finance/analysis.jsonl");
        let base = resolve_arxell_files_dir();
        assert!(resolved.starts_with(&base));
        assert!(resolved.ends_with("analysis.jsonl"));
    }

    #[tokio::test]
    async fn open_sheet_with_missing_relative_path_creates_file_under_arxell_files() {
        let service = Arc::new(SheetsService::default());
        let tool = SheetsTool::new(Arc::clone(&service), "corr-agent".to_string());
        let unique = format!(
            "agent-sheets-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        );
        let relative_path = format!("finance/{unique}");
        let expected = resolve_arxell_files_dir().join(&relative_path);
        let _ = fs::remove_file(&expected);

        let result = tool
            .execute(
                json!({"action": "open_sheet", "path": relative_path}),
                None,
            )
            .await;
        assert!(result.success);
        assert!(expected.exists());

        let _ = fs::remove_file(expected);
    }

    #[tokio::test]
    async fn write_range_accepts_snake_case_coordinates() {
        let service = Arc::new(SheetsService::default());
        let tool = SheetsTool::new(Arc::clone(&service), "corr-agent".to_string());
        let _ = tool.execute(json!({"action": "create_sheet"}), None).await;
        let result = tool
            .execute(
                json!({
                    "action": "write_range",
                    "start_row": 0,
                    "start_col": 0,
                    "values": [["Revenue"], ["1000000"]]
                }),
                None,
            )
            .await;
        assert!(result.success);
    }
}
