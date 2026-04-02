import type { ChatIpcClient } from "../../ipcClient";
import { applyFlowRunSettingsFromRecord, buildFlowStartRequest } from "./runtime";
import type { FlowRunView, FlowRuntimeSlice } from "./state";

interface FlowActionDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
  refreshFlowRuns: () => Promise<void>;
}

export async function startFlowRun(slice: FlowRuntimeSlice, deps: FlowActionDeps): Promise<void> {
  if (!deps.client || slice.flowBusy) return;
  slice.flowBusy = true;
  slice.flowMessage = "Starting flow run...";
  try {
    const request = buildFlowStartRequest(slice, deps.nextCorrelationId());
    const invokeResponse = await deps.client.toolInvoke({
      correlationId: request.correlationId,
      toolId: "flow",
      action: "start",
      mode: "sandbox",
      payload: request as unknown as Record<string, unknown>
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Flow start failed.");
    }
    const response = invokeResponse.data as unknown as { runId: string };
    slice.flowActiveRunId = response.runId;
    slice.flowMessage = `Flow run started: ${response.runId}`;
    await deps.refreshFlowRuns();
  } catch (error) {
    slice.flowMessage = error instanceof Error ? error.message : "Failed to start flow run";
  } finally {
    slice.flowBusy = false;
  }
}

export async function stopFlowRun(slice: FlowRuntimeSlice, deps: FlowActionDeps): Promise<void> {
  if (!deps.client || slice.flowBusy || !slice.flowActiveRunId) return;
  slice.flowBusy = true;
  slice.flowMessage = "Stopping flow run...";
  try {
    const request = {
      correlationId: deps.nextCorrelationId(),
      runId: slice.flowActiveRunId
    };
    const invokeResponse = await deps.client.toolInvoke({
      correlationId: request.correlationId,
      toolId: "flow",
      action: "stop",
      mode: "sandbox",
      payload: request
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Flow stop failed.");
    }
    slice.flowMessage = `Flow run stopped: ${slice.flowActiveRunId}`;
    await deps.refreshFlowRuns();
  } catch (error) {
    slice.flowMessage = error instanceof Error ? error.message : "Failed to stop flow run";
  } finally {
    slice.flowBusy = false;
  }
}

export async function retryFlowRun(
  slice: FlowRuntimeSlice,
  deps: FlowActionDeps,
  baseRun: FlowRunView
): Promise<void> {
  applyFlowRunSettingsFromRecord(slice, baseRun);
  await startFlowRun(slice, deps);
}

export async function resumeFlowRun(
  slice: FlowRuntimeSlice,
  deps: FlowActionDeps,
  baseRun: FlowRunView
): Promise<void> {
  applyFlowRunSettingsFromRecord(slice, baseRun);
  const configured = Math.max(1, baseRun.maxIterations ?? baseRun.currentIteration + 1);
  const remaining = Math.max(1, configured - baseRun.currentIteration);
  slice.flowMaxIterations = remaining;
  slice.flowMessage = `Resuming from ${baseRun.runId} with ${remaining} remaining iteration(s)...`;
  await startFlowRun(slice, deps);
}

export async function rerunFlowValidation(
  slice: FlowRuntimeSlice,
  deps: FlowActionDeps,
  baseRun: FlowRunView
): Promise<void> {
  if (!deps.client || slice.flowBusy) return;
  slice.flowBusy = true;
  slice.flowMessage = `Rerunning validation for ${baseRun.runId}...`;
  try {
    const request = {
      correlationId: deps.nextCorrelationId(),
      runId: baseRun.runId,
      ...(baseRun.currentIteration > 0 ? { iteration: baseRun.currentIteration } : {})
    };
    const invokeResponse = await deps.client.toolInvoke({
      correlationId: request.correlationId,
      toolId: "flow",
      action: "rerun-validation",
      mode: "sandbox",
      payload: request
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Flow validation rerun failed.");
    }
    const response = invokeResponse.data as unknown as {
      ok: boolean;
      results: FlowRuntimeSlice["flowValidationResults"];
    };
    slice.flowValidationResults = response.results;
    slice.flowMessage = response.ok
      ? `Validation rerun passed (${response.results.length} command(s)).`
      : `Validation rerun failed (${response.results.length} command(s)).`;
  } catch (error) {
    slice.flowMessage = error instanceof Error ? error.message : "Failed to rerun validation";
  } finally {
    slice.flowBusy = false;
  }
}
