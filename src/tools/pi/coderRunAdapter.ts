import { terminalSessionWrite } from "../../core/tooling/client";
import type { ToolMode } from "../../core/tooling/types";
import { useTerminalSessionStore } from "../../store/terminalSessionStore";
import { useToolCatalogStore } from "../../store/toolCatalogStore";

export interface PiCoderDispatchOptions {
  prompt: string;
  onProgress?: (line: string) => void;
  ensureVisible?: () => void;
  waitForSessionMs?: number;
  waitForReadyMs?: number;
}

export interface PiCoderDispatchResult {
  dispatched: boolean;
  sessionId: number | null;
  reason: string;
}

interface PiSessionState {
  sessionId: number | null;
  mode: ToolMode;
  ready: boolean;
}

function readPiSession(): PiSessionState {
  const entry = useTerminalSessionStore.getState().getSession("pi");
  if (!entry || !entry.sessionId) {
    return { sessionId: null, mode: "sandbox", ready: false };
  }
  return { sessionId: entry.sessionId, mode: entry.mode, ready: entry.ready };
}

export async function tryDispatchCoderRunViaPi(
  options: PiCoderDispatchOptions
): Promise<PiCoderDispatchResult> {
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

  if (!useToolCatalogStore.getState().isToolEnabled("pi")) {
    return { dispatched: false, sessionId: null, reason: "pi-disabled" };
  }
  ensureVisible?.();

  const terminalPrompt = prompt.replace(/\s+/g, " ").trim();
  if (!terminalPrompt) {
    return { dispatched: false, sessionId: null, reason: "empty-prompt" };
  }

  let session = readPiSession();
  if (!session.sessionId) {
    emit("[coder] waiting for Pi terminal session...\n");
    const start = Date.now();
    while (Date.now() - start < waitForSessionMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      session = readPiSession();
      if (session.sessionId) break;
    }
  }

  if (!session.sessionId) {
    return { dispatched: false, sessionId: null, reason: "no-session" };
  }

  if (!session.ready) {
    emit("[coder] Pi session exists; waiting briefly for ready marker...\n");
    const start = Date.now();
    while (Date.now() - start < waitForReadyMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      session = readPiSession();
      if (session.ready) break;
    }
    if (!session.ready) {
      emit("[coder] ready marker not detected yet; sending prompt to live Pi session anyway.\n");
    }
  }

  // Re-resolve after waits in case Pi restarted and session id changed.
  const latest = readPiSession();
  if (!latest.sessionId) {
    return { dispatched: false, sessionId: null, reason: "session-lost" };
  }
  const liveSid = latest.sessionId;
  const liveMode = latest.mode;

  emit(`[coder] dispatching prompt to live Pi terminal session ${liveSid}...\n`);
  await terminalSessionWrite(liveSid, terminalPrompt, liveMode);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await terminalSessionWrite(liveSid, "\r", liveMode);

  return { dispatched: true, sessionId: liveSid, reason: "live-pi" };
}
