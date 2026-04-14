import type { AppEvent } from "../contracts";
import type { FlowPhaseTranscriptEntry } from "../tools/flow/state";
import type { TerminalManager } from "../tools/terminal/index";
import type { TerminalShellProfile } from "../tools/terminal/types";

interface FlowBridgeState {
  flowPhaseTranscriptsByRun: Record<string, Record<string, FlowPhaseTranscriptEntry[]>>;
  flowPhaseSessionByName: Record<string, string>;
  terminalShellProfile: TerminalShellProfile;
  flowAutoFocusPhaseTerminal: boolean;
  flowBottomPanel: "terminal" | "validate" | "events";
  flowActiveTerminalPhase: string;
  activeTerminalSessionId: string | null;
}

interface CreateFlowBridgeDeps {
  state: FlowBridgeState;
  terminalManager: TerminalManager;
  flowTerminalPhases: readonly string[];
  createTerminalSessionForProfile: (
    terminalManager: TerminalManager,
    profile: FlowBridgeState["terminalShellProfile"]
  ) => Promise<string>;
  persistFlowWorkspacePrefs: () => void;
  persistFlowPhaseSessionMap: (map: Record<string, string>) => void;
}

export function createFlowPhaseTerminalEventHandler(deps: CreateFlowBridgeDeps) {
  const appendFlowTranscript = (entry: FlowPhaseTranscriptEntry): void => {
    const byRun = deps.state.flowPhaseTranscriptsByRun[entry.runId] ?? {};
    const phaseRows = byRun[entry.phase] ?? [];
    const nextRows = [...phaseRows, entry].slice(-400);
    deps.state.flowPhaseTranscriptsByRun = {
      ...deps.state.flowPhaseTranscriptsByRun,
      [entry.runId]: {
        ...byRun,
        [entry.phase]: nextRows
      }
    };
  };

  const parseFlowPayload = (
    payload: unknown
  ): { runId: string | null; step: string | null; message: string } => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { runId: null, step: null, message: "" };
    }
    const row = payload as Record<string, unknown>;
    const runId = typeof row.runId === "string" ? row.runId : null;
    const step = typeof row.step === "string" ? row.step : null;
    const parts: string[] = [];
    if (typeof row.message === "string" && row.message.trim()) parts.push(row.message.trim());
    if (typeof row.command === "string" && row.command.trim()) parts.push(`$ ${row.command.trim()}`);
    if (typeof row.stdout === "string" && row.stdout.trim()) parts.push(row.stdout.trim());
    if (typeof row.stderr === "string" && row.stderr.trim()) parts.push(row.stderr.trim());
    if (typeof row.error === "string" && row.error.trim()) parts.push(`ERROR: ${row.error.trim()}`);
    if (!parts.length && typeof row.result === "string" && row.result.trim()) parts.push(row.result.trim());
    return { runId, step, message: parts.join(" | ") };
  };

  const ensureFlowPhaseSession = async (phase: string): Promise<string> => {
    const mapped = deps.state.flowPhaseSessionByName[phase];
    if (mapped && deps.terminalManager.listSessions().some((s) => s.sessionId === mapped)) {
      return mapped;
    }
    const sessionId = await deps.createTerminalSessionForProfile(
      deps.terminalManager,
      deps.state.terminalShellProfile
    );
    deps.state.flowPhaseSessionByName = {
      ...deps.state.flowPhaseSessionByName,
      [phase]: sessionId
    };
    deps.persistFlowPhaseSessionMap(deps.state.flowPhaseSessionByName);
    return sessionId;
  };

  return async (event: AppEvent): Promise<void> => {
    if (!event.action.startsWith("flow.")) return;
    const { runId, step, message } = parseFlowPayload(event.payload);
    if (!runId) return;

    const phase =
      step ||
      (event.action === "flow.run.start" || event.action === "flow.run.progress"
        ? "orient"
        : null);
    if (!phase) return;
    if (!deps.flowTerminalPhases.includes(phase)) return;

    const kind: FlowPhaseTranscriptEntry["kind"] =
      event.action.endsWith(".start")
        ? "start"
        : event.action.endsWith(".complete")
          ? "complete"
          : event.action.endsWith(".error")
            ? "error"
            : event.action.includes(".progress")
              ? "progress"
              : "run";
    appendFlowTranscript({
      timestampMs: event.timestampMs,
      runId,
      phase,
      kind,
      message: message || `${event.action} (${event.stage})`
    });

    const sessionId = await ensureFlowPhaseSession(phase);
    const linePrefix = `[${new Date(event.timestampMs).toLocaleTimeString()}] [${event.action}]`;
    const line = `${linePrefix} ${message || event.stage}\r\n`;
    deps.terminalManager.writeOutput(sessionId, line);

    if (event.action === "flow.step.start" && deps.state.flowAutoFocusPhaseTerminal) {
      deps.state.flowBottomPanel = "terminal";
      deps.state.flowActiveTerminalPhase = phase;
      deps.state.activeTerminalSessionId = sessionId;
      deps.persistFlowWorkspacePrefs();
      deps.persistFlowPhaseSessionMap(deps.state.flowPhaseSessionByName);
    }
  };
}
