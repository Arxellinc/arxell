import type {
  LooperCheckOpenCodeResponse,
  LooperCloseResponse,
  LooperListResponse,
  LooperPauseResponse,
  LooperStartRequest,
  LooperStartResponse,
  LooperStopResponse
} from "../../contracts.js";
import type { ChatIpcClient } from "../../ipcClient.js";
import type { TerminalManager } from "../terminal/index.js";
import { normalizeLooperLoopRecord } from "./runtime.js";
import type { LooperPhase, LooperToolState } from "./state.js";
import { createLoopRun, LOOPER_PHASE_LABELS, LOOPER_PHASES } from "./state.js";

export interface LooperActionsDeps {
  terminalManager: TerminalManager;
  client: ChatIpcClient;
  nextCorrelationId: () => string;
  renderAndBind: () => void;
  defaultCwd?: string;
}

function syncDraftConfigIntoLiveState(state: LooperToolState, deps: LooperActionsDeps): void {
  state.cwd = state.configCwdDraft.trim() || state.cwd || deps.defaultCwd || ".";
  state.taskPath = state.configTaskPathDraft.trim() || state.taskPath;
  state.specsGlob = state.configSpecsGlobDraft.trim() || state.specsGlob;
  state.maxIterations = Math.max(1, state.configMaxIterationsDraft || state.maxIterations);
}

function registerLoopSessions(state: LooperToolState, deps: LooperActionsDeps): void {
  for (const loop of state.loops) {
    for (const phase of LOOPER_PHASES) {
      const sessionId = loop.phases[phase].sessionId;
      if (!sessionId) continue;
      deps.terminalManager.ensureSession({
        sessionId,
        title: `Loop ${loop.iteration} ${LOOPER_PHASE_LABELS[phase]}`,
        shell: "remote",
        createdAtMs: loop.startedAtMs,
        status:
          loop.phases[phase].status === "complete" ||
          loop.phases[phase].status === "error" ||
          loop.status === "completed" ||
          loop.status === "failed"
            ? "exited"
            : "running"
      });
    }
  }
}

export async function refreshLooperState(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  const correlationId = deps.nextCorrelationId();
  const invokeResponse = await deps.client.toolInvoke({
    correlationId,
    toolId: "looper",
    action: "list",
    mode: "sandbox",
    payload: { correlationId }
  });
  if (!invokeResponse.ok) {
    throw new Error(invokeResponse.error || "Failed to refresh Looper state.");
  }

  const response = invokeResponse.data as unknown as LooperListResponse;
  const backendIds = new Set(response.loops.map((loop) => loop.id));
  const localIdleLoops = state.loops.filter(
    (loop) =>
      loop.status === "idle" &&
      !backendIds.has(loop.id) &&
      LOOPER_PHASES.every((phase) => !loop.phases[phase].sessionId)
  );
  state.loops = [...localIdleLoops, ...response.loops.map(normalizeLooperLoopRecord)];
  state.loops.sort((a, b) => a.iteration - b.iteration);
  state.nextLoopIndex =
    state.loops.reduce((max, loop) => Math.max(max, loop.iteration), 0) + 1;

  if (!state.loops.length) {
    state.activeLoopId = null;
  } else if (!state.activeLoopId || !state.loops.some((loop) => loop.id === state.activeLoopId)) {
    state.activeLoopId = state.loops[state.loops.length - 1]?.id ?? null;
  }

  registerLoopSessions(state, deps);
}

async function checkOpenCodeInstalled(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<boolean> {
  state.installChecking = true;
  state.statusMessage = "Checking OpenCode availability...";
  deps.renderAndBind();

  try {
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "looper",
      action: "check-opencode",
      mode: "sandbox",
      payload: { correlationId }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "OpenCode check failed.");
    }
    const response = invokeResponse.data as unknown as LooperCheckOpenCodeResponse;
    state.installed = response.installed;
    state.installModalOpen = !response.installed;
    return response.installed;
  } catch {
    state.installed = false;
    state.installModalOpen = true;
    return false;
  } finally {
    state.installChecking = false;
    deps.renderAndBind();
  }
}

export async function ensureLooperInit(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  if (state.installed === null) {
    await checkOpenCodeInstalled(state, deps);
  }
  await refreshLooperState(state, deps);
  deps.renderAndBind();
}

export async function createLoop(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  if (state.busy) return;
  syncDraftConfigIntoLiveState(state, deps);
  const loopIndex = state.nextLoopIndex;
  const loop = createLoopRun(loopIndex, state.cwd || deps.defaultCwd || ".", {
    projectName: state.projectNameDraft,
    projectType: state.projectTypeDraft,
    projectIcon: state.projectIconDraft,
    projectDescription: state.projectDescriptionDraft
  });
  loop.launchConfig = {
    cwd: state.cwd || deps.defaultCwd || ".",
    taskPath: state.taskPath,
    specsGlob: state.specsGlob,
    maxIterations: Math.max(1, state.maxIterations),
    phaseModels: { ...state.phaseModels },
    projectName: state.projectNameDraft,
    projectType: state.projectTypeDraft,
    projectIcon: state.projectIconDraft,
    projectDescription: state.projectDescriptionDraft
  };
  state.loops.push(loop);
  state.activeLoopId = loop.id;
  state.nextLoopIndex = loopIndex + 1;
  state.statusMessage = `Loop ${loop.iteration} ready to start.`;
  deps.renderAndBind();
}

function buildStartRequest(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loop: LooperToolState["loops"][number],
  prompts: Record<LooperPhase, string>
): LooperStartRequest {
  syncDraftConfigIntoLiveState(state, deps);
  const launchConfig = loop.launchConfig;
  const request: LooperStartRequest = {
    correlationId: deps.nextCorrelationId(),
    loopId: loop.id,
    iteration: loop.iteration,
    loopType: "build",
    cwd: launchConfig?.cwd || state.cwd || deps.defaultCwd || ".",
    taskPath: launchConfig?.taskPath || state.taskPath,
    specsGlob: launchConfig?.specsGlob || state.specsGlob,
    maxIterations: Math.max(1, launchConfig?.maxIterations || state.maxIterations),
    phasePrompts: prompts,
    projectName: launchConfig?.projectName || state.projectNameDraft,
    projectType: launchConfig?.projectType || state.projectTypeDraft,
    projectIcon: launchConfig?.projectIcon || state.projectIconDraft,
    projectDescription: launchConfig?.projectDescription || state.projectDescriptionDraft
  };
  if (Object.keys(launchConfig?.phaseModels || state.phaseModels).length) {
    request.phaseModels = { ...(launchConfig?.phaseModels || state.phaseModels) };
  }
  return request;
}

export async function startLoop(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop || loop.status === "running") return;

  if (state.installed !== true) {
    const installed = await checkOpenCodeInstalled(state, deps);
    if (!installed) {
      state.installModalOpen = true;
      deps.renderAndBind();
      return;
    }
  }

  const request = buildStartRequest(state, deps, loop, {
    planner: loop.phases.planner.prompt,
    executor: loop.phases.executor.prompt,
    validator: loop.phases.validator.prompt,
    critic: loop.phases.critic.prompt
  });

  state.busy = true;
  state.statusMessage = `Starting loop ${loop.iteration}...`;
  deps.renderAndBind();

  try {
    const invokeResponse = await deps.client.toolInvoke({
      correlationId: request.correlationId,
      toolId: "looper",
      action: "start",
      mode: "sandbox",
      payload: request as unknown as Record<string, unknown>
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed to start loop.");
    }
    const response = invokeResponse.data as unknown as LooperStartResponse;
    state.statusMessage = `Loop ${response.loopId} started.`;
    await refreshLooperState(state, deps);
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to start loop.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function setLoopPaused(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string,
  paused: boolean
): Promise<void> {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;
  const correlationId = deps.nextCorrelationId();
  state.busy = true;
  state.statusMessage = paused ? `Pausing loop ${loop.iteration}...` : `Resuming loop ${loop.iteration}...`;
  deps.renderAndBind();
  try {
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "looper",
      action: "pause",
      mode: "sandbox",
      payload: { correlationId, loopId, paused }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed to update loop pause state.");
    }
    const response = invokeResponse.data as unknown as LooperPauseResponse;
    loop.status = response.paused ? "paused" : "running";
    state.statusMessage = response.paused ? `Loop ${loop.iteration} paused.` : `Loop ${loop.iteration} resumed.`;
    await refreshLooperState(state, deps);
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to update pause state.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function stopLoop(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;
  const correlationId = deps.nextCorrelationId();
  state.busy = true;
  state.statusMessage = `Stopping loop ${loop.iteration}...`;
  deps.renderAndBind();
  try {
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "looper",
      action: "stop",
      mode: "sandbox",
      payload: { correlationId, loopId }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed to stop loop.");
    }
    const response = invokeResponse.data as unknown as LooperStopResponse;
    state.statusMessage = response.stopped ? `Loop ${loop.iteration} stopped.` : `Loop ${loop.iteration} was not running.`;
    await refreshLooperState(state, deps);
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to stop loop.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function closeLoop(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;

  const isLocalOnlyIdleLoop =
    loop.status === "idle" && LOOPER_PHASES.every((phase) => !loop.phases[phase].sessionId);
  if (isLocalOnlyIdleLoop) {
    state.loops = state.loops.filter((item) => item.id !== loopId);
    if (state.activeLoopId === loopId) {
      state.activeLoopId = state.loops[state.loops.length - 1]?.id ?? null;
    }
    deps.renderAndBind();
    return;
  }

  const correlationId = deps.nextCorrelationId();
  state.busy = true;
  state.statusMessage = `Closing loop ${loop.iteration}...`;
  deps.renderAndBind();
  try {
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "looper",
      action: "close",
      mode: "sandbox",
      payload: { correlationId, loopId }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed to close loop.");
    }
    const response = invokeResponse.data as unknown as LooperCloseResponse;
    if (response.closed) {
      state.loops = state.loops.filter((item) => item.id !== loopId);
      if (state.activeLoopId === loopId) {
        state.activeLoopId = state.loops[state.loops.length - 1]?.id ?? null;
      }
    }
    await refreshLooperState(state, deps);
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to close loop.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export function switchLoop(state: LooperToolState, loopId: string): void {
  if (state.activeLoopId === loopId) return;
  state.activeLoopId = loopId;
}

export function togglePhasePromptEdit(
  state: LooperToolState,
  loopId: string,
  phase: LooperPhase
): void {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;
  const phaseState = loop.phases[phase];
  phaseState.promptEditing = !phaseState.promptEditing;
  if (phaseState.promptEditing) {
    phaseState.promptDraft = phaseState.prompt;
  } else {
    phaseState.prompt = phaseState.promptDraft;
  }
}

export function updatePhasePromptDraft(
  state: LooperToolState,
  loopId: string,
  phase: LooperPhase,
  draft: string
): void {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;
  loop.phases[phase].promptDraft = draft;
}

export function openConfig(state: LooperToolState): void {
  state.configCwdDraft = state.cwd;
  state.configTaskPathDraft = state.taskPath;
  state.configSpecsGlobDraft = state.specsGlob;
  state.configMaxIterationsDraft = state.maxIterations;
  state.configOpen = true;
}

export function closeConfig(state: LooperToolState): void {
  state.configOpen = false;
}

export function applyConfig(state: LooperToolState): void {
  state.cwd = state.configCwdDraft;
  state.taskPath = state.configTaskPathDraft;
  state.specsGlob = state.configSpecsGlobDraft;
  state.maxIterations = state.configMaxIterationsDraft;
  state.configOpen = false;
}

export function dismissInstall(state: LooperToolState): void {
  state.installModalOpen = false;
}

export async function recheckInstall(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  const installed = await checkOpenCodeInstalled(state, deps);
  if (installed) {
    await refreshLooperState(state, deps);
    state.installModalOpen = false;
  }
  deps.renderAndBind();
}
