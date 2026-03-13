//! Model manager module for local LLM support
//!
//! This module provides functionality for:
//! - GGUF model metadata inspection (without loading weights)
//! - Model loading and inference via llama.cpp
//! - Device enumeration and selection
//! - State management for loaded models
//! - Token counting and chat template rendering
//! - Generation configuration management

pub mod config;
pub mod engine_installer;
pub mod inference;
pub mod loader;
pub mod metadata;
pub mod resources;
pub mod system_info;
pub mod tokenizer;
pub mod types;

#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
use std::sync::Arc;
use tokio::sync::RwLock;

// Public re-exports for convenience
pub use config::GenerationConfig;
pub use engine_installer::{EngineInstallProgress, EngineInstallResult};
pub use loader::load_model;
pub use metadata::peek_model_metadata;
pub use resources::enumerate_devices;
#[allow(unused_imports)]
pub use tokenizer::{
    check_fits_in_context, count_message_tokens, count_tokens, get_context_budget,
    render_chat_template,
};
pub use types::{
    ChatMessage, ContextFitResult, DeviceInfo, ModelError, ModelInfo, ModelLoadConfig,
    ModelLoadProgress, ModelSource, ServeState, TokenCount,
};

/// Model holder that works with or without llama-cpp-2 feature
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
pub struct ModelHolder {
    pub model: Option<Arc<llama_cpp_2::model::LlamaModel>>,
    pub model_info: Option<ModelInfo>,
    pub selected_device: Option<DeviceInfo>,
    /// Generation config persists across load/unload cycles
    pub generation_config: GenerationConfig,
}

#[cfg(not(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
)))]
pub struct ModelHolder {
    /// Placeholder Arc — matches ModelRef type alias in inference.rs so the
    /// command handler compiles without cfg guards.
    pub model: Option<std::sync::Arc<()>>,
    pub model_info: Option<ModelInfo>,
    pub selected_device: Option<DeviceInfo>,
    /// Generation config persists across load/unload cycles
    pub generation_config: GenerationConfig,
}

impl ModelHolder {
    /// Create a new empty model holder
    pub fn new() -> Self {
        Self {
            model: None,
            model_info: None,
            selected_device: None,
            generation_config: GenerationConfig::default(),
        }
    }

    /// Check if a model is currently loaded
    pub fn is_loaded(&self) -> bool {
        self.model_info.is_some()
    }

    /// Get the loaded model's info, if any
    pub fn get_info(&self) -> Option<&ModelInfo> {
        self.model_info.as_ref()
    }

    /// Clear the loaded model (preserves generation_config)
    pub fn clear(&mut self) {
        self.model = None;
        self.model_info = None;
        self.selected_device = None;
        // Note: generation_config is NOT reset - it persists across load/unload
    }
}

impl Default for ModelHolder {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe state wrapper for ModelManager
pub struct ModelManagerState(pub RwLock<ModelHolder>);

impl ModelManagerState {
    /// Create a new ModelManagerState
    pub fn new() -> Self {
        Self(RwLock::new(ModelHolder::new()))
    }
}

impl Default for ModelManagerState {
    fn default() -> Self {
        Self::new()
    }
}
