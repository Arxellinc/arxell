//! CI-only renderer/IPC handshake. Never compile this feature into release assets.
use tauri::Manager;

pub fn page_loaded(webview: &tauri::Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    eprintln!("[desktop-smoke] page event: {:?}", payload.event());
    if payload.event() != tauri::webview::PageLoadEvent::Finished
        || std::env::var_os("ARXELL_DESKTOP_SMOKE_REPORT").is_none()
    {
        return;
    }
    // Exercise the actual renderer and an existing Rust IPC command. Do not
    // mock invoke or expose a general-purpose evaluation/server capability.
    let evaluation = webview.eval(r#"
        (() => {
            let attempts = 0;
            const timer = setInterval(async () => {
                const frame = document.querySelector('#app .app-frame');
                const bounds = frame && frame.getBoundingClientRect();
                const visible = frame && bounds.width > 0 && bounds.height > 0
                    && getComputedStyle(frame).visibility !== 'hidden';
                if (!visible) {
                    if (++attempts >= 100) {
                        clearInterval(timer);
                        window.__TAURI_INTERNALS__.invoke('cmd_desktop_smoke_ready', { version: 'frontend-missing' }).catch(() => {});
                    }
                    return;
                }
                clearInterval(timer);
                try {
                    const result = await window.__TAURI_INTERNALS__.invoke('cmd_app_version');
                    await window.__TAURI_INTERNALS__.invoke('cmd_desktop_smoke_ready', { version: result.version });
                } catch (_) {
                    window.__TAURI_INTERNALS__.invoke('cmd_desktop_smoke_ready', { version: 'ipc-failed' }).catch(() => {});
                }
            }, 100);
        })();
    "#);
    if evaluation.is_err() {
        eprintln!("[desktop-smoke] probe injection failed");
    }
}

pub fn ready(app: tauri::AppHandle, version: String) -> Result<(), String> {
    if version != env!("CARGO_PKG_VERSION") {
        let reason = if version == "frontend-missing" {
            "frontend-missing"
        } else {
            "ipc-failed"
        };
        eprintln!("[desktop-smoke] handshake failed: {reason}");
        return Err("Desktop smoke IPC version mismatch".to_string());
    }
    let _ = app
        .get_webview_window("main")
        .ok_or("Main window missing")?;
    let path = std::env::var_os("ARXELL_DESKTOP_SMOKE_REPORT")
        .ok_or("Desktop smoke report path missing")?;
    // The report path comes only from the test process environment, never IPC.
    std::fs::write(
        path,
        format!("{{\"frontendRendered\":true,\"ipcVersion\":\"{version}\"}}\n"),
    )
    .map_err(|e| format!("Could not write desktop smoke report: {e}"))?;
    // Keep the window alive for the harness to collect a screenshot and
    // terminate its owned process tree. This is not a persistence test.
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn smoke_context_embeds_frontend_without_a_dev_server() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        assert!(context.assets().get(&"index.html".into()).is_some(),
            "desktop-smoke must enable tauri/custom-protocol; otherwise it loads devUrl without embedded assets");
    }
}
