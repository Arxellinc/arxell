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
}

fn default_source() -> SheetSource {
    crate::services::sheets_source::source_for_new_sheet()
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
        }
    }
}

impl SheetState {
    pub fn snapshot_cell(&self, coord: &CellCoord) -> SheetCellSnapshot {
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
            SheetCellSnapshot {
                row: coord.row,
                col: coord.col,
                input: cell.input.clone(),
                display: cell
                    .error
                    .clone()
                    .unwrap_or_else(|| cell.computed.display_string()),
                kind,
                error: cell.error.clone(),
            }
        } else {
            SheetCellSnapshot {
                row: coord.row,
                col: coord.col,
                input: String::new(),
                display: String::new(),
                kind: SheetCellKind::Empty,
                error: None,
            }
        }
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
