//! Webview management commands for embedded browser panel
//!
//! Note: Tauri v2 multi-webview is primarily a frontend JavaScript API.
//! The Webview class from @tauri-apps/api/webview is used to create
//! child webviews attached to existing windows.

use serde::{Deserialize, Serialize};

/// Information about the browser webview
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserInfo {
    pub label: String,
    pub url: String,
    pub title: Option<String>,
}

/// Check if the browser webview API is available
/// Returns info about the browser panel capabilities
#[tauri::command]
pub async fn cmd_browser_info() -> Result<BrowserInfo, String> {
    // This is a placeholder - actual webview creation happens in frontend
    Ok(BrowserInfo {
        label: "browser-panel".to_string(),
        url: "".to_string(),
        title: Some("Browser Panel".to_string()),
    })
}
