import type { AppEvent } from "../../contracts";
import { applyFlowEvent } from "../flow/runtime";
import type { FlowRuntimeSlice } from "../flow/state";

export function applyFlowRuntimeEvent(
  slice: FlowRuntimeSlice,
  event: AppEvent,
  scheduleRefresh: () => void
): void {
  applyFlowEvent(slice, event);
  if (event.action.startsWith("flow.")) {
    scheduleRefresh();
  }
}
