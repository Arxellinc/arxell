#![cfg(feature = "tauri-runtime")]

use crate::ipc::tauri_bridge::TauriBridgeState;
use crate::services::sheets_service::SheetsService;
use crate::services::sheets_types::EditSource;
use crate::tools::invoke::registry::{decode_payload, InvokeRegistry, ToolInvokeFuture};
use serde::Deserialize;
use serde_json::Value;

pub fn register(registry: &mut InvokeRegistry) {
    registry.register("sheets", &["new_sheet"], invoke_new_sheet);
    registry.register("sheets", &["open_sheet"], invoke_open_sheet);
    registry.register("sheets", &["save_sheet"], invoke_save_sheet);
    registry.register("sheets", &["inspect_sheet"], invoke_inspect_sheet);
    registry.register("sheets", &["undo"], invoke_undo);
    registry.register("sheets", &["redo"], invoke_redo);
    registry.register("sheets", &["read_range"], invoke_read_range);
    registry.register("sheets", &["set_cell"], invoke_set_cell);
    registry.register("sheets", &["set_ai_model"], invoke_set_ai_model);
    registry.register("sheets", &["write_range"], invoke_write_range);
    registry.register("sheets", &["copy_paste_range"], invoke_copy_paste_range);
    registry.register("sheets", &["insert_rows"], invoke_insert_rows);
    registry.register("sheets", &["delete_rows"], invoke_delete_rows);
    registry.register("sheets", &["insert_columns"], invoke_insert_columns);
    registry.register("sheets", &["delete_columns"], invoke_delete_columns);
    registry.register("sheets", &["apply_cell_format"], invoke_apply_cell_format);
    registry.register("sheets", &["toggle_cell_mark"], invoke_toggle_cell_mark);
}

fn invoke_new_sheet(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let _: InspectSheetPayload = decode_payload(payload)?;
        serde_json::to_value(sheets.new_sheet().map_err(SheetsService::error_string)?)
            .map_err(|error| format!("failed serializing sheets new_sheet response: {error}"))
    })
}

fn invoke_open_sheet(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: OpenSheetPayload = decode_payload(payload)?;
        serde_json::to_value(
            sheets
                .open_sheet(req.path.as_str())
                .map_err(SheetsService::error_string)?,
        )
        .map_err(|error| format!("failed serializing sheets open_sheet response: {error}"))
    })
}

fn invoke_save_sheet(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: SaveSheetPayload = decode_payload(payload)?;
        serde_json::to_value(
            sheets
                .save_sheet(req.path.as_deref())
                .map_err(SheetsService::error_string)?,
        )
        .map_err(|error| format!("failed serializing sheets save_sheet response: {error}"))
    })
}

fn invoke_inspect_sheet(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let _: InspectSheetPayload = decode_payload(payload)?;
        serde_json::to_value(
            sheets
                .inspect_sheet()
                .map_err(SheetsService::error_string)?,
        )
        .map_err(|error| format!("failed serializing sheets inspect_sheet response: {error}"))
    })
}

fn invoke_read_range(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: ReadRangePayload = decode_payload(payload)?;
        serde_json::to_value(
            sheets
                .read_range(req.start_row, req.start_col, req.end_row, req.end_col)
                .map_err(SheetsService::error_string)?,
        )
        .map_err(|error| format!("failed serializing sheets read_range response: {error}"))
    })
}

fn invoke_undo(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let _: InspectSheetPayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets.undo().map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets undo task failed: {error}"))??;
        serde_json::to_value(result)
            .map_err(|error| format!("failed serializing sheets undo response: {error}"))
    })
}

fn invoke_redo(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let _: InspectSheetPayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets.redo().map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets redo task failed: {error}"))??;
        serde_json::to_value(result)
            .map_err(|error| format!("failed serializing sheets redo response: {error}"))
    })
}

fn invoke_set_cell(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: SetCellPayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .set_cell_input(req.row, req.col, req.input.as_str(), req.source, None)
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets set_cell task failed: {error}"))??;
        serde_json::to_value(
            result,
        )
        .map_err(|error| format!("failed serializing sheets set_cell response: {error}"))
    })
}

fn invoke_set_ai_model(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: SetAiModelPayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .set_ai_model(req.model_id.as_str())
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets set_ai_model task failed: {error}"))??;
        serde_json::to_value(
            result,
        )
        .map_err(|error| format!("failed serializing sheets set_ai_model response: {error}"))
    })
}

fn invoke_write_range(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: WriteRangePayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .write_range(req.start_row, req.start_col, &req.values, req.source, None)
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets write_range task failed: {error}"))??;
        serde_json::to_value(
            result,
        )
        .map_err(|error| format!("failed serializing sheets write_range response: {error}"))
    })
}

fn invoke_copy_paste_range(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: CopyPasteRangePayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .copy_paste_range(
                    req.src_start_row,
                    req.src_start_col,
                    req.src_end_row,
                    req.src_end_col,
                    req.dest_start_row,
                    req.dest_start_col,
                    &req.values,
                    req.source,
                    None,
                )
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets copy_paste_range task failed: {error}"))??;
        serde_json::to_value(result)
            .map_err(|error| format!("failed serializing sheets copy_paste_range response: {error}"))
    })
}

fn invoke_insert_rows(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: ResizePayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .insert_rows(req.index, req.count, req.source, None)
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets insert_rows task failed: {error}"))??;
        serde_json::to_value(
            result,
        )
        .map_err(|error| format!("failed serializing sheets insert_rows response: {error}"))
    })
}

fn invoke_delete_rows(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: ResizePayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .delete_rows(req.index, req.count, req.source, None)
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets delete_rows task failed: {error}"))??;
        serde_json::to_value(
            result,
        )
        .map_err(|error| format!("failed serializing sheets delete_rows response: {error}"))
    })
}

fn invoke_insert_columns(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: ResizePayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .insert_columns(req.index, req.count, req.source, None)
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets insert_columns task failed: {error}"))??;
        serde_json::to_value(
            result,
        )
        .map_err(|error| format!("failed serializing sheets insert_columns response: {error}"))
    })
}

fn invoke_apply_cell_format(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: FormatRangePayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .apply_cell_format(
                    req.start_row,
                    req.start_col,
                    req.end_row,
                    req.end_col,
                    req.pattern.as_deref(),
                    req.source,
                )
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets apply_cell_format task failed: {error}"))??;
        serde_json::to_value(result).map_err(|error| {
            format!("failed serializing sheets apply_cell_format response: {error}")
        })
    })
}

fn invoke_toggle_cell_mark(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: ToggleCellMarkPayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .toggle_cell_mark(
                    req.start_row,
                    req.start_col,
                    req.end_row,
                    req.end_col,
                    req.mark.as_str(),
                    req.source,
                )
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets toggle_cell_mark task failed: {error}"))??;
        serde_json::to_value(result).map_err(|error| {
            format!("failed serializing sheets toggle_cell_mark response: {error}")
        })
    })
}

fn invoke_delete_columns(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let sheets = state.sheets.clone();
    Box::pin(async move {
        let req: ResizePayload = decode_payload(payload)?;
        let result = tokio::task::spawn_blocking(move || {
            sheets
                .delete_columns(req.index, req.count, req.source, None)
                .map_err(SheetsService::error_string)
        })
        .await
        .map_err(|error| format!("sheets delete_columns task failed: {error}"))??;
        serde_json::to_value(
            result,
        )
        .map_err(|error| format!("failed serializing sheets delete_columns response: {error}"))
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenSheetPayload {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSheetPayload {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InspectSheetPayload {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadRangePayload {
    start_row: usize,
    start_col: usize,
    end_row: usize,
    end_col: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCellPayload {
    row: usize,
    col: usize,
    input: String,
    source: EditSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetAiModelPayload {
    model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteRangePayload {
    start_row: usize,
    start_col: usize,
    values: Vec<Vec<String>>,
    source: EditSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyPasteRangePayload {
    src_start_row: usize,
    src_start_col: usize,
    src_end_row: usize,
    src_end_col: usize,
    dest_start_row: usize,
    dest_start_col: usize,
    values: Vec<Vec<String>>,
    source: EditSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizePayload {
    index: usize,
    count: usize,
    source: EditSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormatRangePayload {
    start_row: usize,
    start_col: usize,
    end_row: usize,
    end_col: usize,
    pattern: Option<String>,
    source: EditSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleCellMarkPayload {
    start_row: usize,
    start_col: usize,
    end_row: usize,
    end_col: usize,
    mark: String,
    source: EditSource,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::AppContext;
    use serde_json::json;
    use serde_json::Value as JsonValue;
    use std::fs;

    fn temp_csv_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "arxell-sheets-invoke-{name}-{}-{}.csv",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        ))
    }

    #[test]
    fn registry_wiring_registers_sheets_actions() {
        let mut registry = InvokeRegistry::new();
        register(&mut registry);
        assert!(registry.get("sheets", "new_sheet").is_some());
        assert!(registry.get("sheets", "open_sheet").is_some());
        assert!(registry.get("sheets", "inspect_sheet").is_some());
        assert!(registry.get("sheets", "delete_columns").is_some());
    }

    #[test]
    fn payload_decoding_supports_set_cell() {
        let payload: SetCellPayload = decode_payload(json!({
            "row": 2,
            "col": 1,
            "input": "=A1+1",
            "source": "user"
        }))
        .unwrap();
        assert_eq!(payload.row, 2);
        assert_eq!(payload.col, 1);
        assert_eq!(payload.input, "=A1+1");
        assert_eq!(payload.source, EditSource::User);
    }

    #[test]
    fn payload_decoding_supports_read_write_and_resize_actions() {
        let read: ReadRangePayload = decode_payload(json!({
            "startRow": 0,
            "startCol": 1,
            "endRow": 3,
            "endCol": 4
        }))
        .unwrap();
        assert_eq!(read.start_row, 0);
        assert_eq!(read.end_col, 4);

        let write: WriteRangePayload = decode_payload(json!({
            "startRow": 2,
            "startCol": 3,
            "values": [["a", "b"], ["c", "d"]],
            "source": "agent"
        }))
        .unwrap();
        assert_eq!(write.start_row, 2);
        assert_eq!(write.values[1][1], "d");
        assert_eq!(write.source, EditSource::Agent);

        let resize: ResizePayload = decode_payload(json!({
            "index": 5,
            "count": 2,
            "source": "user"
        }))
        .unwrap();
        assert_eq!(resize.index, 5);
        assert_eq!(resize.count, 2);
    }

    #[tokio::test]
    async fn invoke_open_sheet_returns_serializable_payload() {
        let app = AppContext::default();
        let state = app.tauri_bridge_state();
        let path = temp_csv_path("open");
        fs::write(&path, "a,b\n1,2\n").unwrap();

        let payload = json!({ "path": path.to_string_lossy().to_string() });
        let value = invoke_open_sheet(&state, payload).await.unwrap();

        assert_eq!(
            value["fileName"].as_str(),
            Some(path.file_name().unwrap().to_string_lossy().as_ref())
        );
        assert_eq!(value["sheet"]["rowCount"].as_u64(), Some(2));
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn invoke_new_sheet_returns_default_blank_sheet() {
        let app = AppContext::default();
        let state = app.tauri_bridge_state();

        let value = invoke_new_sheet(&state, json!({})).await.unwrap();

        assert_eq!(value["fileName"].as_str(), Some("New Sheet"));
        assert_eq!(value["rowCount"].as_u64(), Some(100));
        assert_eq!(value["columnCount"].as_u64(), Some(26));
    }

    #[tokio::test]
    async fn invoke_inspect_sheet_returns_structured_error_without_workbook() {
        let app = AppContext::default();
        let state = app.tauri_bridge_state();

        let error = invoke_inspect_sheet(&state, json!({})).await.err().unwrap();
        let parsed: JsonValue = serde_json::from_str(&error).unwrap();

        assert_eq!(parsed["code"].as_str(), Some("missingopenworkbook"));
        assert!(parsed["message"]
            .as_str()
            .unwrap_or_default()
            .contains("no sheet is open"));
    }
}
