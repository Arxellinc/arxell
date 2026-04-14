import type { AppEvent, FlowMode, FlowRerunValidationResult, FlowRunRecord } from "../../contracts";

export interface FlowStepView {
  step: string;
  state: "pending" | "running" | "complete" | "error" | "skipped";
  startedAtMs: number | null;
  completedAtMs: number | null;
  result: string | null;
  error: string | null;
}

export interface FlowIterationView {
  index: number;
  status: "idle" | "queued" | "running" | "succeeded" | "failed" | "stopped";
  startedAtMs: number;
  completedAtMs: number | null;
  taskId: string | null;
  steps: FlowStepView[];
}

export interface FlowRunView extends Omit<FlowRunRecord, "iterations"> {
  iterations: FlowIterationView[];
}

export interface FlowPhaseTranscriptEntry {
  timestampMs: number;
  runId: string;
  phase: string;
  kind: "start" | "progress" | "complete" | "error" | "run";
  message: string;
}

export interface FlowRuntimeSlice {
  flowRuns: FlowRunView[];
  flowActiveRunId: string | null;
  flowMode: FlowMode;
  flowMaxIterations: number;
  flowDryRun: boolean;
  flowAutoPush: boolean;
  flowPromptPlanPath: string;
  flowPromptBuildPath: string;
  flowPlanPath: string;
  flowSpecsGlob: string;
  flowImplementCommand: string;
  flowBackpressureCommands: string;
  flowEventFilter: string;
  flowValidationResults: FlowRerunValidationResult[];
  flowFilteredEvents: AppEvent[];
  flowMessage: string | null;
  flowBusy: boolean;
  flowAdvancedOpen: boolean;
  flowBottomPanel: "terminal" | "validate" | "events";
  flowWorkspaceSplit: number;
  flowActiveTerminalPhase: string;
  flowPhaseSessionByName: Record<string, string>;
  flowAutoFocusPhaseTerminal: boolean;
  flowPhaseTranscriptsByRun: Record<string, Record<string, FlowPhaseTranscriptEntry[]>>;
  flowProjectSetupOpen: boolean;
  flowProjectSetupDismissed: boolean;
  flowProjectNameDraft: string;
  flowProjectTypeDraft: string;
  flowProjectIconDraft: string;
  flowProjectDescriptionDraft: string;
  flowPhaseModels: Record<string, string>;
  flowAvailableModels: Array<{ id: string; label: string }>;
  flowPaused: boolean;
  flowModelUnavailableOpen: boolean;
  flowModelUnavailablePhase: string;
  flowModelUnavailableModel: string;
  flowModelUnavailableFallbackModel: string;
  flowModelUnavailableReason: string;
  flowModelUnavailableAttempt: number;
  flowModelUnavailableMaxAttempts: number;
  flowModelUnavailableStatus: string;
}
