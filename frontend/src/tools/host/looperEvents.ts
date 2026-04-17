/**
 * Looper event handler wiring
 *
 * This module provides the bridge between the global event stream
 * and the looper-specific event processing in runtime.ts.
 */

import type { AppEvent } from "../../contracts";
import type { LooperToolState } from "../looper/state";
import { applyLooperEvent } from "../looper/runtime";

export function applyLooperRuntimeEvent(
  state: LooperToolState,
  event: AppEvent,
  scheduleRefresh: () => void,
  registerSession?: (loopId: string, phase: string, sessionId: string) => void
): void {
  if (!event.action.startsWith("looper.")) return;

  const payload = event.payload;
  if (registerSession && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const row = payload as Record<string, unknown>;
    if (
      typeof row.loopId === "string" &&
      typeof row.phase === "string" &&
      typeof row.sessionId === "string"
    ) {
      registerSession(row.loopId, row.phase, row.sessionId);
    }
  }

  applyLooperEvent(state, event);

  // Always schedule a refresh when a looper event arrives
  // since terminal output may need to be written to the UI
  scheduleRefresh();
}
