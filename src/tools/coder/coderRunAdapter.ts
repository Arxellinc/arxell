import { settingsGet } from "../../lib/tauri";
import { terminalSessionWrite } from "../../core/tooling/client";
import type { ToolId, ToolMode } from "../../core/tooling/types";
import { useTerminalSessionStore } from "../../store/terminalSessionStore";
import { useToolCatalogStore } from "../../store/toolCatalogStore";
import { buildCoderAgentCommand } from "./agentCommand";

export interface CoderDispatchOptions {
  prompt: string;
  onProgress?: (line: string) => void;
  ensureVisible?: () => void;
  waitForSessionMs?: number;
  waitForReadyMs?: number;
}

export interface CoderDispatchResult {
  dispatched: boolean;
  sessionId: number | null;
  reason: string;
}

interface SessionState {
  toolId: ToolId;
  sessionId: number | null;
  mode: ToolMode;
  ready: boolean;
}

function readSession(toolId: ToolId): SessionState {
  const entry = useTerminalSessionStore.getState().getSession(toolId);
  if (!entry || !entry.sessionId) {
    return { toolId, sessionId: null, mode: "sandbox", ready: false };
  }
  return { toolId, sessionId: entry.sessionId, mode: entry.mode, ready: entry.ready };
}

function pickLiveSession(): SessionState {
  const coder = readSession("codex");
  if (coder.sessionId) return coder;
  return readSession("pi");
}

export async function tryDispatchCoderRunViaTerminal(
  options: CoderDispatchOptions
): Promise<CoderDispatchResult> {
  const {
    prompt,
    onProgress,
    ensureVisible,
    waitForSessionMs = 120_000,
    waitForReadyMs = 6_000,
  } = options;

  const emit = (line: string) => {
    if (!onProgress) return;
    onProgress(line);
  };

  const catalog = useToolCatalogStore.getState();
  if (!catalog.isToolEnabled("codex") && !catalog.isToolEnabled("pi")) {
    return { dispatched: false, sessionId: null, reason: "coder-disabled" };
  }

  ensureVisible?.();

  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  if (!normalizedPrompt) {
    return { dispatched: false, sessionId: null, reason: "empty-prompt" };
  }

  let session = pickLiveSession();
  if (!session.sessionId) {
    emit("[coder] waiting for coder terminal session...\n");
    const start = Date.now();
    while (Date.now() - start < waitForSessionMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      session = pickLiveSession();
      if (session.sessionId) break;
    }
  }

  if (!session.sessionId) {
    return { dispatched: false, sessionId: null, reason: "no-session" };
  }

  if (!session.ready) {
    emit("[coder] session exists; waiting briefly for readiness marker...\n");
    const start = Date.now();
    while (Date.now() - start < waitForReadyMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      session = pickLiveSession();
      if (session.ready) break;
    }
    if (!session.ready) {
      emit("[coder] readiness marker not detected yet; dispatching anyway.\n");
    }
  }

  const live = pickLiveSession();
  if (!live.sessionId) {
    return { dispatched: false, sessionId: null, reason: "session-lost" };
  }

  const [model, baseUrl, apiKey] = await Promise.all([
    settingsGet("coder_model"),
    settingsGet("base_url"),
    settingsGet("api_key"),
  ]);

  const command = buildCoderAgentCommand({
    prompt: normalizedPrompt,
    model,
    baseUrl,
    apiKey,
    maxTurns: 8,
  });

  emit(`[coder] dispatching to ${live.toolId} terminal session ${live.sessionId}...\n`);
  await terminalSessionWrite(live.sessionId, command, live.mode);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await terminalSessionWrite(live.sessionId, "\r", live.mode);

  return { dispatched: true, sessionId: live.sessionId, reason: `live-${live.toolId}` };
}
