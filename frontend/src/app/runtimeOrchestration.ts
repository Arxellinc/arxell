import type { AppEvent } from "../contracts";
import type { IconName } from "../icons";

export function parseAgentToolPayload(
  payload: AppEvent["payload"]
): { toolCallId: string; toolName: string; display: string; success: boolean | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") {
    return null;
  }
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    display: typeof value.display === "string" ? value.display : "",
    success: typeof value.success === "boolean" ? value.success : null
  };
}

export function toolTitleName(rawToolName: string): string {
  const raw = rawToolName.trim();
  if (!raw) return "Tool";
  if (raw === "web_search") return "Web Search";
  if (raw === "bash") return "Terminal";
  if (["read", "write", "edit", "move_file", "mkdir", "find", "grep", "chmod", "ls"].includes(raw)) {
    return "Files";
  }
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function toolIconName(rawToolName: string): IconName {
  const raw = rawToolName.trim();
  if (raw === "web_search") return "globe";
  if (raw === "bash") return "square-terminal";
  if (["read", "write", "edit", "move_file", "mkdir", "find", "grep", "chmod", "ls"].includes(raw)) {
    return "file-badge";
  }
  return "wrench";
}

export function formatRuntimeEventLine(event: AppEvent): string {
  const payloadText =
    event.payload && typeof event.payload === "object"
      ? JSON.stringify(event.payload)
      : String(event.payload);
  const payloadObj =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : null;
  const lineText =
    payloadObj && typeof payloadObj.line === "string" ? payloadObj.line : null;

  if (event.action === "llama.runtime.process.stdout" && lineText) {
    return `${new Date(event.timestampMs).toLocaleTimeString()} [stdout] ${lineText}`;
  }
  if (event.action === "llama.runtime.process.stderr" && lineText) {
    return `${new Date(event.timestampMs).toLocaleTimeString()} [stderr] ${lineText}`;
  }
  return `${new Date(event.timestampMs).toLocaleTimeString()} ${event.action} ${event.stage} ${payloadText}`;
}

export function formatAgentEventLine(
  event: AppEvent,
  payloadAsRecord: (payload: unknown) => Record<string, unknown> | null
): string | null {
  const payload = payloadAsRecord(event.payload);
  if (event.action === "chat.agent.request") {
    const model = typeof payload?.model === "string" ? payload.model : "unknown";
    const maxTokens =
      typeof payload?.maxTokens === "number" ? String(payload.maxTokens) : "n/a";
    const baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl : "n/a";
    return `${event.action} ${event.stage} model=${model} maxTokens=${maxTokens} baseUrl=${baseUrl}`;
  }
  if (event.action === "chat.agent.tool.start") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const callId =
      typeof payload?.toolCallId === "string" ? payload.toolCallId : "unknown";
    return `tool.start ${tool} call=${callId}`;
  }
  if (event.action === "chat.agent.tool.end") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const callId =
      typeof payload?.toolCallId === "string" ? payload.toolCallId : "unknown";
    const success = payload?.success === false ? "error" : "ok";
    return `tool.end ${tool} call=${callId} status=${success}`;
  }
  if (event.action === "chat.agent.tool.result") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const callId =
      typeof payload?.toolCallId === "string" ? payload.toolCallId : "unknown";
    const success = payload?.success === false ? "error" : "ok";
    return `tool.result ${tool} call=${callId} status=${success}`;
  }
  if (event.action === "chat.agent.fallback") {
    const message = typeof payload?.message === "string" ? payload.message : "fallback";
    return `${event.action} ${event.stage} ${message}`;
  }
  return null;
}

export function extractRuntimeProcessLine(event: AppEvent): string | null {
  if (
    event.action !== "llama.runtime.process.stderr" &&
    event.action !== "llama.runtime.process.stdout"
  ) {
    return null;
  }
  if (!event.payload || typeof event.payload !== "object") return null;
  const payloadObj = event.payload as Record<string, unknown>;
  return typeof payloadObj.line === "string" ? payloadObj.line : null;
}

export function updateRuntimeMetricsFromLine(
  state: Record<string, any>,
  line: string
): void {
  const ctxMatch = line.match(/n_ctx_slot\s*=\s*(\d+)/i);
  const ctxValue = ctxMatch?.[1];
  if (ctxValue) {
    state.llamaRuntimeContextCapacity = Number.parseInt(ctxValue, 10);
  }

  const tokensMatch = line.match(/n_tokens\s*=\s*(\d+)/i);
  const tokenValue = tokensMatch?.[1];
  if (tokenValue) {
    state.llamaRuntimeContextTokens = Number.parseInt(tokenValue, 10);
  }

  const tpsMatch = line.match(/([0-9]+(?:\.[0-9]+)?)\s+tokens per second/i);
  const tpsValue = tpsMatch?.[1];
  if (tpsValue) {
    state.llamaRuntimeTokensPerSecond = Number.parseFloat(tpsValue);
  }
}
