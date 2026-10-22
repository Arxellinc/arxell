//! CI-only renderer/IPC/CSP probe. Never compile this feature into release assets.
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SmokeChecks {
    data_image_decoded: bool,
    blob_image_decoded: bool,
    data_audio_loaded: bool,
    blob_audio_loaded: bool,
    data_fetch_loaded: bool,
    blob_fetch_loaded: bool,
    inline_style_applied: bool,
    inline_script_blocked: bool,
}

impl SmokeChecks {
    fn passed(&self) -> bool {
        self.data_image_decoded
            && self.blob_image_decoded
            && self.data_audio_loaded
            && self.blob_audio_loaded
            && self.data_fetch_loaded
            && self.blob_fetch_loaded
            && self.inline_style_applied
            && self.inline_script_blocked
    }
}

pub fn page_loaded(webview: &tauri::Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    eprintln!("[desktop-smoke] page event: {:?}", payload.event());
    if payload.event() != tauri::webview::PageLoadEvent::Finished
        || std::env::var_os("ARXELL_DESKTOP_SMOKE_REPORT").is_none()
    {
        return;
    }
    // Fixed test code only: no general-purpose evaluation/server capability.
    if webview
        .eval(include_str!("../resources/desktop-smoke/probe.js"))
        .is_err()
    {
        eprintln!("[desktop-smoke] probe injection failed");
    }
}

fn report_json(version: &str, checks: &SmokeChecks) -> Result<String, String> {
    if version != env!("CARGO_PKG_VERSION") || !checks.passed() {
        eprintln!("[desktop-smoke] renderer/IPC/CSP handshake failed: {checks:?}");
        return Err("Desktop smoke version or DOM/media/CSP check failed".into());
    }
    Ok(serde_json::json!({
        "frontendRendered": true,
        "ipcVersion": version,
        "checks": checks,
    })
    .to_string()
        + "\n")
}

pub fn ready(app: tauri::AppHandle, version: String, checks: SmokeChecks) -> Result<(), String> {
    let report = report_json(&version, &checks)?;
    let _ = app
        .get_webview_window("main")
        .ok_or("Main window missing")?;
    let path = std::env::var_os("ARXELL_DESKTOP_SMOKE_REPORT")
        .ok_or("Desktop smoke report path missing")?;
    // The report path comes only from the test process environment, never IPC.
    std::fs::write(path, report)
        .map_err(|e| format!("Could not write desktop smoke report: {e}"))?;
    // Keep the window alive for screenshot collection and owned-process cleanup.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_context_embeds_frontend_without_a_dev_server() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        assert!(context.assets().get(&"index.html".into()).is_some(),
            "desktop-smoke must enable tauri/custom-protocol; otherwise it loads devUrl without embedded assets");
    }

    fn successful_checks() -> serde_json::Value {
        serde_json::json!({
            "dataImageDecoded": true, "blobImageDecoded": true,
            "dataAudioLoaded": true, "blobAudioLoaded": true,
            "dataFetchLoaded": true, "blobFetchLoaded": true,
            "inlineStyleApplied": true, "inlineScriptBlocked": true,
        })
    }

    #[test]
    fn report_requires_every_media_style_and_script_check() {
        let checks = successful_checks();
        let typed: SmokeChecks = serde_json::from_value(checks.clone()).unwrap();
        let report = report_json(env!("CARGO_PKG_VERSION"), &typed).unwrap();
        let report: serde_json::Value = serde_json::from_str(&report).unwrap();
        assert_eq!(report["checks"], checks);
        assert!(report_json("wrong-version", &typed).is_err());
        for key in checks.as_object().unwrap().keys() {
            let mut failed = checks.clone();
            failed[key] = false.into();
            let typed = serde_json::from_value(failed).unwrap();
            assert!(
                report_json(env!("CARGO_PKG_VERSION"), &typed).is_err(),
                "{key}"
            );
            let mut missing = checks.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<SmokeChecks>(missing).is_err(),
                "{key}"
            );
        }
    }
}
