import { FLOW_DATA_ATTR, FLOW_UI_ID } from "../ui/constants";
import type { FlowRunView, FlowRuntimeSlice } from "./state";

interface FlowClickDeps {
  refreshRuns: () => Promise<void>;
  startRun: () => Promise<void>;
  stopRun: () => Promise<void>;
  resumeRun: (run: FlowRunView) => Promise<void>;
  retryRun: (run: FlowRunView) => Promise<void>;
  rerunValidation: (run: FlowRunView) => Promise<void>;
}

export async function handleFlowClick(
  target: HTMLElement,
  slice: FlowRuntimeSlice,
  deps: FlowClickDeps
): Promise<boolean> {
  const flowAction = target.getAttribute(FLOW_DATA_ATTR.action);
  const flowRunId = target.getAttribute(FLOW_DATA_ATTR.runId);
  if (!flowAction) return false;

  if (flowAction === "refresh-runs") {
    await deps.refreshRuns();
    return true;
  }
  if (flowAction === "start-run") {
    await deps.startRun();
    return true;
  }
  if (flowAction === "stop-run") {
    await deps.stopRun();
    return true;
  }
  if (flowAction === "select-run" && flowRunId) {
    slice.flowActiveRunId = flowRunId;
    slice.flowValidationResults = [];
    return true;
  }
  if (flowAction === "resume-run") {
    const baseRun = slice.flowRuns.find((run) => run.runId === slice.flowActiveRunId);
    if (baseRun) {
      await deps.resumeRun(baseRun);
    }
    return true;
  }
  if (flowAction === "retry-run") {
    const baseRun = slice.flowRuns.find((run) => run.runId === slice.flowActiveRunId);
    if (baseRun) {
      await deps.retryRun(baseRun);
    }
    return true;
  }
  if (flowAction === "rerun-validation") {
    const baseRun = slice.flowRuns.find((run) => run.runId === slice.flowActiveRunId);
    if (baseRun) {
      await deps.rerunValidation(baseRun);
    }
    return true;
  }
  if (flowAction === "copy-event") {
    const indexRaw = target.getAttribute("data-flow-event-index");
    const index = indexRaw ? Number.parseInt(indexRaw, 10) : Number.NaN;
    const eventRow = Number.isFinite(index) ? slice.flowFilteredEvents[index] : null;
    if (eventRow) {
      const payloadText =
        typeof eventRow.payload === "object"
          ? JSON.stringify(eventRow.payload, null, 2)
          : String(eventRow.payload);
      const text = `${new Date(eventRow.timestampMs).toISOString()} ${eventRow.action} ${eventRow.stage} corr=${eventRow.correlationId}\n${payloadText}`;
      void navigator.clipboard?.writeText(text);
      slice.flowMessage = "Copied event payload.";
    }
    return true;
  }

  return false;
}

export function handleFlowChange(target: HTMLElement, slice: FlowRuntimeSlice): boolean {
  const flowModeSelect = target.closest<HTMLSelectElement>(`#${FLOW_UI_ID.modeSelect}`);
  if (flowModeSelect && (flowModeSelect.value === "plan" || flowModeSelect.value === "build")) {
    slice.flowMode = flowModeSelect.value;
    return true;
  }

  const flowMaxInput = target.closest<HTMLInputElement>(`#${FLOW_UI_ID.maxIterationsInput}`);
  if (flowMaxInput) {
    const parsed = Number.parseInt(flowMaxInput.value, 10);
    slice.flowMaxIterations = Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 1;
    return true;
  }

  const dryRunToggle = target.closest<HTMLInputElement>(`#${FLOW_UI_ID.dryRunToggle}`);
  if (dryRunToggle) {
    slice.flowDryRun = dryRunToggle.checked;
    return true;
  }

  const autoPushToggle = target.closest<HTMLInputElement>(`#${FLOW_UI_ID.autoPushToggle}`);
  if (autoPushToggle) {
    slice.flowAutoPush = autoPushToggle.checked;
    return true;
  }

  return false;
}

export function handleFlowInput(target: HTMLElement, slice: FlowRuntimeSlice): { handled: boolean; rerender: boolean } {
  let rerenderForFlow = false;

  const flowTextInput = target.closest<HTMLInputElement>(
    `#${FLOW_UI_ID.promptPlanPath}, #${FLOW_UI_ID.promptBuildPath}, #${FLOW_UI_ID.planPath}, #${FLOW_UI_ID.specsGlob}, #${FLOW_UI_ID.implementCommand}, #${FLOW_UI_ID.eventFilterInput}`
  );
  if (flowTextInput) {
    if (flowTextInput.id === FLOW_UI_ID.promptPlanPath) {
      slice.flowPromptPlanPath = flowTextInput.value;
    } else if (flowTextInput.id === FLOW_UI_ID.promptBuildPath) {
      slice.flowPromptBuildPath = flowTextInput.value;
    } else if (flowTextInput.id === FLOW_UI_ID.planPath) {
      slice.flowPlanPath = flowTextInput.value;
    } else if (flowTextInput.id === FLOW_UI_ID.specsGlob) {
      slice.flowSpecsGlob = flowTextInput.value;
    } else if (flowTextInput.id === FLOW_UI_ID.implementCommand) {
      slice.flowImplementCommand = flowTextInput.value;
    } else if (flowTextInput.id === FLOW_UI_ID.eventFilterInput) {
      slice.flowEventFilter = flowTextInput.value;
      rerenderForFlow = true;
    }
    return { handled: true, rerender: rerenderForFlow };
  }

  const flowCommands = target.closest<HTMLTextAreaElement>(`#${FLOW_UI_ID.backpressureCommands}`);
  if (flowCommands) {
    slice.flowBackpressureCommands = flowCommands.value;
    rerenderForFlow = true;
    return { handled: true, rerender: rerenderForFlow };
  }

  return { handled: false, rerender: false };
}
