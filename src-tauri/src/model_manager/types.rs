//! Model manager types for GGUF local model support
//!
//! This module contains all types needed for model metadata inspection,
//! loading, and device management.

use serde::{Deserialize, Serialize};

/// Metadata extracted from a GGUF model file header.
///
/// This struct is populated by reading ONLY the GGUF file metadata keys.
/// No model weights are loaded into memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// Display name from model metadata or filename fallback
    pub name: String,
    /// Model family: "llama", "mistral", "phi3", "gemma", "qwen", etc.
    pub architecture: String,
    /// Maximum number of tokens the model can process in one context
    pub context_length: u32,
    /// Number of tokens in the model vocabulary
    pub vocab_size: u32,
    /// Raw Jinja2 chat template string if present in model metadata
    pub chat_template: Option<String>,
    /// Beginning-of-sequence token string
    pub bos_token: Option<String>,
    /// End-of-sequence token string
    pub eos_token: Option<String>,
    /// Roles supported by this model's chat template
    /// Typically: ["system", "user", "assistant"]
    pub supported_roles: Vec<String>,
    /// Quantization level: "Q4_K_M", "Q8_0", "F16", "IQ4_XS", etc.
    pub quantization: Option<String>,
    /// Total parameter count if available in metadata
    pub parameter_count: Option<u64>,
    /// Model file size in megabytes
    pub file_size_mb: Option<u64>,
    /// Whether this model supports a thinking / extended-reasoning mode.
    /// True for GLM-4 and similar models whose chat template gates reasoning
    /// behind an `enable_thinking` Jinja2 variable.
    pub supports_thinking: bool,
}

/// Configuration for loading a model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelLoadConfig {
    /// Path to the GGUF model file
    pub path: String,
    /// Source type for the model
    pub source: ModelSource,

    // === Context and Memory Settings ===
    /// Override context length (None = use model default)
    pub context_override: Option<u32>,
    /// Batch size for prompt processing (default: 512)
    pub batch_size: Option<u32>,
    /// Physical batch size for GPU (ubatch, default: 128)
    pub ubatch_size: Option<u32>,

    // === GPU Offload Settings ===
    /// Number of layers to offload to GPU (None = auto-detect based on device)
    /// Set to 0 for CPU-only, -1 or 999 for all layers
    pub n_gpu_layers: Option<i32>,
    /// Split model across multiple GPUs (for multi-GPU setups)
    pub tensor_split: Option<Vec<f32>>,
    /// Main GPU for multi-GPU setups (default: 0)
    pub main_gpu: Option<i32>,
    /// Use memory mapping for faster loading (default: true)
    pub use_mmap: Option<bool>,
    /// Use memory locking to prevent swapping (default: false)
    pub use_mlock: Option<bool>,

    // === CPU Settings ===
    /// Number of CPU threads (None = auto-detect based on cores)
    pub n_threads: Option<u32>,
    /// Number of threads for batch processing (None = same as n_threads)
    pub n_threads_batch: Option<u32>,
    /// Enable flash-attention kernels when supported
    pub flash_attn: Option<bool>,
    /// KV cache type for keys (e.g. f16, q8_0, q4_0)
    pub cache_type_k: Option<String>,
    /// KV cache type for values (e.g. f16, q8_0, q4_0)
    pub cache_type_v: Option<String>,
    /// CPU priority level (0 = normal, 1 = high, -1 = low)
    pub priority: Option<i32>,

    // === RoPE (Rotary Position Embeddings) Settings ===
    /// RoPE frequency base (default: model-specific, usually 10000.0)
    pub rope_freq_base: Option<f32>,
    /// RoPE frequency scale (default: 1.0, use < 1.0 for extended context)
    pub rope_freq_scale: Option<f32>,
    /// RoPE scaling type: "none", "linear", "yarn"
    pub rope_scaling_type: Option<String>,
    /// YaRN extrapolation mix factor (for YaRN scaling)
    pub yarn_ext_factor: Option<f32>,
    /// YaRN attention factor
    pub yarn_attn_factor: Option<f32>,
    /// YaRN beta fast factor
    pub yarn_beta_fast: Option<f32>,
    /// YaRN beta slow factor
    pub yarn_beta_slow: Option<f32>,

    // === Device Selection ===
    /// Device ID to use from enumerate_devices (None = auto-select)
    pub device_override: Option<String>,

    // === Advanced Settings ===
    /// Embedding mode only (no text generation)
    pub embedding_only: Option<bool>,
    /// Split-mode for multi-GPU: "none", "layer", "row"
    pub split_mode: Option<String>,
}

impl Default for ModelLoadConfig {
    fn default() -> Self {
        Self {
            path: String::new(),
            source: ModelSource::LocalGguf,
            context_override: None,
            batch_size: Some(512),
            ubatch_size: Some(128),
            n_gpu_layers: Some(-1), // All layers to GPU by default
            tensor_split: None,
            main_gpu: None,
            use_mmap: Some(true),
            use_mlock: Some(false),
            n_threads: None,
            n_threads_batch: None,
            flash_attn: Some(false),
            cache_type_k: None,
            cache_type_v: None,
            priority: None,
            rope_freq_base: None,
            rope_freq_scale: None,
            rope_scaling_type: None,
            yarn_ext_factor: None,
            yarn_attn_factor: None,
            yarn_beta_fast: None,
            yarn_beta_slow: None,
            device_override: None,
            embedding_only: Some(false),
            split_mode: None,
        }
    }
}

/// Source type for model loading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelSource {
    /// Local GGUF file on disk
    LocalGguf,
    // HuggingFace variant intentionally omitted until desktop-only phase
}

/// Progress event emitted during model loading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelLoadProgress {
    /// Current stage: "reading_metadata", "allocating_device", "loading_weights", "ready"
    pub stage: String,
    /// Progress percentage 0.0 - 100.0
    pub percentage: f32,
    /// Human-readable message
    pub message: String,
}

/// Information about a compute device (CPU or GPU)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    /// Unique device identifier (e.g., "cpu", "cuda:0", "metal:0", "vulkan:0")
    pub id: String,
    /// Device type: "cpu", "cuda", "metal", "rocm", "vulkan"
    pub device_type: String,
    /// Human-readable device name
    pub name: String,
    /// Available VRAM in megabytes (None for CPU)
    pub vram_mb: Option<u64>,
    /// Whether this device is currently selected for use
    pub is_selected: bool,
    /// Whether this device is available for use
    pub is_available: bool,
}

/// Errors that can occur during model operations
#[derive(Debug, Serialize, Deserialize)]
pub enum ModelError {
    /// The specified file path does not exist
    FileNotFound(String),
    /// The file is not a valid GGUF format
    UnsupportedFormat(String),
    /// The model architecture is not supported
    UnsupportedArchitecture(String),
    /// I/O error reading the file
    IoError(String),
    /// Error from GGUF parsing
    GgufError(String),
    /// Insufficient memory to load model
    InsufficientMemory { needed_mb: u64, available_mb: u64 },
    /// The requested device is not available
    DeviceNotAvailable(String),
    /// No model is currently loaded
    ModelNotLoaded,
    /// Error from llama.cpp
    LlamaCppError(String),
}

impl std::fmt::Display for ModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModelError::FileNotFound(path) => write!(f, "File not found: {}", path),
            ModelError::UnsupportedFormat(msg) => write!(f, "Unsupported format: {}", msg),
            ModelError::UnsupportedArchitecture(arch) => {
                write!(f, "Unsupported architecture: {}", arch)
            }
            ModelError::IoError(msg) => write!(f, "I/O error: {}", msg),
            ModelError::GgufError(msg) => write!(f, "GGUF error: {}", msg),
            ModelError::InsufficientMemory {
                needed_mb,
                available_mb,
            } => {
                write!(
                    f,
                    "Insufficient memory: needed {} MB, available {} MB",
                    needed_mb, available_mb
                )
            }
            ModelError::DeviceNotAvailable(device) => write!(f, "Device not available: {}", device),
            ModelError::ModelNotLoaded => write!(f, "No model is currently loaded"),
            ModelError::LlamaCppError(msg) => write!(f, "llama.cpp error: {}", msg),
        }
    }
}

impl From<ModelError> for String {
    fn from(err: ModelError) -> Self {
        err.to_string()
    }
}

impl From<std::io::Error> for ModelError {
    fn from(err: std::io::Error) -> Self {
        ModelError::IoError(err.to_string())
    }
}

/// A chat message for tokenization and template rendering
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// Role: "system", "user", or "assistant"
    pub role: String,
    /// Message content
    pub content: String,
}

/// Token count result with detailed breakdown
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCount {
    /// Total tokens in the conversation
    pub total: u32,
    /// Tokens used by system prompt
    pub system_tokens: u32,
    /// Tokens used by messages (excluding system)
    pub message_tokens: u32,
    /// Remaining tokens before hitting safety margin
    pub remaining_budget: u32,
    /// Percentage of context used (0-100)
    pub percentage_used: f32,
    /// True if usage exceeds 80%
    pub is_near_limit: bool,
    /// True if usage exceeds 100%
    pub is_over_limit: bool,
}

/// Result of checking if tokens fit in context
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContextFitResult {
    /// Usage is under 80% - plenty of room
    Fits { remaining: u32 },
    /// Usage is 80-99% - approaching limit
    NearLimit {
        remaining: u32,
        percentage_used: f32,
    },
    /// Usage is at or over 100% - exceeds context
    Exceeds { overflow_by: u32 },
}

/// Complete state of the model serving system.
///
/// This is the single source of truth for UI state, returned by `get_serve_state`.
/// Contains everything the frontend needs to display model status and generation settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeState {
    /// Whether a model is currently loaded and ready for inference
    pub is_loaded: bool,
    /// Information about the loaded model, if any
    pub model_info: Option<ModelInfo>,
    /// The device currently being used for inference
    pub active_device: Option<DeviceInfo>,
    /// Active inference endpoint URL (includes host + port), if known
    pub inference_endpoint: Option<String>,
    /// Active context window in tokens (queried from running server when available)
    pub active_context_length: Option<u32>,
    /// Current generation configuration (always available, even before model load)
    pub generation_config: crate::model_manager::GenerationConfig,
}
