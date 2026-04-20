use crate::services::sheets_service::SheetsService;
use crate::services::sheets_types::EditSource;
use arx_rs::tools::Tool;
use arx_rs::types::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
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
        "Inspect and edit the currently open Sheets workbook. Use this for structured spreadsheet edits after the user has opened a sheet in the Sheets workspace tool."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "inspect_sheet",
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
            "inspect_sheet" => match self.service.inspect_sheet() {
                Ok(result) => tool_ok_json(&result, "Inspected current sheet"),
                Err(error) => tool_error(error.message()),
            },
            "read_range" => {
                let Some(start_row) = params.get("startRow").and_then(|value| value.as_u64()) else {
                    return tool_error("read_range requires startRow");
                };
                let Some(start_col) = params.get("startCol").and_then(|value| value.as_u64()) else {
                    return tool_error("read_range requires startCol");
                };
                let Some(end_row) = params.get("endRow").and_then(|value| value.as_u64()) else {
                    return tool_error("read_range requires endRow");
                };
                let Some(end_col) = params.get("endCol").and_then(|value| value.as_u64()) else {
                    return tool_error("read_range requires endCol");
                };
                match self.service.read_range(
                    start_row as usize,
                    start_col as usize,
                    end_row as usize,
                    end_col as usize,
                ) {
                    Ok(result) => tool_ok_json(&result, "Read sheet range"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "set_cell" => {
                let Some(row) = params.get("row").and_then(|value| value.as_u64()) else {
                    return tool_error("set_cell requires row");
                };
                let Some(col) = params.get("col").and_then(|value| value.as_u64()) else {
                    return tool_error("set_cell requires col");
                };
                let Some(input) = params.get("input").and_then(|value| value.as_str()) else {
                    return tool_error("set_cell requires input");
                };
                match self.service.set_cell_input(
                    row as usize,
                    col as usize,
                    input,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Updated one sheet cell"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "write_range" => {
                let Some(start_row) = params.get("startRow").and_then(|value| value.as_u64()) else {
                    return tool_error("write_range requires startRow");
                };
                let Some(start_col) = params.get("startCol").and_then(|value| value.as_u64()) else {
                    return tool_error("write_range requires startCol");
                };
                let Some(values) = params.get("values").and_then(as_string_matrix) else {
                    return tool_error("write_range requires values as string[][]");
                };
                match self.service.write_range(
                    start_row as usize,
                    start_col as usize,
                    &values,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Updated a rectangular sheet range"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "insert_rows" => {
                let Some(index) = params.get("index").and_then(|value| value.as_u64()) else {
                    return tool_error("insert_rows requires index");
                };
                let Some(count) = params.get("count").and_then(|value| value.as_u64()) else {
                    return tool_error("insert_rows requires count");
                };
                match self.service.insert_rows(
                    index as usize,
                    count as usize,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Inserted rows into sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "insert_columns" => {
                let Some(index) = params.get("index").and_then(|value| value.as_u64()) else {
                    return tool_error("insert_columns requires index");
                };
                let Some(count) = params.get("count").and_then(|value| value.as_u64()) else {
                    return tool_error("insert_columns requires count");
                };
                match self.service.insert_columns(
                    index as usize,
                    count as usize,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Inserted columns into sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "delete_rows" => {
                let Some(index) = params.get("index").and_then(|value| value.as_u64()) else {
                    return tool_error("delete_rows requires index");
                };
                let Some(count) = params.get("count").and_then(|value| value.as_u64()) else {
                    return tool_error("delete_rows requires count");
                };
                match self.service.delete_rows(
                    index as usize,
                    count as usize,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Deleted rows from sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "delete_columns" => {
                let Some(index) = params.get("index").and_then(|value| value.as_u64()) else {
                    return tool_error("delete_columns requires index");
                };
                let Some(count) = params.get("count").and_then(|value| value.as_u64()) else {
                    return tool_error("delete_columns requires count");
                };
                match self.service.delete_columns(
                    index as usize,
                    count as usize,
                    EditSource::Agent,
                    Some(self.correlation_id.as_str()),
                ) {
                    Ok(result) => tool_ok_json(&result, "Deleted columns from sheet"),
                    Err(error) => tool_error(error.message()),
                }
            }
            "save_sheet" => {
                let path = params.get("path").and_then(|value| value.as_str());
                match self.service.save_sheet(path) {
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
        assert_eq!(workbook.edit_log.last().map(|item| item.source.clone()), Some(EditSource::Agent));
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
}
