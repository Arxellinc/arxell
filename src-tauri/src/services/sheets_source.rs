use serde::{Deserialize, Serialize};

use crate::services::sheets_capabilities::{
    capabilities_for_csv, capabilities_for_native, capabilities_for_sqlite, CapabilitySet,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetSourceKind {
    NativeJsonl,
    Csv,
    SqliteTable,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSource {
    pub kind: SheetSourceKind,
    pub location: String,
    pub identity: String,
    #[serde(default)]
    pub read_only: bool,
    pub capabilities: CapabilitySet,
}

pub fn source_from_path(path: &str) -> SheetSource {
    if path.ends_with(".sheet.jsonl") {
        SheetSource {
            kind: SheetSourceKind::NativeJsonl,
            location: path.to_string(),
            identity: path.to_string(),
            read_only: false,
            capabilities: capabilities_for_native(),
        }
    } else {
        SheetSource {
            kind: SheetSourceKind::Csv,
            location: path.to_string(),
            identity: path.to_string(),
            read_only: false,
            capabilities: capabilities_for_csv(),
        }
    }
}

pub fn source_for_sqlite(db: &str, table: &str) -> SheetSource {
    SheetSource {
        kind: SheetSourceKind::SqliteTable,
        location: db.to_string(),
        identity: format!("{db}::{table}"),
        read_only: false,
        capabilities: capabilities_for_sqlite(),
    }
}

pub fn source_for_new_sheet() -> SheetSource {
    SheetSource {
        kind: SheetSourceKind::NativeJsonl,
        location: String::new(),
        identity: String::new(),
        read_only: false,
        capabilities: capabilities_for_native(),
    }
}
