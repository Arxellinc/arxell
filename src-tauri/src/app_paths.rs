use std::path::PathBuf;

pub const APP_NAME: &str = "Arxell";
pub const APP_IDENTIFIER: &str = "com.arxell.app";
pub const APP_USER_AGENT: &str = "arxell/1.0";

pub fn app_data_dir() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(".arxell"))
        .unwrap_or_else(|| std::env::temp_dir().join("arxell"))
}
