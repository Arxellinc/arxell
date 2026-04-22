use crate::services::sheets_service::SheetsError;
use crate::services::sheets_types::{
    CellCoord, CellState, ComputedValue, SheetState, SheetsErrorCode,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CellStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub f: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub m: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub va: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ColMeta {
    pub col: usize,
    pub width: Option<usize>,
    pub style_id: Option<usize>,
    pub hidden: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RowMeta {
    pub row: usize,
    pub height: Option<usize>,
    pub style_id: Option<usize>,
    pub hidden: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SheetHeader {
    pub schema_version: u32,
    pub name: String,
    pub size: [usize; 2],
    pub locale: Option<String>,
    pub currency: Option<String>,
    pub timezone: Option<String>,
    pub ai_model_id: Option<String>,
    pub default_style: Option<usize>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CellTuple {
    pub col: usize,
    pub input: String,
    pub style_id: Option<usize>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RowData {
    pub row: usize,
    pub cells: Vec<CellTuple>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MergedRange {
    pub r1: usize,
    pub c1: usize,
    pub r2: usize,
    pub c2: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct JsonlSheetData {
    pub header: SheetHeader,
    pub styles: Vec<CellStyle>,
    pub frozen_panes: Option<[usize; 2]>,
    pub col_meta: Vec<ColMeta>,
    pub row_meta: Vec<RowMeta>,
    pub merged_ranges: Vec<MergedRange>,
    pub rows: Vec<RowData>,
}

fn fail(code: SheetsErrorCode, msg: impl Into<String>) -> SheetsError {
    SheetsError::Message {
        code,
        message: msg.into(),
    }
}

fn as_usz(v: &Value) -> usize {
    v.as_u64().unwrap_or(0) as usize
}

fn opt_usz(v: Option<&Value>) -> Option<usize> {
    v.and_then(|v| v.as_u64()).map(|n| n as usize)
}

fn opt_u8(v: Option<&Value>) -> Option<u8> {
    v.and_then(|v| v.as_u64()).map(|n| n as u8)
}

fn opt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|v| v.as_str()).map(String::from)
}

pub fn parse_jsonl(raw: &str) -> Result<JsonlSheetData, SheetsError> {
    let mut header = None;
    let mut styles = Vec::new();
    let mut frozen_panes = None;
    let mut col_meta = Vec::new();
    let mut row_meta = Vec::new();
    let mut merged_ranges = Vec::new();
    let mut rows = Vec::new();

    for (i, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let val: Value = serde_json::from_str(trimmed).map_err(|e| {
            fail(
                SheetsErrorCode::ParseFailure,
                format!("line {}: {}", i + 1, e),
            )
        })?;

        match val.get("t").and_then(|v| v.as_str()).unwrap_or("") {
            "s" => header = Some(parse_header(&val, i)?),
            "st" => styles = parse_styles(&val, i)?,
            "fz" => frozen_panes = Some(parse_frozen(&val, i)?),
            "cm" => col_meta = parse_col_meta(&val, i)?,
            "rm" => row_meta = parse_row_meta(&val, i)?,
            "mg" => merged_ranges = parse_merged(&val, i)?,
            "r" => rows.push(parse_row(&val, i)?),
            _ => {}
        }
    }

    let header =
        header.ok_or_else(|| fail(SheetsErrorCode::ParseFailure, "missing sheet header record"))?;

    Ok(JsonlSheetData {
        header,
        styles,
        frozen_panes,
        col_meta,
        row_meta,
        merged_ranges,
        rows,
    })
}

fn parse_header(v: &Value, line: usize) -> Result<SheetHeader, SheetsError> {
    let sv = v.get("sv").and_then(|v| v.as_u64()).ok_or_else(|| {
        fail(
            SheetsErrorCode::ParseFailure,
            format!("line {}: header missing 'sv'", line + 1),
        )
    })? as u32;
    let name = v
        .get("n")
        .and_then(|v| v.as_str())
        .unwrap_or("Sheet1")
        .to_string();
    let sz = v
        .get("sz")
        .and_then(|v| v.as_array())
        .map(|a| {
            [
                as_usz(a.get(0).unwrap_or(&Value::Null)),
                as_usz(a.get(1).unwrap_or(&Value::Null)),
            ]
        })
        .unwrap_or([1000, 26]);
    Ok(SheetHeader {
        schema_version: sv,
        name,
        size: sz,
        locale: opt_str(v, "lc"),
        currency: opt_str(v, "cy"),
        timezone: opt_str(v, "tz"),
        ai_model_id: opt_str(v, "aim"),
        default_style: v.get("ds").and_then(|v| v.as_u64()).map(|n| n as usize),
    })
}

fn parse_styles(v: &Value, line: usize) -> Result<Vec<CellStyle>, SheetsError> {
    let arr = v.get("v").and_then(|v| v.as_array()).ok_or_else(|| {
        fail(
            SheetsErrorCode::ParseFailure,
            format!("line {}: style table missing 'v'", line + 1),
        )
    })?;
    arr.iter()
        .map(|sv| {
            serde_json::from_value(sv.clone()).map_err(|e| {
                fail(
                    SheetsErrorCode::ParseFailure,
                    format!("line {}: bad style object: {}", line + 1, e),
                )
            })
        })
        .collect()
}

fn parse_frozen(v: &Value, line: usize) -> Result<[usize; 2], SheetsError> {
    let arr = v.get("v").and_then(|v| v.as_array()).ok_or_else(|| {
        fail(
            SheetsErrorCode::ParseFailure,
            format!("line {}: frozen panes missing 'v'", line + 1),
        )
    })?;
    Ok([
        as_usz(arr.get(0).unwrap_or(&Value::Null)),
        as_usz(arr.get(1).unwrap_or(&Value::Null)),
    ])
}

fn parse_col_meta(v: &Value, line: usize) -> Result<Vec<ColMeta>, SheetsError> {
    let arr = v.get("v").and_then(|v| v.as_array()).ok_or_else(|| {
        fail(
            SheetsErrorCode::ParseFailure,
            format!("line {}: column metadata missing 'v'", line + 1),
        )
    })?;
    arr.iter()
        .map(|t| {
            let a = t.as_array().ok_or_else(|| {
                fail(
                    SheetsErrorCode::ParseFailure,
                    format!("line {}: column metadata entry must be array", line + 1),
                )
            })?;
            Ok(ColMeta {
                col: as_usz(a.get(0).unwrap_or(&Value::Null)),
                width: opt_usz(a.get(1)),
                style_id: opt_usz(a.get(2)),
                hidden: opt_u8(a.get(3)),
            })
        })
        .collect()
}

fn parse_row_meta(v: &Value, line: usize) -> Result<Vec<RowMeta>, SheetsError> {
    let arr = v.get("v").and_then(|v| v.as_array()).ok_or_else(|| {
        fail(
            SheetsErrorCode::ParseFailure,
            format!("line {}: row metadata missing 'v'", line + 1),
        )
    })?;
    arr.iter()
        .map(|t| {
            let a = t.as_array().ok_or_else(|| {
                fail(
                    SheetsErrorCode::ParseFailure,
                    format!("line {}: row metadata entry must be array", line + 1),
                )
            })?;
            Ok(RowMeta {
                row: as_usz(a.get(0).unwrap_or(&Value::Null)),
                height: opt_usz(a.get(1)),
                style_id: opt_usz(a.get(2)),
                hidden: opt_u8(a.get(3)),
            })
        })
        .collect()
}

fn parse_merged(v: &Value, line: usize) -> Result<Vec<MergedRange>, SheetsError> {
    let arr = v.get("v").and_then(|v| v.as_array()).ok_or_else(|| {
        fail(
            SheetsErrorCode::ParseFailure,
            format!("line {}: merged ranges missing 'v'", line + 1),
        )
    })?;
    arr.iter()
        .map(|t| {
            let a = t.as_array().ok_or_else(|| {
                fail(
                    SheetsErrorCode::ParseFailure,
                    format!("line {}: merged range entry must be array", line + 1),
                )
            })?;
            Ok(MergedRange {
                r1: as_usz(a.get(0).unwrap_or(&Value::Null)),
                c1: as_usz(a.get(1).unwrap_or(&Value::Null)),
                r2: as_usz(a.get(2).unwrap_or(&Value::Null)),
                c2: as_usz(a.get(3).unwrap_or(&Value::Null)),
            })
        })
        .collect()
}

fn parse_row(v: &Value, line: usize) -> Result<RowData, SheetsError> {
    let row_idx = v.get("r").and_then(|v| v.as_u64()).ok_or_else(|| {
        fail(
            SheetsErrorCode::ParseFailure,
            format!("line {}: row data missing 'r'", line + 1),
        )
    })? as usize;
    let cells_arr = v.get("c").and_then(|v| v.as_array()).ok_or_else(|| {
        fail(
            SheetsErrorCode::ParseFailure,
            format!("line {}: row data missing 'c'", line + 1),
        )
    })?;
    let cells: Vec<CellTuple> = cells_arr
        .iter()
        .map(|cv| {
            let a = cv.as_array().ok_or_else(|| {
                fail(
                    SheetsErrorCode::ParseFailure,
                    format!("line {}: cell tuple must be array", line + 1),
                )
            })?;
            Ok(CellTuple {
                col: as_usz(a.get(0).unwrap_or(&Value::Null)),
                input: a.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                style_id: opt_usz(a.get(2)),
            })
        })
        .collect::<Result<Vec<_>, SheetsError>>()?;
    Ok(RowData {
        row: row_idx,
        cells,
    })
}

pub fn serialize_jsonl(data: &JsonlSheetData) -> Result<String, SheetsError> {
    let mut lines: Vec<String> = Vec::new();

    {
        let mut m = serde_json::Map::new();
        m.insert("t".into(), Value::String("s".into()));
        m.insert("sv".into(), json!(data.header.schema_version));
        m.insert("n".into(), Value::String(data.header.name.clone()));
        m.insert("sz".into(), json!(data.header.size));
        if let Some(ref v) = data.header.locale {
            m.insert("lc".into(), Value::String(v.clone()));
        }
        if let Some(ref v) = data.header.currency {
            m.insert("cy".into(), Value::String(v.clone()));
        }
        if let Some(ref v) = data.header.timezone {
            m.insert("tz".into(), Value::String(v.clone()));
        }
        if let Some(ref v) = data.header.ai_model_id {
            m.insert("aim".into(), Value::String(v.clone()));
        }
        if let Some(v) = data.header.default_style {
            m.insert("ds".into(), json!(v));
        }
        lines.push(to_line(Value::Object(m))?);
    }

    if !data.styles.is_empty() {
        let style_vals: Vec<Value> = data
            .styles
            .iter()
            .map(|s| serde_json::to_value(s).unwrap())
            .collect();
        let mut m = serde_json::Map::new();
        m.insert("t".into(), Value::String("st".into()));
        m.insert("v".into(), Value::Array(style_vals));
        lines.push(to_line(Value::Object(m))?);
    }

    if let Some(fz) = data.frozen_panes {
        let mut m = serde_json::Map::new();
        m.insert("t".into(), Value::String("fz".into()));
        m.insert("v".into(), json!(fz));
        lines.push(to_line(Value::Object(m))?);
    }

    if !data.col_meta.is_empty() {
        let tuples: Vec<Value> = serialize_col_meta_tuples(&data.col_meta);
        let mut m = serde_json::Map::new();
        m.insert("t".into(), Value::String("cm".into()));
        m.insert("v".into(), Value::Array(tuples));
        lines.push(to_line(Value::Object(m))?);
    }

    if !data.row_meta.is_empty() {
        let tuples: Vec<Value> = serialize_row_meta_tuples(&data.row_meta);
        let mut m = serde_json::Map::new();
        m.insert("t".into(), Value::String("rm".into()));
        m.insert("v".into(), Value::Array(tuples));
        lines.push(to_line(Value::Object(m))?);
    }

    if !data.merged_ranges.is_empty() {
        let tuples: Vec<Value> = data
            .merged_ranges
            .iter()
            .map(|mr| Value::Array(vec![json!(mr.r1), json!(mr.c1), json!(mr.r2), json!(mr.c2)]))
            .collect();
        let mut m = serde_json::Map::new();
        m.insert("t".into(), Value::String("mg".into()));
        m.insert("v".into(), Value::Array(tuples));
        lines.push(to_line(Value::Object(m))?);
    }

    {
        let mut sorted_rows: Vec<&RowData> = data.rows.iter().collect();
        sorted_rows.sort_by_key(|r| r.row);
        for rd in sorted_rows {
            let mut sorted_cells = rd.cells.clone();
            sorted_cells.sort_by_key(|c| c.col);
            let cell_tuples: Vec<Value> = sorted_cells
                .iter()
                .map(|c| {
                    let mut a = vec![json!(c.col), Value::String(c.input.clone())];
                    if let Some(sid) = c.style_id {
                        a.push(json!(sid));
                    }
                    Value::Array(a)
                })
                .collect();
            let mut m = serde_json::Map::new();
            m.insert("t".into(), Value::String("r".into()));
            m.insert("r".into(), json!(rd.row));
            m.insert("c".into(), Value::Array(cell_tuples));
            lines.push(to_line(Value::Object(m))?);
        }
    }

    Ok(lines.join("\n"))
}

fn serialize_col_meta_tuple(cm: &ColMeta) -> Vec<Value> {
    let mut a = vec![json!(cm.col)];
    let need_width = cm.width.is_some() || cm.style_id.is_some() || cm.hidden.is_some();
    let need_style = cm.style_id.is_some() || cm.hidden.is_some();
    let need_hidden = cm.hidden.is_some();
    if need_width {
        a.push(json!(cm.width.unwrap_or(0)));
    }
    if need_style {
        a.push(json!(cm.style_id.unwrap_or(0)));
    }
    if need_hidden {
        a.push(json!(cm.hidden.unwrap_or(0)));
    }
    a
}

fn serialize_col_meta_tuples(items: &[ColMeta]) -> Vec<Value> {
    items
        .iter()
        .map(|cm| Value::Array(serialize_col_meta_tuple(cm)))
        .collect()
}

fn serialize_row_meta_tuple(rm: &RowMeta) -> Vec<Value> {
    let mut a = vec![json!(rm.row)];
    let need_height = rm.height.is_some() || rm.style_id.is_some() || rm.hidden.is_some();
    let need_style = rm.style_id.is_some() || rm.hidden.is_some();
    let need_hidden = rm.hidden.is_some();
    if need_height {
        a.push(json!(rm.height.unwrap_or(0)));
    }
    if need_style {
        a.push(json!(rm.style_id.unwrap_or(0)));
    }
    if need_hidden {
        a.push(json!(rm.hidden.unwrap_or(0)));
    }
    a
}

fn serialize_row_meta_tuples(items: &[RowMeta]) -> Vec<Value> {
    items
        .iter()
        .map(|rm| Value::Array(serialize_row_meta_tuple(rm)))
        .collect()
}

fn to_line(v: Value) -> Result<String, SheetsError> {
    serde_json::to_string(&v).map_err(|e| {
        fail(
            SheetsErrorCode::SaveFailure,
            format!("json serialization failed: {}", e),
        )
    })
}

pub fn jsonl_to_sheet_state(data: &JsonlSheetData) -> SheetState {
    let mut cells = HashMap::new();
    for rd in &data.rows {
        for c in &rd.cells {
            if c.input.is_empty() {
                continue;
            }
            cells.insert(
                CellCoord {
                    row: rd.row,
                    col: c.col,
                },
                CellState {
                    input: c.input.clone(),
                    computed: ComputedValue::Empty,
                    error: None,
                    style_id: c.style_id,
                },
            );
        }
    }
    SheetState {
        name: data.header.name.clone(),
        row_count: data.header.size[0],
        col_count: data.header.size[1],
        cells,
        used_range: None,
    }
}

pub fn sheet_state_to_jsonl(
    sheet: &SheetState,
    name: &str,
    styles: &[CellStyle],
) -> JsonlSheetData {
    let mut row_map: BTreeMap<usize, Vec<CellTuple>> = BTreeMap::new();
    for (coord, cell) in &sheet.cells {
        if cell.input.is_empty() {
            continue;
        }
        row_map.entry(coord.row).or_default().push(CellTuple {
            col: coord.col,
            input: cell.input.clone(),
            style_id: cell.style_id,
        });
    }
    let rows: Vec<RowData> = row_map
        .into_iter()
        .map(|(row, mut cells)| {
            cells.sort_by_key(|c| c.col);
            RowData { row, cells }
        })
        .collect();
    JsonlSheetData {
        header: SheetHeader {
            schema_version: 1,
            name: name.to_string(),
            size: [sheet.row_count, sheet.col_count],
            locale: None,
            currency: None,
            timezone: None,
            ai_model_id: None,
            default_style: None,
        },
        styles: styles.to_vec(),
        frozen_panes: None,
        col_meta: Vec::new(),
        row_meta: Vec::new(),
        merged_ranges: Vec::new(),
        rows,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::sheets_service::SheetsService;
    use crate::services::sheets_types::ComputedValue;
    use std::fs;

    fn make_header(name: &str, rows: usize, cols: usize) -> SheetHeader {
        SheetHeader {
            schema_version: 1,
            name: name.to_string(),
            size: [rows, cols],
            locale: None,
            currency: None,
            timezone: None,
            ai_model_id: None,
            default_style: None,
        }
    }

    fn make_data() -> JsonlSheetData {
        JsonlSheetData {
            header: make_header("Test", 100, 26),
            styles: vec![],
            frozen_panes: None,
            col_meta: vec![],
            row_meta: vec![],
            merged_ranges: vec![],
            rows: vec![
                RowData {
                    row: 0,
                    cells: vec![
                        CellTuple {
                            col: 0,
                            input: "Hello".into(),
                            style_id: None,
                        },
                        CellTuple {
                            col: 1,
                            input: "World".into(),
                            style_id: Some(2),
                        },
                    ],
                },
                RowData {
                    row: 2,
                    cells: vec![CellTuple {
                        col: 0,
                        input: "=A1+B1".into(),
                        style_id: None,
                    }],
                },
            ],
        }
    }

    #[test]
    fn jsonl_round_trip_preserves_cells() {
        let data = make_data();
        let serialized = serialize_jsonl(&data).unwrap();
        let parsed = parse_jsonl(&serialized).unwrap();
        assert_eq!(parsed.rows.len(), 2);
        assert_eq!(parsed.rows[0].cells.len(), 2);
        assert_eq!(parsed.rows[0].cells[0].input, "Hello");
        assert_eq!(parsed.rows[0].cells[0].style_id, None);
        assert_eq!(parsed.rows[0].cells[1].input, "World");
        assert_eq!(parsed.rows[0].cells[1].style_id, Some(2));
        assert_eq!(parsed.rows[1].row, 2);
        assert_eq!(parsed.rows[1].cells[0].input, "=A1+B1");
    }

    #[test]
    fn jsonl_handles_sparse_rows() {
        let raw = r#"{"t":"s","sv":1,"n":"Sparse","sz":[100,26]}"#.to_string()
            + "\n"
            + r#"{"t":"r","r":0,"c":[[0,"A"]]}"#
            + "\n"
            + r#"{"t":"r","r":50,"c":[[0,"B"]]}"#;
        let data = parse_jsonl(&raw).unwrap();
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.rows[0].row, 0);
        assert_eq!(data.rows[0].cells[0].input, "A");
        assert_eq!(data.rows[1].row, 50);
        assert_eq!(data.rows[1].cells[0].input, "B");
    }

    #[test]
    fn jsonl_handles_sparse_cells() {
        let raw = r#"{"t":"s","sv":1,"n":"Sparse","sz":[100,26]}"#.to_string()
            + "\n"
            + r#"{"t":"r","r":0,"c":[[0,"A"],[5,"B"],[25,"C"]]}"#;
        let data = parse_jsonl(&raw).unwrap();
        assert_eq!(data.rows[0].cells.len(), 3);
        assert_eq!(data.rows[0].cells[0].col, 0);
        assert_eq!(data.rows[0].cells[0].input, "A");
        assert_eq!(data.rows[0].cells[1].col, 5);
        assert_eq!(data.rows[0].cells[1].input, "B");
        assert_eq!(data.rows[0].cells[2].col, 25);
        assert_eq!(data.rows[0].cells[2].input, "C");
    }

    #[test]
    fn jsonl_style_table_round_trip() {
        let data = JsonlSheetData {
            header: make_header("Styles", 100, 26),
            styles: vec![
                CellStyle::default(),
                CellStyle {
                    f: Some("$2".into()),
                    a: Some(">".into()),
                    ..Default::default()
                },
                CellStyle {
                    fg: Some("r".into()),
                    bg: Some("#ff0000".into()),
                    ..Default::default()
                },
            ],
            frozen_panes: None,
            col_meta: vec![],
            row_meta: vec![],
            merged_ranges: vec![],
            rows: vec![],
        };
        let serialized = serialize_jsonl(&data).unwrap();
        let parsed = parse_jsonl(&serialized).unwrap();
        assert_eq!(parsed.styles.len(), 3);
        assert_eq!(parsed.styles[0], CellStyle::default());
        assert_eq!(parsed.styles[1].f, Some("$2".into()));
        assert_eq!(parsed.styles[1].a, Some(">".into()));
        assert_eq!(parsed.styles[2].fg, Some("r".into()));
        assert_eq!(parsed.styles[2].bg, Some("#ff0000".into()));
    }

    #[test]
    fn jsonl_unknown_records_skipped() {
        let raw = r#"{"t":"s","sv":1,"n":"Test","sz":[10,10]}"#.to_string()
            + "\n"
            + r#"{"t":"unknown","data":"whatever"}"#
            + "\n"
            + r#"{"t":"future_type","x":42}"#
            + "\n"
            + r#"{"t":"r","r":0,"c":[[0,"hello"]]}"#;
        let data = parse_jsonl(&raw).unwrap();
        assert_eq!(data.rows.len(), 1);
        assert_eq!(data.rows[0].cells[0].input, "hello");
        assert_eq!(data.header.name, "Test");
    }

    #[test]
    fn jsonl_missing_optional_records() {
        let raw = r#"{"t":"s","sv":1,"n":"Minimal","sz":[10,5]}"#.to_string()
            + "\n"
            + r#"{"t":"r","r":0,"c":[[0,"A"]]}"#;
        let data = parse_jsonl(&raw).unwrap();
        assert!(data.styles.is_empty());
        assert!(data.frozen_panes.is_none());
        assert!(data.col_meta.is_empty());
        assert!(data.row_meta.is_empty());
        assert!(data.merged_ranges.is_empty());
        assert_eq!(data.rows.len(), 1);
    }

    #[test]
    fn jsonl_empty_sheet() {
        let raw = r#"{"t":"s","sv":1,"n":"Empty","sz":[100,26]}"#;
        let data = parse_jsonl(raw).unwrap();
        assert_eq!(data.header.name, "Empty");
        assert!(data.rows.is_empty());
        let serialized = serialize_jsonl(&data).unwrap();
        let reparsed = parse_jsonl(&serialized).unwrap();
        assert!(reparsed.rows.is_empty());
        assert_eq!(reparsed.header.name, "Empty");
        assert_eq!(reparsed.header.size, [100, 26]);
    }

    #[test]
    fn jsonl_file_round_trip() {
        let unique = format!(
            "arxell-jsonl-rt-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
        let in_path = std::env::temp_dir().join(format!("{}.sheet.jsonl", unique));
        let out_path = std::env::temp_dir().join(format!("{}-out.sheet.jsonl", unique));

        let content = r#"{"t":"s","sv":1,"n":"TestSheet","sz":[100,26]}"#.to_string()
            + "\n"
            + r#"{"t":"r","r":0,"c":[[0,"Name"],[1,"Value"]]}"#
            + "\n"
            + r#"{"t":"r","r":1,"c":[[0,"Foo"],[1,"42"]]}"#;
        fs::write(&in_path, &content).unwrap();

        let service = SheetsService::default();
        let result = service.open_sheet(in_path.to_str().unwrap()).unwrap();
        assert_eq!(result.sheet.row_count, 100);
        assert_eq!(result.sheet.column_count, 26);

        let workbook = service.current_workbook().unwrap();
        assert_eq!(workbook.format, "jsonl");
        let sheet = &workbook.sheets[0];
        assert_eq!(sheet.cells[&CellCoord { row: 0, col: 0 }].input, "Name");
        assert_eq!(sheet.cells[&CellCoord { row: 1, col: 1 }].input, "42");
        drop(workbook);

        service
            .save_sheet(Some(out_path.to_str().unwrap()))
            .unwrap();

        let saved = fs::read_to_string(&out_path).unwrap();
        assert!(saved.contains("\"t\":\"s\"") || saved.contains("\"t\":\"s\""));

        let reparsed = parse_jsonl(&saved).unwrap();
        assert_eq!(reparsed.rows.len(), 2);
        assert_eq!(reparsed.rows[0].cells[0].input, "Name");
        assert_eq!(reparsed.rows[1].cells[1].input, "42");

        let _ = fs::remove_file(&in_path);
        let _ = fs::remove_file(&out_path);
    }

    #[test]
    fn jsonl_col_and_row_meta_round_trip() {
        let data = JsonlSheetData {
            header: make_header("Meta", 200, 10),
            styles: vec![],
            frozen_panes: Some([2, 1]),
            col_meta: vec![
                ColMeta {
                    col: 0,
                    width: Some(180),
                    style_id: None,
                    hidden: None,
                },
                ColMeta {
                    col: 1,
                    width: Some(96),
                    style_id: Some(1),
                    hidden: None,
                },
                ColMeta {
                    col: 4,
                    width: Some(120),
                    style_id: Some(0),
                    hidden: Some(1),
                },
            ],
            row_meta: vec![
                RowMeta {
                    row: 0,
                    height: Some(28),
                    style_id: Some(4),
                    hidden: None,
                },
                RowMeta {
                    row: 10,
                    height: Some(22),
                    style_id: None,
                    hidden: None,
                },
            ],
            merged_ranges: vec![MergedRange {
                r1: 0,
                c1: 0,
                r2: 0,
                c2: 3,
            }],
            rows: vec![],
        };
        let serialized = serialize_jsonl(&data).unwrap();
        let parsed = parse_jsonl(&serialized).unwrap();
        assert_eq!(parsed.frozen_panes, Some([2, 1]));
        assert_eq!(parsed.col_meta.len(), 3);
        assert_eq!(parsed.col_meta[0].col, 0);
        assert_eq!(parsed.col_meta[0].width, Some(180));
        assert_eq!(parsed.col_meta[1].width, Some(96));
        assert_eq!(parsed.col_meta[1].style_id, Some(1));
        assert_eq!(parsed.col_meta[2].width, Some(120));
        assert_eq!(parsed.col_meta[2].style_id, Some(0));
        assert_eq!(parsed.col_meta[2].hidden, Some(1));
        assert_eq!(parsed.row_meta.len(), 2);
        assert_eq!(parsed.row_meta[0].row, 0);
        assert_eq!(parsed.row_meta[0].height, Some(28));
        assert_eq!(parsed.row_meta[0].style_id, Some(4));
        assert_eq!(parsed.row_meta[1].row, 10);
        assert_eq!(parsed.row_meta[1].height, Some(22));
        assert_eq!(parsed.merged_ranges.len(), 1);
        assert_eq!(parsed.merged_ranges[0].r1, 0);
        assert_eq!(parsed.merged_ranges[0].c2, 3);
    }
}
