import type { ChatIpcClient } from "../../ipcClient";
import type { FlowRunRecord } from "../../contracts";
import type { FlowRunView, FlowRuntimeSlice } from "../flow/state";

interface FlowRefreshState extends FlowRuntimeSlice {
  flowActiveRunId: string | null;
}

interface RefreshFlowRunsDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
  normalizeRun: (run: FlowRunRecord) => FlowRunView;
}

export async function refreshFlowRunsFromToolInvoke(
  slice: FlowRefreshState,
  deps: RefreshFlowRunsDeps
): Promise<void> {
  if (!deps.client) return;
  const correlationId = deps.nextCorrelationId();
  const invokeResponse = await deps.client.toolInvoke({
    correlationId,
    toolId: "flow",
    action: "list-runs",
    mode: "sandbox",
    payload: { correlationId }
  });
  if (!invokeResponse.ok) {
    throw new Error(invokeResponse.error || "Failed to list flow runs.");
  }

  const response = invokeResponse.data as unknown as { runs: FlowRunRecord[] };
  slice.flowRuns = response.runs.map(deps.normalizeRun);
  if (!slice.flowRuns.length) {
    slice.flowActiveRunId = null;
    slice.flowValidationResults = [];
    return;
  }

  if (!slice.flowActiveRunId || !slice.flowRuns.some((run) => run.runId === slice.flowActiveRunId)) {
    slice.flowActiveRunId = slice.flowRuns[0]?.runId ?? null;
    slice.flowValidationResults = [];
  }
}

export function createFlowRunsRefreshScheduler(deps: {
  refresh: () => Promise<void>;
  onRefreshed: () => void;
  delayMs?: number;
}): () => void {
  const delayMs = Math.max(0, deps.delayMs ?? 250);
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      void deps.refresh().then(() => deps.onRefreshed());
    }, delayMs);
  };
}
