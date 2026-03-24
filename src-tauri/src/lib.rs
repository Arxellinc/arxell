mod a2a;
mod ai;
pub mod audio;
mod commands;
mod db;
pub mod memory;
pub mod model_manager;

use serde::Serialize;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{Emitter, Manager};

use model_manager::ModelManagerState;
use rusqlite::OptionalExtension;

/// Handle to a running llama-server subprocess launched by the engine installer.
/// Also used for "adopted" servers that were started in a previous app session.
pub struct LocalServerHandle {
    /// The owned child process — None for adopted (externally started) servers
    pub child: Option<std::process::Child>,
    /// Process ID (always set; used to kill adopted servers by PID)
    pub pid: u32,
    /// OpenAI-compatible base URL (e.g. "http://127.0.0.1:8765/v1")
    pub url: String,
    /// TCP port the server is listening on
    pub port: u16,
    /// Model path the server was started with — used to detect reuse eligibility
    pub model_path: String,
    /// -ngl value the server was started with
    pub n_gpu_layers: u32,
    /// --ctx-size value the server was started with
    pub ctx_size: u32,
    /// Runtime engine identifier (e.g. "llama.cpp-vulkan")
    pub engine_id: String,
    /// -b/--batch-size value
    pub batch_size: u32,
    /// -ub/--ubatch-size value
    pub ubatch_size: u32,
    /// -t/--threads value (None = backend default)
    pub n_threads: Option<u32>,
    /// -tb/--threads-batch value (None = backend default)
    pub n_threads_batch: Option<u32>,
    /// Whether flash-attn was enabled (-fa)
    pub flash_attn: bool,
    /// KV cache key type (-ctk), when set
    pub cache_type_k: Option<String>,
    /// KV cache value type (-ctv), when set
    pub cache_type_v: Option<String>,
    /// State file to delete when this handle is dropped (signals server gone to next startup)
    pub state_file: Option<std::path::PathBuf>,
}

impl Drop for LocalServerHandle {
    fn drop(&mut self) {
        let started = std::time::Instant::now();
        // Kill the subprocess — either the owned child or an adopted process by PID.
        // Rust's Child::drop detaches without killing, so orphaned llama-server processes
        // would accumulate GPU memory across open/close cycles without this.
        let mode = if self.child.is_some() {
            "owned"
        } else {
            "adopted"
        };
        let terminated = if let Some(ref mut child) = self.child {
            let _ = child.kill();
            let _ = child.wait();
            !model_manager::engine_installer::is_pid_alive(self.pid)
        } else {
            // Adopted process — terminate by PID with SIGKILL/taskkill fallback.
            model_manager::engine_installer::terminate_pid(
                self.pid,
                std::time::Duration::from_secs(2),
            )
        };
        let elapsed_ms = started.elapsed().as_millis();
        if terminated {
            log::info!(
                "[shutdown] llama-server pid={} mode={} terminated=true elapsed_ms={}",
                self.pid,
                mode,
                elapsed_ms
            );
        } else {
            log::warn!(
                "[shutdown] llama-server pid={} mode={} terminated=false elapsed_ms={}",
                self.pid,
                mode,
                elapsed_ms
            );
        }
        // Remove the state file only when the process is confirmed gone.
        // If termination failed, keep the file so next startup can re-attempt cleanup.
        if let Some(ref path) = self.state_file {
            if terminated {
                let _ = std::fs::remove_file(path);
            } else {
                log::warn!(
                    "[shutdown] llama-server PID {} still alive; preserving {:?}",
                    self.pid,
                    path
                );
            }
        }
    }
}

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub a2a_db: Mutex<rusqlite::Connection>,
    pub voice_active: Mutex<bool>,
    pub audio_buffer: Mutex<Vec<f32>>,
    pub chat_cancel: Arc<AtomicBool>,
    /// Cancel flag for speculative prefill warmup requests (separate from main chat)
    pub speculative_cancel: Arc<AtomicBool>,
    /// Monotonic generation counter — incremented on each new chat stream to detect stale responses
    pub generation_id: Arc<AtomicU64>,
    /// Run flag for the active voice pipeline (capture + transcription loops).
    /// Set true by cmd_voice_start, false by cmd_voice_stop. Stored here so
    /// cmd_voice_stop can actually signal the loops to exit.
    pub voice_running: Arc<AtomicBool>,
    /// Running llama-server subprocess (Some when an external engine is active)
    pub local_server: Mutex<Option<LocalServerHandle>>,
    /// Persistent Kokoro TTS daemon — keeps ONNX model loaded in memory
    pub kokoro_daemon: audio::tts::KokoroDaemonHandle,
    /// Persistent Whisper STT daemon — keeps model loaded in memory
    pub whisper_daemon: audio::stt::WhisperDaemonHandle,
    /// Persistent whisper-rs context — keeps GGML model loaded in memory
    pub whisper_rs_ctx: audio::stt::WhisperRsHandle,
    /// Shared HTTP client — reuses connection pools across all API requests
    pub http_client: reqwest::Client,
    /// Directory where agent memory markdown files are stored
    pub memory_dir: std::path::PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KokoroBootstrapStatus {
    pub phase: String,
    pub message: String,
    pub progress_percent: u8,
    pub model_ready: bool,
    pub runtime_ready: bool,
    pub done: bool,
    pub ok: bool,
    pub error: Option<String>,
}

static KOKORO_BOOTSTRAP_STATUS: LazyLock<Mutex<KokoroBootstrapStatus>> = LazyLock::new(|| {
    Mutex::new(KokoroBootstrapStatus {
        phase: "idle".to_string(),
        message: "Waiting".to_string(),
        progress_percent: 0,
        model_ready: false,
        runtime_ready: false,
        done: false,
        ok: false,
        error: None,
    })
});
static KOKORO_BOOTSTRAP_RUNNING: AtomicBool = AtomicBool::new(false);
static KOKORO_RUNTIME_SETUP_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn emit_kokoro_bootstrap_status(app: &tauri::AppHandle, status: KokoroBootstrapStatus) {
    if let Ok(mut guard) = KOKORO_BOOTSTRAP_STATUS.lock() {
        *guard = status.clone();
    }
    let _ = app.emit("kokoro:bootstrap", &status);
}

pub fn get_kokoro_bootstrap_status() -> KokoroBootstrapStatus {
    KOKORO_BOOTSTRAP_STATUS
        .lock()
        .map(|s| s.clone())
        .unwrap_or(KokoroBootstrapStatus {
            phase: "unknown".to_string(),
            message: "Status unavailable".to_string(),
            progress_percent: 0,
            model_ready: false,
            runtime_ready: false,
            done: false,
            ok: false,
            error: Some("status lock unavailable".to_string()),
        })
}

/// Log system state at startup so any subsequent failure has context.
///
/// Emitted to the frontend via `log:info` / `log:warn` events before any
/// other work runs, so the information is visible even when startup fails
/// partway through.  All information is also written to the Rust log at
/// the `info` level for capture via `RUST_LOG=info`.
fn log_startup_diagnostics() {
    use sysinfo::System;

    // ── Memory ────────────────────────────────────────────────────────────────
    let mut sys = System::new();
    sys.refresh_memory();
    let total_gb = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
    let avail_gb = sys.available_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
    let used_pct = (1.0 - avail_gb / total_gb.max(0.001)) * 100.0;

    let mem_msg = format!(
        "System RAM: {:.1} GB total, {:.1} GB available ({:.0}% used)",
        total_gb, avail_gb, used_pct,
    );
    commands::logs::info(&mem_msg);
    log::info!("{}", mem_msg);

    // ── Inference backend compiled in ─────────────────────────────────────────
    // `LLAMA_CPP_BACKEND` is set by build.rs via `cargo:rustc-env`.
    // The feature flags below reflect what was actually compiled in.
    let compiled_backend = {
        #[cfg(feature = "vulkan")]
        {
            "vulkan"
        }
        #[cfg(feature = "cuda")]
        {
            "cuda"
        }
        #[cfg(feature = "metal")]
        {
            "metal"
        }
        #[cfg(feature = "rocm")]
        {
            "rocm"
        }
        #[cfg(not(any(
            feature = "vulkan",
            feature = "cuda",
            feature = "metal",
            feature = "rocm",
        )))]
        {
            "cpu-only (no llama-cpp-2)"
        }
    };
    let detected_backend = env!("LLAMA_CPP_BACKEND");

    let backend_msg = format!(
        "Inference backend: compiled={}, build-detected={}",
        compiled_backend, detected_backend,
    );
    commands::logs::info(&backend_msg);
    log::info!("{}", backend_msg);

    // ── Low-memory warning ────────────────────────────────────────────────────
    // Loading a GPU model requires RAM headroom. Warn early rather than fail
    // silently later when cmd_load_model is called.
    #[cfg(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    ))]
    if avail_gb < 6.0 {
        let warn_msg = format!(
            "Low available RAM ({:.1} GB) with GPU inference backend compiled in — \
             loading a large model may trigger an OOM error.",
            avail_gb,
        );
        commands::logs::warn(&warn_msg);
        log::warn!("{}", warn_msg);
    }
}

fn model_id_from_path(path: &str) -> Option<String> {
    let stem = std::path::Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())?;
    let trimmed = stem.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resolve_existing_resource_path(
    app: &tauri::AppHandle,
    candidates: &[&str],
) -> Option<std::path::PathBuf> {
    for rel in candidates {
        if let Ok(path) = app
            .path()
            .resolve(rel, tauri::path::BaseDirectory::Resource)
        {
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

fn resolve_kokoro_runtime_archive_path(
    app: &tauri::AppHandle,
    archive_name: &str,
) -> Option<std::path::PathBuf> {
    let rel_a = format!("resources/kokoro-runtime/{archive_name}");
    let rel_b = format!("kokoro-runtime/{archive_name}");
    resolve_existing_resource_path(app, &[&rel_a, &rel_b])
}

fn kokoro_python_candidates(app_dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let base = app_dir.join("kokoro").join("runtime").join("venv");
    #[cfg(target_os = "windows")]
    {
        vec![
            base.join("Scripts").join("python.exe"),
            base.join("python.exe"),
            base.join("bin").join("python.exe"),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![
            base.join("bin").join("python3"),
            base.join("bin").join("python"),
        ]
    }
}

fn default_kokoro_python_path(app_dir: &std::path::Path) -> std::path::PathBuf {
    kokoro_python_candidates(app_dir)
        .into_iter()
        .next()
        .unwrap_or_else(|| {
            app_dir
                .join("kokoro")
                .join("runtime")
                .join("venv")
                .join("python")
        })
}

fn resolve_existing_kokoro_python_path(app_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    kokoro_python_candidates(app_dir)
        .into_iter()
        .find(|p| p.exists())
}

fn resolve_kokoro_voices_path(kokoro_dir: &std::path::Path) -> std::path::PathBuf {
    let candidates = ["af_heart.bin", "af.bin"];
    for name in candidates {
        let path = kokoro_dir.join(name);
        if path.exists() {
            return path;
        }
    }
    // Default setting path for first-launch before assets are deployed.
    kokoro_dir.join("af_heart.bin")
}

#[cfg(target_os = "windows")]
fn apply_no_window(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_cmd: &mut std::process::Command) {}

fn normalize_voice_paths(conn: &rusqlite::Connection, app_dir: &std::path::Path) {
    let whisper_dir = app_dir.join("whisper");
    let kokoro_dir = app_dir.join("kokoro");
    let _ = std::fs::create_dir_all(&whisper_dir);
    let _ = std::fs::create_dir_all(&kokoro_dir);

    let whisper_model = whisper_dir
        .join("ggml-base-q8_0.bin")
        .to_string_lossy()
        .to_string();
    let kokoro_model = kokoro_dir
        .join("model_quantized.onnx")
        .to_string_lossy()
        .to_string();
    let kokoro_voices = resolve_kokoro_voices_path(&kokoro_dir)
        .to_string_lossy()
        .to_string();
    let kokoro_python = resolve_existing_kokoro_python_path(app_dir)
        .unwrap_or_else(|| default_kokoro_python_path(app_dir))
        .to_string_lossy()
        .to_string();

    let upsert_sql = "INSERT INTO settings (key, value) VALUES (?1, ?2)
                      ON CONFLICT(key) DO UPDATE SET value = excluded.value";
    let _ = conn.execute(
        upsert_sql,
        rusqlite::params!["whisper_rs_model_path", whisper_model],
    );
    let _ = conn.execute(
        upsert_sql,
        rusqlite::params!["kokoro_model_path", kokoro_model],
    );
    let _ = conn.execute(
        upsert_sql,
        rusqlite::params!["kokoro_voices_path", kokoro_voices],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["kokoro_python_path", kokoro_python],
    );
}

fn validate_kokoro_runtime_with_python(python_bin: &std::path::Path) -> Result<(), String> {
    let mut cmd = std::process::Command::new(python_bin);
    cmd.args(["-c", "import kokoro_onnx, onnxruntime, numpy"]);
    apply_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run python runtime check: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if stderr.is_empty() { stdout } else { stderr };
    Err(if details.is_empty() {
        format!("runtime import check failed: {}", output.status)
    } else {
        format!("runtime import check failed: {} ({details})", output.status)
    })
}

fn check_kokoro_runtime_with_python(python_bin: &std::path::Path) -> bool {
    validate_kokoro_runtime_with_python(python_bin).is_ok()
}

fn kokoro_runtime_archive_name() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "kokoro-runtime-linux-x86_64.zip";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "kokoro-runtime-linux-aarch64.zip";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "kokoro-runtime-macos-x86_64.zip";
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "kokoro-runtime-macos-aarch64.zip";
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "kokoro-runtime-windows-x86_64.zip";
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return "kokoro-runtime-windows-aarch64.zip";
    }
    #[allow(unreachable_code)]
    "kokoro-runtime-unknown.zip"
}

fn extract_zip_archive(
    archive_path: &std::path::Path,
    dest_dir: &std::path::Path,
) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| {
        format!(
            "failed to open runtime archive {}: {e}",
            archive_path.display()
        )
    })?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("failed to parse runtime archive: {e}"))?;

    let tmp_dir = dest_dir.with_extension("tmp-extract");
    if tmp_dir.exists() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("failed to create temp dir: {e}"))?;

    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("failed to read runtime archive entry {idx}: {e}"))?;
        let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out_path = tmp_dir.join(rel_path);
        if entry.name().ends_with('/') {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("failed to create runtime dir {}: {e}", out_path.display()))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create runtime path {}: {e}", parent.display()))?;
        }
        let mut out_file = std::fs::File::create(&out_path)
            .map_err(|e| format!("failed to create runtime file {}: {e}", out_path.display()))?;
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("failed to extract runtime file {}: {e}", out_path.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                let _ = std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode));
            }
        }
    }

    let nested = tmp_dir.join("venv");
    let extract_root = if nested.exists() && nested.is_dir() {
        nested
    } else {
        tmp_dir.clone()
    };

    if dest_dir.exists() {
        std::fs::remove_dir_all(dest_dir).map_err(|e| {
            format!(
                "failed to replace runtime directory {}: {e}",
                dest_dir.display()
            )
        })?;
    }
    std::fs::rename(&extract_root, dest_dir).map_err(|e| {
        format!(
            "failed to finalize runtime extraction {} -> {}: {e}",
            extract_root.display(),
            dest_dir.display()
        )
    })?;
    if tmp_dir.exists() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
    Ok(())
}

#[cfg(unix)]
fn chmod_runtime_binaries(python_path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let bin_dir = python_path
        .parent()
        .ok_or_else(|| "invalid python path".to_string())?;
    for entry in
        std::fs::read_dir(bin_dir).map_err(|e| format!("failed to inspect runtime bin/: {e}"))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_file() {
            let mut perm = std::fs::metadata(&p)
                .map_err(|e| format!("failed to read permissions for {}: {e}", p.display()))?
                .permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&p, perm).map_err(|e| {
                format!(
                    "failed to set executable permissions on {}: {e}",
                    p.display()
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn chmod_runtime_binaries(_python_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

fn rewrite_pyvenv_home(python_path: &std::path::Path) -> Result<(), String> {
    let venv_dir = python_path
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "failed to resolve runtime venv path".to_string())?;
    let cfg_path = venv_dir.join("pyvenv.cfg");
    if !cfg_path.exists() {
        return Ok(());
    }

    let mut content = String::new();
    std::fs::File::open(&cfg_path)
        .map_err(|e| format!("failed to open {}: {e}", cfg_path.display()))?
        .read_to_string(&mut content)
        .map_err(|e| format!("failed to read {}: {e}", cfg_path.display()))?;
    let home = python_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "failed to determine runtime python home".to_string())?;
    let mut found = false;
    let mut lines: Vec<String> = content
        .lines()
        .map(|line| {
            if line.trim_start().starts_with("home =") {
                found = true;
                format!("home = {home}")
            } else {
                line.to_string()
            }
        })
        .collect();
    if !found {
        lines.push(format!("home = {home}"));
    }
    std::fs::File::create(&cfg_path)
        .map_err(|e| format!("failed to write {}: {e}", cfg_path.display()))?
        .write_all(lines.join("\n").as_bytes())
        .map_err(|e| format!("failed to save {}: {e}", cfg_path.display()))?;
    Ok(())
}

fn ensure_kokoro_runtime(
    app: &tauri::AppHandle,
    app_dir: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    if let Some(existing) = resolve_existing_kokoro_python_path(app_dir) {
        if check_kokoro_runtime_with_python(&existing) {
            return Ok(existing);
        }
    }

    let _guard = KOKORO_RUNTIME_SETUP_LOCK.lock().unwrap();
    if let Some(existing) = resolve_existing_kokoro_python_path(app_dir) {
        if check_kokoro_runtime_with_python(&existing) {
            return Ok(existing);
        }
    }

    let runtime_dir = app_dir.join("kokoro").join("runtime").join("venv");
    let archive_name = kokoro_runtime_archive_name();
    let expected_python = default_kokoro_python_path(app_dir);
    let archive_path = resolve_kokoro_runtime_archive_path(app, archive_name).ok_or_else(|| {
        format!("failed to resolve bundled runtime archive path for {archive_name}")
    })?;
    commands::logs::event(
        "info",
        "runtime.bootstrap.start",
        serde_json::json!({
            "runtime": "kokoro",
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "archive_path": archive_path.to_string_lossy(),
            "archive_exists": archive_path.exists(),
            "python_path": expected_python.to_string_lossy(),
            "python_exists": expected_python.exists(),
        }),
    );
    if !archive_path.exists() {
        commands::logs::event(
            "error",
            "runtime.bootstrap.verify",
            serde_json::json!({
                "runtime": "kokoro",
                "stage": "archive_present",
                "result": "error",
                "error_code": "RUNTIME_ARCHIVE_MISSING",
                "archive_path": archive_path.to_string_lossy(),
            }),
        );
        return Err(format!(
            "Bundled Kokoro runtime archive missing: {}",
            archive_path.to_string_lossy()
        ));
    }

    let extract_start = std::time::Instant::now();
    extract_zip_archive(&archive_path, &runtime_dir)?;
    commands::logs::event(
        "info",
        "runtime.bootstrap.extract",
        serde_json::json!({
            "runtime": "kokoro",
            "target_dir": runtime_dir.to_string_lossy(),
            "duration_ms": extract_start.elapsed().as_millis(),
            "result": "ok",
        }),
    );
    let Some(python_path) = resolve_existing_kokoro_python_path(app_dir) else {
        commands::logs::event(
            "error",
            "runtime.bootstrap.verify",
            serde_json::json!({
                "runtime": "kokoro",
                "stage": "python_present",
                "result": "error",
                "error_code": "PYTHON_BIN_MISSING",
                "python_path": expected_python.to_string_lossy(),
            }),
        );
        return Err(format!(
            "Runtime extracted but Python interpreter is missing. Checked candidates under {}",
            runtime_dir.to_string_lossy()
        ));
    };
    chmod_runtime_binaries(&python_path)?;
    rewrite_pyvenv_home(&python_path)?;
    validate_kokoro_runtime_with_python(&python_path)?;
    commands::logs::event(
        "info",
        "runtime.bootstrap.verify",
        serde_json::json!({
            "runtime": "kokoro",
            "stage": "import_check",
            "result": "ok",
            "python_path": python_path.to_string_lossy(),
            "modules": ["kokoro_onnx", "onnxruntime", "numpy"],
        }),
    );
    Ok(python_path)
}

pub(crate) fn ensure_kokoro_runtime_now(
    app: &tauri::AppHandle,
) -> Result<std::path::PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let result = ensure_kokoro_runtime(app, &app_dir);
    if let Err(e) = &result {
        commands::logs::event(
            "warn",
            "runtime.bootstrap.repair_attempt",
            serde_json::json!({
                "runtime": "kokoro",
                "result": "error",
                "error_code": "RUNTIME_REPAIR_FAILED",
                "error": e,
            }),
        );
    } else {
        commands::logs::event(
            "info",
            "runtime.bootstrap.repair_attempt",
            serde_json::json!({
                "runtime": "kokoro",
                "result": "ok",
            }),
        );
    }
    result
}

fn log_kokoro_bootstrap_snapshot(
    app: &tauri::AppHandle,
    app_dir: &std::path::Path,
    model_path: &std::path::Path,
    voices_path: &std::path::Path,
) {
    let python_path = default_kokoro_python_path(app_dir);
    let archive_name = kokoro_runtime_archive_name();
    let archive_path = resolve_kokoro_runtime_archive_path(app, archive_name);
    let archive_exists = archive_path.as_ref().map(|p| p.exists()).unwrap_or(false);
    let archive_size = archive_path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .unwrap_or(0);
    let model_exists = model_path.exists();
    let model_size = std::fs::metadata(model_path).map(|m| m.len()).unwrap_or(0);
    let voices_exists = voices_path.exists();
    let voices_size = std::fs::metadata(voices_path).map(|m| m.len()).unwrap_or(0);
    let python_exists = python_path.exists();
    let selected_voice = app
        .try_state::<AppState>()
        .and_then(|state| {
            let db = state.db.lock().ok()?;
            db.query_row(
                "SELECT value FROM settings WHERE key = 'kokoro_voice'",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .unwrap_or_else(|| "af_heart".to_string());

    commands::logs::info(&format!(
        "[startup] Kokoro snapshot: archive={} exists={} size={} python={} exists={} model={} exists={} size={} voices={} exists={} size={} voice={}",
        archive_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "<unresolved>".to_string()),
        archive_exists,
        archive_size,
        python_path.to_string_lossy(),
        python_exists,
        model_path.to_string_lossy(),
        model_exists,
        model_size,
        voices_path.to_string_lossy(),
        voices_exists,
        voices_size,
        selected_voice
    ));
}

fn start_kokoro_bootstrap(
    app: tauri::AppHandle,
    app_dir: std::path::PathBuf,
    model_path: std::path::PathBuf,
    voices_path: std::path::PathBuf,
) {
    if KOKORO_BOOTSTRAP_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    log_kokoro_bootstrap_snapshot(&app, &app_dir, &model_path, &voices_path);

    emit_kokoro_bootstrap_status(
        &app,
        KokoroBootstrapStatus {
            phase: "starting".to_string(),
            message: "Preparing voice runtime".to_string(),
            progress_percent: 2,
            model_ready: model_path.exists(),
            runtime_ready: false,
            done: false,
            ok: false,
            error: None,
        },
    );

    tauri::async_runtime::spawn(async move {
        let model_ready = model_path.exists();
        let mut runtime_ready = false;

        if !voices_path.exists() {
            let msg = format!("voices file missing at {}", voices_path.to_string_lossy());
            emit_kokoro_bootstrap_status(
                &app,
                KokoroBootstrapStatus {
                    phase: "error".to_string(),
                    message: "Kokoro voices file is missing".to_string(),
                    progress_percent: 100,
                    model_ready,
                    runtime_ready,
                    done: true,
                    ok: false,
                    error: Some(msg.clone()),
                },
            );
            commands::logs::warn(&format!("[startup] Kokoro bootstrap failed: {msg}"));
            KOKORO_BOOTSTRAP_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
            return;
        }

        if !model_ready {
            let msg = format!(
                "bundled Kokoro model missing at {}",
                model_path.to_string_lossy()
            );
            emit_kokoro_bootstrap_status(
                &app,
                KokoroBootstrapStatus {
                    phase: "error".to_string(),
                    message: "Kokoro model file is missing".to_string(),
                    progress_percent: 100,
                    model_ready: false,
                    runtime_ready,
                    done: true,
                    ok: false,
                    error: Some(msg.clone()),
                },
            );
            commands::logs::warn(&format!("[startup] Kokoro bootstrap failed: {msg}"));
            KOKORO_BOOTSTRAP_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
            return;
        }

        emit_kokoro_bootstrap_status(
            &app,
            KokoroBootstrapStatus {
                phase: "installing-runtime".to_string(),
                message: "Installing voice runtime".to_string(),
                progress_percent: 70,
                model_ready,
                runtime_ready,
                done: false,
                ok: false,
                error: None,
            },
        );

        let app_clone = app.clone();
        let app_dir_clone = app_dir.clone();
        let runtime_result =
            tokio::task::spawn_blocking(move || ensure_kokoro_runtime(&app_clone, &app_dir_clone))
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| r);

        match runtime_result {
            Ok(python_path) => {
                runtime_ready = true;
                if let Some(state) = app.try_state::<AppState>() {
                    let db = state.db.lock().unwrap();
                    let _ = db.execute(
                        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                        rusqlite::params![
                            "kokoro_python_path",
                            python_path.to_string_lossy().to_string()
                        ],
                    );
                }
                emit_kokoro_bootstrap_status(
                    &app,
                    KokoroBootstrapStatus {
                        phase: "ready".to_string(),
                        message: "Voice runtime ready".to_string(),
                        progress_percent: 100,
                        model_ready,
                        runtime_ready,
                        done: true,
                        ok: true,
                        error: None,
                    },
                );
                commands::logs::info("[startup] Kokoro runtime is ready");
            }
            Err(e) => {
                emit_kokoro_bootstrap_status(
                    &app,
                    KokoroBootstrapStatus {
                        phase: "error".to_string(),
                        message: "Voice runtime setup failed".to_string(),
                        progress_percent: 100,
                        model_ready,
                        runtime_ready: false,
                        done: true,
                        ok: false,
                        error: Some(e.clone()),
                    },
                );
                commands::logs::warn(&format!("[startup] Kokoro runtime setup failed: {e}"));
            }
        }

        KOKORO_BOOTSTRAP_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    });
}

/// Periodically checks the managed local llama-server health and unloads stale state.
fn start_local_server_health_probe(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let mut consecutive_failures: u8 = 0;

        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;

            let app_state = app.state::<AppState>();
            let snapshot = {
                let guard = app_state.local_server.lock().unwrap();
                guard.as_ref().map(|h| (h.pid, h.port))
            };
            let Some((pid, port)) = snapshot else {
                consecutive_failures = 0;
                continue;
            };

            let pid_ok = model_manager::engine_installer::is_pid_alive(pid);
            let health_ok = client
                .get(format!("http://127.0.0.1:{port}/health"))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false);
            commands::logs::event(
                "debug",
                "local_server.health",
                serde_json::json!({
                    "pid": pid,
                    "port": port,
                    "pid_alive": pid_ok,
                    "http_health": health_ok,
                    "consecutive_failures": consecutive_failures,
                }),
            );

            if pid_ok && health_ok {
                consecutive_failures = 0;
                continue;
            }

            consecutive_failures = consecutive_failures.saturating_add(1);
            if consecutive_failures < 2 {
                log::warn!(
                    "[health-probe] local server unhealthy (pid_ok={}, health_ok={}) pid={} port={} (retrying)",
                    pid_ok,
                    health_ok,
                    pid,
                    port
                );
                commands::logs::event(
                    "warn",
                    "local_server.health",
                    serde_json::json!({
                        "pid": pid,
                        "port": port,
                        "pid_alive": pid_ok,
                        "http_health": health_ok,
                        "consecutive_failures": consecutive_failures,
                        "result": "retrying",
                    }),
                );
                continue;
            }

            let removed = {
                let mut guard = app_state.local_server.lock().unwrap();
                if guard.as_ref().map(|h| h.pid) != Some(pid) {
                    false
                } else if let Some(handle) = guard.take() {
                    drop(handle);
                    true
                } else {
                    false
                }
            };
            if !removed {
                consecutive_failures = 0;
                continue;
            }

            let model_state = app.state::<ModelManagerState>();
            {
                let mut manager = model_state.0.write().await;
                manager.clear();
            }

            let msg = format!(
                "Local model server stopped responding on port {}. Model unloaded; reload to continue.",
                port
            );
            log::warn!("[health-probe] {}", msg);
            commands::logs::event(
                "error",
                "local_server.health",
                serde_json::json!({
                    "pid": pid,
                    "port": port,
                    "pid_alive": pid_ok,
                    "http_health": health_ok,
                    "consecutive_failures": consecutive_failures,
                    "result": "unloaded",
                    "error_code": "LOCAL_SERVER_UNHEALTHY",
                    "message": msg,
                }),
            );
            let _ = app.emit("model:state_changed", ());
            let _ = app.emit("model:server_unhealthy", &msg);
            let _ = app.emit("local:error", &msg);
            consecutive_failures = 0;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        // webproxy:// — server-side HTTP proxy for the embedded browser iframe.
        // Fetches external URLs with reqwest, strips X-Frame-Options and CSP
        // frame-ancestors headers so any site can be loaded in the iframe.
        .register_asynchronous_uri_scheme_protocol("webproxy", |_app, request, responder| {
            tauri::async_runtime::spawn(async move {
                let response = commands::browser::handle_proxy_request(request).await;
                responder.respond(response);
            });
        })
        .setup(|app| {
            // Initialize log emitter with app handle
            commands::logs::init(app.handle().clone());

            commands::logs::info(&format!(
                "arx starting — version {}",
                env!("CARGO_PKG_VERSION")
            ));

            // ── System diagnostics ────────────────────────────────────────────
            // Logged first so that any subsequent failure has memory context.
            log_startup_diagnostics();

            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir)?;
            commands::logs::info(&format!("App data directory: {:?}", app_dir));

            let db_path = app_dir.join("arx.db");
            let conn = db::init_db(&db_path).expect("failed to init database");
            normalize_voice_paths(&conn, &app_dir);
            commands::logs::info("Database initialized");

            let a2a_db_path = app_dir.join("a2a.db");
            let a2a_conn =
                a2a::workflow_store::init_db(&a2a_db_path).expect("failed to init A2A database");
            a2a::workflow_store::ensure_seed_workflows(&a2a_conn)
                .expect("failed to seed A2A workflows");
            commands::logs::info("A2A database initialized");

            // ── Memory: import any files edited while the app was closed ──────
            let memory_dir = app_dir.join("memory");
            std::fs::create_dir_all(&memory_dir).ok();
            if let Err(e) = memory::sync_from_files(&conn, &memory_dir) {
                log::warn!("Memory file sync on startup: {}", e);
            }
            let agent_home_dir = app_dir.join("agent");
            std::fs::create_dir_all(&agent_home_dir).ok();
            std::env::set_var("ARX_AGENT_HOME", &agent_home_dir);

            commands::skills::seed_default_skills(app.handle());

            // ── Bundled Whisper models: deploy to user data dir on first launch ─
            // Models may come from explicit bundle resources (resources/whisper/)
            // or frontend dist assets (whisper/).
            // On first run (or if deleted) they are copied to
            // app_data_dir/whisper/ so the default DB path resolves and
            // users can manage/replace models in a stable, well-known location.
            {
                let whisper_dest = app_dir.join("whisper");
                std::fs::create_dir_all(&whisper_dest).ok();
                let bundled = ["ggml-base-q8_0.bin", "ggml-tiny.en-q8_0.bin"];
                for name in &bundled {
                    let dest = whisper_dest.join(name);
                    if !dest.exists() {
                        let src = resolve_existing_resource_path(
                            app.handle(),
                            &[
                                &format!("resources/whisper/{name}"),
                                &format!("whisper/{name}"),
                            ],
                        );
                        match src {
                            Some(src) => match std::fs::copy(&src, &dest) {
                                Ok(_) => commands::logs::info(&format!(
                                    "Deployed bundled Whisper model: {name}"
                                )),
                                Err(e) => log::warn!("Failed to deploy Whisper model {name}: {e}"),
                            },
                            None => {
                                log::debug!("Bundled Whisper model not found in resources: {name}")
                            }
                        }
                    }
                }
            }

            // ── Kokoro assets bootstrap ────────────────────────────────────────
            // Kokoro model and voices may be bundled under resources/voice/
            // or in frontend dist assets under voice/.
            // On first run (or if deleted), *.bin voice assets and the selected
            // model are copied to app_data_dir/kokoro/.
            {
                let kokoro_dest = app_dir.join("kokoro");
                std::fs::create_dir_all(&kokoro_dest).ok();
                let model_dest = kokoro_dest.join("model_quantized.onnx");
                if let Some(voice_resources_dir) = resolve_existing_resource_path(
                    app.handle(),
                    &["resources/voice", "voice"],
                ) {
                    if let Ok(entries) = std::fs::read_dir(&voice_resources_dir) {
                        for entry in entries.flatten() {
                            let src = entry.path();
                            if !src.is_file() {
                                continue;
                            }
                            let ext = src
                                .extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("")
                                .to_ascii_lowercase();
                            if ext != "bin" {
                                continue;
                            }
                            let Some(name) = src.file_name() else {
                                continue;
                            };
                            let dest = kokoro_dest.join(name);
                            if dest.exists() {
                                continue;
                            }
                            if let Err(e) = std::fs::copy(&src, &dest) {
                                log::warn!("Failed to deploy Kokoro voice asset {:?}: {e}", name);
                            }
                        }
                    }
                }
                let voices_dest = resolve_kokoro_voices_path(&kokoro_dest);
                if !voices_dest.exists() {
                    log::warn!(
                        "Bundled Kokoro voice assets not found in resources (expected af_heart.bin or af.bin)"
                    );
                } else {
                    let _ = conn.execute(
                        "INSERT INTO settings (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        rusqlite::params![
                            "kokoro_voices_path",
                            voices_dest.to_string_lossy().to_string()
                        ],
                    );
                }
                if !model_dest.exists() {
                    let src = resolve_existing_resource_path(
                        app.handle(),
                        &["resources/voice/model_quantized.onnx", "voice/model_quantized.onnx"],
                    );
                    match src {
                        Some(src) => match std::fs::copy(&src, &model_dest) {
                            Ok(_) => commands::logs::info(
                                "Deployed bundled Kokoro model: model_quantized.onnx",
                            ),
                            Err(e) => log::warn!(
                                "Failed to deploy bundled Kokoro model model_quantized.onnx: {e}"
                            ),
                        },
                        None => log::warn!(
                            "Bundled Kokoro model model_quantized.onnx not found in resources"
                        ),
                    }
                }
                start_kokoro_bootstrap(
                    app.handle().clone(),
                    app_dir.clone(),
                    model_dest,
                    voices_dest,
                );
            }

            app.manage(AppState {
                db: Mutex::new(conn),
                a2a_db: Mutex::new(a2a_conn),
                voice_active: Mutex::new(false),
                audio_buffer: Mutex::new(Vec::new()),
                chat_cancel: Arc::new(AtomicBool::new(false)),
                speculative_cancel: Arc::new(AtomicBool::new(false)),
                generation_id: Arc::new(AtomicU64::new(0)),
                voice_running: Arc::new(AtomicBool::new(false)),
                local_server: Mutex::new(None),
                kokoro_daemon: Arc::new(Mutex::new(None)),
                whisper_daemon: Arc::new(Mutex::new(None)),
                whisper_rs_ctx: Arc::new(Mutex::new(None)),
                http_client: reqwest::Client::new(),
                memory_dir,
            });

            // Initialize model manager state
            app.manage(ModelManagerState::new());
            // Initialize audio device state
            app.manage(audio::state::AudioState::new());

            // ── Adopt any llama-server left running from a previous session ────────
            // Reads llama-server.state written by the previous session. If the
            // recorded PID is alive and the port is open the server is adopted
            // (no model reload needed). If stale the PID is killed and cleaned up.
            {
                let state_file = app_dir.join("llama-server.state");
                if let Some(handle) =
                    model_manager::engine_installer::adopt_or_cleanup_server(&state_file)
                {
                    let adopted_url = handle.url.clone();
                    let adopted_model = model_id_from_path(&handle.model_path);
                    let msg = format!(
                        "[startup] Adopted existing llama-server (PID {}) on port {} — model: {}",
                        handle.pid, handle.port, handle.model_path
                    );
                    commands::logs::info(&msg);
                    log::info!("{}", msg);
                    let app_state = app.state::<AppState>();
                    *app_state.local_server.lock().unwrap() = Some(handle);

                    // Align routing settings with the adopted local server unless API was explicitly selected.
                    let db = app_state.db.lock().unwrap();
                    let primary_source: String = db
                        .query_row(
                            "SELECT value FROM settings WHERE key = 'primary_llm_source'",
                            [],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()
                        .unwrap_or(None)
                        .unwrap_or_default()
                        .trim()
                        .to_ascii_lowercase();

                    if primary_source != "api" {
                        let _ = db.execute(
                            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                            rusqlite::params!["base_url", adopted_url],
                        );
                        if let Some(model_id) = adopted_model {
                            let _ = db.execute(
                                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                                rusqlite::params!["model", model_id],
                            );
                        }
                        let _ = db.execute(
                            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                            rusqlite::params!["primary_llm_source", "local"],
                        );
                        let msg =
                            "[startup] Updated settings to route chat to adopted local server";
                        commands::logs::info(msg);
                        log::info!("{}", msg);
                    } else {
                        let msg = "[startup] Primary LLM source is API; keeping API routing";
                        commands::logs::info(msg);
                        log::info!("{}", msg);
                    }
                }
            }

            // ── Windows GPU probe thread ──────────────────────────────────────
            // Runs a single PowerShell process every 15 s and writes the result
            // into a shared cache. The system-usage loop below reads only from
            // that cache and never spawns processes, keeping it non-blocking.
            #[cfg(target_os = "windows")]
            model_manager::system_info::start_windows_gpu_probe_thread();

            // ── Background system-usage emitter ──────────────────────────────
            // Runs on a dedicated OS thread so it is never starved by the async
            // runtime or blocked by AI streaming. Emits "system:usage" ~every
            // second; the frontend listens instead of polling via invoke.
            {
                let emitter = app.handle().clone();
                std::thread::spawn(move || loop {
                    let t0 = std::time::Instant::now();
                    let snapshot = model_manager::system_info::get_system_usage();
                    let _ = emitter.emit("system:usage", &snapshot);
                    let elapsed = t0.elapsed();
                    let period = std::time::Duration::from_millis(1000);
                    if elapsed < period {
                        std::thread::sleep(period - elapsed);
                    }
                });
            }

            // Detect post-start llama-server crashes and notify the frontend.
            start_local_server_health_probe(app.handle());

            commands::logs::info("Application ready");

            #[cfg(target_os = "linux")]
            {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.with_webview(|webview| {
                        use webkit2gtk::glib::prelude::ObjectExt;
                        use webkit2gtk::{
                            PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
                            WebViewExt,
                        };
                        if let Some(settings) = webview.inner().settings() {
                            settings.set_enable_media_stream(true);
                            log::info!("[webkit] enabled media stream");
                        } else {
                            log::warn!("[webkit] missing webview settings");
                        }
                        webview.inner().connect_permission_request(|_wv, request| {
                            if request.is::<UserMediaPermissionRequest>() {
                                log::info!("[webkit] granting user media permission");
                                request.allow();
                                return true;
                            }
                            false
                        });
                    });
                } else {
                    log::warn!("[webkit] main webview not found to enable media stream");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::chat::cmd_chat_stream,
            commands::chat::cmd_chat_cancel,
            commands::chat::cmd_prefill_warmup,
            commands::chat::cmd_chat_get_messages,
            commands::chat::cmd_chat_clear,
            commands::chat::cmd_chat_regenerate_last_prompt,
            commands::chat::cmd_delegate_stream,
            commands::project::cmd_project_create,
            commands::project::cmd_project_list,
            commands::project::cmd_project_delete,
            commands::project::cmd_project_update,
            commands::project::cmd_conversation_create,
            commands::project::cmd_conversation_list,
            commands::project::cmd_conversation_list_all,
            commands::project::cmd_conversation_get_last,
            commands::project::cmd_conversation_delete,
            commands::project::cmd_conversation_update_title,
            commands::project::cmd_conversation_assign_project,
            commands::project::cmd_conversation_branch_from_message,
            commands::voice::cmd_voice_start,
            commands::voice::cmd_voice_stop,
            commands::voice::cmd_tts_speak,
            commands::voice::cmd_check_voice_endpoints,
            commands::voice::cmd_list_audio_devices,
            commands::voice::cmd_get_kokoro_bootstrap_status,
            commands::voice::cmd_tts_check_engines,
            commands::voice::cmd_tts_self_test,
            commands::voice::cmd_stt_check_engines,
            commands::voice::cmd_stt_list_whisper_models,
            commands::voice::cmd_tts_list_voices,
            audio::set_audio_device,
            audio::get_stream_status,
            commands::diagnostics::cmd_voice_diagnostics,
            commands::a2a::cmd_a2a_process_list,
            commands::a2a::cmd_a2a_process_get,
            commands::a2a::cmd_a2a_process_events,
            commands::a2a::cmd_a2a_seed_demo_process,
            commands::a2a::cmd_a2a_process_create,
            commands::a2a::cmd_a2a_process_set_status,
            commands::a2a::cmd_a2a_process_retry,
            commands::a2a::cmd_a2a_agent_cards_list,
            commands::a2a::cmd_a2a_agent_card_create,
            commands::a2a::cmd_a2a_agent_card_update,
            commands::a2a::cmd_a2a_agent_card_delete,
            commands::a2a_workflow::cmd_a2a_workflow_list,
            commands::a2a_workflow::cmd_a2a_workflow_get,
            commands::a2a_workflow::cmd_a2a_workflow_create,
            commands::a2a_workflow::cmd_a2a_workflow_update,
            commands::a2a_workflow::cmd_a2a_workflow_delete,
            commands::a2a_workflow::cmd_a2a_workflow_run_list,
            commands::a2a_workflow::cmd_a2a_workflow_run_get,
            commands::a2a_workflow::cmd_a2a_node_type_list,
            commands::a2a_workflow::cmd_a2a_workflow_preflight,
            commands::a2a_workflow::cmd_a2a_workflow_run_start,
            commands::a2a_workflow::cmd_a2a_workflow_run_cancel,
            commands::a2a_workflow::cmd_a2a_workflow_run_pause,
            commands::a2a_workflow::cmd_a2a_workflow_run_resume,
            commands::a2a_workflow::cmd_a2a_workflow_node_test,
            commands::a2a_workflow::cmd_a2a_credential_list,
            commands::a2a_workflow::cmd_a2a_credential_create,
            commands::a2a_workflow::cmd_a2a_credential_delete,
            commands::a2a_workflow::cmd_a2a_template_list,
            commands::a2a_workflow::cmd_a2a_template_create,
            commands::a2a_workflow::cmd_a2a_template_delete,
            commands::tool_gateway::cmd_tool_invoke,
            commands::tool_packs::cmd_tool_packs_list,
            commands::tool_packs::cmd_tool_packs_index,
            commands::tool_packs::cmd_tool_pack_install,
            commands::tool_packs::cmd_tool_pack_set_enabled,
            commands::tool_packs::cmd_tool_pack_remove,
            commands::settings::cmd_settings_get,
            commands::settings::cmd_settings_set,
            commands::settings::cmd_settings_get_all,
            commands::settings::cmd_models_list,
            commands::skills::cmd_skills_list,
            commands::skills::cmd_skills_dir,
            commands::skills::cmd_skills_resolve,
            commands::skills::cmd_skills_set_enabled,
            commands::models::cmd_model_list_all,
            commands::models::cmd_model_add,
            commands::models::cmd_model_update,
            commands::models::cmd_model_delete,
            commands::models::cmd_model_set_primary,
            commands::models::cmd_model_verify,
            commands::webview::cmd_browser_info,
            commands::model::cmd_peek_model_metadata,
            commands::model::cmd_load_model,
            commands::model::cmd_unload_model,
            commands::model::cmd_get_available_devices,
            commands::model::cmd_is_model_loaded,
            commands::model::cmd_get_loaded_model_info,
            commands::model::cmd_count_tokens,
            commands::model::cmd_render_prompt,
            commands::model::cmd_get_generation_config,
            commands::model::cmd_set_generation_config,
            commands::model::cmd_get_serve_state,
            commands::model::cmd_local_inference_stream,
            commands::model::cmd_get_system_resources,
            commands::model::cmd_get_system_usage,
            commands::model::cmd_get_storage_devices,
            commands::model::cmd_get_display_info,
            commands::model::cmd_get_system_identity,
            commands::model::cmd_list_available_models,
            commands::model::cmd_delete_available_model,
            commands::model::cmd_get_models_dir,
            commands::model::cmd_import_model_from_path,
            commands::model::cmd_download_model_from_hf_query,
            commands::model::cmd_download_model_from_hf_asset,
            commands::model::cmd_get_runtime_status,
            commands::model::cmd_open_models_folder,
            commands::model::cmd_install_runtime_engine,
            commands::memory::cmd_memory_upsert,
            commands::memory::cmd_memory_list,
            commands::memory::cmd_memory_delete,
            commands::memory::cmd_memory_get_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Belt-and-suspenders: kill any running llama-server subprocess.
                // The Drop impl on LocalServerHandle does this too, but explicit
                // cleanup here runs before managed state is torn down.
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Ok(mut server) = state.local_server.lock() {
                        if let Some(handle) = server.take() {
                            // Drop impl kills process + removes state file
                            drop(handle);
                        }
                    }
                }

                // Drop the in-process GPU model Arc so llama.cpp can release
                // Vulkan/CUDA resources through its normal teardown path.
                // Use try_write() (non-blocking) — if inference is still active
                // the lock is held, but the process is exiting anyway and the OS
                // will reclaim GPU memory.  Avoid block_on here: calling it from
                // the winit event loop thread (not a tokio worker) can panic.
                if let Some(mm) = app_handle.try_state::<ModelManagerState>() {
                    if let Ok(mut manager) = mm.0.try_write() {
                        manager.clear();
                    }
                }
            }
        });
}
