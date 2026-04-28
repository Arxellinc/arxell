use crate::api_registry::ApiRegistryService;
use crate::contracts::{EventSeverity, EventStage, Subsystem};
use crate::observability::EventHub;
use crate::services::sheets_capabilities::CapabilitySet;
use crate::services::sheets_formula::{
    create_engine, AiFormulaProvider, FormulaEngine, FormulaError, FormulaErrorCode,
};
use crate::services::sheets_jsonl;
use crate::services::sheets_source::{source_for_new_sheet, source_from_path, SheetSourceKind};
use crate::services::sheets_types::{
    CellCoord, CellState, ComputedValue, EditProvenance, EditSource, InspectSheetResult,
    OpenSheetResult, ReadRangeResult, ResizeResult, SaveSheetResult, SetCellResult,
    SheetCellSnapshot, SheetSnapshot, SheetState, SheetsErrorCode, SheetsErrorPayload, UsedRange,
    WorkbookHistoryEntry, WorkbookState, WriteRangeResult,
};
use csv::{ReaderBuilder, WriterBuilder};
use serde_json::json;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SheetsError {
    #[error("{message}")]
    Message {
        code: SheetsErrorCode,
        message: String,
    },
}

pub struct SheetsService {
    state: RwLock<Option<WorkbookState>>,
    formula_engine: Box<dyn FormulaEngine>,
    hub: Option<EventHub>,
    ai_model_id: Arc<RwLock<String>>,
}

impl SheetsService {
    pub fn new(hub: Option<EventHub>, api_registry: Arc<ApiRegistryService>) -> Self {
        let ai_model_id = Arc::new(RwLock::new("local:runtime".to_string()));
        let ai_provider: Arc<dyn AiFormulaProvider> = Arc::new(HttpAiFormulaProvider::new(
            api_registry,
            Arc::clone(&ai_model_id),
        ));
        Self {
            state: RwLock::new(None),
            formula_engine: create_engine(Some(ai_provider)),
            hub,
            ai_model_id,
        }
    }

    pub fn current_workbook(&self) -> Option<WorkbookState> {
        self.state
            .read()
            .expect("sheets state lock poisoned")
            .clone()
    }

    pub fn capabilities(&self) -> Option<CapabilitySet> {
        self.state
            .read()
            .expect("sheets state lock poisoned")
            .as_ref()
            .map(|wb| wb.source.capabilities.clone())
    }

    pub fn new_sheet(&self) -> Result<InspectSheetResult, SheetsError> {
        let sheet = SheetState {
            name: "Sheet1".to_string(),
            row_count: 1000,
            col_count: 26,
            cells: HashMap::new(),
            used_range: None,
        };
        let source = source_for_new_sheet();
        let capabilities = source.capabilities.clone();
        let workbook = WorkbookState {
            file_path: None,
            file_name: Some("New Sheet".to_string()),
            active_sheet: 0,
            sheets: vec![sheet.clone()],
            dirty: false,
            revision: 1,
            edit_log: Vec::new(),
            format: "jsonl".to_string(),
            source,
            ai_model_id: "local:runtime".to_string(),
            styles: vec![sheets_jsonl::CellStyle::default()],
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        };
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        *guard = Some(workbook);
        *self
            .ai_model_id
            .write()
            .expect("sheets ai model lock poisoned") = "local:runtime".to_string();
        Ok(InspectSheetResult {
            file_path: None,
            file_name: Some("New Sheet".to_string()),
            row_count: sheet.row_count,
            column_count: sheet.col_count,
            used_range: None,
            dirty: false,
            revision: 1,
            capabilities: Some(capabilities),
            ai_model_id: "local:runtime".to_string(),
            can_undo: false,
            can_redo: false,
        })
    }

    pub fn open_sheet(&self, path: &str) -> Result<OpenSheetResult, SheetsError> {
        let resolved = normalize_existing_path(path)?;
        let file_name = resolved
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("sheet.csv")
            .to_string();

        let source = source_from_path(path);
        let format = match source.kind {
            SheetSourceKind::NativeJsonl => "jsonl",
            SheetSourceKind::Csv => "csv",
            SheetSourceKind::SqliteTable => "sqlite",
        };

        let (mut sheet, styles) = if format == "jsonl" {
            let raw = std::fs::read_to_string(&resolved).map_err(|error| {
                sheets_error(
                    SheetsErrorCode::ParseFailure,
                    format!("failed reading file: {error}"),
                )
            })?;
            let data = sheets_jsonl::parse_jsonl(&raw)?;
            *self
                .ai_model_id
                .write()
                .expect("sheets ai model lock poisoned") = data
                .header
                .ai_model_id
                .clone()
                .unwrap_or_else(|| "local:runtime".to_string());
            (
                sheets_jsonl::jsonl_to_sheet_state(&data),
                if data.styles.is_empty() {
                    vec![sheets_jsonl::CellStyle::default()]
                } else {
                    data.styles.clone()
                },
            )
        } else {
            let mut reader = ReaderBuilder::new()
                .has_headers(false)
                .flexible(true)
                .from_path(&resolved)
                .map_err(|error| {
                    sheets_error(
                        SheetsErrorCode::ParseFailure,
                        format!("failed opening csv: {error}"),
                    )
                })?;

            let mut rows = Vec::<Vec<String>>::new();
            let mut max_cols = 0usize;
            for record in reader.records() {
                let record = record.map_err(|error| {
                    sheets_error(
                        SheetsErrorCode::ParseFailure,
                        format!("failed parsing csv: {error}"),
                    )
                })?;
                let values = record.iter().map(ToOwned::to_owned).collect::<Vec<_>>();
                max_cols = max_cols.max(values.len());
                rows.push(values);
            }

            let row_count = rows.len().max(1);
            let col_count = max_cols.max(1);
            let mut cells = HashMap::new();
            for (row_index, row) in rows.iter().enumerate() {
                for col_index in 0..col_count {
                    let input = row.get(col_index).cloned().unwrap_or_default();
                    if input.is_empty() {
                        continue;
                    }
                    cells.insert(
                        CellCoord {
                            row: row_index,
                            col: col_index,
                        },
                        CellState {
                            input,
                            computed: ComputedValue::Empty,
                            error: None,
                            style_id: None,
                        },
                    );
                }
            }

            (
                SheetState {
                    name: "Sheet1".to_string(),
                    row_count,
                    col_count,
                    cells,
                    used_range: None,
                },
                vec![sheets_jsonl::CellStyle::default()],
            )
        };

        self.formula_engine
            .recompute_sheet(&mut sheet)
            .map_err(SheetsError::from)?;
        sheet.used_range = compute_used_range(&sheet.cells);

        let capabilities = source.capabilities.clone();
        let ai_model_id = self
            .ai_model_id
            .read()
            .expect("sheets ai model lock poisoned")
            .clone();
        let sheet_snapshot = snapshot_sheet(&sheet, &styles, 1, false);
        let workbook = WorkbookState {
            file_path: Some(path_to_string(&resolved)),
            file_name: Some(file_name.clone()),
            active_sheet: 0,
            sheets: vec![sheet.clone()],
            dirty: false,
            revision: 1,
            edit_log: Vec::new(),
            format: format.to_string(),
            source,
            ai_model_id: ai_model_id.clone(),
            styles,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        };

        let mut guard = self.state.write().expect("sheets state lock poisoned");
        *guard = Some(workbook);

        Ok(OpenSheetResult {
            file_path: path_to_string(&resolved),
            file_name,
            sheet: sheet_snapshot,
            capabilities,
            ai_model_id,
            can_undo: false,
            can_redo: false,
        })
    }

    pub fn save_sheet(&self, path: Option<&str>) -> Result<SaveSheetResult, SheetsError> {
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        if workbook.source.read_only {
            return Err(sheets_error(
                SheetsErrorCode::SaveFailure,
                "this source is read-only",
            ));
        }
        let existing_path = workbook.file_path.clone();
        let target = match path.and_then(normalize_optional_path) {
            Some(value) => normalize_target_path(&value)?,
            None => normalize_target_path(existing_path.as_deref().ok_or_else(|| {
                sheets_error(SheetsErrorCode::InvalidPath, "save path is required")
            })?)?,
        };

        let format = workbook.format.clone();
        let (used_range, row_count, col_count, cells, sheet_name) = {
            let sheet = active_sheet_ref(workbook)?;
            (
                sheet.used_range.clone(),
                sheet.row_count,
                sheet.col_count,
                sheet.cells.clone(),
                sheet.name.clone(),
            )
        };

        if format == "jsonl" {
            let sheet_state = SheetState {
                name: sheet_name,
                row_count,
                col_count,
                cells,
                used_range,
            };
            let mut data = sheets_jsonl::sheet_state_to_jsonl(
                &sheet_state,
                &sheet_state.name,
                &workbook.styles,
            );
            data.header.ai_model_id = Some(workbook.ai_model_id.clone());
            let content = sheets_jsonl::serialize_jsonl(&data)?;
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    sheets_error(
                        SheetsErrorCode::SaveFailure,
                        format!("failed creating save directory: {error}"),
                    )
                })?;
            }
            std::fs::write(&target, content).map_err(|error| {
                sheets_error(
                    SheetsErrorCode::SaveFailure,
                    format!("failed saving jsonl: {error}"),
                )
            })?;
        } else {
            let mut writer = WriterBuilder::new()
                .has_headers(false)
                .from_writer(Vec::new());
            if used_range.is_some() {
                for row in 0..row_count {
                    let mut values = Vec::with_capacity(col_count);
                    for col in 0..col_count {
                        let input = cells
                            .get(&CellCoord { row, col })
                            .map(|cell| cell.input.clone())
                            .unwrap_or_default();
                        values.push(input);
                    }
                    writer.write_record(values).map_err(|error| {
                        sheets_error(
                            SheetsErrorCode::SaveFailure,
                            format!("failed writing csv rows: {error}"),
                        )
                    })?;
                }
            }
            let bytes = writer.into_inner().map_err(|error| {
                sheets_error(
                    SheetsErrorCode::SaveFailure,
                    format!("failed finalizing csv writer: {error}"),
                )
            })?;
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    sheets_error(
                        SheetsErrorCode::SaveFailure,
                        format!("failed creating save directory: {error}"),
                    )
                })?;
            }
            std::fs::write(&target, bytes).map_err(|error| {
                sheets_error(
                    SheetsErrorCode::SaveFailure,
                    format!("failed saving csv: {error}"),
                )
            })?;
        }

        workbook.file_path = Some(path_to_string(&target));
        workbook.file_name = target
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned);
        workbook.dirty = false;

        Ok(SaveSheetResult {
            file_path: path_to_string(&target),
            row_count,
            column_count: col_count,
        })
    }

    pub fn inspect_sheet(&self) -> Result<InspectSheetResult, SheetsError> {
        let guard = self.state.read().expect("sheets state lock poisoned");
        let workbook = guard.as_ref().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let sheet = active_sheet_ref(workbook)?;
        Ok(InspectSheetResult {
            file_path: workbook.file_path.clone(),
            file_name: workbook.file_name.clone(),
            row_count: sheet.row_count,
            column_count: sheet.col_count,
            used_range: sheet.used_range.clone(),
            dirty: workbook.dirty,
            revision: workbook.revision,
            capabilities: Some(workbook.source.capabilities.clone()),
            ai_model_id: workbook.ai_model_id.clone(),
            can_undo: !workbook.undo_stack.is_empty(),
            can_redo: !workbook.redo_stack.is_empty(),
        })
    }

    pub fn read_range(
        &self,
        start_row: usize,
        start_col: usize,
        end_row: usize,
        end_col: usize,
    ) -> Result<ReadRangeResult, SheetsError> {
        let guard = self.state.read().expect("sheets state lock poisoned");
        let workbook = guard.as_ref().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let sheet = active_sheet_ref(workbook)?;
        validate_range(sheet, start_row, start_col, end_row, end_col)?;
        Ok(ReadRangeResult {
            cells: snapshot_range(
                sheet,
                &workbook.styles,
                start_row,
                start_col,
                end_row,
                end_col,
            ),
        })
    }

    pub fn set_cell_input(
        &self,
        row: usize,
        col: usize,
        input: &str,
        source: EditSource,
        notify_correlation_id: Option<&str>,
    ) -> Result<SetCellResult, SheetsError> {
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let dirty = mutate_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "set_cell",
            Some(format!("Updated {}", coord_label(row, col))),
            |sheet| {
                let previous_cells = sheet.cells.clone();
                ensure_cell_dimensions(sheet, row, col);
                apply_cell_input(sheet, row, col, input);
                let changed = finalize_sheet(sheet, self.formula_engine.as_ref(), previous_cells)?;
                let mut changed = changed;
                changed.insert(CellCoord { row, col });
                Ok(changed)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        let sheet = active_sheet_ref(workbook_ref)?;
        if dirty {
            maybe_emit_sync(
                &self.hub,
                notify_correlation_id,
                workbook_ref,
                sheet,
                "set_cell",
                Some(source),
            );
        }
        Ok(SetCellResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            updated_cells: snapshot_changed_cells(
                sheet,
                &workbook_ref.styles,
                &[CellCoord { row, col }],
            ),
            dirty: workbook_ref.dirty,
        })
    }

    pub fn write_range(
        &self,
        start_row: usize,
        start_col: usize,
        values: &[Vec<String>],
        source: EditSource,
        notify_correlation_id: Option<&str>,
    ) -> Result<WriteRangeResult, SheetsError> {
        if values.is_empty() {
            return Ok(WriteRangeResult {
                revision: self.inspect_sheet()?.revision,
                updated_range: None,
                dirty: self.inspect_sheet()?.dirty,
            });
        }
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let width = values.iter().map(|row| row.len()).max().unwrap_or(0);
        let requested_range = UsedRange {
            start_row,
            start_col,
            end_row: start_row + values.len().saturating_sub(1),
            end_col: start_col + width.saturating_sub(1),
        };
        let dirty = mutate_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "write_range",
            Some(format!("Updated {}x{} range", values.len(), width.max(1))),
            |sheet| {
                let previous_cells = sheet.cells.clone();
                ensure_cell_dimensions(sheet, requested_range.end_row, requested_range.end_col);
                for (row_offset, row_values) in values.iter().enumerate() {
                    for col_offset in 0..width {
                        let value = row_values.get(col_offset).cloned().unwrap_or_default();
                        apply_cell_input(
                            sheet,
                            start_row + row_offset,
                            start_col + col_offset,
                            value.as_str(),
                        );
                    }
                }
                finalize_sheet(sheet, self.formula_engine.as_ref(), previous_cells)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        let sheet = active_sheet_ref(workbook_ref)?;
        if dirty {
            maybe_emit_sync(
                &self.hub,
                notify_correlation_id,
                workbook_ref,
                sheet,
                "write_range",
                Some(source),
            );
        }
        Ok(WriteRangeResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            updated_range: Some(requested_range),
            dirty: workbook_ref.dirty,
        })
    }

    pub fn copy_paste_range(
        &self,
        src_start_row: usize,
        src_start_col: usize,
        _src_end_row: usize,
        _src_end_col: usize,
        dest_start_row: usize,
        dest_start_col: usize,
        values: &[Vec<String>],
        source: EditSource,
        notify_correlation_id: Option<&str>,
    ) -> Result<WriteRangeResult, SheetsError> {
        if values.is_empty() {
            return Ok(WriteRangeResult {
                revision: self.inspect_sheet()?.revision,
                updated_range: None,
                dirty: self.inspect_sheet()?.dirty,
            });
        }
        let d_row = dest_start_row as isize - src_start_row as isize;
        let d_col = dest_start_col as isize - src_start_col as isize;
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let width = values.iter().map(|row| row.len()).max().unwrap_or(0);
        let requested_range = UsedRange {
            start_row: dest_start_row,
            start_col: dest_start_col,
            end_row: dest_start_row.saturating_add(values.len().saturating_sub(1)),
            end_col: dest_start_col.saturating_add(width.saturating_sub(1)),
        };
        let dirty = mutate_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "copy_paste_range",
            Some(format!("Copied {}x{} range", values.len(), width.max(1))),
            |sheet| {
                let previous_cells = sheet.cells.clone();
                ensure_cell_dimensions(sheet, requested_range.end_row, requested_range.end_col);
                for (row_offset, row_values) in values.iter().enumerate() {
                    for col_offset in 0..width {
                        let value = row_values.get(col_offset).cloned().unwrap_or_default();
                        let rewritten = if value.starts_with('=') {
                            rewrite_formula_for_offset(&value, d_row, d_col)
                        } else {
                            value
                        };
                        apply_cell_input(
                            sheet,
                            dest_start_row + row_offset,
                            dest_start_col + col_offset,
                            rewritten.as_str(),
                        );
                    }
                }
                finalize_sheet(sheet, self.formula_engine.as_ref(), previous_cells)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        let sheet = active_sheet_ref(workbook_ref)?;
        if dirty {
            maybe_emit_sync(
                &self.hub,
                notify_correlation_id,
                workbook_ref,
                sheet,
                "copy_paste_range",
                Some(source),
            );
        }
        Ok(WriteRangeResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            updated_range: Some(requested_range),
            dirty: workbook_ref.dirty,
        })
    }

    pub fn insert_rows(
        &self,
        index: usize,
        count: usize,
        source: EditSource,
        notify_correlation_id: Option<&str>,
    ) -> Result<ResizeResult, SheetsError> {
        if count == 0 {
            return Err(sheets_error(
                SheetsErrorCode::InvalidRange,
                "row count must be greater than zero",
            ));
        }
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let dirty = mutate_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "insert_rows",
            Some(format!("Inserted {count} row(s) at {index}")),
            |sheet| {
                if index > sheet.row_count {
                    return Err(sheets_error(
                        SheetsErrorCode::InvalidRange,
                        "row insert index is out of bounds",
                    ));
                }
                let previous_cells = sheet.cells.clone();
                let mut next = HashMap::new();
                for (coord, cell) in previous_cells.iter() {
                    let next_coord = if coord.row >= index {
                        CellCoord {
                            row: coord.row + count,
                            col: coord.col,
                        }
                    } else {
                        coord.clone()
                    };
                    let mut next_cell = cell.clone();
                    next_cell.input =
                        rewrite_formula_input_for_row_insert(&next_cell.input, index, count);
                    next.insert(next_coord, next_cell);
                }
                sheet.cells = next;
                sheet.row_count += count;
                finalize_sheet(sheet, self.formula_engine.as_ref(), previous_cells)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        let sheet = active_sheet_ref(workbook_ref)?;
        if dirty {
            maybe_emit_sync(
                &self.hub,
                notify_correlation_id,
                workbook_ref,
                sheet,
                "insert_rows",
                Some(source),
            );
        }
        Ok(ResizeResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            dirty: workbook_ref.dirty,
            row_count: Some(sheet.row_count),
            column_count: None,
        })
    }

    pub fn delete_rows(
        &self,
        index: usize,
        count: usize,
        source: EditSource,
        notify_correlation_id: Option<&str>,
    ) -> Result<ResizeResult, SheetsError> {
        if count == 0 {
            return Err(sheets_error(
                SheetsErrorCode::InvalidRange,
                "row count must be greater than zero",
            ));
        }
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let dirty = mutate_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "delete_rows",
            Some(format!("Deleted {count} row(s) at {index}")),
            |sheet| {
                if index >= sheet.row_count {
                    return Err(sheets_error(
                        SheetsErrorCode::InvalidRange,
                        "row delete index is out of bounds",
                    ));
                }
                let previous_cells = sheet.cells.clone();
                let mut next = HashMap::new();
                let delete_end = index + count;
                for (coord, cell) in previous_cells.iter() {
                    if coord.row >= index && coord.row < delete_end {
                        continue;
                    }
                    let next_coord = if coord.row >= delete_end {
                        CellCoord {
                            row: coord.row - count,
                            col: coord.col,
                        }
                    } else {
                        coord.clone()
                    };
                    let mut next_cell = cell.clone();
                    next_cell.input =
                        rewrite_formula_input_for_row_delete(&next_cell.input, index, count);
                    next.insert(next_coord, next_cell);
                }
                sheet.cells = next;
                sheet.row_count = sheet.row_count.saturating_sub(count).max(1);
                finalize_sheet(sheet, self.formula_engine.as_ref(), previous_cells)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        let sheet = active_sheet_ref(workbook_ref)?;
        if dirty {
            maybe_emit_sync(
                &self.hub,
                notify_correlation_id,
                workbook_ref,
                sheet,
                "delete_rows",
                Some(source),
            );
        }
        Ok(ResizeResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            dirty: workbook_ref.dirty,
            row_count: Some(sheet.row_count),
            column_count: None,
        })
    }

    pub fn insert_columns(
        &self,
        index: usize,
        count: usize,
        source: EditSource,
        notify_correlation_id: Option<&str>,
    ) -> Result<ResizeResult, SheetsError> {
        if count == 0 {
            return Err(sheets_error(
                SheetsErrorCode::InvalidRange,
                "column count must be greater than zero",
            ));
        }
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let dirty = mutate_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "insert_columns",
            Some(format!("Inserted {count} column(s) at {index}")),
            |sheet| {
                if index > sheet.col_count {
                    return Err(sheets_error(
                        SheetsErrorCode::InvalidRange,
                        "column insert index is out of bounds",
                    ));
                }
                let previous_cells = sheet.cells.clone();
                let mut next = HashMap::new();
                for (coord, cell) in previous_cells.iter() {
                    let next_coord = if coord.col >= index {
                        CellCoord {
                            row: coord.row,
                            col: coord.col + count,
                        }
                    } else {
                        coord.clone()
                    };
                    let mut next_cell = cell.clone();
                    next_cell.input =
                        rewrite_formula_input_for_column_insert(&next_cell.input, index, count);
                    next.insert(next_coord, next_cell);
                }
                sheet.cells = next;
                sheet.col_count += count;
                finalize_sheet(sheet, self.formula_engine.as_ref(), previous_cells)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        let sheet = active_sheet_ref(workbook_ref)?;
        if dirty {
            maybe_emit_sync(
                &self.hub,
                notify_correlation_id,
                workbook_ref,
                sheet,
                "insert_columns",
                Some(source),
            );
        }
        Ok(ResizeResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            dirty: workbook_ref.dirty,
            row_count: None,
            column_count: Some(sheet.col_count),
        })
    }

    pub fn delete_columns(
        &self,
        index: usize,
        count: usize,
        source: EditSource,
        notify_correlation_id: Option<&str>,
    ) -> Result<ResizeResult, SheetsError> {
        if count == 0 {
            return Err(sheets_error(
                SheetsErrorCode::InvalidRange,
                "column count must be greater than zero",
            ));
        }
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let dirty = mutate_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "delete_columns",
            Some(format!("Deleted {count} column(s) at {index}")),
            |sheet| {
                if index >= sheet.col_count {
                    return Err(sheets_error(
                        SheetsErrorCode::InvalidRange,
                        "column delete index is out of bounds",
                    ));
                }
                let previous_cells = sheet.cells.clone();
                let mut next = HashMap::new();
                let delete_end = index + count;
                for (coord, cell) in previous_cells.iter() {
                    if coord.col >= index && coord.col < delete_end {
                        continue;
                    }
                    let next_coord = if coord.col >= delete_end {
                        CellCoord {
                            row: coord.row,
                            col: coord.col - count,
                        }
                    } else {
                        coord.clone()
                    };
                    let mut next_cell = cell.clone();
                    next_cell.input =
                        rewrite_formula_input_for_column_delete(&next_cell.input, index, count);
                    next.insert(next_coord, next_cell);
                }
                sheet.cells = next;
                sheet.col_count = sheet.col_count.saturating_sub(count).max(1);
                finalize_sheet(sheet, self.formula_engine.as_ref(), previous_cells)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        let sheet = active_sheet_ref(workbook_ref)?;
        if dirty {
            maybe_emit_sync(
                &self.hub,
                notify_correlation_id,
                workbook_ref,
                sheet,
                "delete_columns",
                Some(source),
            );
        }
        Ok(ResizeResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            dirty: workbook_ref.dirty,
            row_count: None,
            column_count: Some(sheet.col_count),
        })
    }

    pub fn error_string(error: SheetsError) -> String {
        error.to_error_string()
    }

    pub fn set_ai_model(&self, model_id: &str) -> Result<InspectSheetResult, SheetsError> {
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let next_model = if model_id.trim().is_empty() {
            "local:runtime".to_string()
        } else {
            model_id.trim().to_string()
        };
        workbook.ai_model_id = next_model.clone();
        *self
            .ai_model_id
            .write()
            .expect("sheets ai model lock poisoned") = next_model.clone();
        let (row_count, column_count, used_range, revision, dirty, capabilities) = {
            let sheet = active_sheet_mut(workbook)?;
            self.formula_engine
                .recompute_sheet(sheet)
                .map_err(SheetsError::from)?;
            sheet.used_range = compute_used_range(&sheet.cells);
            let row_count = sheet.row_count;
            let column_count = sheet.col_count;
            let used_range = sheet.used_range.clone();
            workbook.revision += 1;
            workbook.dirty = true;
            (
                row_count,
                column_count,
                used_range,
                workbook.revision,
                workbook.dirty,
                workbook.source.capabilities.clone(),
            )
        };
        Ok(InspectSheetResult {
            file_path: workbook.file_path.clone(),
            file_name: workbook.file_name.clone(),
            row_count,
            column_count,
            used_range,
            dirty,
            revision,
            capabilities: Some(capabilities),
            ai_model_id: next_model,
            can_undo: !workbook.undo_stack.is_empty(),
            can_redo: !workbook.redo_stack.is_empty(),
        })
    }

    pub fn undo(&self) -> Result<InspectSheetResult, SheetsError> {
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let entry = workbook
            .undo_stack
            .pop()
            .ok_or_else(|| sheets_error(SheetsErrorCode::InvalidRange, "nothing to undo"))?;
        workbook.redo_stack.push(history_entry(workbook));
        restore_history_entry(workbook, entry);
        workbook.revision += 1;
        workbook.dirty = true;
        inspect_workbook(workbook)
    }

    pub fn redo(&self) -> Result<InspectSheetResult, SheetsError> {
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let entry = workbook
            .redo_stack
            .pop()
            .ok_or_else(|| sheets_error(SheetsErrorCode::InvalidRange, "nothing to redo"))?;
        workbook.undo_stack.push(history_entry(workbook));
        restore_history_entry(workbook, entry);
        workbook.revision += 1;
        workbook.dirty = true;
        inspect_workbook(workbook)
    }

    pub fn apply_cell_format(
        &self,
        start_row: usize,
        start_col: usize,
        end_row: usize,
        end_col: usize,
        pattern: Option<&str>,
        source: EditSource,
    ) -> Result<WriteRangeResult, SheetsError> {
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let requested_range = UsedRange {
            start_row,
            start_col,
            end_row,
            end_col,
        };
        let dirty = mutate_workbook_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "apply_cell_format",
            Some("Updated cell format".to_string()),
            |workbook, sheet| {
                validate_range(sheet, start_row, start_col, end_row, end_col)?;
                let mut changed = BTreeSet::new();
                for row in start_row..=end_row {
                    for col in start_col..=end_col {
                        let coord = CellCoord { row, col };
                        let Some(cell) = sheet.cells.get_mut(&coord) else {
                            continue;
                        };
                        let next_style_id =
                            merge_cell_style(&mut workbook.styles, cell.style_id, |style| {
                                style.f = pattern.map(ToOwned::to_owned);
                            });
                        if cell.style_id != next_style_id {
                            cell.style_id = next_style_id;
                            changed.insert(coord);
                        }
                    }
                }
                Ok(changed)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        Ok(WriteRangeResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            updated_range: Some(requested_range),
            dirty: workbook_ref.dirty,
        })
    }

    pub fn toggle_cell_mark(
        &self,
        start_row: usize,
        start_col: usize,
        end_row: usize,
        end_col: usize,
        mark: &str,
        source: EditSource,
    ) -> Result<WriteRangeResult, SheetsError> {
        let mut guard = self.state.write().expect("sheets state lock poisoned");
        let workbook = guard.as_mut().ok_or_else(|| {
            sheets_error(SheetsErrorCode::MissingOpenWorkbook, "no sheet is open")
        })?;
        let before_revision = workbook.revision;
        let requested_range = UsedRange {
            start_row,
            start_col,
            end_row,
            end_col,
        };
        let dirty = mutate_workbook_sheet(
            workbook,
            self.formula_engine.as_ref(),
            source,
            "toggle_cell_mark",
            Some(format!("Toggled {mark} style")),
            |workbook, sheet| {
                validate_range(sheet, start_row, start_col, end_row, end_col)?;
                let has_unmarked = (start_row..=end_row).any(|row| {
                    (start_col..=end_col).any(|col| {
                        let coord = CellCoord { row, col };
                        sheet
                            .cells
                            .get(&coord)
                            .map(|cell| !cell_has_mark(cell, &workbook.styles, mark))
                            .unwrap_or(false)
                    })
                });
                let mut changed = BTreeSet::new();
                for row in start_row..=end_row {
                    for col in start_col..=end_col {
                        let coord = CellCoord { row, col };
                        let Some(cell) = sheet.cells.get_mut(&coord) else {
                            continue;
                        };
                        let next_style_id =
                            merge_cell_style(&mut workbook.styles, cell.style_id, |style| {
                                let marks = style.m.get_or_insert_with(Vec::new);
                                if has_unmarked {
                                    if !marks.iter().any(|entry| entry == mark) {
                                        marks.push(mark.to_string());
                                        marks.sort();
                                    }
                                } else {
                                    marks.retain(|entry| entry != mark);
                                    if marks.is_empty() {
                                        style.m = None;
                                    }
                                }
                            });
                        if cell.style_id != next_style_id {
                            cell.style_id = next_style_id;
                            changed.insert(coord);
                        }
                    }
                }
                Ok(changed)
            },
        )?;
        let workbook_ref = guard.as_ref().expect("workbook present after mutation");
        Ok(WriteRangeResult {
            revision: if dirty {
                workbook_ref.revision
            } else {
                before_revision
            },
            updated_range: Some(requested_range),
            dirty: workbook_ref.dirty,
        })
    }
}

struct HttpAiFormulaProvider {
    api_registry: Arc<ApiRegistryService>,
    selected_model_id: Arc<RwLock<String>>,
    cache: RwLock<HashMap<String, String>>,
}

impl HttpAiFormulaProvider {
    fn new(api_registry: Arc<ApiRegistryService>, selected_model_id: Arc<RwLock<String>>) -> Self {
        Self {
            api_registry,
            selected_model_id,
            cache: RwLock::new(HashMap::new()),
        }
    }

    fn resolve_provider(&self) -> Result<(String, Option<String>, String), FormulaError> {
        let selected = self
            .selected_model_id
            .read()
            .expect("sheets ai model lock poisoned")
            .clone();
        let fallback_model =
            std::env::var("FOUNDATION_LLM_MODEL").unwrap_or_else(|_| "local-model".to_string());
        if selected.starts_with("api:") {
            let mut parts = selected.splitn(3, ':');
            let _ = parts.next();
            let connection_id = parts.next().unwrap_or_default();
            let model_name = parts.next().unwrap_or_default();
            if let Some(conn) = self
                .api_registry
                .verified_for_agent()
                .into_iter()
                .find(|record| record.id == connection_id)
            {
                return Ok((
                    resolve_chat_endpoint(conn.api_url.as_str(), conn.api_standard_path.as_deref()),
                    Some(conn.api_key),
                    if model_name.is_empty() {
                        conn.model_name.unwrap_or(fallback_model)
                    } else {
                        model_name.to_string()
                    },
                ));
            }
        }
        Ok((
            std::env::var("FOUNDATION_LLM_ENDPOINT")
                .unwrap_or_else(|_| "http://127.0.0.1:1420/v1/chat/completions".to_string()),
            std::env::var("OPENAI_API_KEY").ok(),
            fallback_model,
        ))
    }
}

impl AiFormulaProvider for HttpAiFormulaProvider {
    fn generate(&self, prompt: &str, context: Option<&str>) -> Result<String, FormulaError> {
        let cache_key = format!(
            "{}\u{1f}|{}\u{1f}|{}",
            self.selected_model_id
                .read()
                .expect("sheets ai model lock poisoned")
                .as_str(),
            prompt,
            context.unwrap_or("")
        );
        if let Some(cached) = self
            .cache
            .read()
            .expect("sheets ai cache lock poisoned")
            .get(&cache_key)
        {
            return Ok(cached.clone());
        }
        let (endpoint, api_key, model) = self.resolve_provider()?;
        let user_prompt = if let Some(context) = context {
            format!("{}\n\nContext:\n{}", prompt.trim(), context.trim())
        } else {
            prompt.trim().to_string()
        };
        let mut request = reqwest::blocking::Client::new()
            .post(endpoint)
            .json(&json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are helping spreadsheet users. Return only the requested cell output text with no markdown or commentary."},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.2
            }));
        if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
            request = request.header("Authorization", format!("Bearer {key}"));
        }
        let response = request.send().map_err(|error| FormulaError {
            code: FormulaErrorCode::UnsupportedFormula,
            message: format!("AI request failed: {error}"),
        })?;
        let body: serde_json::Value = response.json().map_err(|error| FormulaError {
            code: FormulaErrorCode::UnsupportedFormula,
            message: format!("AI response parse failed: {error}"),
        })?;
        let text = extract_generated_text_from_value(&body);
        self.cache
            .write()
            .expect("sheets ai cache lock poisoned")
            .insert(cache_key, text.clone());
        Ok(text)
    }
}

fn resolve_chat_endpoint(base: &str, path: Option<&str>) -> String {
    let path = path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("/chat/completions");
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let lower = base.to_ascii_lowercase();
    if lower.ends_with("/chat/completions") {
        return base.to_string();
    }
    if lower.ends_with("/v1") {
        return format!("{base}{normalized_path}");
    }
    format!("{base}/v1{normalized_path}")
}

fn extract_generated_text_from_value(body: &serde_json::Value) -> String {
    body.get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| {
            choice
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
                .map(str::to_string)
        })
        .or_else(|| {
            body.get("choices")
                .and_then(|choices| choices.as_array())
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("text"))
                .and_then(|text| text.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

impl Default for SheetsService {
    fn default() -> Self {
        Self::new(None, Arc::new(ApiRegistryService::new()))
    }
}

impl From<FormulaError> for SheetsError {
    fn from(value: FormulaError) -> Self {
        let code = match value.code {
            FormulaErrorCode::CircularReference => SheetsErrorCode::CircularReference,
            FormulaErrorCode::InvalidReference => SheetsErrorCode::InvalidReference,
            FormulaErrorCode::UnsupportedFormula => SheetsErrorCode::UnsupportedFormula,
            FormulaErrorCode::ParseFailure => SheetsErrorCode::ParseFailure,
        };
        sheets_error(code, value.message)
    }
}

impl SheetsError {
    pub fn to_error_string(&self) -> String {
        let payload = match self {
            Self::Message { code, message } => SheetsErrorPayload {
                code: format!("{:?}", code).to_ascii_lowercase(),
                message: message.clone(),
            },
        };
        serde_json::to_string(&payload).unwrap_or_else(|_| payload.message)
    }

    pub fn message(&self) -> String {
        match self {
            Self::Message { message, .. } => message.clone(),
        }
    }
}

fn mutate_sheet<F>(
    workbook: &mut WorkbookState,
    _formula_engine: &dyn FormulaEngine,
    source: EditSource,
    operation: &str,
    summary: Option<String>,
    mutator: F,
) -> Result<bool, SheetsError>
where
    F: FnOnce(&mut SheetState) -> Result<BTreeSet<CellCoord>, SheetsError>,
{
    let sheet = active_sheet_mut(workbook)?;
    let previous_cells = sheet.cells.clone();
    let previous_rows = sheet.row_count;
    let previous_cols = sheet.col_count;
    let changed = mutator(sheet)?;
    let dirty = !changed.is_empty()
        || previous_rows != sheet.row_count
        || previous_cols != sheet.col_count
        || previous_cells != sheet.cells;
    if dirty {
        workbook.undo_stack.push(history_entry(workbook));
        if workbook.undo_stack.len() > 100 {
            workbook.undo_stack.remove(0);
        }
        workbook.redo_stack.clear();
        workbook.revision += 1;
        workbook.dirty = true;
        workbook.edit_log.push(EditProvenance {
            source,
            operation: operation.to_string(),
            timestamp_ms: now_ms(),
            summary,
        });
    }
    Ok(dirty)
}

fn mutate_workbook_sheet<F>(
    workbook: &mut WorkbookState,
    formula_engine: &dyn FormulaEngine,
    source: EditSource,
    operation: &str,
    summary: Option<String>,
    mutator: F,
) -> Result<bool, SheetsError>
where
    F: FnOnce(&mut WorkbookState, &mut SheetState) -> Result<BTreeSet<CellCoord>, SheetsError>,
{
    let previous_workbook = history_entry(workbook);
    let previous_revision = workbook.revision;
    let previous_dirty = workbook.dirty;
    let previous_log_len = workbook.edit_log.len();
    let previous_redo = workbook.redo_stack.clone();
    let sheet_index = workbook.active_sheet;
    let previous_cells = workbook
        .sheets
        .get(sheet_index)
        .map(|sheet| sheet.cells.clone())
        .unwrap_or_default();
    let previous_rows = workbook
        .sheets
        .get(sheet_index)
        .map(|sheet| sheet.row_count)
        .unwrap_or(0);
    let previous_cols = workbook
        .sheets
        .get(sheet_index)
        .map(|sheet| sheet.col_count)
        .unwrap_or(0);

    let mut sheet = workbook.sheets.remove(sheet_index);
    let changed = mutator(workbook, &mut sheet)?;
    let dirty = !changed.is_empty()
        || previous_rows != sheet.row_count
        || previous_cols != sheet.col_count
        || previous_cells != sheet.cells;
    workbook.sheets.insert(sheet_index, sheet);

    if dirty {
        workbook.undo_stack.push(previous_workbook);
        if workbook.undo_stack.len() > 100 {
            workbook.undo_stack.remove(0);
        }
        workbook.redo_stack.clear();
        workbook.revision += 1;
        workbook.dirty = true;
        workbook.edit_log.push(EditProvenance {
            source,
            operation: operation.to_string(),
            timestamp_ms: now_ms(),
            summary,
        });
        Ok(true)
    } else {
        workbook.revision = previous_revision;
        workbook.dirty = previous_dirty;
        workbook.edit_log.truncate(previous_log_len);
        workbook.redo_stack = previous_redo;
        Ok(false)
    }
}

fn history_entry(workbook: &WorkbookState) -> WorkbookHistoryEntry {
    WorkbookHistoryEntry {
        sheets: workbook.sheets.clone(),
        active_sheet: workbook.active_sheet,
        styles: workbook.styles.clone(),
    }
}

fn merge_cell_style(
    styles: &mut Vec<sheets_jsonl::CellStyle>,
    style_id: Option<usize>,
    mutator: impl FnOnce(&mut sheets_jsonl::CellStyle),
) -> Option<usize> {
    let mut style = style_id
        .and_then(|id| styles.get(id).cloned())
        .unwrap_or_default();
    mutator(&mut style);
    if style == sheets_jsonl::CellStyle::default() {
        return None;
    }
    if let Some(existing) = styles.iter().position(|entry| *entry == style) {
        return Some(existing);
    }
    styles.push(style);
    Some(styles.len() - 1)
}

fn cell_has_mark(cell: &CellState, styles: &[sheets_jsonl::CellStyle], mark: &str) -> bool {
    cell.style_id
        .and_then(|style_id| styles.get(style_id))
        .and_then(|style| style.m.as_ref())
        .map(|marks| marks.iter().any(|entry| entry == mark))
        .unwrap_or(false)
}

fn restore_history_entry(workbook: &mut WorkbookState, entry: WorkbookHistoryEntry) {
    workbook.sheets = entry.sheets;
    workbook.active_sheet = entry
        .active_sheet
        .min(workbook.sheets.len().saturating_sub(1));
    workbook.styles = entry.styles;
}

fn inspect_workbook(workbook: &WorkbookState) -> Result<InspectSheetResult, SheetsError> {
    let sheet = active_sheet_ref(workbook)?;
    Ok(InspectSheetResult {
        file_path: workbook.file_path.clone(),
        file_name: workbook.file_name.clone(),
        row_count: sheet.row_count,
        column_count: sheet.col_count,
        used_range: sheet.used_range.clone(),
        dirty: workbook.dirty,
        revision: workbook.revision,
        capabilities: Some(workbook.source.capabilities.clone()),
        ai_model_id: workbook.ai_model_id.clone(),
        can_undo: !workbook.undo_stack.is_empty(),
        can_redo: !workbook.redo_stack.is_empty(),
    })
}

fn finalize_sheet(
    sheet: &mut SheetState,
    formula_engine: &dyn FormulaEngine,
    previous_cells: HashMap<CellCoord, CellState>,
) -> Result<BTreeSet<CellCoord>, SheetsError> {
    formula_engine
        .recompute_sheet(sheet)
        .map_err(SheetsError::from)?;
    sheet.used_range = compute_used_range(&sheet.cells);
    Ok(diff_cell_maps(&previous_cells, &sheet.cells))
}

fn active_sheet_ref(workbook: &WorkbookState) -> Result<&SheetState, SheetsError> {
    workbook.sheets.get(workbook.active_sheet).ok_or_else(|| {
        sheets_error(
            SheetsErrorCode::MissingOpenWorkbook,
            "active sheet is missing from workbook",
        )
    })
}

fn active_sheet_mut(workbook: &mut WorkbookState) -> Result<&mut SheetState, SheetsError> {
    workbook
        .sheets
        .get_mut(workbook.active_sheet)
        .ok_or_else(|| {
            sheets_error(
                SheetsErrorCode::MissingOpenWorkbook,
                "active sheet is missing from workbook",
            )
        })
}

fn validate_range(
    sheet: &SheetState,
    start_row: usize,
    start_col: usize,
    end_row: usize,
    end_col: usize,
) -> Result<(), SheetsError> {
    if start_row > end_row || start_col > end_col {
        return Err(sheets_error(
            SheetsErrorCode::InvalidRange,
            "range start must not exceed range end",
        ));
    }
    if end_row >= sheet.row_count || end_col >= sheet.col_count {
        return Err(sheets_error(
            SheetsErrorCode::InvalidRange,
            "requested range is outside the active sheet bounds",
        ));
    }
    Ok(())
}

fn snapshot_range(
    sheet: &SheetState,
    styles: &[sheets_jsonl::CellStyle],
    start_row: usize,
    start_col: usize,
    end_row: usize,
    end_col: usize,
) -> Vec<SheetCellSnapshot> {
    let mut cells = Vec::new();
    for row in start_row..=end_row {
        for col in start_col..=end_col {
            cells.push(sheet.snapshot_cell(&CellCoord { row, col }, styles));
        }
    }
    cells
}

fn snapshot_sheet(
    sheet: &SheetState,
    styles: &[sheets_jsonl::CellStyle],
    revision: u64,
    dirty: bool,
) -> SheetSnapshot {
    let mut coords = sorted_coords(sheet.cells.keys().cloned().collect());
    let cells = coords
        .drain(..)
        .map(|coord| sheet.snapshot_cell(&coord, styles))
        .collect::<Vec<_>>();
    SheetSnapshot {
        row_count: sheet.row_count,
        column_count: sheet.col_count,
        used_range: sheet.used_range.clone(),
        dirty,
        revision,
        cells,
    }
}

fn snapshot_changed_cells(
    sheet: &SheetState,
    styles: &[sheets_jsonl::CellStyle],
    coords: &[CellCoord],
) -> Vec<SheetCellSnapshot> {
    let mut sorted = coords.to_vec();
    sorted.sort();
    sorted.dedup();
    sorted
        .into_iter()
        .map(|coord| sheet.snapshot_cell(&coord, styles))
        .collect()
}

fn compute_used_range(cells: &HashMap<CellCoord, CellState>) -> Option<UsedRange> {
    let mut rows = cells.keys().map(|coord| coord.row);
    let mut cols = cells.keys().map(|coord| coord.col);
    let start_row = rows.next()?;
    let start_col = cols.next()?;
    let (mut min_row, mut max_row) = (start_row, start_row);
    let (mut min_col, mut max_col) = (start_col, start_col);
    for coord in cells.keys() {
        min_row = min_row.min(coord.row);
        max_row = max_row.max(coord.row);
        min_col = min_col.min(coord.col);
        max_col = max_col.max(coord.col);
    }
    Some(UsedRange {
        start_row: min_row,
        start_col: min_col,
        end_row: max_row,
        end_col: max_col,
    })
}

fn diff_cell_maps(
    previous: &HashMap<CellCoord, CellState>,
    current: &HashMap<CellCoord, CellState>,
) -> BTreeSet<CellCoord> {
    let mut changed = BTreeSet::new();
    for coord in previous.keys() {
        if previous.get(coord) != current.get(coord) {
            changed.insert(coord.clone());
        }
    }
    for coord in current.keys() {
        if previous.get(coord) != current.get(coord) {
            changed.insert(coord.clone());
        }
    }
    changed
}

fn ensure_cell_dimensions(sheet: &mut SheetState, row: usize, col: usize) {
    sheet.row_count = sheet.row_count.max(row + 1).max(1);
    sheet.col_count = sheet.col_count.max(col + 1).max(1);
}

fn apply_cell_input(sheet: &mut SheetState, row: usize, col: usize, input: &str) {
    let coord = CellCoord { row, col };
    if input.is_empty() {
        sheet.cells.remove(&coord);
    } else {
        let entry = sheet.cells.entry(coord).or_insert_with(CellState::empty);
        entry.input = input.to_string();
        entry.computed = ComputedValue::Empty;
        entry.error = None;
    }
}

fn sorted_coords(mut coords: Vec<CellCoord>) -> Vec<CellCoord> {
    coords.sort();
    coords
}

fn maybe_emit_sync(
    hub: &Option<EventHub>,
    correlation_id: Option<&str>,
    workbook: &WorkbookState,
    sheet: &SheetState,
    operation: &str,
    source: Option<EditSource>,
) {
    let Some(hub) = hub else { return };
    let Some(correlation_id) = correlation_id else {
        return;
    };
    hub.emit(hub.make_event(
        correlation_id,
        Subsystem::Tool,
        "sheets.workbook.sync",
        EventStage::Complete,
        EventSeverity::Info,
        json!({
            "filePath": workbook.file_path,
            "fileName": workbook.file_name,
            "rowCount": sheet.row_count,
            "columnCount": sheet.col_count,
            "usedRange": sheet.used_range,
            "dirty": workbook.dirty,
            "revision": workbook.revision,
            "format": workbook.format,
            "operation": operation,
            "source": source
        }),
    ));
}

fn sheets_error(code: SheetsErrorCode, message: impl Into<String>) -> SheetsError {
    SheetsError::Message {
        code,
        message: message.into(),
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn normalize_optional_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_existing_path(path: &str) -> Result<PathBuf, SheetsError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(sheets_error(
            SheetsErrorCode::InvalidPath,
            "path is required",
        ));
    }
    let path = PathBuf::from(trimmed);
    path.canonicalize().map_err(|error| {
        sheets_error(
            SheetsErrorCode::InvalidPath,
            format!("failed resolving path: {error}"),
        )
    })
}

fn normalize_target_path(path: &str) -> Result<PathBuf, SheetsError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(sheets_error(
            SheetsErrorCode::InvalidPath,
            "path is required",
        ));
    }
    let candidate = PathBuf::from(trimmed);
    if candidate.exists() {
        return candidate.canonicalize().map_err(|error| {
            sheets_error(
                SheetsErrorCode::InvalidPath,
                format!("failed resolving path: {error}"),
            )
        });
    }
    Ok(candidate)
}

fn rewrite_formula_input_for_row_insert(input: &str, index: usize, count: usize) -> String {
    rewrite_formula_references(input, |coord| {
        Some(CellCoord {
            row: if coord.row >= index {
                coord.row + count
            } else {
                coord.row
            },
            col: coord.col,
        })
    })
}

fn rewrite_formula_input_for_row_delete(input: &str, index: usize, count: usize) -> String {
    let delete_end = index + count;
    rewrite_formula_references(input, |coord| {
        if coord.row >= index && coord.row < delete_end {
            None
        } else {
            Some(CellCoord {
                row: if coord.row >= delete_end {
                    coord.row - count
                } else {
                    coord.row
                },
                col: coord.col,
            })
        }
    })
}

fn rewrite_formula_input_for_column_insert(input: &str, index: usize, count: usize) -> String {
    rewrite_formula_references(input, |coord| {
        Some(CellCoord {
            row: coord.row,
            col: if coord.col >= index {
                coord.col + count
            } else {
                coord.col
            },
        })
    })
}

fn rewrite_formula_input_for_column_delete(input: &str, index: usize, count: usize) -> String {
    let delete_end = index + count;
    rewrite_formula_references(input, |coord| {
        if coord.col >= index && coord.col < delete_end {
            None
        } else {
            Some(CellCoord {
                row: coord.row,
                col: if coord.col >= delete_end {
                    coord.col - count
                } else {
                    coord.col
                },
            })
        }
    })
}

fn rewrite_formula_for_offset(input: &str, d_row: isize, d_col: isize) -> String {
    rewrite_formula_references(input, |coord| {
        let new_row = coord.row as isize + d_row;
        let new_col = coord.col as isize + d_col;
        if new_row < 0 || new_col < 0 {
            None
        } else {
            Some(CellCoord {
                row: new_row as usize,
                col: new_col as usize,
            })
        }
    })
}

fn rewrite_formula_references(
    input: &str,
    mut rewrite_coord: impl FnMut(CellCoord) -> Option<CellCoord>,
) -> String {
    if !input.starts_with('=') {
        return input.to_string();
    }

    let mut result = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut index = 0usize;
    let mut in_string = false;

    while index < chars.len() {
        let ch = chars[index];
        if ch == '"' {
            result.push(ch);
            if in_string && index + 1 < chars.len() && chars[index + 1] == '"' {
                result.push(chars[index + 1]);
                index += 2;
                continue;
            }
            in_string = !in_string;
            index += 1;
            continue;
        }

        if !in_string && ch.is_ascii_alphabetic() {
            let token_start = index;
            while index < chars.len() && chars[index].is_ascii_alphabetic() {
                index += 1;
            }
            let row_start = index;
            while index < chars.len() && chars[index].is_ascii_digit() {
                index += 1;
            }

            if row_start > token_start && index > row_start {
                let reference: String = chars[token_start..index].iter().collect();
                if let Some(coord) = parse_formula_coord(&reference) {
                    if token_start > 0 && is_reference_word_char(chars[token_start - 1]) {
                        result.push_str(&reference);
                        continue;
                    }
                    if index < chars.len() && is_reference_word_char(chars[index]) {
                        result.push_str(&reference);
                        continue;
                    }

                    let replacement = match rewrite_coord(coord) {
                        Some(next) => coord_label(next.row, next.col),
                        None => "#REF!".to_string(),
                    };
                    result.push_str(&replacement);

                    if index < chars.len() && chars[index] == ':' {
                        let colon_index = index;
                        let mut range_end = colon_index + 1;
                        while range_end < chars.len() && chars[range_end].is_ascii_alphabetic() {
                            range_end += 1;
                        }
                        let range_row_start = range_end;
                        while range_end < chars.len() && chars[range_end].is_ascii_digit() {
                            range_end += 1;
                        }
                        if range_row_start > colon_index + 1 && range_end > range_row_start {
                            let end_reference: String =
                                chars[colon_index + 1..range_end].iter().collect();
                            if let Some(end_coord) = parse_formula_coord(&end_reference) {
                                let end_replacement = match rewrite_coord(end_coord) {
                                    Some(next) => coord_label(next.row, next.col),
                                    None => "#REF!".to_string(),
                                };
                                result.push(':');
                                result.push_str(&end_replacement);
                                index = range_end;
                                continue;
                            }
                        }
                        result.push(':');
                        index = colon_index + 1;
                    }
                    continue;
                }
                result.push_str(&reference);
                continue;
            }

            let token: String = chars[token_start..index].iter().collect();
            result.push_str(&token);
            continue;
        }

        result.push(ch);
        index += 1;
    }

    result
}

fn is_reference_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn parse_formula_coord(value: &str) -> Option<CellCoord> {
    let mut col_part = String::new();
    let mut row_part = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphabetic() && row_part.is_empty() {
            col_part.push(ch.to_ascii_uppercase());
        } else if ch.is_ascii_digit() {
            row_part.push(ch);
        } else {
            return None;
        }
    }
    if col_part.is_empty() || row_part.is_empty() {
        return None;
    }
    let row_number = row_part.parse::<usize>().ok()?;
    if row_number == 0 {
        return None;
    }
    Some(CellCoord {
        row: row_number - 1,
        col: column_label_to_index(&col_part)?,
    })
}

fn column_label_to_index(label: &str) -> Option<usize> {
    let mut value = 0usize;
    for ch in label.chars() {
        if !ch.is_ascii_uppercase() {
            return None;
        }
        value = value.checked_mul(26)?;
        value = value.checked_add((ch as u8 - b'A' + 1) as usize)?;
    }
    value.checked_sub(1)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn coord_label(row: usize, col: usize) -> String {
    format!(
        "{}{}",
        crate::services::sheets_formula::column_index_to_label(col),
        row + 1
    )
}

pub(crate) fn detect_format(path: &str) -> &'static str {
    if path.ends_with(".sheet.jsonl") {
        "jsonl"
    } else {
        "csv"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_csv_path(name: &str) -> PathBuf {
        let unique = format!(
            "arxell-sheets-{}-{}-{}.csv",
            name,
            std::process::id(),
            now_ms()
        );
        std::env::temp_dir().join(unique)
    }

    fn write_csv(name: &str, content: &str) -> PathBuf {
        let path = temp_csv_path(name);
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn open_sheet_normalizes_ragged_rows() {
        let path = write_csv("open", "a,b\n1\n2,3,4\n");
        let service = SheetsService::default();
        let result = service.open_sheet(path.to_str().unwrap()).unwrap();
        assert_eq!(result.sheet.row_count, 3);
        assert_eq!(result.sheet.column_count, 3);
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(sheet.cells[&CellCoord { row: 2, col: 2 }].input, "4");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn new_sheet_creates_blank_default_workbook() {
        let service = SheetsService::default();
        let result = service.new_sheet().unwrap();
        assert_eq!(result.file_name.as_deref(), Some("New Sheet"));
        assert_eq!(result.row_count, 1000);
        assert_eq!(result.column_count, 26);
        let workbook = service.current_workbook().unwrap();
        assert!(workbook.file_path.is_none());
        assert!(workbook.sheets[0].cells.is_empty());
    }

    #[test]
    fn save_sheet_preserves_formulas() {
        let path = write_csv("save", "1,=A1+2\n");
        let save_path = temp_csv_path("save-output");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service
            .save_sheet(Some(save_path.to_str().unwrap()))
            .unwrap();
        let saved = fs::read_to_string(&save_path).unwrap();
        assert!(saved.contains("=A1+2"));
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(save_path);
    }

    #[test]
    fn set_cell_updates_canonical_state() {
        let path = write_csv("set-cell", "a\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service
            .set_cell_input(0, 1, "=1+2", EditSource::User, None)
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(sheet.cells[&CellCoord { row: 0, col: 1 }].input, "=1+2");
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Number(3.0)
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn write_range_updates_canonical_state() {
        let path = write_csv("write-range", "\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service
            .write_range(
                0,
                0,
                &vec![
                    vec!["1".to_string(), "2".to_string()],
                    vec!["3".to_string(), "=A1+B1".to_string()],
                ],
                EditSource::User,
                None,
            )
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(
            sheet.cells[&CellCoord { row: 1, col: 1 }].computed,
            ComputedValue::Number(3.0)
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn copy_paste_range_adjusts_formula_references() {
        let path = write_csv("copy-paste", "\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service
            .write_range(
                0,
                0,
                &vec![vec!["1".to_string(), "2".to_string()]],
                EditSource::User,
                None,
            )
            .unwrap();
        service
            .write_range(
                1,
                0,
                &vec![vec!["3".to_string(), "4".to_string()]],
                EditSource::User,
                None,
            )
            .unwrap();
        service
            .write_range(
                0,
                2,
                &vec![vec!["=A1&B1".to_string()]],
                EditSource::User,
                None,
            )
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].input,
            "=A1&B1".to_string()
        );
        let original_computed = sheet.cells[&CellCoord { row: 0, col: 2 }].computed.clone();
        drop(workbook);
        service
            .copy_paste_range(
                0,
                2,
                0,
                2,
                1,
                2,
                &vec![vec!["=A1&B1".to_string()]],
                EditSource::User,
                None,
            )
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        let c1_input = &sheet.cells[&CellCoord { row: 1, col: 2 }].input;
        assert_eq!(c1_input, "=A2&B2");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn insert_and_delete_rows_and_columns_shift_cells() {
        let path = write_csv("shift", "1,2\n3,4\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service.insert_rows(1, 1, EditSource::User, None).unwrap();
        service
            .insert_columns(1, 1, EditSource::User, None)
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert!(sheet.cells.contains_key(&CellCoord { row: 2, col: 2 }));
        service.delete_rows(1, 1, EditSource::User, None).unwrap();
        service
            .delete_columns(1, 1, EditSource::User, None)
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert!(sheet.cells.contains_key(&CellCoord { row: 1, col: 1 }));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn recomputation_updates_dependents() {
        let path = write_csv("deps", "1,=A1*2\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service
            .set_cell_input(0, 0, "5", EditSource::User, None)
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Number(10.0)
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn insert_rows_rewrites_formula_references() {
        let path = write_csv("insert-row-refs", "1\n=A1\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service.insert_rows(0, 1, EditSource::User, None).unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(sheet.cells[&CellCoord { row: 2, col: 0 }].input, "=A2");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn delete_rows_rewrites_formula_references() {
        let path = write_csv("delete-row-refs", "1\n2\n=A2\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service.delete_rows(0, 1, EditSource::User, None).unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(sheet.cells[&CellCoord { row: 1, col: 0 }].input, "=A1");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn insert_columns_rewrites_formula_references() {
        let path = write_csv("insert-col-refs", "1,=A1\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service
            .insert_columns(0, 1, EditSource::User, None)
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(sheet.cells[&CellCoord { row: 0, col: 2 }].input, "=B1");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn delete_columns_rewrites_formula_references() {
        let path = write_csv("delete-col-refs", "1,2,=B1\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        service
            .delete_columns(0, 1, EditSource::User, None)
            .unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert_eq!(sheet.cells[&CellCoord { row: 0, col: 1 }].input, "=A1");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn circular_references_surface_errors() {
        let path = write_csv("cycle", "=B1,=A1\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        assert!(sheet.cells[&CellCoord { row: 0, col: 0 }].error.is_some());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn invalid_references_surface_errors() {
        let path = write_csv("invalid-ref", "=Z99\n");
        let service = SheetsService::default();
        service.open_sheet(path.to_str().unwrap()).unwrap();
        let workbook = service.current_workbook().unwrap();
        let sheet = &workbook.sheets[0];
        let cell = &sheet.cells[&CellCoord { row: 0, col: 0 }];
        let has_error_or_empty = cell.error.is_some()
            || cell.computed == ComputedValue::Empty
            || cell.computed == ComputedValue::Number(0.0);
        assert!(has_error_or_empty);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn jsonl_format_detection() {
        assert_eq!(detect_format("test.sheet.jsonl"), "jsonl");
        assert_eq!(detect_format("test.csv"), "csv");
        assert_eq!(detect_format("test.xlsx"), "csv");
        assert_eq!(detect_format("/path/to/my.sheet.jsonl"), "jsonl");
        assert_eq!(detect_format("data"), "csv");
        assert_eq!(detect_format("file.txt"), "csv");
    }
}
