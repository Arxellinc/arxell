mod a2a;
mod ai;
pub mod audio;
mod commands;
mod db;
pub mod memory;
pub mod model_manager;

use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

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
        .join("kokoro-v1.0.onnx")
        .to_string_lossy()
        .to_string();
    let kokoro_voices = kokoro_dir
        .join("voices-v1.0.bin")
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
}

fn start_kokoro_download_if_missing(model_path: std::path::PathBuf) {
    if model_path.exists() {
        return;
    }

    let parent = match model_path.parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };
    let _ = std::fs::create_dir_all(&parent);

    let lock_path = parent.join(".kokoro_download.lock");
    let lock = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&lock_path);
    if lock.is_err() {
        return;
    }

    let url = std::env::var("ARXELL_KOKORO_MODEL_URL").unwrap_or_else(|_| {
        "https://huggingface.co/Arxell/kokoro-v1.0.onnx/resolve/main/kokoro-v1.0.onnx?download=true".to_string()
    });
    let temp_path = model_path.with_extension("onnx.part");
    commands::logs::info(&format!(
        "[startup] Kokoro model missing; starting background download from {}",
        url
    ));

    tauri::async_runtime::spawn(async move {
        let result: Result<(), String> = async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(1200))
                .build()
                .map_err(|e| format!("failed to build HTTP client: {e}"))?;

            let mut resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("request failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }

            let mut file = tokio::fs::File::create(&temp_path)
                .await
                .map_err(|e| format!("failed to create temp file: {e}"))?;
            while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("failed to write chunk: {e}"))?;
            }
            file.flush()
                .await
                .map_err(|e| format!("failed to flush file: {e}"))?;

            tokio::fs::rename(&temp_path, &model_path)
                .await
                .map_err(|e| format!("failed to finalize model file: {e}"))?;
            Ok(())
        }
        .await;

        match result {
            Ok(()) => commands::logs::info("[startup] Kokoro model download complete"),
            Err(e) => {
                let _ = std::fs::remove_file(&temp_path);
                commands::logs::warn(&format!(
                    "[startup] Kokoro model download failed: {}. Local TTS may fall back until this succeeds.",
                    e
                ));
            }
        }

        let _ = std::fs::remove_file(&lock_path);
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

            commands::skills::seed_default_skills(app.handle());

            // ── Bundled Whisper models: deploy to user data dir on first launch ─
            // Models are shipped inside the app bundle under resources/whisper/.
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
                        match app.path().resolve(
                            format!("resources/whisper/{name}"),
                            tauri::path::BaseDirectory::Resource,
                        ) {
                            Ok(src) if src.exists() => match std::fs::copy(&src, &dest) {
                                Ok(_) => commands::logs::info(&format!(
                                    "Deployed bundled Whisper model: {name}"
                                )),
                                Err(e) => log::warn!("Failed to deploy Whisper model {name}: {e}"),
                            },
                            _ => {
                                log::debug!("Bundled Whisper model not found in resources: {name}")
                            }
                        }
                    }
                }
            }

            // ── Kokoro assets bootstrap ────────────────────────────────────────
            // voices-v1.0.bin is bundled with the app. The large ONNX model is
            // downloaded on-demand on first launch when missing.
            {
                let kokoro_dest = app_dir.join("kokoro");
                std::fs::create_dir_all(&kokoro_dest).ok();
                let voices_dest = kokoro_dest.join("voices-v1.0.bin");
                if !voices_dest.exists() {
                    match app.path().resolve(
                        "resources/voice/voices-v1.0.bin",
                        tauri::path::BaseDirectory::Resource,
                    ) {
                        Ok(src) if src.exists() => match std::fs::copy(&src, &voices_dest) {
                            Ok(_) => commands::logs::info("Deployed bundled Kokoro voices file"),
                            Err(e) => log::warn!("Failed to deploy Kokoro voices file: {e}"),
                        },
                        _ => log::debug!("Bundled Kokoro voices file not found in resources"),
                    }
                }
                start_kokoro_download_if_missing(kokoro_dest.join("kokoro-v1.0.onnx"));
            }

            // ── Optional bundled LLM: deploy to {app_data_dir}/models/ on first launch ──
            // If a model is present in resources/models/, copy it once so
            // cmd_list_available_models can pick it up. Public builds may omit
            // this asset and rely on first-run model installation flow.
            {
                let llm_dest = app_dir.join("models");
                std::fs::create_dir_all(&llm_dest).ok();
                let bundled_llm = "Qwen3.5-2B-Q8_0.gguf";
                let dest = llm_dest.join(bundled_llm);
                if !dest.exists() {
                    match app.path().resolve(
                        format!("resources/models/{bundled_llm}"),
                        tauri::path::BaseDirectory::Resource,
                    ) {
                        Ok(src) if src.exists() => match std::fs::copy(&src, &dest) {
                            Ok(_) => commands::logs::info(&format!(
                                "Deployed bundled LLM: {bundled_llm}"
                            )),
                            Err(e) => log::warn!("Failed to deploy bundled LLM {bundled_llm}: {e}"),
                        },
                        _ => log::debug!("Bundled LLM not found in resources: {bundled_llm}"),
                    }
                }
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
            commands::voice::cmd_tts_check_engines,
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
            commands::a2a_workflow::cmd_a2a_workflow_run_start,
            commands::a2a_workflow::cmd_a2a_workflow_node_test,
            commands::a2a_workflow::cmd_a2a_credential_list,
            commands::a2a_workflow::cmd_a2a_credential_create,
            commands::a2a_workflow::cmd_a2a_credential_delete,
            commands::a2a_workflow::cmd_a2a_template_list,
            commands::a2a_workflow::cmd_a2a_template_create,
            commands::a2a_workflow::cmd_a2a_template_delete,
            commands::tool_gateway::cmd_tool_invoke,
            commands::settings::cmd_settings_get,
            commands::settings::cmd_settings_set,
            commands::settings::cmd_settings_get_all,
            commands::settings::cmd_models_list,
            commands::skills::cmd_skills_list,
            commands::skills::cmd_skills_dir,
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
