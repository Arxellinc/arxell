import type { AppEvent, LooperLoopRecord, LooperPhaseRecord } from "../../contracts.js";
import {
  LOOPER_PHASES,
  type LooperLoopRun,
  type LooperPhase,
  type LooperPhaseState,
  type LooperSubStep,
  type LooperToolState
} from "./state.js";

interface LooperPhaseEventPayload {
  loopId: string;
  phase: LooperPhase;
  sessionId?: string;
  result?: string;
  error?: string;
}

interface LooperLoopEventPayload {
  loopId: string;
  iteration: number;
  activePhase?: LooperPhase;
  status?: string;
  reviewResult?: string;
}

function payloadAsRecord(payload: AppEvent["payload"]): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload;
}

function normalizeSubsteps(substeps: Array<{ id: string; label: string; status: string }>): LooperSubStep[] {
  return substeps.map((step) => ({
    id: step.id,
    label: step.label,
    status:
      step.status === "running" ||
      step.status === "complete" ||
      step.status === "error" ||
      step.status === "skipped"
        ? step.status
        : "pending"
  }));
}

function normalizePhaseRecord(phase: LooperPhase, record?: LooperPhaseRecord): LooperPhaseState {
  return {
    phase,
    status: record?.status ?? "idle",
    agentId: null,
    sessionId: record?.sessionId ?? null,
    substeps: normalizeSubsteps(record?.substeps ?? []),
    prompt: record?.prompt ?? "",
    promptDraft: record?.prompt ?? "",
    promptEditing: false
  };
}

export function normalizeLooperLoopRecord(record: LooperLoopRecord): LooperLoopRun {
  const reviewResult =
    record.reviewResult?.toLowerCase() === "ship"
      ? "ship"
      : record.reviewResult?.toLowerCase() === "revise"
        ? "revise"
        : null;

  return {
    id: record.id,
    iteration: record.iteration,
    status: record.status,
    startedAtMs: record.startedAtMs,
    completedAtMs: record.completedAtMs,
    activePhase:
      record.activePhase === "planner" ||
      record.activePhase === "executor" ||
      record.activePhase === "validator" ||
      record.activePhase === "critic"
        ? record.activePhase
        : null,
    phases: {
      planner: normalizePhaseRecord("planner", record.phases.planner),
      executor: normalizePhaseRecord("executor", record.phases.executor),
      validator: normalizePhaseRecord("validator", record.phases.validator),
      critic: normalizePhaseRecord("critic", record.phases.critic)
    },
    reviewResult,
    reviewBeforeExecute: record.reviewBeforeExecute,
    plannerPlan: record.plannerPlan,
    pendingQuestions: record.pendingQuestions,
    reviewAnswers: {},
    preview: {
      status:
        record.preview?.status === "starting" ||
        record.preview?.status === "running" ||
        record.preview?.status === "failed" ||
        record.preview?.status === "stopped"
          ? record.preview.status
          : "idle",
      command: record.preview?.command ?? null,
      url: record.preview?.url ?? null,
      sessionId: record.preview?.sessionId ?? null,
      lastError: record.preview?.lastError ?? null
    },
    launchConfig: {
      cwd: record.cwd,
      taskPath: record.taskPath,
      specsGlob: record.specsGlob,
      maxIterations: record.maxIterations,
      phaseModels: { ...record.phaseModels },
      projectName: record.projectName,
      projectType: record.projectType,
      projectIcon: record.projectIcon,
      projectDescription: record.projectDescription,
      reviewBeforeExecute: record.reviewBeforeExecute
    }
  };
}

function createEventPlaceholderLoop(loopId: string, iteration: number, timestampMs: number): LooperLoopRun {
  const makePhase = (phase: LooperPhase): LooperPhaseState => ({
    phase,
    status: "idle",
    agentId: null,
    sessionId: null,
    substeps: [],
    prompt: "",
    promptDraft: "",
    promptEditing: false
  });

  return {
    id: loopId,
    iteration,
    status: "running",
    startedAtMs: timestampMs,
    completedAtMs: null,
    activePhase: null,
    phases: {
      planner: makePhase("planner"),
      executor: makePhase("executor"),
      validator: makePhase("validator"),
      critic: makePhase("critic")
    },
    reviewResult: null,
    reviewBeforeExecute: true,
    plannerPlan: "",
    pendingQuestions: [],
    reviewAnswers: {},
    preview: {
      status: "idle",
      command: null,
      url: null,
      sessionId: null,
      lastError: null
    }
  };
}

function ensureLoop(state: LooperToolState, loopId: string, iteration: number, timestampMs: number): LooperLoopRun {
  const existing = state.loops.find((loop) => loop.id === loopId);
  if (existing) return existing;
  const created = createEventPlaceholderLoop(loopId, iteration, timestampMs);
  state.loops.push(created);
  if (!state.activeLoopId) {
    state.activeLoopId = loopId;
  }
  return created;
}

function parseLoopPayload(event: AppEvent): LooperLoopEventPayload | null {
  const payload = payloadAsRecord(event.payload);
  if (!payload || typeof payload.loopId !== "string") return null;
  const result: LooperLoopEventPayload = {
    loopId: payload.loopId,
    iteration: typeof payload.iteration === "number" ? payload.iteration : 0
  };
  if (typeof payload.activePhase === "string") {
    result.activePhase = payload.activePhase as LooperPhase;
  }
  if (typeof payload.status === "string") {
    result.status = payload.status;
  }
  if (typeof payload.reviewResult === "string") {
    result.reviewResult = payload.reviewResult;
  }
  return result;
}

function parsePhasePayload(event: AppEvent): LooperPhaseEventPayload | null {
  const payload = payloadAsRecord(event.payload);
  if (!payload || typeof payload.loopId !== "string") return null;
  const phaseRaw =
    typeof payload.phase === "string"
      ? payload.phase
      : typeof payload.toPhase === "string"
        ? payload.toPhase
        : null;
  if (phaseRaw !== "planner" && phaseRaw !== "executor" && phaseRaw !== "validator" && phaseRaw !== "critic") {
    return null;
  }

  const result: LooperPhaseEventPayload = {
    loopId: payload.loopId,
    phase: phaseRaw
  };
  if (typeof payload.sessionId === "string") {
    result.sessionId = payload.sessionId;
  }
  if (typeof payload.result === "string") {
    result.result = payload.result;
  }
  if (typeof payload.error === "string") {
    result.error = payload.error;
  }
  return result;
}

function markRunningSubsteps(state: LooperPhaseState, nextStatus: "complete" | "error"): void {
  for (const step of state.substeps) {
    if (step.status === "running") {
      step.status = nextStatus;
    }
  }
}

export function applyLooperEvent(state: LooperToolState, event: AppEvent): void {
  if (!event.action.startsWith("looper.")) return;

  if (event.action === "looper.check-opencode.result") {
    const payload = payloadAsRecord(event.payload);
    if (typeof payload?.installed === "boolean") {
      state.installed = payload.installed;
      state.installModalOpen = !payload.installed;
      state.installChecking = false;
    }
    return;
  }

  if (event.action === "looper.loop.revise") {
    const payload = payloadAsRecord(event.payload);
    if (!payload || typeof payload.loopId !== "string") return;
    const loop = state.loops.find((item) => item.id === payload.loopId);
    if (!loop) return;
    if (typeof payload.newIteration === "number") {
      loop.iteration = payload.newIteration;
    }
    loop.status = "running";
    loop.completedAtMs = null;
    return;
  }

  const loopPayload = parseLoopPayload(event);
  if (loopPayload && event.action.startsWith("looper.loop.")) {
    const loop = ensureLoop(state, loopPayload.loopId, loopPayload.iteration, event.timestampMs);
    if (event.action === "looper.loop.start") {
      loop.status = "running";
      loop.activePhase = loopPayload.activePhase ?? loop.activePhase ?? "planner";
      return;
    }
    if (event.action === "looper.loop.complete") {
      loop.status = "completed";
      loop.completedAtMs = event.timestampMs;
      loop.reviewResult =
        loopPayload.reviewResult?.toLowerCase() === "ship"
          ? "ship"
          : loopPayload.reviewResult?.toLowerCase() === "revise"
            ? "revise"
            : loop.reviewResult;
      return;
    }
    if (event.action === "looper.loop.failed") {
      loop.status = "failed";
      loop.completedAtMs = event.timestampMs;
      return;
    }
    if (event.action === "looper.loop.paused") {
      const payload = payloadAsRecord(event.payload);
      loop.status = payload?.paused === true ? "paused" : "running";
      return;
    }
  }

  const phasePayload = parsePhasePayload(event);
  if (!phasePayload) return;
  const loop = ensureLoop(state, phasePayload.loopId, 0, event.timestampMs);
  const phaseState = loop.phases[phasePayload.phase];

  if (event.action === "looper.phase.start") {
    loop.activePhase = phasePayload.phase;
    phaseState.status = "running";
    if (phasePayload.sessionId) {
      phaseState.sessionId = phasePayload.sessionId;
    }
    if (phaseState.substeps[0]) {
      phaseState.substeps[0].status = "running";
    }
    return;
  }

  if (event.action === "looper.phase.transition") {
    const payload = payloadAsRecord(event.payload);
    if (typeof payload?.fromPhase === "string") {
      const from = payload.fromPhase as LooperPhase;
      if (LOOPER_PHASES.includes(from)) {
        loop.phases[from].status = "complete";
        markRunningSubsteps(loop.phases[from], "complete");
      }
    }
    loop.activePhase = phasePayload.phase;
    phaseState.status = "running";
    if (phasePayload.sessionId) {
      phaseState.sessionId = phasePayload.sessionId;
    }
    if (phaseState.substeps[0]) {
      phaseState.substeps[0].status = "running";
    }
    return;
  }

  if (event.action === "looper.phase.complete") {
    phaseState.status = "complete";
    markRunningSubsteps(phaseState, "complete");
    return;
  }

  if (event.action === "looper.phase.error") {
    phaseState.status = "error";
    markRunningSubsteps(phaseState, "error");
  }
}
