import type {
  LooperCheckOpenCodeResponse,
  LooperCloseAllResponse,
  LooperCloseResponse,
  LooperImportResponse,
  LooperListResponse,
  LooperPauseResponse,
  LooperPreviewResponse,
  LooperStartRequest,
  LooperStartResponse,
  LooperStopResponse
} from "../../contracts.js";
import type { ChatIpcClient } from "../../ipcClient.js";
import { ensureUserProject, getUserProjectRoots } from "../../projects.js";
import type { TerminalManager } from "../terminal/index.js";
import { normalizeLooperLoopRecord } from "./runtime.js";
import type { LooperPhase, LooperToolState } from "./state.js";
import { createLoopRun, LOOPER_PHASE_LABELS, LOOPER_PHASES, sanitizeLooperToolId } from "./state.js";

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
          owner: "looper",
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
  if (!state.directoryPreviewRoots) {
    const roots = await getUserProjectRoots(deps.client, deps.nextCorrelationId());
    state.directoryPreviewRoots = {
      projectsRoot: roots.projectsRoot,
      toolsRoot: roots.toolsRoot
    };
  }
  if (state.installed === null) {
    await checkOpenCodeInstalled(state, deps);
  }
  await refreshLooperState(state, deps);
  deps.renderAndBind();
}

export async function createLoop(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<string | null> {
  if (state.busy) return null;
  const projectName = state.projectNameDraft.trim();
  if (projectName) {
    if (state.projectTypeDraft === "app-tool") {
      const toolId = sanitizeLooperToolId(projectName) || "project";
      const toolsRoot = state.directoryPreviewRoots?.toolsRoot;
      if (toolsRoot) {
        state.configCwdDraft = `${toolsRoot.replace(/[\\/]+$/, "")}/${toolId}`;
        state.cwd = state.configCwdDraft;
      }
    } else {
      const project = await ensureUserProject(deps.client, deps.nextCorrelationId(), projectName);
      state.configCwdDraft = project.rootPath;
      state.cwd = project.rootPath;
    }
  }
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
  loop.reviewBeforeExecute = state.reviewBeforeExecuteDraft;
  state.loops.push(loop);
  state.activeLoopId = loop.id;
  state.nextLoopIndex = loopIndex + 1;
  state.statusMessage = `Loop ${loop.iteration} ready to start.`;
  deps.renderAndBind();
  return loop.id;
}

export async function createAndStartLoop(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  const loopId = await createLoop(state, deps);
  if (!loopId) return;
  await startLoop(state, deps, loopId);
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
    projectDescription: launchConfig?.projectDescription || state.projectDescriptionDraft,
    reviewBeforeExecute: loop.reviewBeforeExecute
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

export async function submitPlannerReview(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;
  state.busy = true;
  state.statusMessage = "Submitting planner review...";
  deps.renderAndBind();
  try {
    const answers = loop.pendingQuestions
      .map((question) => {
        const answer = loop.reviewAnswers[question.id];
        return {
          questionId: question.id,
          selectedOptionId: answer?.selectedOptionId || "",
          freeformText: answer?.freeformText?.trim() || undefined
        };
      })
      .filter((answer) => answer.selectedOptionId || answer.freeformText);
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "looper",
      action: "submit-questions",
      mode: "sandbox",
      payload: {
        correlationId,
        loopId,
        answers
      }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed to submit planner review.");
    }
    loop.pendingQuestions = [];
    loop.plannerPlan = "";
    loop.reviewAnswers = {};
    state.statusMessage = "Planner review submitted.";
    await refreshLooperState(state, deps);
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to submit planner review.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function openPreview(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;
  state.busy = true;
  state.statusMessage = loop.preview.status === "running" ? "Opening preview..." : "Starting preview...";
  deps.renderAndBind();
  try {
    const response = await deps.client.openLooperPreviewWindow({
      correlationId: deps.nextCorrelationId(),
      loopId
    });
    applyPreviewResponse(loop, response);
    state.statusMessage = response.url ? `Preview ready at ${response.url}` : response.lastError || "Preview is starting...";
    await refreshLooperState(state, deps);
  } catch (error) {
    loop.preview.status = "failed";
    loop.preview.lastError = error instanceof Error ? error.message : "Failed to open preview.";
    state.statusMessage = loop.preview.lastError;
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function stopPreview(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;
  state.busy = true;
  state.statusMessage = "Stopping preview...";
  deps.renderAndBind();
  try {
    const response = await deps.client.toolInvoke({
      correlationId: deps.nextCorrelationId(),
      toolId: "looper",
      action: "stop-preview",
      mode: "sandbox",
      payload: {
        correlationId: deps.nextCorrelationId(),
        loopId
      }
    });
    if (!response.ok) {
      throw new Error(response.error || "Failed to stop preview.");
    }
    applyPreviewResponse(loop, response.data as unknown as LooperPreviewResponse);
    state.statusMessage = "Preview stopped.";
    await refreshLooperState(state, deps);
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to stop preview.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function restartPreview(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  await stopPreview(state, deps, loopId);
  await openPreview(state, deps, loopId);
}

function applyPreviewResponse(
  loop: LooperToolState["loops"][number],
  response: LooperPreviewResponse
): void {
  loop.preview.status =
    response.status === "starting" || response.status === "running" || response.status === "stopped"
      ? response.status
      : "failed";
  loop.preview.command = response.command ?? null;
  loop.preview.url = response.url ?? null;
  loop.preview.sessionId = response.sessionId ?? null;
  loop.preview.lastError = response.lastError ?? null;
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

export async function closeAllLoops(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  if (state.busy || !state.loops.length) return;
  state.busy = true;
  state.statusMessage = "Closing all loops...";
  deps.renderAndBind();
  try {
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "looper",
      action: "close-all",
      mode: "sandbox",
      payload: { correlationId }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed to close all loops.");
    }
    const response = invokeResponse.data as unknown as LooperCloseAllResponse;
    state.loops = [];
    state.activeLoopId = null;
    state.statusMessage = `Closed ${response.closedCount} loop(s).`;
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to close all loops.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function saveSessionAs(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  if (state.busy || !state.loops.length) return;
  state.busy = true;
  state.statusMessage = "Saving session...";
  deps.renderAndBind();
  try {
    const correlationId = deps.nextCorrelationId();
    const listResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "looper",
      action: "list",
      mode: "sandbox",
      payload: { correlationId }
    });
    if (!listResponse.ok) {
      throw new Error(listResponse.error || "Failed to list loops for export.");
    }
    const listData = listResponse.data as unknown as LooperListResponse;
    const projectName = listData.loops[0]?.projectName || "looper-session";
    const defaultName = `${projectName}.looper.json`;
    const savePath = await pickSavePath(defaultName);
    if (!savePath) {
      state.statusMessage = "Save cancelled.";
      return;
    }
    const json = JSON.stringify(listData.loops, null, 2);
    const writeResponse = await deps.client.toolInvoke({
      correlationId: deps.nextCorrelationId(),
      toolId: "files",
      action: "write-file",
      mode: "sandbox",
      payload: { correlationId: deps.nextCorrelationId(), path: savePath, content: json }
    });
    if (!writeResponse.ok) {
      throw new Error(writeResponse.error || "Failed to write session file.");
    }
    state.statusMessage = `Session saved to ${savePath}`;
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to save session.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function openSession(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  if (state.busy) return;
  const openPath = await pickOpenPath();
  if (!openPath) {
    state.statusMessage = "Open cancelled.";
    deps.renderAndBind();
    return;
  }
  state.busy = true;
  state.statusMessage = "Loading session...";
  deps.renderAndBind();
  try {
    const correlationId = deps.nextCorrelationId();
    const readResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "files",
      action: "read-file",
      mode: "sandbox",
      payload: { correlationId, path: openPath }
    });
    if (!readResponse.ok) {
      throw new Error(readResponse.error || "Failed to read session file.");
    }
    const fileData = readResponse.data as { content: string };
    const records = JSON.parse(fileData.content);
    if (!Array.isArray(records)) {
      throw new Error("Invalid session file: expected an array of loop records.");
    }
    const importResponse = await deps.client.toolInvoke({
      correlationId: deps.nextCorrelationId(),
      toolId: "looper",
      action: "import",
      mode: "sandbox",
      payload: {
        correlationId: deps.nextCorrelationId(),
        loops: records
      }
    });
    if (!importResponse.ok) {
      throw new Error(importResponse.error || "Failed to import session.");
    }
    const importData = importResponse.data as unknown as LooperImportResponse;
    state.statusMessage = `Loaded ${importData.importedCount} loop(s) from ${openPath}`;
    await refreshLooperState(state, deps);
  } catch (error) {
    state.statusMessage = error instanceof Error ? error.message : "Failed to open session.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

async function pickSavePath(defaultName: string): Promise<string | null> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | null>("plugin:dialog|save", {
        options: {
          title: "Save Looper Session",
          defaultPath: defaultName,
          filters: [{ name: "Looper Session", extensions: ["looper.json"] }]
        }
      });
      return selected;
    } catch {
      // Fall through to manual prompt.
    }
  }
  const entered = window.prompt("Save session path", defaultName)?.trim();
  return entered || null;
}

async function pickOpenPath(): Promise<string | null> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
          title: "Open Looper Session",
          directory: false,
          multiple: false,
          filters: [{ name: "Looper Session", extensions: ["looper.json"] }]
        }
      });
      if (Array.isArray(selected)) return selected[0] ?? null;
      return selected;
    } catch {
      // Fall through to manual prompt.
    }
  }
  const entered = window.prompt("Open session path")?.trim();
  return entered || null;
}
