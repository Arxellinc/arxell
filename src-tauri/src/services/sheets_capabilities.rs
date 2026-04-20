use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitySet {
    #[serde(default)]
    pub formulas: bool,
    #[serde(default)]
    pub styles: bool,
    #[serde(default)]
    pub formats: bool,
    #[serde(default)]
    pub typed_cells: bool,
    #[serde(default)]
    pub column_widths: bool,
    #[serde(default)]
    pub row_heights: bool,
    #[serde(default)]
    pub frozen_panes: bool,
    #[serde(default)]
    pub merges: bool,
    #[serde(default)]
    pub insert_rows: bool,
    #[serde(default)]
    pub delete_rows: bool,
    #[serde(default)]
    pub insert_cols: bool,
    #[serde(default)]
    pub delete_cols: bool,
    #[serde(default)]
    pub rename_cols: bool,
    #[serde(default)]
    pub schema_changes: bool,
    #[serde(default)]
    pub transactions: bool,
}

pub fn capabilities_for_native() -> CapabilitySet {
    CapabilitySet {
        formulas: true,
        styles: true,
        formats: true,
        typed_cells: true,
        column_widths: true,
        row_heights: true,
        frozen_panes: true,
        merges: true,
        insert_rows: true,
        delete_rows: true,
        insert_cols: true,
        delete_cols: true,
        rename_cols: true,
        schema_changes: true,
        transactions: true,
    }
}

pub fn capabilities_for_csv() -> CapabilitySet {
    CapabilitySet {
        formulas: true,
        insert_rows: true,
        delete_rows: true,
        insert_cols: true,
        delete_cols: true,
        ..Default::default()
    }
}

pub fn capabilities_for_sqlite() -> CapabilitySet {
    CapabilitySet {
        typed_cells: true,
        insert_rows: true,
        delete_rows: true,
        transactions: true,
        ..Default::default()
    }
}

impl Default for CapabilitySet {
    fn default() -> Self {
        Self {
            formulas: false,
            styles: false,
            formats: false,
            typed_cells: false,
            column_widths: false,
            row_heights: false,
            frozen_panes: false,
            merges: false,
            insert_rows: false,
            delete_rows: false,
            insert_cols: false,
            delete_cols: false,
            rename_cols: false,
            schema_changes: false,
            transactions: false,
        }
    }
}
