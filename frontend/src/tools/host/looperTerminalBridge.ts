import type { AppEvent } from "../../contracts";
import type { TerminalManager } from "../terminal/index";
import type { LooperPhase, LooperToolState } from "../looper/state";

interface LooperBridgeState {
  looperState: LooperToolState;
  terminalManager: TerminalManager;
  looperPhaseSessionByLoop: Record<string, Record<LooperPhase, string | null>>;
}

interface CreateLooperBridgeDeps {
  state: LooperBridgeState;
}

export function createLooperTerminalEventHandler(deps: CreateLooperBridgeDeps) {
  return async (event: AppEvent): Promise<void> => {
    if (!event.action.startsWith("terminal.")) return;

    if (event.action === "terminal.output") {
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;
      const row = payload as Record<string, unknown>;
      const sessionId = typeof row.sessionId === "string" ? row.sessionId : null;
      const data = typeof row.data === "string" ? row.data : null;
      if (!sessionId || !data) return;

      for (const loop of deps.state.looperState.loops) {
        for (const phase of ["planner", "executor", "validator", "critic"] as LooperPhase[]) {
          if (loop.phases[phase].sessionId === sessionId) {
            deps.state.terminalManager.writeOutput(sessionId, data);
            return;
          }
        }
      }
      return;
    }

    if (event.action === "terminal.exit") {
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;
      const row = payload as Record<string, unknown>;
      const sessionId = typeof row.sessionId === "string" ? row.sessionId : null;
      if (!sessionId) return;

      for (const loop of deps.state.looperState.loops) {
        for (const phase of ["planner", "executor", "validator", "critic"] as LooperPhase[]) {
          if (loop.phases[phase].sessionId === sessionId) {
            deps.state.terminalManager.markExited(sessionId);
            return;
          }
        }
      }
      return;
    }
  };
}