import type { TerminalManager } from "../terminal/index";
import type { ChatIpcClient } from "../../ipcClient";
import type {
  LooperPhase,
  LooperToolState
} from "./state";
import { createLoopRun } from "./state";

export interface LooperActionsDeps {
  terminalManager: TerminalManager;
  client: ChatIpcClient;
  nextCorrelationId: () => string;
  renderAndBind: () => void;
  defaultCwd?: string;
}

async function checkOpenCodeInstalled(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<boolean> {
  state.installChecking = true;
  state.installed = null;
  deps.renderAndBind();

  try {
    const correlationId = deps.nextCorrelationId();
    const probe = await deps.terminalManager.createSession({ shell: "/bin/sh" });
    const probeId = probe.sessionId;
    let outputBuffer = "";

    const cleanup = deps.client.onEvent((event) => {
      if (event.action === "terminal.output") {
        const payload = event.payload as Record<string, unknown>;
        if (payload?.sessionId === probeId && typeof payload?.data === "string") {
          outputBuffer += payload.data;
        }
      }
    });

    await deps.client.sendTerminalInput({
      sessionId: probeId,
      input: "which opencode\n",
      correlationId
    });

    await sleep(2000);
    cleanup();

    const found =
      outputBuffer.includes("/") &&
      !outputBuffer.includes("not found") &&
      !outputBuffer.includes("which: no");

    await deps.terminalManager.closeSession(probeId);

    state.installed = found;
    if (!found) {
      state.installModalOpen = true;
    }
    return found;
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
  if (state.installed !== null) return;
  await checkOpenCodeInstalled(state, deps);
}

export async function createLoop(
  state: LooperToolState,
  deps: LooperActionsDeps
): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  deps.renderAndBind();

  const loopIndex = state.nextLoopIndex;
  const cwd = state.cwd || deps.defaultCwd || ".";
  const loop = createLoopRun(loopIndex, cwd, {
    projectName: state.projectNameDraft,
    projectType: state.projectTypeDraft,
    projectIcon: state.projectIconDraft,
    projectDescription: state.projectDescriptionDraft
  });
  const allPhases: LooperPhase[] = ["planner", "executor", "validator", "critic"];

  try {
    for (const phase of allPhases) {
      const createOpts: { cwd?: string } = {};
      if (cwd && cwd !== ".") createOpts.cwd = cwd;

      const session = await deps.terminalManager.createSession(createOpts);
      loop.phases[phase].sessionId = session.sessionId;
      loop.phases[phase].agentId = `looper-${loop.id}-${phase}`;
    }

    state.loops.push(loop);
    state.activeLoopId = loop.id;
    state.nextLoopIndex = loopIndex + 1;
  } catch {
    for (const phase of allPhases) {
      const sessionId = loop.phases[phase].sessionId;
      if (sessionId) {
        await deps.terminalManager.closeSession(sessionId).catch(() => {});
      }
    }
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function startLoop(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  const loop = state.loops.find((l) => l.id === loopId);
  if (!loop || loop.status === "running") return;

  loop.status = "running";
  loop.activePhase = "planner";
  loop.phases.planner.status = "running";
  loop.phases.planner.substeps.forEach((s, i) => {
    s.status = i === 0 ? "running" : "pending";
  });

  state.statusMessage = `Iteration ${loop.iteration}: Planner starting...`;
  deps.renderAndBind();

  const plannerSessionId = loop.phases.planner.sessionId;
  if (plannerSessionId) {
    await sleep(300);
    await deps.client.sendTerminalInput({
      sessionId: plannerSessionId,
      input: "opencode\n",
      correlationId: deps.nextCorrelationId()
    });

    const prompt = loop.phases.planner.prompt;
    if (prompt) {
      await sleep(1500);
      await deps.client.sendTerminalInput({
        sessionId: plannerSessionId,
        input: `${prompt}\n`,
        correlationId: deps.nextCorrelationId()
      });
    }
  }
}

export async function advancePhase(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string,
  nextPhase: LooperPhase
): Promise<void> {
  const loop = state.loops.find((l) => l.id === loopId);
  if (!loop) return;

  const prevPhase = loop.activePhase;
  if (prevPhase && loop.phases[prevPhase]) {
    loop.phases[prevPhase].status = "complete";
    loop.phases[prevPhase].substeps.forEach((s) => {
      if (s.status === "running") s.status = "complete";
    });
  }

  loop.activePhase = nextPhase;
  loop.phases[nextPhase].status = "running";
  loop.phases[nextPhase].substeps.forEach((s, i) => {
    s.status = i === 0 ? "running" : "pending";
  });

  state.statusMessage = `Iteration ${loop.iteration}: ${nextPhase.charAt(0).toUpperCase() + nextPhase.slice(1)} running...`;
  deps.renderAndBind();

  const sessionId = loop.phases[nextPhase].sessionId;
  if (sessionId) {
    await deps.client.sendTerminalInput({
      sessionId,
      input: "opencode\n",
      correlationId: deps.nextCorrelationId()
    });

    const prompt = loop.phases[nextPhase].prompt;
    if (prompt) {
      await sleep(1500);
      await deps.client.sendTerminalInput({
        sessionId,
        input: `${prompt}\n`,
        correlationId: deps.nextCorrelationId()
      });
    }
  }
}

export function pauseLoop(state: LooperToolState, loopId: string): void {
  const loop = state.loops.find((l) => l.id === loopId);
  if (!loop || loop.status !== "running") return;
  loop.status = "paused";
  state.statusMessage = `Iteration ${loop.iteration}: Paused`;
}

export function stopLoop(state: LooperToolState, loopId: string): void {
  const loop = state.loops.find((l) => l.id === loopId);
  if (!loop) return;
  loop.status = "failed";
  loop.completedAtMs = Date.now();
  state.statusMessage = `Iteration ${loop.iteration}: Stopped`;
}

export async function closeLoop(
  state: LooperToolState,
  deps: LooperActionsDeps,
  loopId: string
): Promise<void> {
  const loop = state.loops.find((l) => l.id === loopId);
  if (!loop) return;

  const phases: LooperPhase[] = ["planner", "executor", "validator", "critic"];
  for (const phase of phases) {
    const sessionId = loop.phases[phase].sessionId;
    if (sessionId) {
      await deps.terminalManager.closeSession(sessionId).catch(() => {});
    }
  }

  state.loops = state.loops.filter((l) => l.id !== loopId);
  if (state.activeLoopId === loopId) {
    const next = state.loops[state.loops.length - 1];
    state.activeLoopId = next?.id ?? null;
  }
}

export function switchLoop(state: LooperToolState, loopId: string): void {
  if (state.activeLoopId === loopId) return;
  state.activeLoopId = loopId;
}

export function setPhasePrompt(
  state: LooperToolState,
  loopId: string,
  phase: LooperPhase,
  prompt: string
): void {
  const loop = state.loops.find((l) => l.id === loopId);
  if (!loop) return;
  loop.phases[phase].prompt = prompt;
}

export function togglePhasePromptEdit(
  state: LooperToolState,
  loopId: string,
  phase: LooperPhase
): void {
  const loop = state.loops.find((l) => l.id === loopId);
  if (!loop) return;
  const ps = loop.phases[phase];
  ps.promptEditing = !ps.promptEditing;
  if (ps.promptEditing) {
    ps.promptDraft = ps.prompt;
  } else {
    ps.prompt = ps.promptDraft;
  }
}

export function updatePhasePromptDraft(
  state: LooperToolState,
  loopId: string,
  phase: LooperPhase,
  draft: string
): void {
  const loop = state.loops.find((l) => l.id === loopId);
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
    state.installModalOpen = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
