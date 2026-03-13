/**
 * Model metadata types for local LLM support
 *
 * These types mirror the Rust types in src-tauri/src/model_manager/types.rs
 */

/**
 * Metadata extracted from a GGUF model file header.
 *
 * This information is obtained by reading ONLY the GGUF file metadata keys.
 * No model weights are loaded into memory.
 */
export interface ModelInfo {
  /** Display name from model metadata or filename fallback */
  name: string

  /**
   * Model family/architecture
   * Common values: "llama", "mistral", "phi3", "gemma", "qwen", "starcoder2", "command-r"
   */
  architecture: string

  /**
   * Maximum number of tokens the model can process in one context window
   * Common values: 2048, 4096, 8192, 16384, 32768, 65536, 128000
   */
  contextLength: number

  /**
   * Number of tokens in the model vocabulary
   * Varies by tokenizer: Llama-2 (32000), Llama-3 (128000), etc.
   */
  vocabSize: number

  /**
   * Raw Jinja2 chat template string if present in model metadata
   * Used to format conversation turns for the model
   * null if not specified in the model
   */
  chatTemplate: string | null

  /**
   * Beginning-of-sequence token string
   * Example: "<|begin_of_text|>", "<s>", null if not specified
   */
  bosToken: string | null

  /**
   * End-of-sequence token string
   * Example: "<|end_of_text|>", "</s>", null if not specified
   */
  eosToken: string | null

  /**
   * Roles supported by this model's chat template
   * Typically: ["system", "user", "assistant"]
   * Some templates may only support ["user", "assistant"]
   */
  supportedRoles: string[]

  /**
   * Quantization level detected from filename or metadata
   * Common values:
   * - K-quant: "Q4_K_M", "Q4_K_S", "Q5_K_M", "Q5_K_S", "Q6_K", "Q8_0"
   * - Legacy: "Q4_0", "Q4_1", "Q5_0", "Q5_1"
   * - Importance matrix: "IQ4_XS", "IQ3_M", "IQ2_XXS"
   * - Unquantized: "F16", "F32", "BF16"
   * null if not detected
   */
  quantization: string | null

  /**
   * Total parameter count if available in metadata
   * Example: 7000000000 for a 7B model
   * null if not specified
   */
  parameterCount: number | null

  /**
   * Model file size in megabytes
   * Useful for estimating memory requirements
   */
  fileSizeMb: number | null

  /**
   * Whether this model supports thinking/reasoning mode
   * True for GLM-4 and similar models with extended reasoning capabilities
   */
  supportsThinking: boolean
}

/**
 * Error types that can occur during model metadata inspection
 *
 * Use discriminated union pattern for type-safe error handling:
 * ```typescript
 * if (error.type === 'FileNotFound') {
 *   console.log(`File not found: ${error.message}`)
 * }
 * ```
 */
export type ModelError =
  | { type: 'FileNotFound'; message: string }
  | { type: 'UnsupportedFormat'; message: string }
  | { type: 'UnsupportedArchitecture'; message: string }
  | { type: 'IoError'; message: string }
  | { type: 'GgufError'; message: string }
  | { type: 'InsufficientMemory'; neededMb: number; availableMb: number }
  | { type: 'DeviceNotAvailable'; device: string }
  | { type: 'ModelNotLoaded'; message: string }
  | { type: 'LlamaCppError'; message: string }

/**
 * A chat message for tokenization and template rendering
 */
export interface ChatMessage {
  /** Role: "system", "user", or "assistant" */
  role: 'system' | 'user' | 'assistant'
  /** Message content */
  content: string
}

/**
 * Token count result with detailed breakdown
 */
export interface TokenCount {
  /** Total tokens in the conversation */
  total: number
  /** Tokens used by system prompt */
  systemTokens: number
  /** Tokens used by messages (excluding system) */
  messageTokens: number
  /** Remaining tokens before hitting safety margin */
  remainingBudget: number
  /** Percentage of context used (0-100) */
  percentageUsed: number
  /** True if usage exceeds 80% */
  isNearLimit: boolean
  /** True if usage exceeds 100% */
  isOverLimit: boolean
}

/**
 * Result of checking if tokens fit in context
 */
export type ContextFitResult =
  | { type: 'Fits'; remaining: number }
  | { type: 'NearLimit'; remaining: number; percentageUsed: number }
  | { type: 'Exceeds'; overflowBy: number }

/**
 * Information about a compute device (CPU or GPU)
 */
export interface DeviceInfo {
  /** Unique device identifier (e.g., "cpu", "cuda:0", "metal:0", "vulkan:0") */
  id: string
  /** Device type: "cpu", "cuda", "metal", "rocm", "vulkan" */
  device_type: string
  /** Human-readable device name */
  name: string
  /** Available VRAM in megabytes (null for CPU) */
  vram_mb: number | null
  /** Whether this device is currently selected for use */
  is_selected: boolean
  /** Whether this device is available for use */
  is_available: boolean
}

/**
 * Configuration for text generation with a local LLM.
 *
 * All parameters have sensible defaults and are validated/clamped
 * before use to ensure they're within acceptable ranges.
 */
export interface GenerationConfig {
  /** Sampling temperature. Higher = more random, lower = more focused. Range: 0.0–2.0 */
  temperature: number
  /** Top-p (nucleus) sampling threshold. Range: 0.0–1.0 */
  top_p: number
  /** Top-k sampling. Only consider the top k most likely tokens. Range: 1–500 */
  top_k: number
  /** Repetition penalty. 1.0 = no penalty. Range: 0.5–2.0 */
  repeat_penalty: number
  /** Maximum number of new tokens to generate. Range: 1–32768 */
  max_new_tokens: number
  /** Random seed for reproducible generation. null = random seed */
  seed: number | null
  /** Stop sequences. Generation stops when any of these strings are produced. */
  stop_sequences: string[]
  /** Mirostat mode: 0 = off, 1 = v1, 2 = v2. Range: 0–2 */
  mirostat_mode: number
  /** Mirostat target entropy (tau). Range: 0.0–10.0 */
  mirostat_tau: number
  /** Mirostat learning rate (eta). Range: 0.0–1.0 */
  mirostat_eta: number
}

/**
 * Default generation configuration values.
 */
export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.1,
  max_new_tokens: 512,
  seed: null,
  stop_sequences: [],
  mirostat_mode: 0,
  mirostat_tau: 5.0,
  mirostat_eta: 0.1,
}

/**
 * Complete state of the model serving system.
 *
 * This is the single source of truth for UI state, returned by `get_serve_state`.
 * Contains everything the frontend needs to display model status and generation settings.
 *
 * Fields use camelCase to match the Rust struct's `#[serde(rename_all = "camelCase")]`.
 */
export interface ServeState {
  /** Whether a model is currently loaded and ready for inference */
  isLoaded: boolean
  /** Information about the loaded model, if any */
  modelInfo: ModelInfo | null
  /** The device currently being used for inference */
  activeDevice: DeviceInfo | null
  /** Active inference endpoint URL (includes host + port), if known */
  inferenceEndpoint: string | null
  /** Active context window in tokens (queried from running server when available) */
  activeContextLength: number | null
  /** Current generation configuration (always available, even before model load) */
  generationConfig: GenerationConfig
}

/**
 * Common quantization levels grouped by type
 */
export const QuantizationLevels = {
  /** K-quant formats (recommended) */
  kQuant: ['Q2_K', 'Q2_K_S', 'Q3_K', 'Q3_K_S', 'Q3_K_M', 'Q4_K_M', 'Q4_K_S', 'Q4_K_L', 'Q5_K_M', 'Q5_K_S', 'Q6_K', 'Q6_K_M', 'Q8_K'] as const,

  /** Legacy quantization formats */
  legacy: ['Q4_0', 'Q4_1', 'Q4_2', 'Q4_3', 'Q5_0', 'Q5_1', 'Q8_0', 'Q8_1'] as const,

  /** Importance matrix quantization (highest compression) */
  importanceMatrix: ['IQ4_XS', 'IQ4_NL', 'IQ3_M', 'IQ3_S', 'IQ2_XXS'] as const,

  /** Unquantized formats */
  unquantized: ['F16', 'F32', 'BF16'] as const,
} as const

/**
 * Common model architectures and their typical context lengths
 */
export const ArchitectureDefaults: Record<string, { typicalContext: number }> = {
  llama: { typicalContext: 4096 },
  mistral: { typicalContext: 32768 },
  phi3: { typicalContext: 4096 },
  gemma: { typicalContext: 8192 },
  qwen: { typicalContext: 32768 },
  starcoder2: { typicalContext: 16384 },
  'command-r': { typicalContext: 128000 },
} as const

/**
 * Helper to format parameter count as human-readable string
 */
export function formatParameterCount(count: number | null): string {
  if (count === null) return 'Unknown'
  if (count >= 1e12) return `${(count / 1e12).toFixed(1)}T`
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`
  return count.toLocaleString()
}

/**
 * Helper to estimate memory requirements based on quantization
 * Returns approximate GB of VRAM needed
 */
export function estimateMemoryRequirements(
  parameterCount: number | null,
  quantization: string | null
): number | null {
  if (parameterCount === null) return null

  // Base size in bytes (FP16 = 2 bytes per parameter)
  const fp16Size = parameterCount * 2

  // Quantization compression ratios (approximate)
  const compressionRatios: Record<string, number> = {
    'Q2_K': 0.3,
    'Q3_K': 0.35,
    'Q4_K_M': 0.4,
    'Q4_K_S': 0.38,
    'Q5_K_M': 0.45,
    'Q5_K_S': 0.43,
    'Q6_K': 0.55,
    'Q8_0': 0.6,
    'Q4_0': 0.37,
    'Q5_0': 0.42,
    'F16': 1.0,
    'BF16': 1.0,
    'F32': 2.0,
  }

  const ratio = quantization ? (compressionRatios[quantization] ?? 0.5) : 0.5
  const bytesNeeded = fp16Size * ratio

  // Convert to GB and add 20% overhead
  return (bytesNeeded * 1.2) / (1024 * 1024 * 1024)
}

// ============================================================================
// System Resources Types
// ============================================================================

/**
 * CPU information
 */
export interface CpuInfo {
  /** CPU name/brand */
  name: string
  /** Number of physical cores */
  physicalCores: number
  /** Number of logical cores (including hyperthreading) */
  logicalCores: number
  /** CPU architecture (x86_64, aarch64, etc.) */
  arch: string
}

/**
 * System memory information
 */
export interface MemoryInfo {
  /** Total system RAM in MB */
  totalMb: number
  /** Available RAM in MB */
  availableMb: number
  /** Used RAM in MB */
  usedMb: number
  /** Usage percentage */
  usagePercent: number
}

/**
 * GPU driver status
 */
export interface DriverStatus {
  /** Driver type (cuda, vulkan, rocm, metal) */
  driverType: string
  /** Whether driver is installed and available */
  isAvailable: boolean
  /** Driver version if available */
  version: string | null
  /** Any error message if driver check failed */
  error: string | null
}

/**
 * GPU device information
 */
export interface GpuInfo {
  /** Device ID (e.g., "cuda:0", "vulkan:0") */
  id: string
  /** GPU name */
  name: string
  /** GPU type (cuda, vulkan, rocm, metal) */
  gpuType: string
  /** Total VRAM in MB (null for unified memory) */
  vramMb: number | null
  /** Available VRAM in MB */
  availableVramMb: number | null
  /** Whether this GPU is available for compute */
  isAvailable: boolean
  /** Driver status for this GPU */
  driver: DriverStatus
}

/**
 * NPU (Neural Processing Unit) information
 */
export interface NpuInfo {
  /** NPU name */
  name: string
  /** NPU type (e.g., "intel_npu", "apple_neural_engine", "qualcomm_npu") */
  npuType: string
  /** Whether NPU is available */
  isAvailable: boolean
  /** Driver/software status */
  driver: DriverStatus
}

/**
 * Complete system resources information
 */
export interface SystemResources {
  /** CPU information */
  cpu: CpuInfo
  /** Memory information */
  memory: MemoryInfo
  /** Available GPUs */
  gpus: GpuInfo[]
  /** Available NPUs */
  npus: NpuInfo[]
  /** All driver statuses */
  drivers: DriverStatus[]
}

/**
 * Information about an available model file in the models directory
 */
export interface AvailableModel {
  /** Model file name */
  name: string
  /** Full path to the model file */
  path: string
  /** File size in megabytes */
  sizeMb: number
  /** Last modified timestamp in Unix milliseconds */
  modifiedMs: number
}

/**
 * Inference engine information
 */
export interface InferenceEngine {
  /** Engine identifier (e.g., "llama.cpp-vulkan", "llama.cpp-cuda") */
  id: string
  /** Display name for the engine */
  name: string
  /** Engine type (llama.cpp, onnx, etc.) */
  engineType: string
  /** Acceleration backend (vulkan, cuda, metal, rocm, cpu) */
  backend: string
  /** Whether this engine is available on this system */
  isAvailable: boolean
  /** Whether this runtime backend applies to the current platform/device */
  isApplicable: boolean
  /** Whether this is the recommended engine for this system */
  isRecommended: boolean
  /** Version string if available */
  version: string | null
  /** Path to the engine binary if found */
  binaryPath: string | null
  /** Any error message if engine check failed */
  error: string | null
}

/**
 * Progress event emitted during engine installation
 */
export interface EngineInstallProgress {
  engineId: string
  /** "fetching_release" | "selecting_asset" | "downloading" | "extracting" | "done" | "error" */
  stage: string
  percentage: number
  message: string
}

/**
 * Result returned after a successful engine installation
 */
export interface EngineInstallResult {
  engineId: string
  binaryPath: string
  version: string
}

/**
 * Runtime status containing all inference engine information
 */
export interface RuntimeStatus {
  /** List of all supported/compatible engines for this system */
  engines: InferenceEngine[]
  /** The currently active engine (if any) */
  activeEngine: string | null
  /** Whether any engine is available */
  hasAvailableEngine: boolean
  /** Warning message if no engines are available */
  warning: string | null
}
