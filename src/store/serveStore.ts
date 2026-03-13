import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ModelInfo,
  DeviceInfo,
  EngineInstallProgress,
  EngineInstallResult,
  GenerationConfig,
  TokenCount,
  ServeState,
  ChatMessage,
  SystemResources,
  AvailableModel,
  RuntimeStatus,
} from "../types/model";

const STARTUP_AUTOLOAD_MIN_AVAILABLE_MB = 6144;
const STARTUP_AUTOLOAD_CONTEXT_OVERRIDE = 10000;
const LAST_LOADED_MODEL_PATH_KEY = "arx_last_loaded_model_path";

function normalizeModelPath(path: string): string {
  return path.trim().replace(/\/+$/, "");
}

function modelFileName(path: string): string {
  const normalized = normalizeModelPath(path);
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

// Re-export for convenience
export type { ModelInfo, DeviceInfo, GenerationConfig, TokenCount, EngineInstallProgress };

/**
 * Progress event emitted during model loading
 */
export interface ModelLoadProgress {
  stage: string;
  percentage: number;
  message: string;
}

/**
 * Configuration for loading a model
 * Mirrors the Rust ModelLoadConfig with all llama.cpp settings
 */
export interface ModelLoadConfig {
  path: string;
  source: "LocalGguf";
  
  // === Context and Memory Settings ===
  /** Override context length (undefined = use model default) */
  context_override?: number;
  /** Batch size for prompt processing (default: 512) */
  batch_size?: number;
  /** Physical batch size for GPU (ubatch, default: 128) */
  ubatch_size?: number;
  
  // === GPU Offload Settings ===
  /** Number of layers to offload to GPU (undefined = auto, -1 or 999 for all) */
  n_gpu_layers?: number;
  /** Split model across multiple GPUs (for multi-GPU setups) */
  tensor_split?: number[];
  /** Main GPU for multi-GPU setups (default: 0) */
  main_gpu?: number;
  /** Use memory mapping for faster loading (default: true) */
  use_mmap?: boolean;
  /** Use memory locking to prevent swapping (default: false) */
  use_mlock?: boolean;
  
  // === CPU Settings ===
  /** Number of CPU threads (undefined = auto-detect based on cores) */
  n_threads?: number;
  /** Number of threads for batch processing (undefined = same as n_threads) */
  n_threads_batch?: number;
  /** Enable flash-attention kernels when supported by backend */
  flash_attn?: boolean;
  /** KV cache type for keys (e.g. f16, q8_0, q4_0) */
  cache_type_k?: string;
  /** KV cache type for values (e.g. f16, q8_0, q4_0) */
  cache_type_v?: string;
  /** CPU priority level (0 = normal, 1 = high, -1 = low) */
  priority?: number;
  
  // === RoPE (Rotary Position Embeddings) Settings ===
  /** RoPE frequency base (default: model-specific, usually 10000.0) */
  rope_freq_base?: number;
  /** RoPE frequency scale (default: 1.0, use < 1.0 for extended context) */
  rope_freq_scale?: number;
  /** RoPE scaling type: "none", "linear", "yarn" */
  rope_scaling_type?: string;
  /** YaRN extrapolation mix factor */
  yarn_ext_factor?: number;
  /** YaRN attention factor */
  yarn_attn_factor?: number;
  /** YaRN beta fast factor */
  yarn_beta_fast?: number;
  /** YaRN beta slow factor */
  yarn_beta_slow?: number;
  
  // === Device Selection ===
  /** Device ID to use from enumerate_devices (undefined = auto-select) */
  device_override?: string;
  
  // === Advanced Settings ===
  /** Embedding mode only (no text generation) */
  embedding_only?: boolean;
  /** Split-mode for multi-GPU: "none", "layer", "row" */
  split_mode?: string;
}

/**
 * Default model load configuration
 */
export const DEFAULT_MODEL_LOAD_CONFIG: ModelLoadConfig = {
  path: "",
  source: "LocalGguf",
  context_override: undefined,
  batch_size: 512,
  ubatch_size: 128,
  n_gpu_layers: -1, // All layers to GPU by default
  tensor_split: undefined,
  main_gpu: undefined,
  use_mmap: true,
  use_mlock: false,
  n_threads: undefined,
  n_threads_batch: undefined,
  flash_attn: false,
  cache_type_k: undefined,
  cache_type_v: undefined,
  priority: undefined,
  rope_freq_base: undefined,
  rope_freq_scale: undefined,
  rope_scaling_type: undefined,
  yarn_ext_factor: undefined,
  yarn_attn_factor: undefined,
  yarn_beta_fast: undefined,
  yarn_beta_slow: undefined,
  device_override: undefined,
  embedding_only: false,
  split_mode: undefined,
};

interface ServeStore {
  // State
  isLoaded: boolean;
  isLoading: boolean;
  loadProgress: ModelLoadProgress | null;
  modelInfo: ModelInfo | null;
  activeDevice: DeviceInfo | null;
  inferenceEndpoint: string | null;
  activeContextLength: number | null;
  availableDevices: DeviceInfo[];
  generationConfig: GenerationConfig;
  tokenCount: TokenCount | null;
  error: string | null;

  // System resources state
  systemResources: SystemResources | null;
  availableModels: AvailableModel[];
  runtimeStatus: RuntimeStatus | null;

  // Panel state
  panelOpen: boolean;

  // Actions
  initialize: () => Promise<void>;
  previewModel: (path: string) => Promise<ModelInfo>;
  loadModel: (config: ModelLoadConfig) => Promise<void>;
  unloadModel: () => Promise<void>;
  setGenerationConfig: (config: GenerationConfig) => Promise<void>;
  refreshTokenCount: (messages: ChatMessage[], systemPrompt?: string) => Promise<void>;

  // System resources actions
  fetchSystemResources: () => Promise<void>;
  fetchAvailableModels: () => Promise<void>;
  fetchRuntimeStatus: () => Promise<void>;
  getModelsDir: () => Promise<string>;
  openModelsFolder: () => Promise<void>;

  // Engine install state
  installingEngineId: string | null;
  installProgress: EngineInstallProgress | null;
  installEngine: (engineId: string) => Promise<void>;

  // Panel actions
  openPanel: () => void;
  closePanel: () => void;

  // Internal setters
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  setLoadProgress: (progress: ModelLoadProgress | null) => void;
}

// Debounce helper for token counting
let tokenCountTimeout: ReturnType<typeof setTimeout> | null = null;

export const useServeStore = create<ServeStore>((set, get) => {
  let unlistenProgress: UnlistenFn | null = null;
  let unlistenStateChanged: UnlistenFn | null = null;
  let unlistenInstallProgress: UnlistenFn | null = null;
  let startupAutoLoadAttempted = false;
  let initializeInFlight: Promise<void> | null = null;
  let startupAutoLoadTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    // Initial state
    isLoaded: false,
    isLoading: false,
    loadProgress: null,
    modelInfo: null,
    activeDevice: null,
    inferenceEndpoint: null,
    activeContextLength: null,
    availableDevices: [],
    generationConfig: {
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
    },
    tokenCount: null,
    error: null,
    panelOpen: false,
    systemResources: null,
    availableModels: [],
    runtimeStatus: null,
    installingEngineId: null,
    installProgress: null,

    // Initialize store and set up event listeners
    initialize: async () => {
      if (initializeInFlight) {
        await initializeInFlight;
        return;
      }

      initializeInFlight = (async () => {
        try {
          // Fetch initial state
          const [serveState, devices, runtimeStatus, models] = await Promise.all([
            invoke<ServeState>("cmd_get_serve_state"),
            invoke<DeviceInfo[]>("cmd_get_available_devices"),
            invoke<RuntimeStatus>("cmd_get_runtime_status"),
            invoke<AvailableModel[]>("cmd_list_available_models"),
          ]);

          set({
            isLoaded: serveState.isLoaded,
            modelInfo: serveState.modelInfo,
            activeDevice: serveState.activeDevice,
            inferenceEndpoint: serveState.inferenceEndpoint,
            activeContextLength: serveState.activeContextLength ?? null,
            generationConfig: serveState.generationConfig,
            availableDevices: devices,
            runtimeStatus,
            availableModels: models,
            error: null,
          });

          // Startup autoload is deferred until after initialize completes to avoid
          // cold-start contention. This must only be considered once per app
          // session (true startup) and never re-armed by later state refreshes
          // such as manual unload or model state change events.
          if (!startupAutoLoadAttempted) {
            startupAutoLoadAttempted = true;
            if (!serveState.isLoaded) {
              const autoloadDisabled =
                typeof window !== "undefined" &&
                window.localStorage?.getItem("arx_disable_model_autoload") === "true";
              if (autoloadDisabled) {
                console.info("[model-autoload] disabled by localStorage flag arx_disable_model_autoload=true");
              } else if (startupAutoLoadTimer) {
                clearTimeout(startupAutoLoadTimer);
                startupAutoLoadTimer = null;
              }

              if (!autoloadDisabled) {
                startupAutoLoadTimer = setTimeout(async () => {
                  try {
                    const current = await invoke<ServeState>("cmd_get_serve_state");
                    if (current.isLoaded) {
                      console.info("[model-autoload] skipped (model already loaded)");
                      return;
                    }

                    if (models.length === 0) {
                      console.info("[model-autoload] skipped (no local models found)");
                      return;
                    }

                    const hasUsableRuntime = runtimeStatus.engines.some(
                      (e) => e.isAvailable && e.backend !== "cpu"
                    );

                    // On first run there is exactly one model — the bundled default.
                    // Allow autoload even without a GPU so the user isn't left with
                    // an empty app. For multi-model libraries, keep the GPU-only guard
                    // to avoid unexpected CPU thrash on heavier models.
                    const isFirstRunDefault = models.length === 1;
                    if (!hasUsableRuntime && !isFirstRunDefault) {
                      console.info("[model-autoload] skipped (no non-CPU runtime, multiple models present)");
                      return;
                    }

                    const rememberedPath =
                      typeof window !== "undefined"
                        ? window.localStorage?.getItem(LAST_LOADED_MODEL_PATH_KEY)?.trim() || ""
                        : "";
                    const rememberedNorm = normalizeModelPath(rememberedPath);
                    const rememberedModel =
                      rememberedNorm.length > 0
                        ? models.find((m) => normalizeModelPath(m.path) === rememberedNorm) ??
                          models.find(
                            (m) =>
                              modelFileName(m.path).toLowerCase() ===
                              modelFileName(rememberedNorm).toLowerCase()
                          )
                        : undefined;
                    const newest = models
                      .slice()
                      .sort((a, b) => b.modifiedMs - a.modifiedMs)[0];
                    const candidate = rememberedModel ?? newest;

                    if (!candidate?.path) {
                      console.info("[model-autoload] skipped (no autoload candidate)");
                      return;
                    }

                    // Guardrail: keep a minimum amount of free host RAM before
                    // startup autoload. This avoids worst-case startup thrash
                    // while allowing normal autoload behavior on typical systems.
                    const resources = await invoke<SystemResources>("cmd_get_system_resources");
                    const availableMb = resources.memory?.availableMb ?? 0;
                    const requiredMb = STARTUP_AUTOLOAD_MIN_AVAILABLE_MB;
                    if (availableMb < requiredMb) {
                      console.warn(
                        `[model-autoload] skipped (available=${availableMb}MB, required=${requiredMb}MB)`
                      );
                      return;
                    }

                    console.info(
                      `[model-autoload] deferred startup load: ${candidate.name}${
                        rememberedModel ? " (remembered)" : ""
                      }`
                    );
                    await get().loadModel({
                      ...DEFAULT_MODEL_LOAD_CONFIG,
                      path: candidate.path,
                      source: "LocalGguf",
                      context_override: STARTUP_AUTOLOAD_CONTEXT_OVERRIDE,
                      // Keep CPU pressure lower on startup; prefer GPU offload strategy.
                      n_gpu_layers: -1,
                      use_mmap: true,
                      use_mlock: false,
                    });
                  } catch (e) {
                    console.error("[model-autoload] deferred startup load failed:", e);
                  } finally {
                    startupAutoLoadTimer = null;
                  }
                }, 3500);
              }
            }
          }

          // Set up event listeners if not already done
          if (!unlistenProgress) {
            unlistenProgress = await listen<ModelLoadProgress>(
              "model:load_progress",
              (event) => {
                set({ loadProgress: event.payload });
              }
            );
          }

          if (!unlistenStateChanged) {
            unlistenStateChanged = await listen<void>(
              "model:state_changed",
              () => {
                // Refresh state when model state changes (single-flight guarded).
                void get().initialize();
              }
            );
          }

          if (!unlistenInstallProgress) {
            unlistenInstallProgress = await listen<EngineInstallProgress>(
              "engine:install_progress",
              (event) => {
                const p = event.payload;
                console.info(
                  `[runtime-install] ${p.engineId} ${p.stage} ${Math.round(p.percentage)}% - ${p.message}`
                );
                set({ installingEngineId: p.engineId, installProgress: p });
                if (p.stage === "done" || p.stage === "error") {
                  // Clear installing state after a short delay, then refresh
                  setTimeout(() => {
                    set({ installingEngineId: null, installProgress: null });
                    get().fetchRuntimeStatus();
                  }, 2500);
                }
              }
            );
          }
        } catch (e) {
          set({ error: `Failed to initialize: ${e}` });
        } finally {
          initializeInFlight = null;
        }
      })();

      await initializeInFlight;
    },

    // Preview model metadata without loading - returns the info for the caller
    previewModel: async (path: string): Promise<ModelInfo> => {
      set({ error: null });
      try {
        const info = await invoke<ModelInfo>("cmd_peek_model_metadata", {
          path,
        });
        // Don't set modelInfo here - that's only for loaded models
        // Just return the info for the caller to use
        return info;
      } catch (e) {
        set({ error: `Failed to preview model: ${e}` });
        throw e;
      }
    },

    // Load model with progress tracking
    loadModel: async (config: ModelLoadConfig) => {
      set({ isLoading: true, loadProgress: null, error: null });
      try {
        const info = await invoke<ModelInfo>("cmd_load_model", { config });
        const serveState = await invoke<ServeState>("cmd_get_serve_state");
        if (typeof window !== "undefined" && config.path?.trim()) {
          window.localStorage?.setItem(
            LAST_LOADED_MODEL_PATH_KEY,
            normalizeModelPath(config.path)
          );
        }
        set({
          isLoaded: true,
          isLoading: false,
          loadProgress: null,
          modelInfo: info,
          inferenceEndpoint: serveState.inferenceEndpoint,
          activeContextLength: serveState.activeContextLength ?? null,
          error: null,
        });
      } catch (e) {
        set({
          isLoading: false,
          loadProgress: null,
          error: `Failed to load model: ${e}`,
        });
        throw e;
      }
    },

    // Unload current model
    unloadModel: async () => {
      set({ error: null });
      try {
        await invoke<void>("cmd_unload_model");
        set({
          isLoaded: false,
          isLoading: false,
          modelInfo: null,
          activeDevice: null,
          inferenceEndpoint: null,
          activeContextLength: null,
          tokenCount: null,
          loadProgress: null,
          error: null,
        });
      } catch (e) {
        set({ error: `Failed to unload model: ${e}` });
        throw e;
      }
    },

    // Update generation config
    setGenerationConfig: async (config: GenerationConfig) => {
      set({ error: null });
      try {
        const validated = await invoke<GenerationConfig>(
          "cmd_set_generation_config",
          { config }
        );
        set({ generationConfig: validated });
      } catch (e) {
        set({ error: `Failed to set generation config: ${e}` });
        throw e;
      }
    },

    // Refresh token count (debounced)
    refreshTokenCount: async (messages: ChatMessage[], systemPrompt?: string) => {
      // Clear pending timeout
      if (tokenCountTimeout) {
        clearTimeout(tokenCountTimeout);
      }

      // Debounce 300ms
      tokenCountTimeout = setTimeout(async () => {
        if (!get().isLoaded) return;
        
        try {
          const count = await invoke<TokenCount>("cmd_count_tokens", {
            messages,
            systemPrompt: systemPrompt ?? null,
          });
          set({ tokenCount: count });
        } catch (e) {
          const msg = String(e ?? "");
          const expectedUnavailable =
            msg.includes("No model is currently loaded") ||
            msg.includes("ModelNotLoaded");
          if (expectedUnavailable) {
            set({ tokenCount: null });
            return;
          }
          console.error("Failed to count tokens:", e);
        }
      }, 300);
    },

    // Fetch system resources
    fetchSystemResources: async () => {
      try {
        const resources = await invoke<SystemResources>("cmd_get_system_resources");
        set({ systemResources: resources });
      } catch (e) {
        console.error("Failed to fetch system resources:", e);
      }
    },

    // Fetch available models from models directory
    fetchAvailableModels: async () => {
      try {
        const models = await invoke<AvailableModel[]>("cmd_list_available_models");
        set({ availableModels: models });
      } catch (e) {
        console.error("Failed to fetch available models:", e);
      }
    },

    // Fetch runtime status (inference engines)
    fetchRuntimeStatus: async () => {
      try {
        const status = await invoke<RuntimeStatus>("cmd_get_runtime_status");
        set({ runtimeStatus: status });
      } catch (e) {
        console.error("Failed to fetch runtime status:", e);
      }
    },

    // Get the models directory path
    getModelsDir: async () => {
      try {
        const dir = await invoke<string>("cmd_get_models_dir");
        return dir;
      } catch (e) {
        console.error("Failed to get models dir:", e);
        throw e;
      }
    },

    // Open models folder in file manager
    openModelsFolder: async () => {
      try {
        await invoke<void>("cmd_open_models_folder");
      } catch (e) {
        console.error("Failed to open models folder:", e);
        throw e;
      }
    },

    // Install engine binary from GitHub releases
    installEngine: async (engineId: string) => {
      console.info(`[runtime-install] starting install for ${engineId}`);
      set({ installingEngineId: engineId, installProgress: null, error: null });
      try {
        const result = await invoke<EngineInstallResult>("cmd_install_runtime_engine", { engineId });
        console.info(
          `[runtime-install] invoke completed for ${engineId}: ${result.binaryPath} (${result.version})`
        );
        // Success handled by the engine:install_progress "done" event listener
      } catch (e) {
        console.error(`[runtime-install] install failed for ${engineId}:`, e);
        set({
          installingEngineId: null,
          installProgress: null,
          error: `Failed to install engine: ${e}`,
        });
        throw e;
      }
    },

    // Panel actions
    openPanel: () => set({ panelOpen: true }),
    closePanel: () => set({ panelOpen: false }),

    // Internal setters
    setError: (error) => set({ error }),
    setLoading: (isLoading) => set({ isLoading }),
    setLoadProgress: (loadProgress) => set({ loadProgress }),
  };
});

// Cleanup function to call when app unmounts
export function cleanupServeStoreListeners() {
  // This would need to be called from the store's cleanup
  // For now, listeners are managed internally
}
