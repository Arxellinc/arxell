//! Model loading with progress events
//!
//! This module provides functionality to load GGUF models into memory
//! with progress events emitted throughout the loading process.

use std::path::Path;
use tauri::{AppHandle, Emitter};

use super::metadata::peek_model_metadata;
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
use super::resources::enumerate_devices;
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
use super::types::DeviceInfo;
use super::types::{ModelError, ModelInfo, ModelLoadConfig, ModelLoadProgress};

/// Load a GGUF model into memory for inference.
///
/// This function:
/// 1. Validates the file path and extension
/// 2. Reads model metadata (lightweight operation)
/// 3. Loads the model into GPU/CPU memory
/// 4. Emits progress events throughout
///
/// # Progress Events
/// Emits `model:load_progress` events with stages:
/// - "reading_metadata" (10%)
/// - "allocating_device" (30%)
/// - "loading_weights" (60-90%)
/// - "ready" (100%)
///
/// # Returns
/// Returns a tuple of (LlamaModel, ModelInfo) when GPU features are enabled,
/// or ((), ModelInfo) when no GPU backend is available.
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
pub async fn load_model(
    config: &ModelLoadConfig,
    app: &AppHandle,
) -> Result<(llama_cpp_2::model::LlamaModel, ModelInfo), ModelError> {
    let path = Path::new(&config.path);

    // Validate path exists
    if !path.exists() {
        return Err(ModelError::FileNotFound(config.path.clone()));
    }

    // Check file extension
    if path.extension().map(|e| e != "gguf").unwrap_or(true) {
        return Err(ModelError::UnsupportedFormat(
            "File must have .gguf extension".to_string(),
        ));
    }

    // Stage 1: Reading metadata (10%)
    emit_progress(app, "reading_metadata", 10.0, "Reading model metadata")?;

    let model_info = peek_model_metadata(path).await?;

    // Stage 2: Allocating device (30%)
    emit_progress(
        app,
        "allocating_device",
        30.0,
        "Preparing device for model loading",
    )?;

    // Determine which device to use
    let devices = enumerate_devices();
    let selected_device = select_device(&devices, &config.device_override);

    // Stage 3: Loading weights (60-90%)
    emit_progress(
        app,
        "loading_weights",
        60.0,
        "Loading model weights into memory",
    )?;

    // Load model using llama-cpp-2 with full configuration
    let model = load_model_with_llama_cpp(path, &selected_device, config, app).await?;

    // Stage 4: Ready (100%)
    emit_progress(app, "ready", 100.0, "Model loaded successfully")?;

    Ok((model, model_info))
}

#[cfg(not(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
)))]
pub async fn load_model(
    config: &ModelLoadConfig,
    app: &AppHandle,
) -> Result<((), ModelInfo), ModelError> {
    let path = Path::new(&config.path);

    // Validate path exists
    if !path.exists() {
        return Err(ModelError::FileNotFound(config.path.clone()));
    }

    // Check file extension
    if path.extension().map(|e| e != "gguf").unwrap_or(true) {
        return Err(ModelError::UnsupportedFormat(
            "File must have .gguf extension".to_string(),
        ));
    }

    // Stage 1: Reading metadata (10%)
    emit_progress(app, "reading_metadata", 10.0, "Reading model metadata")?;

    let model_info = peek_model_metadata(path).await?;

    // Stage 2: No GPU backend available (30%)
    emit_progress(
        app,
        "allocating_device",
        30.0,
        "No GPU backend compiled - metadata only",
    )?;

    // Stage 3: Skip weight loading (60%)
    emit_progress(
        app,
        "loading_weights",
        60.0,
        "Skipping weight loading - no GPU backend",
    )?;

    // Stage 4: Ready (100%)
    emit_progress(
        app,
        "ready",
        100.0,
        "Metadata loaded (no inference backend)",
    )?;

    Ok(((), model_info))
}

/// Emit a progress event to the frontend
fn emit_progress(
    app: &AppHandle,
    stage: &str,
    percentage: f32,
    message: &str,
) -> Result<(), ModelError> {
    app.emit(
        "model:load_progress",
        ModelLoadProgress {
            stage: stage.to_string(),
            percentage,
            message: message.to_string(),
        },
    )
    .map_err(|e| ModelError::LlamaCppError(format!("Failed to emit progress: {}", e)))?;
    Ok(())
}

/// Select the best device for model loading
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
fn select_device(devices: &[DeviceInfo], device_override: &Option<String>) -> DeviceInfo {
    // If a specific device is requested, find it
    if let Some(ref device_id) = *device_override {
        if let Some(device) = devices.iter().find(|d| &d.id == device_id) {
            return device.clone();
        }
    }

    // Otherwise, use the auto-selected device
    devices
        .iter()
        .find(|d| d.is_selected)
        .cloned()
        .unwrap_or_else(|| DeviceInfo {
            id: "cpu".to_string(),
            device_type: "cpu".to_string(),
            name: "CPU".to_string(),
            vram_mb: None,
            is_selected: true,
            is_available: true,
        })
}

/// Load model using llama-cpp-2 with full configuration support
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
async fn load_model_with_llama_cpp(
    path: &Path,
    device: &DeviceInfo,
    config: &ModelLoadConfig,
    app: &AppHandle,
) -> Result<llama_cpp_2::model::LlamaModel, ModelError> {
    use llama_cpp_2::model::LlamaModel;

    // Determine number of GPU layers:
    // - If explicitly set in config, use that
    // - If device is CPU, use 0
    // - Otherwise, offload all layers (999)
    let n_gpu_layers =
        config
            .n_gpu_layers
            .unwrap_or_else(|| if device.device_type == "cpu" { 0 } else { 999 });

    // Update progress
    emit_progress(app, "loading_weights", 70.0, "Initializing model loader")?;

    // Load the model in a blocking task since llama.cpp is synchronous.
    // We reuse the same process-scoped backend as inference.rs so that
    // llama_backend_init/free are only called once per process lifetime.
    let path_buf = path.to_path_buf();
    let vram_mb = device.vram_mb.unwrap_or(0);

    // Clone model-level config values for the blocking task.
    // Note: context-level params (n_ctx, n_threads, n_batch) are applied at
    // context creation time in inference.rs, not at model load time.
    let use_mmap = config.use_mmap.unwrap_or(true);
    let use_mlock = config.use_mlock.unwrap_or(false);

    let result = tokio::task::spawn_blocking(move || -> Result<LlamaModel, ModelError> {
        // Reuse (or lazily create) the global backend — identical OnceLock as in inference.rs.
        let backend = crate::model_manager::inference::get_global_backend()?;

        // Build model params with all configuration options.
        // Only model-level params belong here; context-level params go on LlamaContextParams.
        let params = llama_cpp_2::model::params::LlamaModelParams::default()
            .with_n_gpu_layers(n_gpu_layers)
            .with_use_mmap(use_mmap)
            .with_use_mlock(use_mlock);

        LlamaModel::load_from_file(backend, &path_buf, &params).map_err(|e| {
            let err_str = format!("{}", e);
            if err_str.to_lowercase().contains("oom")
                || err_str.contains("allocation failure")
                || err_str.contains("could not allocate")
            {
                ModelError::InsufficientMemory {
                    needed_mb: 0,
                    available_mb: vram_mb,
                }
            } else {
                ModelError::LlamaCppError(err_str)
            }
        })
    })
    .await;

    match result {
        Ok(Ok(model)) => {
            emit_progress(app, "loading_weights", 90.0, "Model weights loaded")?;
            Ok(model)
        }
        Ok(Err(e)) => Err(e),
        Err(e) => Err(ModelError::LlamaCppError(format!("Task join error: {}", e))),
    }
}
