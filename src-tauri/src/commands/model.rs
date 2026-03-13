//! Tauri commands for local model management
//!
//! Commands for:
//! - Peeking at model metadata without loading weights
//! - Loading/unloading models into memory
//! - Enumerating compute devices
//! - Token counting and prompt rendering
//! - Streaming local inference (local:token / local:done events)

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::model_manager::system_info::{
    get_runtime_status, get_storage_devices, get_system_identity, get_system_resources,
    get_system_usage, RuntimeStatus, StorageDevice, SystemIdentity, SystemResources, SystemUsage,
};
use crate::model_manager::{
    enumerate_devices, load_model, peek_model_metadata as read_model_metadata, ChatMessage,
    DeviceInfo, EngineInstallResult, GenerationConfig, ModelError, ModelInfo, ModelLoadConfig,
    ModelLoadProgress, ModelManagerState, ServeState, TokenCount,
};
use crate::AppState;

fn build_lightweight_model_info(path: &str, context_override: Option<u32>) -> ModelInfo {
    let path_obj = Path::new(path);
    let name = path_obj
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let file_size_mb = std::fs::metadata(path_obj)
        .ok()
        .map(|m| m.len() / (1024 * 1024));

    let name_lower = name.to_lowercase();
    let supports_thinking = name_lower.starts_with("glm")
        || name_lower.starts_with("qwq")
        || name_lower.starts_with("qwen3")
        || name_lower.contains("thinking");

    ModelInfo {
        name,
        architecture: "unknown".to_string(),
        context_length: context_override.unwrap_or(0),
        vocab_size: 0,
        chat_template: None,
        bos_token: None,
        eos_token: None,
        supported_roles: vec![
            "system".to_string(),
            "user".to_string(),
            "assistant".to_string(),
        ],
        quantization: None,
        parameter_count: None,
        file_size_mb,
        supports_thinking,
    }
}

/// Query the llama-server for the actual allocated context window (n_ctx).
///
/// llama-server respects --ctx-size, so this returns the user-configured limit,
/// not the model's theoretical maximum. Falls back through several endpoints and
/// field locations that vary across llama.cpp versions:
///
///   /props  → default_generation_settings.n_ctx  (current llama.cpp)
///   /props  → n_ctx                              (older builds)
///   /slots  → [0].n_ctx                          (fallback)
async fn query_server_n_ctx(port: u16) -> Option<u32> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    // ── /props ──────────────────────────────────────────────────────────────
    if let Ok(resp) = client
        .get(format!("http://127.0.0.1:{}/props", port))
        .send()
        .await
    {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            // Current llama.cpp: nested under default_generation_settings
            if let Some(n) = json
                .get("default_generation_settings")
                .and_then(|s| s.get("n_ctx"))
                .and_then(|v| v.as_u64())
            {
                return Some(n as u32);
            }
            // Older builds: top-level n_ctx
            if let Some(n) = json.get("n_ctx").and_then(|v| v.as_u64()) {
                return Some(n as u32);
            }
        }
    }

    // ── /slots (fallback) ────────────────────────────────────────────────────
    if let Ok(resp) = client
        .get(format!("http://127.0.0.1:{}/slots", port))
        .send()
        .await
    {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            if let Some(n) = json
                .get(0)
                .and_then(|slot| slot.get("n_ctx"))
                .and_then(|v| v.as_u64())
            {
                return Some(n as u32);
            }
        }
    }

    None
}

/// Peek at a GGUF model's metadata without loading weights into memory.
///
/// This is a fast operation (<500ms) that only reads the file header.
#[tauri::command]
pub async fn cmd_peek_model_metadata(path: String) -> Result<ModelInfo, String> {
    let path = Path::new(&path);
    read_model_metadata(path).await.map_err(|e| e.to_string())
}

/// Load a GGUF model into memory for inference.
///
/// Emits `model:load_progress` events during loading:
/// - "reading_metadata" (10%)
/// - "allocating_device" (30%)
/// - "loading_weights" (60%)
/// - "ready" (100%)
///
/// If a model is already loaded, it will be unloaded first.
#[tauri::command]
pub async fn cmd_load_model(
    config: ModelLoadConfig,
    state: State<'_, ModelManagerState>,
    app_state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ModelInfo, String> {
    #[cfg(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    ))]
    {
        // Compiled-in GPU backend — kill any external server, then load directly
        {
            let mut server = app_state.local_server.lock().unwrap();
            if let Some(handle) = server.take() {
                drop(handle);
            }
        }
        {
            let mut manager = state.0.write().await;
            manager.clear();
        }
        let result = load_model(&config, &app).await.map_err(|e| e.to_string())?;
        let (model, model_info) = result;
        let mut manager = state.0.write().await;
        manager.model = Some(std::sync::Arc::new(model));
        manager.model_info = Some(model_info.clone());
        let _ = app.emit("model:state_changed", ());
        return Ok(model_info);
    }

    #[cfg(not(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    )))]
    {
        use crate::model_manager::engine_installer::{
            find_free_port, start_llama_server, wait_for_server_ready,
        };
        use crate::model_manager::system_info::get_runtime_status;

        // Compute the requested params up-front so we can match against a
        // potentially-running server before deciding to kill and respawn.
        let ngl = match config.n_gpu_layers {
            Some(n) if n < 0 => 999u32,
            Some(n) => n as u32,
            None => 999u32,
        };
        // ctx_size=0 tells llama-server to use the model's native max context
        // (the value trained into the GGUF metadata, e.g. 131072 for Qwen2.5).
        // If an explicit override is provided, enforce a 16k minimum floor.
        let ctx_size = match config.context_override {
            Some(n) => (n as u32).max(16_000),
            None => 0, // Let llama-server use the model's GGUF native max context
        };
        let batch_size = config.batch_size.unwrap_or(512).clamp(1, 8192);
        let ubatch_size = config.ubatch_size.unwrap_or(128).clamp(1, 4096);
        let n_threads = config.n_threads.filter(|v| *v > 0);
        let n_threads_batch = config.n_threads_batch.filter(|v| *v > 0);
        let flash_attn = config.flash_attn.unwrap_or(false);
        let cache_type_k = config
            .cache_type_k
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let cache_type_v = config
            .cache_type_v
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        // ── Adopt-if-matching check ───────────────────────────────────────────
        // If there is already a running server with the same model path and
        // params, reuse it without killing and reloading (saves GPU memory
        // churn on app restart).
        // Extract the port in a separate block so the MutexGuard is dropped
        // before any await point (Send requirement for async Tauri commands).
        let reuse_port: Option<u16> = {
            let srv = app_state.local_server.lock().unwrap();
            match srv.as_ref() {
                Some(handle)
                    if handle.model_path == config.path
                        && handle.n_gpu_layers == ngl
                        && handle.ctx_size == ctx_size
                        && handle.batch_size == batch_size
                        && handle.ubatch_size == ubatch_size
                        && handle.n_threads == n_threads
                        && handle.n_threads_batch == n_threads_batch
                        && handle.flash_attn == flash_attn
                        && handle.cache_type_k.as_deref() == cache_type_k.as_deref()
                        && handle.cache_type_v.as_deref() == cache_type_v.as_deref() =>
                {
                    Some(handle.port)
                }
                _ => None,
            }
        }; // MutexGuard dropped here

        if let Some(port) = reuse_port {
            // Query actual context length from running server
            let actual_ctx = query_server_n_ctx(port).await;
            let model_info =
                build_lightweight_model_info(&config.path, actual_ctx.or(config.context_override));

            app.emit(
                "model:load_progress",
                ModelLoadProgress {
                    stage: "ready".to_string(),
                    percentage: 100.0,
                    message: format!("Model already running on port {} (adopted)", port),
                },
            )
            .ok();

            let mut manager = state.0.write().await;
            manager.model_info = Some(model_info.clone());
            let _ = app.emit("model:state_changed", ());
            return Ok(model_info);
        }

        // Params don't match (or no server running) — kill existing and spawn fresh
        {
            let mut server = app_state.local_server.lock().unwrap();
            if let Some(handle) = server.take() {
                drop(handle);
            } // kills process + state file
        }
        {
            let mut manager = state.0.write().await;
            manager.clear();
        }

        // Check if there is an installed external engine binary we can use
        let engines_dir = app.path().app_data_dir().map(|p| p.join("engines")).ok();

        let runtime = get_runtime_status(engines_dir.as_deref());
        let best_external = runtime
            .engines
            .iter()
            .filter(|e| e.is_available && e.is_applicable && e.backend != "cpu" && e.binary_path.is_some())
            .max_by_key(|e| e.is_recommended as i32)
            .cloned();

        if let Some(engine) = best_external {
            let binary_path_str = engine.binary_path.unwrap();
            let binary_path = std::path::Path::new(&binary_path_str);

            let port = find_free_port(8765)
                .ok_or_else(|| "No free port available for inference server".to_string())?;

            // Emit model:load_progress events so the frontend shows progress
            app.emit(
                "model:load_progress",
                ModelLoadProgress {
                    stage: "allocating_device".to_string(),
                    percentage: 30.0,
                    message: format!("Starting {} inference server...", engine.name),
                },
            )
            .ok();

            // State file path — written by start_llama_server for cross-session adoption
            let state_file_path = app
                .path()
                .app_data_dir()
                .map(|p| p.join("llama-server.state"))
                .ok();

            let server_handle = start_llama_server(
                &engine.id,
                binary_path,
                &config.path,
                ngl,
                ctx_size,
                batch_size,
                ubatch_size,
                n_threads,
                n_threads_batch,
                flash_attn,
                cache_type_k.as_deref(),
                cache_type_v.as_deref(),
                port,
                state_file_path.as_deref(),
            )
            .map_err(|e| e)?;

            app.emit(
                "model:load_progress",
                ModelLoadProgress {
                    stage: "loading_weights".to_string(),
                    percentage: 60.0,
                    message: "Loading model into inference server (this may take a minute)..."
                        .to_string(),
                },
            )
            .ok();

            // Poll health endpoint — give up to 2 minutes for large models
            let ready = wait_for_server_ready(port, 120).await;
            if !ready {
                return Err("Inference server did not become ready within 2 minutes. \
                     Check that the model path is correct and you have enough memory."
                    .to_string());
            }

            // Store the server handle in AppState so chat uses it
            {
                let mut srv = app_state.local_server.lock().unwrap();
                *srv = Some(server_handle);
            }

            // Query actual context length now that the server is up.
            // llama-server sets n_ctx to the model's GGUF-defined max when we pass --ctx-size 0.
            let actual_ctx = query_server_n_ctx(port).await;
            log::info!(
                "[load-model] actual n_ctx from server props: {:?}",
                actual_ctx
            );

            // For external server path, avoid expensive GGUF parse at startup.
            // Large models can trigger substantial host RAM growth when parsing.
            let model_info =
                build_lightweight_model_info(&config.path, actual_ctx.or(config.context_override));

            app.emit(
                "model:load_progress",
                ModelLoadProgress {
                    stage: "ready".to_string(),
                    percentage: 100.0,
                    message: format!("Model loaded via {} on port {}", engine.name, port),
                },
            )
            .ok();

            let mut manager = state.0.write().await;
            manager.model_info = Some(model_info.clone());
            let _ = app.emit("model:state_changed", ());
            return Ok(model_info);
        }

        // No external binary — metadata-only path (no inference)
        let result = load_model(&config, &app).await.map_err(|e| e.to_string())?;
        let (_, model_info) = result;
        let mut manager = state.0.write().await;
        manager.model_info = Some(model_info.clone());
        let _ = app.emit("model:state_changed", ());
        Ok(model_info)
    }
}

/// Unload the currently loaded model and free memory.
#[tauri::command]
pub async fn cmd_unload_model(
    state: State<'_, ModelManagerState>,
    app_state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    // Stop any active or pending generation/warmup before dropping model/server resources.
    app_state
        .chat_cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
    app_state
        .speculative_cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);

    // Kill any running local inference server (Drop handles kill + state file deletion)
    {
        let mut server = app_state.local_server.lock().unwrap();
        if let Some(handle) = server.take() {
            drop(handle);
        }
    }
    let mut manager = state.0.write().await;
    manager.clear();
    let _ = app.emit("model:state_changed", ());
    Ok(())
}

/// Get list of available compute devices (CPU, GPU, etc.).
///
/// Always returns at least a CPU device.
/// GPU devices are only included if the corresponding feature was enabled at compile time
/// and the hardware is detected.
#[tauri::command]
pub fn cmd_get_available_devices() -> Result<Vec<DeviceInfo>, String> {
    Ok(enumerate_devices())
}

/// Check if a model is currently loaded.
#[tauri::command]
pub async fn cmd_is_model_loaded(state: State<'_, ModelManagerState>) -> Result<bool, String> {
    let manager = state.0.read().await;
    Ok(manager.is_loaded())
}

/// Get info about the currently loaded model, if any.
#[tauri::command]
pub async fn cmd_get_loaded_model_info(
    state: State<'_, ModelManagerState>,
) -> Result<Option<ModelInfo>, String> {
    let manager = state.0.read().await;
    Ok(manager.get_info().cloned())
}

/// Count tokens in a conversation.
///
/// Returns detailed token count breakdown including system tokens,
/// message tokens, remaining budget, and usage percentage.
#[tauri::command]
pub async fn cmd_count_tokens(
    _messages: Vec<ChatMessage>,
    _system_prompt: Option<String>,
    state: State<'_, ModelManagerState>,
) -> Result<TokenCount, String> {
    let manager = state.0.read().await;

    // Check if model is loaded
    let model_info = manager
        .model_info
        .clone()
        .ok_or_else(|| ModelError::ModelNotLoaded.to_string())?;

    #[cfg(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    ))]
    {
        let model = manager
            .model
            .clone()
            .ok_or_else(|| ModelError::ModelNotLoaded.to_string())?;

        // Use spawn_blocking for synchronous tokenization
        let messages_clone = _messages.clone();
        let system_clone = _system_prompt.clone();

        let result = tokio::task::spawn_blocking(move || {
            crate::model_manager::count_message_tokens(
                &messages_clone,
                system_clone.as_deref(),
                &model,
                &model_info,
            )
        })
        .await;

        // Flatten the nested Result: JoinError -> ModelError -> String
        result
            .map_err(|e| format!("Blocking task error: {}", e))
            .and_then(|r| r.map_err(|e| e.to_string()))
    }

    #[cfg(not(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    )))]
    {
        let _ = model_info; // Silence unused warning
        Err(ModelError::ModelNotLoaded.to_string())
    }
}

/// Render chat messages into a prompt string.
///
/// Uses the model's chat template if available, otherwise falls back
/// to an architecture-specific format.
#[tauri::command]
pub async fn cmd_render_prompt(
    _messages: Vec<ChatMessage>,
    _system_prompt: Option<String>,
    state: State<'_, ModelManagerState>,
) -> Result<String, String> {
    let manager = state.0.read().await;

    // Check if model is loaded
    let model_info = manager
        .model_info
        .clone()
        .ok_or_else(|| ModelError::ModelNotLoaded.to_string())?;

    #[cfg(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    ))]
    {
        let model = manager
            .model
            .clone()
            .ok_or_else(|| ModelError::ModelNotLoaded.to_string())?;

        // Use spawn_blocking for synchronous template rendering
        let messages_clone = _messages.clone();
        let system_clone = _system_prompt.clone();

        let result = tokio::task::spawn_blocking(move || {
            crate::model_manager::render_chat_template(
                &messages_clone,
                system_clone.as_deref(),
                &model,
                &model_info,
                None, // enable_thinking: use model default
            )
        })
        .await;

        // Flatten the nested Result: JoinError -> ModelError -> String
        result
            .map_err(|e| format!("Blocking task error: {}", e))
            .and_then(|r| r.map_err(|e| e.to_string()))
    }

    #[cfg(not(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    )))]
    {
        let _ = model_info; // Silence unused warning
        Err(ModelError::ModelNotLoaded.to_string())
    }
}

/// Get the current generation configuration.
///
/// Returns the current config even if no model is loaded.
/// The config persists across load/unload cycles.
#[tauri::command]
pub async fn cmd_get_generation_config(
    state: State<'_, ModelManagerState>,
) -> Result<GenerationConfig, String> {
    let manager = state.0.read().await;
    Ok(manager.generation_config.clone())
}

/// Update the generation configuration.
///
/// Validates and clamps all values before saving. Returns the
/// validated config so the frontend can see any clamped values.
///
/// Example: Setting temperature to 99.0 will return 2.0 (the max).
#[tauri::command]
pub async fn cmd_set_generation_config(
    mut config: GenerationConfig,
    state: State<'_, ModelManagerState>,
) -> Result<GenerationConfig, String> {
    // Validate and clamp all values
    config.validate();

    let mut manager = state.0.write().await;
    manager.generation_config = config.clone();

    Ok(config)
}

/// Get the complete serve state.
///
/// This is the single source of truth for UI state. Returns:
/// - Whether a model is loaded
/// - Model info (if loaded)
/// - Active device (if any)
/// - Current generation config (always available)
///
/// The frontend should call this on mount to initialize its state.
#[tauri::command]
pub async fn cmd_get_serve_state(
    state: State<'_, ModelManagerState>,
    app_state: State<'_, AppState>,
) -> Result<ServeState, String> {
    let (is_loaded, model_info, active_device, generation_config) = {
        let manager = state.0.read().await;
        (
            manager.is_loaded(),
            manager.model_info.clone(),
            manager.selected_device.clone(),
            manager.generation_config.clone(),
        )
    };

    let (inference_endpoint, local_server_port, local_ctx_size) = {
        let local = app_state.local_server.lock().unwrap();
        if let Some(handle) = local.as_ref() {
            (Some(handle.url.clone()), Some(handle.port), Some(handle.ctx_size))
        } else {
            drop(local);
            let db = app_state.db.lock().unwrap();
            (
                db.query_row(
                    "SELECT value FROM settings WHERE key = 'base_url'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok(),
                None,
                None,
            )
        }
    };

    let active_context_length = if let Some(len) = model_info
        .as_ref()
        .map(|m| m.context_length)
        .filter(|len| *len > 0)
    {
        Some(len)
    } else if let Some(ctx_size) = local_ctx_size.filter(|v| *v > 0) {
        Some(ctx_size)
    } else if let Some(port) = local_server_port {
        query_server_n_ctx(port).await
    } else {
        None
    };

    Ok(ServeState {
        is_loaded,
        model_info,
        active_device,
        inference_endpoint,
        active_context_length,
        generation_config,
    })
}

/// Stream token generation from the loaded local model.
///
/// Emits the following Tauri events during generation:
/// - `local:token`  — `String` payload containing one or more decoded characters
/// - `local:done`   — `null` payload when generation finishes normally
/// - `local:error`  — `String` payload if generation fails mid-stream
///
/// Returns immediately with `Ok(())` after spawning the blocking generation thread.
/// The frontend should listen for `local:done` / `local:error` to know when it ends.
///
/// `thinking_enabled` is forwarded to the chat template renderer.  Pass `Some(false)`
/// to disable the reasoning block on GLM-4 and similar thinking-capable models.
///
/// # Errors
/// Returns an error synchronously only if no model is loaded.
#[tauri::command]
pub async fn cmd_local_inference_stream(
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    thinking_enabled: Option<bool>,
    state: State<'_, ModelManagerState>,
    app_state: State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<(), String> {
    // Snapshot the model, config, and info — releasing the lock before blocking.
    let (model, model_info, gen_config) = {
        let manager = state.0.read().await;
        let model = manager
            .model
            .clone()
            .ok_or_else(|| ModelError::ModelNotLoaded.to_string())?;
        let model_info = manager
            .model_info
            .clone()
            .ok_or_else(|| ModelError::ModelNotLoaded.to_string())?;
        let gen_config = manager.generation_config.clone();
        (model, model_info, gen_config)
    };

    // Share the existing chat_cancel flag so Stop also halts local generation.
    let cancel = Arc::clone(&app_state.chat_cancel);

    // Run inference on the blocking thread pool (llama-cpp-2 is fully synchronous).
    tokio::task::spawn_blocking(move || {
        let result = crate::model_manager::inference::run_inference_stream(
            model,
            &model_info,
            &gen_config,
            &messages,
            system_prompt.as_deref(),
            thinking_enabled,
            cancel,
            &app,
            None,
        );

        if let Err(e) = result {
            use tauri::Emitter;
            let _ = app.emit("local:error", e.to_string());
        }
    });

    Ok(())
}

/// Get comprehensive system resources information.
///
/// Returns detailed information about:
/// - CPU (name, cores, architecture)
/// - Memory (total, available, used, usage percent)
/// - GPUs (name, type, VRAM, driver status)
/// - NPUs (name, type, driver status)
/// - Driver availability (CUDA, Vulkan, ROCm, Metal)
#[tauri::command]
pub fn cmd_get_system_resources() -> Result<SystemResources, String> {
    Ok(get_system_resources())
}

/// Get real-time system utilization information.
///
/// Returns:
/// - CPU utilization (%)
/// - Memory utilization (%)
/// - GPU utilization and memory use (when available)
#[tauri::command]
pub fn cmd_get_system_usage() -> Result<SystemUsage, String> {
    Ok(get_system_usage())
}

/// Get mounted disks/volumes and storage capacity data.
#[tauri::command]
pub fn cmd_get_storage_devices() -> Result<Vec<StorageDevice>, String> {
    Ok(get_storage_devices())
}

/// Display/monitor metadata from native windowing APIs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

/// Get native display list for accurate monitor detection.
#[tauri::command]
pub fn cmd_get_display_info(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let primary_sig = primary.as_ref().map(|m| {
        (
            m.size().width,
            m.size().height,
            m.position().x,
            m.position().y,
            m.scale_factor(),
        )
    });

    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .into_iter()
        .map(|m| {
            let sig = (
                m.size().width,
                m.size().height,
                m.position().x,
                m.position().y,
                m.scale_factor(),
            );
            DisplayInfo {
                name: m.name().cloned(),
                width: m.size().width,
                height: m.size().height,
                scale_factor: m.scale_factor(),
                x: m.position().x,
                y: m.position().y,
                is_primary: primary_sig.map(|p| p == sig).unwrap_or(false),
            }
        })
        .collect())
}

/// Get compact OS/system/CPU/user identity metadata.
#[tauri::command]
pub fn cmd_get_system_identity() -> Result<SystemIdentity, String> {
    Ok(get_system_identity())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralDevice {
    pub name: String,
    pub kind: String,
}

/// Get connected non-audio input peripherals (keyboard/mouse where detectable).
#[tauri::command]
pub fn cmd_get_peripheral_devices() -> Result<Vec<PeripheralDevice>, String> {
    #[cfg(target_os = "linux")]
    {
        let content = std::fs::read_to_string("/proc/bus/input/devices")
            .map_err(|e| format!("Failed to read input devices: {}", e))?;

        let mut out: Vec<PeripheralDevice> = Vec::new();

        for block in content.split("\n\n") {
            let mut name: Option<String> = None;
            let mut handlers: Option<String> = None;

            for line in block.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("N: Name=") {
                    let n = rest.trim().trim_matches('"').to_string();
                    if !n.is_empty() {
                        name = Some(n);
                    }
                } else if let Some(rest) = trimmed.strip_prefix("H: Handlers=") {
                    handlers = Some(rest.trim().to_lowercase());
                }
            }

            let Some(device_name) = name else { continue };
            let handlers = handlers.unwrap_or_default();

            let kind = if handlers.contains("kbd") {
                "keyboard"
            } else if handlers.contains("mouse") {
                "mouse"
            } else if handlers.contains("event") {
                "input"
            } else {
                continue;
            };

            out.push(PeripheralDevice {
                name: device_name,
                kind: kind.to_string(),
            });
        }

        let video_root = std::path::Path::new("/sys/class/video4linux");
        if video_root.exists() {
            if let Ok(entries) = std::fs::read_dir(video_root) {
                for entry in entries.flatten() {
                    let node = entry.file_name().to_string_lossy().to_string();
                    let label = std::fs::read_to_string(entry.path().join("name"))
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| node.clone());
                    out.push(PeripheralDevice {
                        name: format!("{} ({})", label, node),
                        kind: "video".to_string(),
                    });
                }
            }
        }

        out.sort_by(|a, b| {
            let rank = |kind: &str| match kind {
                "keyboard" => 0,
                "mouse" => 1,
                "video" => 2,
                _ => 3,
            };
            rank(&a.kind)
                .cmp(&rank(&b.kind))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        out.dedup_by(|a, b| a.kind == b.kind && a.name.eq_ignore_ascii_case(&b.name));
        return Ok(out);
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(Vec::new())
    }
}

/// List available GGUF models in the models directory.
///
/// Scans the application's models directory for .gguf files and returns
/// basic file information (name, path, size). Does not read model metadata.
#[tauri::command]
pub async fn cmd_list_available_models(app: AppHandle) -> Result<Vec<AvailableModel>, String> {
    use std::path::PathBuf;

    // Get the models directory path
    let models_dir: PathBuf = app
        .path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Create directory if it doesn't exist
    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
        return Ok(Vec::new());
    }

    // Scan for .gguf files
    let mut models = Vec::new();
    let entries = std::fs::read_dir(&models_dir)
        .map_err(|e| format!("Failed to read models directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "gguf").unwrap_or(false) {
            if let Ok(metadata) = entry.metadata() {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Unknown".to_string());

                models.push(AvailableModel {
                    name,
                    path: path.to_string_lossy().to_string(),
                    size_mb: metadata.len() / (1024 * 1024),
                    modified_ms: metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0),
                });
            }
        }
    }

    // Sort newest first, then by name for stable ordering
    models.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(models)
}

#[tauri::command]
pub async fn cmd_delete_available_model(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let base = models_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve models directory: {}", e))?;
    let candidate =
        std::path::PathBuf::from(&path).canonicalize().map_err(|e| format!("Invalid path: {}", e))?;

    if !candidate.starts_with(&base) {
        return Err("Refusing to delete file outside models directory".to_string());
    }
    if candidate
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("gguf"))
        != Some(true)
    {
        return Err("Only .gguf files can be deleted".to_string());
    }

    let in_use = state
        .local_server
        .lock()
        .map_err(|_| "Failed to read local runtime state".to_string())?
        .as_ref()
        .map(|h| {
            std::path::PathBuf::from(&h.model_path)
                .canonicalize()
                .map(|p| p == candidate)
                .unwrap_or_else(|_| h.model_path == path)
        })
        .unwrap_or(false);
    if in_use {
        return Err("Cannot delete the currently loaded model".to_string());
    }

    std::fs::remove_file(&candidate).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(())
}

/// Get the path to the models directory.
/// Returns the path as a string for use in the frontend.
#[tauri::command]
pub fn cmd_get_models_dir(app: AppHandle) -> Result<String, String> {
    let models_dir: std::path::PathBuf = app
        .path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Create directory if it doesn't exist
    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    Ok(models_dir.to_string_lossy().to_string())
}

/// Open the models directory in the system file manager.
#[tauri::command]
pub async fn cmd_open_models_folder(app: AppHandle) -> Result<(), String> {
    let models_dir: std::path::PathBuf = app
        .path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Create directory if it doesn't exist
    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    // Open in file manager using the `open` crate
    open::that(&models_dir).map_err(|e| format!("Failed to open models folder: {}", e))?;

    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
struct HfSearchItem {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct HfModelDetail {
    siblings: Option<Vec<HfSibling>>,
}

#[derive(Debug, Clone, Deserialize)]
struct HfSibling {
    rfilename: String,
    size: Option<u64>,
}

fn score_gguf_filename(name: &str) -> i32 {
    let n = name.to_ascii_lowercase();
    let mut score = 0i32;
    if n.ends_with(".gguf") {
        score += 100;
    } else {
        return -1;
    }
    if n.contains("q4_k_m") {
        score += 60;
    }
    if n.contains("q4_k_s") {
        score += 55;
    }
    if n.contains("iq4") {
        score += 50;
    }
    if n.contains("q5_k_m") {
        score += 45;
    }
    if n.contains("q5_k_s") {
        score += 40;
    }
    if n.contains("q4_0") || n.contains("q4_1") {
        score += 30;
    }
    if n.contains("q8") || n.contains("f16") || n.contains("f32") {
        score -= 40;
    }
    if n.contains("imatrix") || n.contains("instruct-awq") {
        score -= 10;
    }
    if n.contains("mmproj") || n.contains("vision-proj") || n.contains("clip") {
        score -= 80;
    }
    score
}

fn sanitize_filename(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "model.gguf".to_string()
    } else {
        out
    }
}

/// Search Hugging Face for a matching GGUF model and download it into app_data/models.
///
/// This is intentionally "best effort": it picks the highest-scoring GGUF candidate
/// across the top search results, preferring practical quantizations like Q4_K_M.
#[tauri::command]
pub async fn cmd_download_model_from_hf_query(
    app: AppHandle,
    query: String,
) -> Result<AvailableModel, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("query is empty".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("arx-model-downloader/0.8")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let search_url = "https://huggingface.co/api/models";
    let search_results: Vec<HfSearchItem> = client
        .get(search_url)
        .query(&[("search", q), ("limit", "12"), ("full", "false")])
        .send()
        .await
        .map_err(|e| format!("HF search failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("HF search HTTP error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("HF search parse failed: {e}"))?;

    if search_results.is_empty() {
        return Err(format!("No Hugging Face model matches query '{q}'"));
    }

    let mut best_repo = String::new();
    let mut best_file = String::new();
    let mut best_score = i32::MIN;
    let mut best_size = u64::MAX;

    for item in search_results.iter().take(12) {
        let detail_url = format!("https://huggingface.co/api/models/{}", item.id);
        let detail = match client.get(&detail_url).send().await {
            Ok(resp) => match resp.error_for_status() {
                Ok(ok) => match ok.json::<HfModelDetail>().await {
                    Ok(parsed) => parsed,
                    Err(_) => continue,
                },
                Err(_) => continue,
            },
            Err(_) => continue,
        };

        let siblings = match detail.siblings {
            Some(s) => s,
            None => continue,
        };

        for sib in siblings {
            let file = sib.rfilename;
            if !file.to_ascii_lowercase().ends_with(".gguf") {
                continue;
            }
            let score = score_gguf_filename(&file);
            if score < 0 {
                continue;
            }
            let size = sib.size.unwrap_or(u64::MAX);
            let better = score > best_score || (score == best_score && size < best_size);
            if better {
                best_score = score;
                best_repo = item.id.clone();
                best_file = file;
                best_size = size;
            }
        }
    }

    if best_repo.is_empty() || best_file.is_empty() {
        return Err(format!("No downloadable GGUF found for '{q}'"));
    }

    let models_dir: std::path::PathBuf = app
        .path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    let file_name = sanitize_filename(
        std::path::Path::new(&best_file)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("model.gguf"),
    );
    let final_path = models_dir.join(file_name);
    let temp_path = final_path.with_extension("gguf.part");

    // Skip network transfer if file already exists.
    if !final_path.exists() {
        let download_url = format!(
            "https://huggingface.co/{}/resolve/main/{}?download=true",
            best_repo, best_file
        );

        let resp = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| format!("Model download failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Model download HTTP error: {e}"))?;

        let mut file = tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| format!("Failed to create temp file: {e}"))?;

        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("Download stream error: {e}"))?;
            tokio::io::AsyncWriteExt::write_all(&mut file, &bytes)
                .await
                .map_err(|e| format!("Failed writing model file: {e}"))?;
        }
        tokio::io::AsyncWriteExt::flush(&mut file)
            .await
            .map_err(|e| format!("Failed flushing model file: {e}"))?;

        std::fs::rename(&temp_path, &final_path)
            .map_err(|e| format!("Failed to finalize model file: {e}"))?;
    }

    let metadata = std::fs::metadata(&final_path)
        .map_err(|e| format!("Failed to stat downloaded model: {e}"))?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Ok(AvailableModel {
        name: final_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Unknown.gguf".to_string()),
        path: final_path.to_string_lossy().to_string(),
        size_mb: metadata.len() / (1024 * 1024),
        modified_ms,
    })
}

/// Download a specific model asset from a fixed Hugging Face repo.
///
/// If `file_name` exists exactly, it is used. Otherwise, the command falls
/// back to a deterministic "best match" in that same repo.
#[tauri::command]
pub async fn cmd_download_model_from_hf_asset(
    app: AppHandle,
    repo_id: String,
    file_name: String,
) -> Result<AvailableModel, String> {
    let repo = repo_id.trim();
    if repo.is_empty() {
        return Err("repo_id is empty".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("arx-model-downloader/0.8")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let detail_url = format!("https://huggingface.co/api/models/{}", repo);
    let detail: HfModelDetail = client
        .get(&detail_url)
        .send()
        .await
        .map_err(|e| format!("HF repo lookup failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("HF repo lookup HTTP error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("HF repo parse failed: {e}"))?;

    let siblings = detail
        .siblings
        .ok_or_else(|| format!("No files listed for repo '{repo}'"))?;

    let requested = file_name.trim();
    let requested_lower = requested.to_ascii_lowercase();
    let mut chosen = siblings
        .iter()
        .find(|s| s.rfilename.eq_ignore_ascii_case(requested))
        .map(|s| s.rfilename.clone());

    if chosen.is_none() && !requested_lower.is_empty() {
        chosen = siblings
            .iter()
            .find(|s| s.rfilename.to_ascii_lowercase().contains(&requested_lower))
            .map(|s| s.rfilename.clone());
    }

    if chosen.is_none() {
        let mut best: Option<(String, i32, u64)> = None;
        for s in &siblings {
            let score = score_gguf_filename(&s.rfilename);
            if score < 0 {
                continue;
            }
            let size = s.size.unwrap_or(u64::MAX);
            match &best {
                Some((_, cur_score, cur_size))
                    if *cur_score > score || (*cur_score == score && *cur_size <= size) => {}
                _ => best = Some((s.rfilename.clone(), score, size)),
            }
        }
        chosen = best.map(|x| x.0);
    }

    let chosen_file = chosen.ok_or_else(|| {
        if requested.is_empty() {
            format!("No GGUF file found in repo '{repo}'")
        } else {
            format!("Requested file '{requested}' not found and no GGUF fallback exists in repo '{repo}'")
        }
    })?;

    let models_dir: std::path::PathBuf = app
        .path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    let local_name = sanitize_filename(
        std::path::Path::new(&chosen_file)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("model.gguf"),
    );
    let final_path = models_dir.join(local_name);
    let temp_path = final_path.with_extension("gguf.part");

    if !final_path.exists() {
        let download_url = format!(
            "https://huggingface.co/{}/resolve/main/{}?download=true",
            repo, chosen_file
        );
        let resp = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| format!("Model download failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Model download HTTP error: {e}"))?;

        let mut file = tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| format!("Failed to create temp file: {e}"))?;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("Download stream error: {e}"))?;
            tokio::io::AsyncWriteExt::write_all(&mut file, &bytes)
                .await
                .map_err(|e| format!("Failed writing model file: {e}"))?;
        }
        tokio::io::AsyncWriteExt::flush(&mut file)
            .await
            .map_err(|e| format!("Failed flushing model file: {e}"))?;
        std::fs::rename(&temp_path, &final_path)
            .map_err(|e| format!("Failed to finalize model file: {e}"))?;
    }

    let metadata = std::fs::metadata(&final_path)
        .map_err(|e| format!("Failed to stat downloaded model: {e}"))?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Ok(AvailableModel {
        name: final_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Unknown.gguf".to_string()),
        path: final_path.to_string_lossy().to_string(),
        size_mb: metadata.len() / (1024 * 1024),
        modified_ms,
    })
}

/// Get runtime status including available inference engines.
///
/// Returns information about compatible inference engines for this system,
/// including which ones are available, recommended, and any warnings.
#[tauri::command]
pub fn cmd_get_runtime_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RuntimeStatus, String> {
    let engines_dir = app.path().app_data_dir().ok().map(|p| p.join("engines"));
    let mut status = get_runtime_status(engines_dir.as_deref());
    let running_engine = state
        .local_server
        .lock()
        .ok()
        .and_then(|s| s.as_ref().map(|h| h.engine_id.clone()));

    if let Some(engine_id) = running_engine {
        status.active_engine = Some(engine_id);
    } else if status.active_engine.is_none() {
        status.active_engine = status
            .engines
            .iter()
            .find(|e| e.is_available && e.backend != "cpu")
            .or_else(|| status.engines.iter().find(|e| e.is_available))
            .map(|e| e.id.clone());
    }
    Ok(status)
}

/// Download and install a llama.cpp inference engine binary from GitHub releases.
///
/// The appropriate binary is selected automatically based on the engine ID,
/// operating system, and CPU architecture.
///
/// Emits `engine:install_progress` events throughout installation.
#[tauri::command]
pub async fn cmd_install_runtime_engine(
    engine_id: String,
    app: AppHandle,
) -> Result<EngineInstallResult, String> {
    let start_msg = format!("[runtime] install requested for {}", engine_id);
    crate::commands::logs::info(&start_msg);
    log::info!("{}", start_msg);

    let engines_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.join("engines"))
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    let result =
        crate::model_manager::engine_installer::install_engine(&engine_id, &engines_dir, &app)
            .await;
    match &result {
        Ok(ok) => {
            let msg = format!(
                "[runtime] install completed for {}: {} ({})",
                ok.engine_id, ok.binary_path, ok.version
            );
            crate::commands::logs::info(&msg);
            log::info!("{}", msg);
        }
        Err(err) => {
            let msg = format!("[runtime] install failed for {}: {}", engine_id, err);
            crate::commands::logs::error(&msg);
            log::error!("{}", msg);
        }
    }
    result
}

/// Information about an available model file
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    /// Model file name
    pub name: String,
    /// Full path to the model file
    pub path: String,
    /// File size in megabytes
    pub size_mb: u64,
    /// Last modified timestamp (Unix ms)
    pub modified_ms: i64,
}
