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
}
