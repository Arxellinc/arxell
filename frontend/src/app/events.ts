import type { AppEvent } from "../contracts";

export function parseTerminalOutput(payload: AppEvent["payload"]): { sessionId: string; data: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.sessionId !== "string" || typeof value.data !== "string") return null;
  return { sessionId: value.sessionId, data: value.data };
}

export function parseTerminalExit(payload: AppEvent["payload"]): { sessionId: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.sessionId !== "string") return null;
  return { sessionId: value.sessionId };
}

export function isNoisyTerminalControlEvent(event: AppEvent): boolean {
  if (event.subsystem !== "ipc") return false;
  if (event.stage === "error") return false;
  return event.action === "cmd.terminal.resize" || event.action === "cmd.terminal.send_input";
}

export function isNoisyRuntimeStatusEvent(event: AppEvent): boolean {
  if (
    event.subsystem === "runtime" &&
    event.action === "tts.download_model" &&
    event.stage === "progress"
  ) {
    return true;
  }
  return (
    event.subsystem === "runtime" &&
    event.action === "llama.runtime.status" &&
    event.stage === "complete"
  );
}

export function isNoisyChatStreamEvent(event: AppEvent): boolean {
  if (event.subsystem !== "service") return false;
  if (event.stage !== "progress") return false;
  return event.action === "chat.stream.chunk" || event.action === "chat.stream.reasoning_chunk";
}

export function payloadAsRecord(payload: AppEvent["payload"]): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

export function handleCoreAppEvent(
  event: AppEvent,
  deps: {
    onChatTtsStreamChunkEvent: (event: AppEvent) => void;
    formatAgentEventLine: (event: AppEvent) => string | null;
    pushConsoleEntry: (
      level: "log" | "info" | "warn" | "error" | "debug",
      source: "browser" | "app",
      message: string
    ) => void;
    safePayloadPreview: (payload: AppEvent["payload"]) => string;
    terminalManager: {
      writeOutput: (sessionId: string, data: string) => void;
      markExited: (sessionId: string) => void;
    };
    renderAndBind: () => void;
    resolveChatTtsStreamWaiters: (correlationId: string) => void;
    extractRuntimeProcessLine: (event: AppEvent) => string | null;
    updateRuntimeMetricsFromLine: (line: string) => void;
    formatRuntimeEventLine: (event: AppEvent) => string;
    refreshLlamaRuntime: () => Promise<void>;
    state: {
      llamaRuntimeLogs: string[];
      modelManagerBusy: boolean;
      modelManagerMessage: string | null;
      flowPaused: boolean;
      events: AppEvent[];
    };
    applyFlowRuntimeEvent: (event: AppEvent) => void;
    maybeHandleFlowPhaseTerminalEvent: (event: AppEvent) => Promise<void>;
  }
): boolean {
  if (event.action === "tts.stream.chunk") {
    deps.onChatTtsStreamChunkEvent(event);
  }

  const agentEventLine = deps.formatAgentEventLine(event);
  if (agentEventLine) {
    deps.pushConsoleEntry(
      event.severity === "error" ? "error" : "info",
      "app",
      `[agent] ${agentEventLine} corr=${event.correlationId}`
    );
  } else if (
    !event.action.startsWith("llama.runtime") &&
    !isNoisyRuntimeStatusEvent(event) &&
    !isNoisyChatStreamEvent(event)
  ) {
    const payloadText =
      event.stage === "error"
        ? ` payload=${deps.safePayloadPreview(event.payload)}`
        : "";
    deps.pushConsoleEntry(
      event.severity === "error" ? "error" : "info",
      "app",
      `[${event.subsystem}] ${event.action} ${event.stage} corr=${event.correlationId}${payloadText}`
    );
  }

  if (event.action === "terminal.output") {
    const output = parseTerminalOutput(event.payload);
    if (output) {
      deps.terminalManager.writeOutput(output.sessionId, output.data);
    }
    return true;
  }

  if (event.action === "terminal.exit") {
    const exiting = parseTerminalExit(event.payload);
    if (exiting) {
      deps.terminalManager.markExited(exiting.sessionId);
      deps.renderAndBind();
    }
    return true;
  }

  if (event.action === "tts.request" && event.stage === "complete") {
    deps.resolveChatTtsStreamWaiters(event.correlationId);
    const payload = (event.payload && typeof event.payload === "object")
      ? (event.payload as Record<string, unknown>)
      : null;
    const timings = (payload?.timingsMs && typeof payload.timingsMs === "object")
      ? (payload.timingsMs as Record<string, unknown>)
      : null;
    if (timings) {
      const num = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const total = num(timings.total);
      const ensureAssets = num(timings.ensureAssets);
      const buildSignature = num(timings.buildSignature);
      const saveSettings = num(timings.saveSettings);
      const enginePrepare = num(timings.enginePrepare);
      const synthesis = num(timings.synthesis);
      const wavEncode = num(timings.wavEncode);
      const workerWait = num(timings.workerWait);
      deps.pushConsoleEntry(
        "debug",
        "app",
        [
          "TTS timings(ms)",
          `total=${total ?? "n/a"}`,
          `ensureAssets=${ensureAssets ?? "n/a"}`,
          `buildSignature=${buildSignature ?? "n/a"}`,
          `saveSettings=${saveSettings ?? "n/a"}`,
          `enginePrepare=${enginePrepare ?? "n/a"}`,
          `synthesis=${synthesis ?? "n/a"}`,
          `wavEncode=${wavEncode ?? "n/a"}`,
          `workerWait=${workerWait ?? "n/a"}`
        ].join(" ")
      );
    }
  }

  if (isNoisyTerminalControlEvent(event)) {
    return true;
  }

  if (event.action.startsWith("llama.runtime")) {
    const processLine = deps.extractRuntimeProcessLine(event);
    if (processLine) {
      deps.updateRuntimeMetricsFromLine(processLine);
    }
    const runtimeLine = deps.formatRuntimeEventLine(event);
    deps.pushConsoleEntry(
      event.severity === "error" ? "error" : "info",
      "app",
      `[runtime] ${runtimeLine} corr=${event.correlationId}`
    );

    if (!isNoisyRuntimeStatusEvent(event)) {
      deps.state.llamaRuntimeLogs.push(runtimeLine);
      if (deps.state.llamaRuntimeLogs.length > 300) {
        deps.state.llamaRuntimeLogs.splice(0, deps.state.llamaRuntimeLogs.length - 300);
      }
    }
    if (
      (event.stage === "complete" || event.stage === "error") &&
      event.action !== "llama.runtime.status"
    ) {
      void deps.refreshLlamaRuntime().then(() => deps.renderAndBind());
    }
  }

  if (event.action.startsWith("model.manager.")) {
    if (event.stage === "start") {
      deps.state.modelManagerBusy = true;
    }
    if (event.stage === "complete" || event.stage === "error") {
      deps.state.modelManagerBusy = false;
    }
    if (event.stage === "error") {
      deps.state.modelManagerMessage = `Model manager error: ${deps.safePayloadPreview(event.payload)}`;
    }
  }

  if (event.action === "flow.run.paused") {
    const payload = event.payload as Record<string, unknown>;
    if (typeof payload?.paused === "boolean") {
      deps.state.flowPaused = payload.paused;
    }
  }

  deps.state.events.push(event);
  deps.applyFlowRuntimeEvent(event);
  void deps.maybeHandleFlowPhaseTerminalEvent(event);
  return false;
}

export function handleChatStreamEvent(
  event: AppEvent,
  deps: {
    isCurrentChatCorrelation: (correlationId: string) => boolean;
    state: {
      chatTtsEnabled: boolean;
      chatTtsPlaying: boolean;
      conversationId: string;
      chatStreamCompleteByCorrelation: Record<string, boolean>;
    };
    setChatTtsStopRequested: (value: boolean) => void;
    getVoicePipelineState: () => "idle" | "user_speaking" | "processing" | "agent_speaking" | "interrupted";
    setVoicePipelineState: (next: "idle" | "user_speaking" | "processing" | "agent_speaking" | "interrupted") => void;
    resetChatTtsStreamParser: (correlationId: string) => void;
    flushChatStreamForTts: (correlationId: string) => void;
    scheduleChatStreamDomUpdate: () => void;
    parseAgentToolPayload: (
      payload: AppEvent["payload"]
    ) => { toolCallId: string; toolName: string; display: string; success: boolean | null } | null;
    ensureAssistantMessageForCorrelation: (correlationId: string) => void;
    ensureToolIntentRow: (correlationId: string, toolName: string) => void;
    appendChatToolRow: (
      correlationId: string,
      row: { icon: unknown; title: string; details: string }
    ) => void;
    toolIconName: (toolName: string) => string;
    toolTitleName: (toolName: string) => string;
    parseStreamChunk: (
      payload: AppEvent["payload"]
    ) => { conversationId: string; delta: string; done: boolean } | null;
    parseReasoningStreamChunk: (
      payload: AppEvent["payload"]
    ) => { conversationId: string; delta: string; done: boolean } | null;
    updateAssistantDraft: (correlationId: string, delta: string) => void;
    ingestChatStreamForTts: (correlationId: string, delta: string) => void;
    updateReasoningDraft: (correlationId: string, delta: string) => void;
    renderAndBind: () => void;
  }
): boolean {
  if (event.action === "chat.stream.start") {
    if (!deps.isCurrentChatCorrelation(event.correlationId)) return true;
    deps.setChatTtsStopRequested(false);
    const pipeline = deps.getVoicePipelineState();
    if (pipeline === "processing" || pipeline === "interrupted") {
      deps.setVoicePipelineState("idle");
    }
    deps.state.chatStreamCompleteByCorrelation[event.correlationId] = false;
    if (deps.state.chatTtsEnabled) {
      deps.resetChatTtsStreamParser(event.correlationId);
    }
    return true;
  }

  if (event.action === "chat.stream.complete") {
    if (!deps.isCurrentChatCorrelation(event.correlationId)) return true;
    deps.state.chatStreamCompleteByCorrelation[event.correlationId] = true;
    if (!deps.state.chatTtsPlaying) {
      deps.setVoicePipelineState("idle");
    }
    deps.flushChatStreamForTts(event.correlationId);
    deps.scheduleChatStreamDomUpdate();
    return true;
  }

  if (event.action === "chat.agent.tool.start") {
    if (!deps.isCurrentChatCorrelation(event.correlationId)) return true;
    const payload = deps.parseAgentToolPayload(event.payload);
    if (payload) {
      deps.ensureAssistantMessageForCorrelation(event.correlationId);
      deps.ensureToolIntentRow(event.correlationId, payload.toolName);
      deps.appendChatToolRow(event.correlationId, {
        icon: deps.toolIconName(payload.toolName),
        title: `${deps.toolTitleName(payload.toolName)} · start`,
        details: payload.display || `Started tool call ${payload.toolCallId}.`
      });
      deps.scheduleChatStreamDomUpdate();
    }
    return true;
  }

  if (event.action === "chat.agent.tool.end") {
    if (!deps.isCurrentChatCorrelation(event.correlationId)) return true;
    const payload = deps.parseAgentToolPayload(event.payload);
    if (payload) {
      deps.ensureAssistantMessageForCorrelation(event.correlationId);
      deps.appendChatToolRow(event.correlationId, {
        icon: deps.toolIconName(payload.toolName),
        title: `${deps.toolTitleName(payload.toolName)} · complete`,
        details: payload.display || `Tool call ${payload.toolCallId} completed.`
      });
      deps.scheduleChatStreamDomUpdate();
    }
    return true;
  }

  if (event.action === "chat.agent.tool.result") {
    if (!deps.isCurrentChatCorrelation(event.correlationId)) return true;
    const payload = deps.parseAgentToolPayload(event.payload);
    if (payload) {
      deps.ensureAssistantMessageForCorrelation(event.correlationId);
      const status = payload.success === false ? "error" : "result";
      const defaultDetail =
        payload.success === false
          ? `Tool call ${payload.toolCallId} returned an error.`
          : `Tool call ${payload.toolCallId} returned successfully.`;
      deps.appendChatToolRow(event.correlationId, {
        icon: payload.success === false ? "triangle-alert" : deps.toolIconName(payload.toolName),
        title: `${deps.toolTitleName(payload.toolName)} · ${status}`,
        details: payload.display || defaultDetail
      });
      deps.scheduleChatStreamDomUpdate();
    }
    return true;
  }

  if (event.action === "chat.stream.chunk") {
    const chunk = deps.parseStreamChunk(event.payload);
    if (chunk && chunk.conversationId === deps.state.conversationId) {
      deps.updateAssistantDraft(event.correlationId, chunk.delta);
      deps.ingestChatStreamForTts(event.correlationId, chunk.delta);
      deps.scheduleChatStreamDomUpdate();
      return true;
    }
  }

  if (event.action === "chat.stream.reasoning_chunk") {
    const chunk = deps.parseReasoningStreamChunk(event.payload);
    if (chunk && chunk.conversationId === deps.state.conversationId) {
      deps.updateReasoningDraft(event.correlationId, chunk.delta);
      deps.scheduleChatStreamDomUpdate();
      return true;
    }
  }

  deps.renderAndBind();
  return true;
}
