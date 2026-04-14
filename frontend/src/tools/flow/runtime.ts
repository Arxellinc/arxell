import type {
  AppEvent,
  FlowRerunValidationResult,
  FlowRunRecord,
  FlowStartRequest
} from "../../contracts";
import type { FlowRunView, FlowRuntimeSlice } from "./state";

interface ParsedFlowEventPayload {
  runId: string;
  iteration: number | null;
  step: string | null;
  mode: "plan" | "build" | null;
  status: "idle" | "queued" | "running" | "succeeded" | "failed" | "stopped" | null;
  taskId: string | null;
  durationMs: number | null;
  command: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  result: string | null;
  error: string | null;
}

function payloadAsRecord(payload: AppEvent["payload"]): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function parseFlowEventPayload(event: AppEvent): ParsedFlowEventPayload | null {
  const payload = payloadAsRecord(event.payload);
  if (!payload) return null;
  const runId = typeof payload.runId === "string" ? payload.runId : null;
  if (!runId) return null;
  const pick = (key: string): unknown => payload[key];
  const modeRaw = pick("mode");
  const mode = modeRaw === "plan" || modeRaw === "build" ? modeRaw : null;
  const statusRaw = pick("status");
  const status =
    statusRaw === "idle" ||
    statusRaw === "queued" ||
    statusRaw === "running" ||
    statusRaw === "succeeded" ||
    statusRaw === "failed" ||
    statusRaw === "stopped"
      ? statusRaw
      : null;
  return {
    runId,
    iteration: typeof payload.iteration === "number" ? payload.iteration : null,
    step: typeof payload.step === "string" ? payload.step : null,
    mode,
    status,
    taskId: typeof pick("taskId") === "string" ? (pick("taskId") as string) : null,
    durationMs: typeof pick("durationMs") === "number" ? (pick("durationMs") as number) : null,
    command: typeof pick("command") === "string" ? (pick("command") as string) : null,
    exitCode: typeof pick("exitCode") === "number" ? (pick("exitCode") as number) : null,
    stdout: typeof pick("stdout") === "string" ? (pick("stdout") as string) : null,
    stderr: typeof pick("stderr") === "string" ? (pick("stderr") as string) : null,
    result: typeof pick("result") === "string" ? (pick("result") as string) : null,
    error: typeof pick("error") === "string" ? (pick("error") as string) : null
  };
}

function ensureFlowRunFromEvent(
  slice: FlowRuntimeSlice,
  runId: string,
  mode: "plan" | "build" | null,
  timestampMs: number
): FlowRunView {
  let run = slice.flowRuns.find((item) => item.runId === runId);
  if (run) return run;
  run = {
    runId,
    mode: mode ?? slice.flowMode,
    status: "running",
    maxIterations: null,
    currentIteration: 0,
    startedAtMs: timestampMs,
    completedAtMs: null,
    dryRun: slice.flowDryRun,
    autoPush: slice.flowAutoPush,
    promptPlanPath: slice.flowPromptPlanPath,
    promptBuildPath: slice.flowPromptBuildPath,
    planPath: slice.flowPlanPath,
    specsGlob: slice.flowSpecsGlob,
    implementCommand: slice.flowImplementCommand,
    backpressureCommands: slice.flowBackpressureCommands
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    summary: null,
    iterations: []
  };
  slice.flowRuns.unshift(run);
  if (!slice.flowActiveRunId) {
    slice.flowActiveRunId = runId;
  }
  return run;
}

function ensureFlowIteration(run: FlowRunView, index: number, timestampMs: number) {
  let iteration = run.iterations.find((item) => item.index === index);
  if (iteration) return iteration;
  iteration = {
    index,
    status: "running",
    startedAtMs: timestampMs,
    completedAtMs: null,
    taskId: null,
    steps: []
  };
  run.iterations.push(iteration);
  run.iterations.sort((a, b) => a.index - b.index);
  if (index > run.currentIteration) {
    run.currentIteration = index;
  }
  return iteration;
}

export function applyFlowEvent(slice: FlowRuntimeSlice, event: AppEvent): void {
  if (!event.action.startsWith("flow.")) return;
  if (event.action === "flow.model.unavailable") {
    const payload = payloadAsRecord(event.payload);
    const runId = typeof payload?.runId === "string" ? payload.runId : null;
    if (!runId) return;
    const status = typeof payload?.status === "string" ? payload.status : "retrying";
    const phase = typeof payload?.phase === "string" ? payload.phase : "";
    const model = typeof payload?.model === "string" ? payload.model : "";
    const fallbackModel =
      typeof payload?.fallbackModel === "string" ? payload.fallbackModel : "";
    const reason = typeof payload?.reason === "string" ? payload.reason : "Model unavailable";
    const attempt = typeof payload?.attempt === "number" ? payload.attempt : 0;
    const maxAttempts = typeof payload?.maxAttempts === "number" ? payload.maxAttempts : 0;
    slice.flowModelUnavailableOpen = status !== "switched";
    slice.flowModelUnavailablePhase = phase;
    slice.flowModelUnavailableModel = model;
    slice.flowModelUnavailableFallbackModel = fallbackModel;
    slice.flowModelUnavailableReason = reason;
    slice.flowModelUnavailableAttempt = attempt;
    slice.flowModelUnavailableMaxAttempts = maxAttempts;
    slice.flowModelUnavailableStatus = status;
    if (status === "switched" && phase && fallbackModel) {
      slice.flowPhaseModels = {
        ...slice.flowPhaseModels,
        [phase]: fallbackModel
      };
      slice.flowMessage = `Flow switched ${phase} to fallback model ${fallbackModel}.`;
    }
    return;
  }
  const parsed = parseFlowEventPayload(event);
  if (!parsed) return;

  if (event.action === "flow.validation.rerun.complete" || event.action === "flow.validation.rerun.error") {
    const payload = payloadAsRecord(event.payload);
    const resultsRaw = Array.isArray(payload?.results) ? payload.results : [];
    slice.flowValidationResults = resultsRaw
      .map((item): FlowRerunValidationResult | null => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        if (typeof row.command !== "string") return null;
        return {
          command: row.command,
          ok: row.ok === true,
          exitCode: typeof row.exitCode === "number" ? row.exitCode : -1,
          stdout: typeof row.stdout === "string" ? row.stdout : "",
          stderr: typeof row.stderr === "string" ? row.stderr : "",
          durationMs: typeof row.durationMs === "number" ? row.durationMs : 0
        };
      })
      .filter((item): item is FlowRerunValidationResult => item !== null);
  }

  const run = ensureFlowRunFromEvent(slice, parsed.runId, parsed.mode, event.timestampMs);
  if (event.action.startsWith("flow.run.")) {
    if (event.action === "flow.run.start") {
      run.status = "queued";
      run.startedAtMs = Math.min(run.startedAtMs, event.timestampMs);
      run.completedAtMs = null;
      run.summary = null;
    } else if (event.action === "flow.run.complete") {
      run.status = parsed.status ?? "succeeded";
      run.completedAtMs = event.timestampMs;
      run.summary = parsed.result ?? run.summary ?? (run.status === "stopped" ? "Stopped" : null);
      slice.flowModelUnavailableOpen = false;
    } else if (event.action === "flow.run.error") {
      run.status = parsed.status ?? "failed";
      run.completedAtMs = event.timestampMs;
      run.summary = parsed.error ?? "Flow run failed";
      slice.flowModelUnavailableOpen = false;
    } else if (event.action === "flow.run.progress") {
      run.status = parsed.status ?? "running";
    }
    slice.flowActiveRunId = run.runId;
    return;
  }

  if (parsed.iteration === null) return;
  const iteration = ensureFlowIteration(run, parsed.iteration, event.timestampMs);

  if (event.action.startsWith("flow.iteration.")) {
    if (event.action === "flow.iteration.start") {
      iteration.status = "running";
      iteration.startedAtMs = event.timestampMs;
      iteration.completedAtMs = null;
    } else if (event.action === "flow.iteration.complete") {
      iteration.status = "succeeded";
      iteration.completedAtMs = event.timestampMs;
    } else if (event.action === "flow.iteration.error") {
      iteration.status = "failed";
      iteration.completedAtMs = event.timestampMs;
    }
    if (parsed.taskId) {
      iteration.taskId = parsed.taskId;
    }
    return;
  }

  if (!parsed.step) return;
  let step = iteration.steps.find((item) => item.step === parsed.step);
  if (!step) {
    step = {
      step: parsed.step,
      state: "pending",
      startedAtMs: null,
      completedAtMs: null,
      result: null,
      error: null
    };
    iteration.steps.push(step);
  }

  if (event.action === "flow.step.start") {
    step.state = "running";
    step.startedAtMs = event.timestampMs;
    step.completedAtMs = null;
    step.error = null;
  } else if (event.action === "flow.step.progress") {
    if (step.state !== "running") {
      step.state = "running";
    }
    const progressBits = [parsed.command, parsed.stdout, parsed.stderr]
      .filter((item): item is string => Boolean(item && item.trim()))
      .join(" | ");
    if (progressBits) {
      step.result = progressBits;
    }
    if (parsed.step === "validate" && parsed.command) {
      const existingIndex = slice.flowValidationResults.findIndex(
        (item) => item.command === parsed.command
      );
      const entry: FlowRerunValidationResult = {
        command: parsed.command,
        ok: parsed.exitCode === null ? true : parsed.exitCode === 0,
        exitCode: parsed.exitCode ?? 0,
        stdout: parsed.stdout ?? "",
        stderr: parsed.stderr ?? "",
        durationMs: parsed.durationMs ?? 0
      };
      if (existingIndex >= 0) {
        slice.flowValidationResults[existingIndex] = entry;
      } else {
        slice.flowValidationResults.push(entry);
      }
    }
  } else if (event.action === "flow.step.complete") {
    step.state = "complete";
    step.completedAtMs = event.timestampMs;
    if (parsed.result) step.result = parsed.result;
  } else if (event.action === "flow.step.error") {
    step.state = "error";
    step.completedAtMs = event.timestampMs;
    step.error = parsed.error ?? "step failed";
  }
}

export function normalizeFlowRun(run: FlowRunRecord): FlowRunView {
  return {
    ...run,
    implementCommand: run.implementCommand ?? "",
    iterations: run.iterations.map((iteration) => ({
      ...iteration,
      steps: iteration.steps
        .filter(
          (step) =>
            step.state !== "pending" ||
            step.startedAtMs !== null ||
            step.completedAtMs !== null ||
            Boolean(step.result) ||
            Boolean(step.error)
        )
        .map((step) => ({
          ...step
        }))
    }))
  };
}

export function filterFlowEvents(
  events: AppEvent[],
  rawFilter: string,
  maxItems = 120
): { forRender: AppEvent[]; forInspector: AppEvent[] } {
  const flowEvents = events.filter((event) => event.action.startsWith("flow."));
  const filter = rawFilter.trim().toLowerCase();
  const filtered = flowEvents.filter((event) => {
    if (!filter) return true;
    const payloadText =
      typeof event.payload === "object" ? JSON.stringify(event.payload) : String(event.payload);
    const haystack = `${event.action} ${event.correlationId} ${payloadText}`.toLowerCase();
    return haystack.includes(filter);
  });
  const tail = filtered.slice(-maxItems);
  return {
    forRender: tail,
    forInspector: [...tail].reverse()
  };
}

export function buildFlowStartRequest(
  slice: Pick<
    FlowRuntimeSlice,
    | "flowMode"
    | "flowMaxIterations"
    | "flowDryRun"
    | "flowAutoPush"
    | "flowPromptPlanPath"
    | "flowPromptBuildPath"
    | "flowPlanPath"
    | "flowSpecsGlob"
    | "flowImplementCommand"
    | "flowBackpressureCommands"
    | "flowPhaseModels"
  >,
  correlationId: string
): FlowStartRequest {
  const maxIterations = Math.max(1, Math.min(200, Math.trunc(slice.flowMaxIterations || 1)));
  const backpressureCommands = slice.flowBackpressureCommands
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const implementCommand = slice.flowImplementCommand.trim();
  return {
    correlationId,
    mode: slice.flowMode,
    maxIterations,
    dryRun: slice.flowDryRun,
    autoPush: slice.flowAutoPush,
    promptPlanPath: slice.flowPromptPlanPath.trim() || "PROMPT_plan.md",
    promptBuildPath: slice.flowPromptBuildPath.trim() || "PROMPT_build.md",
    planPath: slice.flowPlanPath.trim() || "IMPLEMENTATION_PLAN.md",
    specsGlob: slice.flowSpecsGlob.trim() || "specs/*.md",
    backpressureCommands,
    phaseModels: { ...slice.flowPhaseModels },
    ...(implementCommand ? { implementCommand } : {})
  };
}

export function applyFlowRunSettingsFromRecord(slice: FlowRuntimeSlice, run: FlowRunView): void {
  slice.flowMode = run.mode;
  slice.flowMaxIterations = Math.max(1, run.maxIterations ?? 1);
  slice.flowDryRun = run.dryRun;
  slice.flowAutoPush = run.autoPush;
  slice.flowPromptPlanPath = run.promptPlanPath;
  slice.flowPromptBuildPath = run.promptBuildPath;
  slice.flowPlanPath = run.planPath;
  slice.flowSpecsGlob = run.specsGlob;
  slice.flowImplementCommand = run.implementCommand ?? "";
  slice.flowBackpressureCommands = run.backpressureCommands.join("\n");
  slice.flowPhaseModels = { ...(run.phaseModels ?? {}) };
}
