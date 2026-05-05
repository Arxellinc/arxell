import {
  buildEngineNotReadyError,
  buildLlamaRuntimeStartRequest,
  canProceedWithUnreadyGpuEngine,
  type LlamaRuntimeStartArgs,
  shouldVerifyEngineBeforeStart
} from "./llamaCppRuntime";
import type { LlamaRuntimeStatusResponse } from "../contracts";

export interface LlamaCppControllerDeps {
  nextCorrelationId: () => string;
  refreshLlamaRuntime: () => Promise<void>;
  browseModelPath: () => Promise<string | null>;
  persistLlamaModelPath: (path: string) => void;
  persistLlamaEngineId: (engineId: string) => void;
  pushConsoleEntry: (level: "warn" | "error" | "info", source: "browser", line: string) => void;
}

export interface LlamaStateSlice {
  llamaRuntimeBusy: boolean;
  llamaRuntimeSelectedEngineId: string;
  llamaRuntimeModelPath: string;
  llamaRuntimeActiveModelPath: string;
  llamaRuntimePort: number;
  llamaRuntimeCtxSize: number;
  llamaRuntimeGpuLayers: number;
  llamaRuntimeThreads: number | null;
  llamaRuntimeBatchSize: number | null;
  llamaRuntimeUbatchSize: number | null;
  llamaRuntimeTemperature: number;
  llamaRuntimeTopP: number;
  llamaRuntimeTopK: number;
  llamaRuntimeRepeatPenalty: number;
  llamaRuntimeFlashAttn: boolean;
  llamaRuntimeMmap: boolean;
  llamaRuntimeMlock: boolean;
  llamaRuntimeSeed: number | null;
  llamaRuntime: LlamaRuntimeStatusResponse | null;
  sidebarTab: string;
  modelManagerBusy: boolean;
  modelManagerMessage: string | null;
}

function assertValidStartArgs(args: LlamaRuntimeStartArgs): void {
  if (!args.engineId.trim()) throw new Error("Runtime engine is required");
  if (!args.modelPath.trim()) throw new Error("Model path is required");
  if (!Number.isFinite(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error("Runtime port must be between 1 and 65535");
  }
}

export async function startRuntime(
  state: LlamaStateSlice,
  clientRef: {
    installLlamaRuntimeEngine: (req: { correlationId: string; engineId: string }) => Promise<unknown>;
    startLlamaRuntime: (req: Record<string, unknown>) => Promise<unknown>;
  } | null,
  args: LlamaRuntimeStartArgs,
  deps: Pick<LlamaCppControllerDeps, "nextCorrelationId" | "refreshLlamaRuntime" | "persistLlamaModelPath" | "persistLlamaEngineId" | "pushConsoleEntry">
): Promise<void> {
  if (!clientRef) return;
  state.llamaRuntimeBusy = true;
  state.llamaRuntimeSelectedEngineId = args.engineId;
  deps.persistLlamaEngineId(args.engineId);
  state.llamaRuntimeModelPath = args.modelPath;
  deps.persistLlamaModelPath(args.modelPath);
  state.llamaRuntimePort = args.port;
  state.llamaRuntimeCtxSize = args.ctxSize;
  state.llamaRuntimeGpuLayers = args.nGpuLayers;
  state.llamaRuntimeThreads = args.threads;
  state.llamaRuntimeBatchSize = args.batchSize;
  state.llamaRuntimeUbatchSize = args.ubatchSize;
  state.llamaRuntimeTemperature = args.temperature;
  state.llamaRuntimeTopP = args.topP;
  state.llamaRuntimeTopK = args.topK;
  state.llamaRuntimeRepeatPenalty = args.repeatPenalty;
  state.llamaRuntimeFlashAttn = args.flashAttn;
  state.llamaRuntimeMmap = args.mmap;
  state.llamaRuntimeMlock = args.mlock;
  state.llamaRuntimeSeed = args.seed;
  try {
    assertValidStartArgs(args);
    await deps.refreshLlamaRuntime();
    const selectedEngine = state.llamaRuntime?.engines.find((engine) => engine.engineId === args.engineId);
    if (!selectedEngine) {
      throw new Error(`Runtime engine not found: ${args.engineId}`);
    }

    if (shouldVerifyEngineBeforeStart(selectedEngine)) {
      deps.pushConsoleEntry(
        "info",
        "browser",
        `Verifying runtime files for ${selectedEngine.label} before start...`
      );
      await clientRef.installLlamaRuntimeEngine({
        correlationId: deps.nextCorrelationId(),
        engineId: args.engineId
      });
      await deps.refreshLlamaRuntime();
    }

    const refreshedEngine = state.llamaRuntime?.engines.find((engine) => engine.engineId === args.engineId);
    if (!refreshedEngine?.isReady) {
      const canProceedWithGpu = canProceedWithUnreadyGpuEngine(refreshedEngine);
      if (canProceedWithGpu) {
        deps.pushConsoleEntry(
          "warn",
          "browser",
          `Proceeding with ${refreshedEngine.label} even though prerequisite probes are inconclusive.`
        );
      } else {
        throw buildEngineNotReadyError(refreshedEngine, args.engineId);
      }
    }

    const startRequest = buildLlamaRuntimeStartRequest(args, deps.nextCorrelationId());
    await clientRef.startLlamaRuntime(startRequest);
    state.llamaRuntimeActiveModelPath = args.modelPath;
    await deps.refreshLlamaRuntime();
  } catch (error) {
    deps.pushConsoleEntry("error", "browser", `Failed to start runtime ${args.engineId}: ${String(error)}`);
    await deps.refreshLlamaRuntime();
    state.llamaRuntimeBusy = false;
  }
}

export async function installEngine(
  state: LlamaStateSlice,
  clientRef: { installLlamaRuntimeEngine: (req: { correlationId: string; engineId: string }) => Promise<unknown> } | null,
  engineId: string,
  deps: LlamaCppControllerDeps
): Promise<void> {
  if (!clientRef) return;
  state.llamaRuntimeBusy = true;
  state.llamaRuntimeSelectedEngineId = engineId;
  deps.persistLlamaEngineId(engineId);
  try {
    await clientRef.installLlamaRuntimeEngine({
      correlationId: deps.nextCorrelationId(),
      engineId
    });
    await deps.refreshLlamaRuntime();
  } catch (error) {
    deps.pushConsoleEntry("error", "browser", `Failed to install runtime engine ${engineId}: ${String(error)}`);
    await deps.refreshLlamaRuntime();
  } finally {
    state.llamaRuntimeBusy = false;
  }
}

export async function browseAndSetModelPath(
  state: LlamaStateSlice,
  deps: Pick<LlamaCppControllerDeps, "browseModelPath" | "persistLlamaModelPath">
): Promise<void> {
  const selectedPath = await deps.browseModelPath();
  if (!selectedPath) return;
  state.llamaRuntimeModelPath = selectedPath;
  deps.persistLlamaModelPath(selectedPath);
}

export async function stopRuntime(
  state: LlamaStateSlice,
  clientRef: { stopLlamaRuntime: (req: { correlationId: string }) => Promise<unknown> } | null,
  deps: Pick<LlamaCppControllerDeps, "nextCorrelationId" | "refreshLlamaRuntime" | "pushConsoleEntry">
): Promise<void> {
  if (!clientRef) return;
  state.llamaRuntimeBusy = true;
  try {
    await clientRef.stopLlamaRuntime({ correlationId: deps.nextCorrelationId() });
    state.llamaRuntimeActiveModelPath = "";
    await deps.refreshLlamaRuntime();
  } catch (error) {
    deps.pushConsoleEntry("error", "browser", `Failed to stop runtime: ${String(error)}`);
    await deps.refreshLlamaRuntime();
  } finally {
    state.llamaRuntimeBusy = false;
  }
}

export function useModelPathFromManager(state: LlamaStateSlice, modelPath: string, persistLlamaModelPath: (path: string) => void): void {
  state.llamaRuntimeModelPath = modelPath;
  persistLlamaModelPath(modelPath);
  state.sidebarTab = "llama_cpp";
  state.modelManagerMessage = `Selected model for llama.cpp: ${modelPath}`;
}

export async function ejectActiveModel(
  state: LlamaStateSlice,
  clientRef: { stopLlamaRuntime: (req: { correlationId: string }) => Promise<unknown> } | null,
  deps: Pick<LlamaCppControllerDeps, "nextCorrelationId" | "persistLlamaModelPath" | "refreshLlamaRuntime">
): Promise<void> {
  if (!clientRef) return;
  state.modelManagerBusy = true;
  state.modelManagerMessage = "Ejecting active model and stopping llama.cpp...";
  try {
    await clientRef.stopLlamaRuntime({ correlationId: deps.nextCorrelationId() });
  } catch {
    // Ignore stop failure and still clear local model selection.
  }
  try {
    state.llamaRuntimeModelPath = "";
    state.llamaRuntimeActiveModelPath = "";
    deps.persistLlamaModelPath("");
    await deps.refreshLlamaRuntime();
    state.modelManagerMessage = "Active model ejected and llama.cpp stopped.";
  } catch (error) {
    state.modelManagerMessage = `Eject completed, refresh failed: ${String(error)}`;
  } finally {
    state.modelManagerBusy = false;
  }
}
