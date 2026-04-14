import { FLOW_DATA_ATTR, FLOW_UI_ID } from "../ui/constants";
import type { FlowRunView, FlowRuntimeSlice } from "./state";

interface FlowClickDeps {
  refreshRuns: () => Promise<void>;
  startRun: () => Promise<void>;
  stopRun: () => Promise<void>;
  resumeRun: (run: FlowRunView) => Promise<void>;
  retryRun: (run: FlowRunView) => Promise<void>;
  rerunValidation: (run: FlowRunView) => Promise<void>;
  openPhaseTerminal: (phase: string) => Promise<void>;
  closePhaseTerminal: (phase: string) => Promise<void>;
  createProjectSetup: (name: string, projectType: string, description: string) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  nudgeRun: (message: string) => Promise<void>;
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
  if (flowAction === "toggle-advanced") {
    slice.flowAdvancedOpen = !slice.flowAdvancedOpen;
    return true;
  }
  if (flowAction === "set-mode-plan") {
    slice.flowMode = "plan";
    return true;
  }
  if (flowAction === "set-mode-build") {
    slice.flowMode = "build";
    return true;
  }
  if (flowAction === "toggle-dry-run") {
    slice.flowDryRun = !slice.flowDryRun;
    return true;
  }
  if (flowAction === "toggle-phase-follow") {
    slice.flowAutoFocusPhaseTerminal = !slice.flowAutoFocusPhaseTerminal;
    return true;
  }
  if (flowAction === "toggle-paused-run") {
    const nextPaused = !slice.flowPaused;
    await deps.setPaused(nextPaused);
    slice.flowPaused = nextPaused;
    return true;
  }
  if (flowAction === "pause-for-model-recovery") {
    if (!slice.flowPaused) {
      await deps.setPaused(true);
      slice.flowPaused = true;
    }
    slice.flowModelUnavailableStatus = "paused";
    return true;
  }
  if (flowAction === "dismiss-model-recovery-modal") {
    slice.flowModelUnavailableOpen = false;
    return true;
  }
  if (flowAction === "nudge-run") {
    const message = window.prompt("Redirect/nudge instruction for current run:");
    if (message && message.trim()) {
      await deps.nudgeRun(message.trim());
      slice.flowMessage = "Run nudged.";
    }
    return true;
  }
  if (flowAction === "select-bottom-panel") {
    const panel = target.getAttribute(FLOW_DATA_ATTR.panel);
    if (panel === "terminal" || panel === "validate" || panel === "events") {
      slice.flowBottomPanel = panel;
    }
    return true;
  }
  if (flowAction === "select-terminal-phase") {
    const phase = target.getAttribute(FLOW_DATA_ATTR.phase);
    if (phase) {
      slice.flowActiveTerminalPhase = phase;
    }
    return true;
  }
  if (flowAction === "open-phase-terminal") {
    const phase = target.getAttribute(FLOW_DATA_ATTR.phase) || slice.flowActiveTerminalPhase;
    if (phase) {
      await deps.openPhaseTerminal(phase);
    }
    return true;
  }
  if (flowAction === "close-phase-terminal") {
    const phase = target.getAttribute(FLOW_DATA_ATTR.phase) || slice.flowActiveTerminalPhase;
    if (phase) {
      await deps.closePhaseTerminal(phase);
    }
    return true;
  }
  if (flowAction === "create-project-setup") {
    await deps.createProjectSetup(
      slice.flowProjectNameDraft.trim(),
      slice.flowProjectTypeDraft,
      slice.flowProjectDescriptionDraft.trim()
    );
    slice.flowProjectSetupOpen = false;
    slice.flowProjectSetupDismissed = false;
    return true;
  }
  if (flowAction === "skip-project-setup") {
    slice.flowProjectSetupOpen = false;
    slice.flowProjectSetupDismissed = true;
    return true;
  }
  if (flowAction === "set-phase-model") {
    const phase = target.getAttribute(FLOW_DATA_ATTR.phase);
    const select = target.closest("select");
    if (phase && select) {
      slice.flowPhaseModels = {
        ...slice.flowPhaseModels,
        [phase]: (select as HTMLSelectElement).value || "auto"
      };
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
    `#${FLOW_UI_ID.promptPlanPath}, #${FLOW_UI_ID.promptBuildPath}, #${FLOW_UI_ID.planPath}, #${FLOW_UI_ID.specsGlob}, #${FLOW_UI_ID.implementCommand}, #${FLOW_UI_ID.eventFilterInput}, #${FLOW_UI_ID.projectNameInput}`
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
    } else if (flowTextInput.id === FLOW_UI_ID.projectNameInput) {
      slice.flowProjectNameDraft = flowTextInput.value;
      }
    return { handled: true, rerender: rerenderForFlow };
  }

  const projectTypeSelect = target.closest<HTMLSelectElement>(`#${FLOW_UI_ID.projectTypeSelect}`);
  if (projectTypeSelect) {
    slice.flowProjectTypeDraft = projectTypeSelect.value;
    return { handled: true, rerender: false };
  }

  const projectDescription = target.closest<HTMLTextAreaElement>(`#${FLOW_UI_ID.projectDescriptionInput}`);
  if (projectDescription) {
    slice.flowProjectDescriptionDraft = projectDescription.value;
    return { handled: true, rerender: false };
  }

  const flowCommands = target.closest<HTMLTextAreaElement>(`#${FLOW_UI_ID.backpressureCommands}`);
  if (flowCommands) {
    slice.flowBackpressureCommands = flowCommands.value;
    rerenderForFlow = true;
    return { handled: true, rerender: rerenderForFlow };
  }

  return { handled: false, rerender: false };
}
