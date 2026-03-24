use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

pub fn emit_log(level: &str, message: &str) {
    if let Some(app) = APP_HANDLE.get() {
        let event_name = format!("log:{}", level);
        let _ = app.emit(&event_name, message);
    }
}

#[allow(dead_code)]
#[macro_export]
macro_rules! log_emit {
    ($level:expr, $($arg:tt)*) => {
        $crate::commands::logs::emit_log($level, &format!($($arg)*))
    };
}

pub fn info(msg: &str) {
    emit_log("info", msg);
}

pub fn warn(msg: &str) {
    emit_log("warn", msg);
}

pub fn error(msg: &str) {
    emit_log("error", msg);
}

#[allow(dead_code)]
pub fn debug(msg: &str) {
    emit_log("debug", msg);
}

pub fn event(level: &str, name: &str, fields: serde_json::Value) {
    let ts_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let payload = serde_json::json!({
        "event": name,
        "ts_ms": ts_ms,
        "fields": fields,
    })
    .to_string();
    emit_log(level, &payload);
    match level {
        "error" => log::error!("{}", payload),
        "warn" => log::warn!("{}", payload),
        "debug" => log::debug!("{}", payload),
        _ => log::info!("{}", payload),
    }
}
