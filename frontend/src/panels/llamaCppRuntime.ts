import type { LlamaRuntimeEngine, LlamaRuntimeStatusResponse } from "../contracts";

export interface LlamaRuntimeStartArgs {
  engineId: string;
  modelPath: string;
  port: number;
  ctxSize: number;
  nGpuLayers: number;
  threads: number | null;
  batchSize: number | null;
  ubatchSize: number | null;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  flashAttn: boolean;
  mmap: boolean;
  mlock: boolean;
  seed: number | null;
}

function isSelectableGpu(engine: LlamaRuntimeEngine): boolean {
  if (engine.backend === "cpu") return false;
  if (!engine.isApplicable) return false;
  return engine.isReady || engine.isInstalled || engine.prerequisites.some((item) => item.ok);
}

export function selectPreferredLlamaEngineId(
  runtime: LlamaRuntimeStatusResponse,
  currentEngineId: string
): string {
  const current = runtime.engines.find((engine) => engine.engineId === currentEngineId);

  const preferredRocm = runtime.engines.find(
    (engine) => engine.backend === "rocm" && isSelectableGpu(engine)
  );
  const preferredVulkan = runtime.engines.find(
    (engine) => engine.backend === "vulkan" && isSelectableGpu(engine)
  );
  const preferredAnyGpu = runtime.engines.find((engine) => isSelectableGpu(engine));
  const preferredGpu = preferredRocm ?? preferredVulkan ?? preferredAnyGpu ?? null;

  if (preferredGpu) {
    const isCurrentCpu = current?.backend === "cpu";
    if (!current || isCurrentCpu || !current.isReady) {
      return preferredGpu.engineId;
    }
  }

  if (current) return current.engineId;
  return runtime.engines.at(0)?.engineId ?? currentEngineId;
}

export function getMissingBundleWarning(
  runtime: LlamaRuntimeStatusResponse,
  selectedEngineId: string,
  previouslyWarnedEngineId: string | null
): { warning: string | null; nextWarnedEngineId: string | null } {
  const selected = runtime.engines.find((engine) => engine.engineId === selectedEngineId);
  if (!selected) {
    return { warning: null, nextWarnedEngineId: null };
  }
  if (selected.isApplicable && !selected.isBundled && !selected.isInstalled) {
    if (previouslyWarnedEngineId !== selected.engineId) {
      return {
        warning: `Selected engine ${selected.label} is not bundled in this build. Install will require local PATH or runtime download fallback.`,
        nextWarnedEngineId: selected.engineId
      };
    }
    return { warning: null, nextWarnedEngineId: selected.engineId };
  }
  return { warning: null, nextWarnedEngineId: null };
}

export function shouldClearActiveModelPath(runtime: LlamaRuntimeStatusResponse): boolean {
  return runtime.state !== "healthy" || !runtime.activeEngineId || !runtime.pid;
}

export function applyLlamaRuntimeStartArgsToState(
  state: Record<string, unknown>,
  args: LlamaRuntimeStartArgs
): void {
  state.llamaRuntimeSelectedEngineId = args.engineId;
  state.llamaRuntimeModelPath = args.modelPath;
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
}

export function shouldVerifyEngineBeforeStart(engine: LlamaRuntimeEngine): boolean {
  return engine.backend !== "cpu" || !engine.isInstalled || !engine.isReady;
}

export function canProceedWithUnreadyGpuEngine(engine: LlamaRuntimeEngine | null | undefined): boolean {
  return Boolean(engine && engine.backend !== "cpu" && engine.isApplicable && engine.isInstalled);
}

export function buildEngineNotReadyError(engine: LlamaRuntimeEngine | null | undefined, engineId: string): Error {
  const blocking = engine?.prerequisites
    .filter((item) => !item.ok)
    .map((item) => `${item.key}: ${item.message}`)
    .join(" | ");
  return new Error(
    blocking ? `Runtime engine is not ready: ${blocking}` : `Runtime engine is not ready: ${engineId}`
  );
}

export function buildLlamaRuntimeStartRequest(args: LlamaRuntimeStartArgs, correlationId: string): Record<string, unknown> {
  return {
    correlationId,
    engineId: args.engineId,
    modelPath: args.modelPath,
    port: args.port,
    ctxSize: args.ctxSize,
    nGpuLayers: args.nGpuLayers,
    temperature: args.temperature,
    topP: args.topP,
    topK: args.topK,
    repeatPenalty: args.repeatPenalty,
    flashAttn: args.flashAttn,
    mmap: args.mmap,
    mlock: args.mlock,
    ...(args.threads !== null ? { threads: args.threads } : {}),
    ...(args.batchSize !== null ? { batchSize: args.batchSize } : {}),
    ...(args.ubatchSize !== null ? { ubatchSize: args.ubatchSize } : {}),
    ...(args.seed !== null ? { seed: args.seed } : {})
  };
}
