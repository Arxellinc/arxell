use crate::services::sheets_capabilities::CapabilitySet;
use crate::services::sheets_source::SheetSource;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellCoord {
    pub row: usize,
    pub col: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsedRange {
    pub start_row: usize,
    pub start_col: usize,
    pub end_row: usize,
    pub end_col: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComputedValue {
    Empty,
    Text(String),
    Number(f64),
    Boolean(bool),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellState {
    pub input: String,
    pub computed: ComputedValue,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetState {
    pub name: String,
    pub row_count: usize,
    pub col_count: usize,
    pub cells: HashMap<CellCoord, CellState>,
    pub used_range: Option<UsedRange>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookState {
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub active_sheet: usize,
    pub sheets: Vec<SheetState>,
    pub dirty: bool,
    pub revision: u64,
    pub edit_log: Vec<EditProvenance>,
    #[serde(default)]
    pub format: String,
    #[serde(default = "default_source")]
    pub source: SheetSource,
    #[serde(default = "default_ai_model_id")]
    pub ai_model_id: String,
    #[serde(default)]
    pub styles: Vec<crate::services::sheets_jsonl::CellStyle>,
    #[serde(default)]
    pub undo_stack: Vec<WorkbookHistoryEntry>,
    #[serde(default)]
    pub redo_stack: Vec<WorkbookHistoryEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookHistoryEntry {
    pub sheets: Vec<SheetState>,
    pub active_sheet: usize,
    pub styles: Vec<crate::services::sheets_jsonl::CellStyle>,
}

fn default_source() -> SheetSource {
    crate::services::sheets_source::source_for_new_sheet()
}

fn default_ai_model_id() -> String {
    "local:runtime".to_string()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditSource {
    User,
    Agent,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditProvenance {
    pub source: EditSource,
    pub operation: String,
    pub timestamp_ms: i64,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetCellKind {
    Empty,
    Text,
    Number,
    Boolean,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetCellSnapshot {
    pub row: usize,
    pub col: usize,
    pub input: String,
    pub display: String,
    pub kind: SheetCellKind,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub strikethrough: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSnapshot {
    pub row_count: usize,
    pub column_count: usize,
    pub used_range: Option<UsedRange>,
    pub dirty: bool,
    pub revision: u64,
    #[serde(default)]
    pub cells: Vec<SheetCellSnapshot>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSheetResult {
    pub file_path: String,
    pub file_name: String,
    pub sheet: SheetSnapshot,
    pub capabilities: CapabilitySet,
    pub ai_model_id: String,
    #[serde(default)]
    pub can_undo: bool,
    #[serde(default)]
    pub can_redo: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSheetResult {
    pub file_path: String,
    pub row_count: usize,
    pub column_count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectSheetResult {
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub row_count: usize,
    pub column_count: usize,
    pub used_range: Option<UsedRange>,
    pub dirty: bool,
    pub revision: u64,
    #[serde(default)]
    pub capabilities: Option<CapabilitySet>,
    #[serde(default = "default_ai_model_id")]
    pub ai_model_id: String,
    #[serde(default)]
    pub can_undo: bool,
    #[serde(default)]
    pub can_redo: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRangeResult {
    pub cells: Vec<SheetCellSnapshot>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCellResult {
    pub revision: u64,
    pub updated_cells: Vec<SheetCellSnapshot>,
    pub dirty: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRangeResult {
    pub revision: u64,
    pub updated_range: Option<UsedRange>,
    pub dirty: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeResult {
    pub revision: u64,
    pub dirty: bool,
    pub row_count: Option<usize>,
    pub column_count: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetsErrorCode {
    ParseFailure,
    InvalidRange,
    CircularReference,
    UnsupportedFormula,
    MissingOpenWorkbook,
    SaveFailure,
    InvalidReference,
    InvalidPath,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetsErrorPayload {
    pub code: String,
    pub message: String,
}

impl ComputedValue {
    pub fn display_string(&self) -> String {
        match self {
            Self::Empty => String::new(),
            Self::Text(value) => value.clone(),
            Self::Number(value) => format_number(*value),
            Self::Boolean(value) => value.to_string().to_uppercase(),
        }
    }
}

impl CellState {
    pub fn empty() -> Self {
        Self {
            input: String::new(),
            computed: ComputedValue::Empty,
            error: None,
            style_id: None,
        }
    }
}

impl SheetState {
    pub fn snapshot_cell(
        &self,
        coord: &CellCoord,
        styles: &[crate::services::sheets_jsonl::CellStyle],
    ) -> SheetCellSnapshot {
        if let Some(cell) = self.cells.get(coord) {
            let kind = if cell.error.is_some() {
                SheetCellKind::Error
            } else {
                match cell.computed {
                    ComputedValue::Empty => SheetCellKind::Empty,
                    ComputedValue::Text(_) => SheetCellKind::Text,
                    ComputedValue::Number(_) => SheetCellKind::Number,
                    ComputedValue::Boolean(_) => SheetCellKind::Boolean,
                }
            };
            let style = cell.style_id.and_then(|style_id| styles.get(style_id));
            let format = style.and_then(|entry| entry.f.clone());
            let marks = style.and_then(|entry| entry.m.as_ref());
            SheetCellSnapshot {
                row: coord.row,
                col: coord.col,
                input: cell.input.clone(),
                display: if cell.error.is_some() {
                    "#ERROR".to_string()
                } else {
                    display_value_with_format(&cell.computed, format.as_deref())
                },
                kind,
                error: cell.error.clone(),
                format,
                bold: has_style_mark(marks, "b"),
                italic: has_style_mark(marks, "i"),
                strikethrough: has_style_mark(marks, "s"),
            }
        } else {
            SheetCellSnapshot {
                row: coord.row,
                col: coord.col,
                input: String::new(),
                display: String::new(),
                kind: SheetCellKind::Empty,
                error: None,
                format: None,
                bold: false,
                italic: false,
                strikethrough: false,
            }
        }
    }
}

fn has_style_mark(marks: Option<&Vec<String>>, mark: &str) -> bool {
    marks
        .map(|entries| entries.iter().any(|entry| entry == mark))
        .unwrap_or(false)
}

fn display_value_with_format(value: &ComputedValue, format: Option<&str>) -> String {
    match value {
        ComputedValue::Number(number) => {
            if let Some(pattern) = format {
                if let Ok(rendered) = crate::services::sheets_formula::format_text_value(*number, pattern)
                {
                    return rendered;
                }
            }
            format_number(*number)
        }
        _ => value.display_string(),
    }
}

pub fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{:.0}", value)
    } else {
        let rendered = format!("{value}");
        if rendered.contains('e') || rendered.contains('E') {
            rendered
        } else {
            rendered
                .trim_end_matches('0')
                .trim_end_matches('.')
                .to_string()
        }
    }
}
