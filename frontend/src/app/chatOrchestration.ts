import type { AppEvent, ChatStreamChunkPayload, ChatStreamReasoningChunkPayload } from "../contracts";
import type { IconName } from "../icons";
import type { ChatPanelState, ChatToolEventRow } from "../panels/types";

type AnyState = Record<string, any>;

export function updateAssistantDraftState(
  state: AnyState,
  correlationId: string,
  delta: string,
  normalizeChatText: (input: string) => string,
  syncThinkingPlacement: (correlationId: string) => void
): void {
  if (!state.chatFirstAssistantChunkMsByCorrelation[correlationId]) {
    state.chatFirstAssistantChunkMsByCorrelation[correlationId] = Date.now();
    syncThinkingPlacement(correlationId);
  }
  const existing = state.messages.find(
    (m: { role: string; correlationId?: string; text: string }) =>
      m.role === "assistant" && m.correlationId === correlationId
  );
  if (existing) {
    existing.text = normalizeChatText(`${existing.text}${delta}`);
    return;
  }
  state.messages.push({ role: "assistant", text: normalizeChatText(delta), correlationId });
}

export function updateReasoningDraftState(
  state: AnyState,
  correlationId: string,
  delta: string,
  normalizeChatText: (input: string) => string,
  syncThinkingPlacement: (correlationId: string) => void
): void {
  if (!state.chatFirstReasoningChunkMsByCorrelation[correlationId]) {
    state.chatFirstReasoningChunkMsByCorrelation[correlationId] = Date.now();
    syncThinkingPlacement(correlationId);
  }
  if (state.chatThinkingExpandedByCorrelation[correlationId] === undefined) {
    state.chatThinkingExpandedByCorrelation[correlationId] = false;
  }
  const current = state.chatReasoningByCorrelation[correlationId] ?? "";
  state.chatReasoningByCorrelation[correlationId] = normalizeChatText(`${current}${delta}`);
}

export function updateSecondaryAssistantDraftState(
  state: AnyState,
  cp: ChatPanelState,
  correlationId: string,
  delta: string,
  normalizeChatText: (input: string) => string,
  syncSecondaryThinkingPlacement: (cp: ChatPanelState, correlationId: string) => void
): void {
  if (!state.chatFirstAssistantChunkMsByCorrelation[correlationId]) {
    state.chatFirstAssistantChunkMsByCorrelation[correlationId] = Date.now();
    syncSecondaryThinkingPlacement(cp, correlationId);
  }
  const existing = cp.messages.find(
    (message) => message.role === "assistant" && message.correlationId === correlationId
  );
  if (existing) {
    existing.text = normalizeChatText(`${existing.text}${delta}`);
    return;
  }
  cp.messages.push({ role: "assistant", text: normalizeChatText(delta), correlationId });
}

export function updateSecondaryReasoningDraftState(
  state: AnyState,
  cp: ChatPanelState,
  correlationId: string,
  delta: string,
  normalizeChatText: (input: string) => string,
  syncSecondaryThinkingPlacement: (cp: ChatPanelState, correlationId: string) => void
): void {
  if (!state.chatFirstReasoningChunkMsByCorrelation[correlationId]) {
    state.chatFirstReasoningChunkMsByCorrelation[correlationId] = Date.now();
    syncSecondaryThinkingPlacement(cp, correlationId);
  }
  if (cp.chatThinkingExpandedByCorrelation[correlationId] === undefined) {
    cp.chatThinkingExpandedByCorrelation[correlationId] = false;
  }
  const current = cp.chatReasoningByCorrelation[correlationId] ?? "";
  cp.chatReasoningByCorrelation[correlationId] = normalizeChatText(`${current}${delta}`);
}

export function ensureAssistantMessageForState(state: AnyState, correlationId: string): void {
  const existing = state.messages.find(
    (m: { role: string; correlationId?: string }) =>
      m.role === "assistant" && m.correlationId === correlationId
  );
  if (existing) return;
  state.messages.push({ role: "assistant", text: "", correlationId });
}

export function ensureAssistantMessageForPanelState(cp: ChatPanelState, correlationId: string): void {
  const existing = cp.messages.find(
    (message) => message.role === "assistant" && message.correlationId === correlationId
  );
  if (existing) return;
  cp.messages.push({ role: "assistant", text: "", correlationId });
}

export function appendChatToolRowState(
  state: AnyState,
  correlationId: string,
  row: Omit<ChatToolEventRow, "rowId">
): void {
  const existing = state.chatToolRowsByCorrelation[correlationId] ?? [];
  const rowId = `tool-row-${correlationId}-${existing.length + 1}`;
  state.chatToolRowsByCorrelation[correlationId] = [...existing, { rowId, ...row }];
  if (state.chatToolRowExpandedById[rowId] === undefined) {
    state.chatToolRowExpandedById[rowId] = false;
  }
}

export function appendChatToolRowForPanelState(
  cp: ChatPanelState,
  correlationId: string,
  row: Omit<ChatToolEventRow, "rowId">
): void {
  const existing = cp.chatToolRowsByCorrelation[correlationId] ?? [];
  const rowId = `tool-row-${correlationId}-${existing.length + 1}`;
  cp.chatToolRowsByCorrelation[correlationId] = [...existing, { rowId, ...row }];
  if (cp.chatToolRowExpandedById[rowId] === undefined) {
    cp.chatToolRowExpandedById[rowId] = false;
  }
}

export function ensureToolIntentRowState(
  state: AnyState,
  correlationId: string,
  toolName: string,
  toolIconName: (name: string) => IconName,
  toolTitleName: (name: string) => string
): void {
  const key = `${correlationId}:${toolName}`;
  if (state.chatToolIntentByCorrelation[key]) return;
  state.chatToolIntentByCorrelation[key] = true;
  appendChatToolRowState(state, correlationId, {
    icon: toolIconName(toolName),
    title: `Use ${toolTitleName(toolName)} tool`,
    details: `Agent confirmed it will use the ${toolTitleName(toolName)} tool.`
  });
}

export function parseStreamChunkPayload(payload: AppEvent["payload"]): ChatStreamChunkPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.conversationId !== "string" ||
    typeof value.delta !== "string" ||
    typeof value.done !== "boolean"
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId,
    delta: value.delta,
    done: value.done
  };
}

export function parseReasoningStreamChunkPayload(
  payload: AppEvent["payload"]
): ChatStreamReasoningChunkPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.conversationId !== "string" ||
    typeof value.delta !== "string" ||
    typeof value.done !== "boolean"
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId,
    delta: value.delta,
    done: value.done
  };
}

export function normalizeChatText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/(^|\s)[\[(<]\s*(?:blank[_ ]audio|silence|no[_ ]speech|no[_ ]audio|inaudible|noise|music|applause|laughter|laughing|cough(?:ing)?|breathing|typing)\s*[\])>](?=\s|$)/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function syncThinkingPlacementState(state: AnyState, correlationId: string): void {
  const assistantTs = state.chatFirstAssistantChunkMsByCorrelation[correlationId];
  const reasoningTs = state.chatFirstReasoningChunkMsByCorrelation[correlationId];
  if (assistantTs && reasoningTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] =
      reasoningTs <= assistantTs ? "before" : "after";
    return;
  }
  if (reasoningTs && !assistantTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] = "before";
    return;
  }
  if (assistantTs && !reasoningTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] = "after";
  }
}

export function syncThinkingPlacementForPanelState(
  state: AnyState,
  cp: ChatPanelState,
  correlationId: string
): void {
  const assistantTs = state.chatFirstAssistantChunkMsByCorrelation[correlationId];
  const reasoningTs = state.chatFirstReasoningChunkMsByCorrelation[correlationId];
  if (assistantTs && reasoningTs) {
    cp.chatThinkingPlacementByCorrelation[correlationId] = reasoningTs <= assistantTs ? "before" : "after";
    return;
  }
  if (reasoningTs && !assistantTs) {
    cp.chatThinkingPlacementByCorrelation[correlationId] = "before";
    return;
  }
  if (assistantTs && !reasoningTs) {
    cp.chatThinkingPlacementByCorrelation[correlationId] = "after";
  }
}

export function resetCurrentConversationUiState(
  state: AnyState,
  chatTtsLatencyCapturedByCorrelation: Set<string>
): void {
  state.messages = [];
  state.chatDraft = "";
  state.chatAttachedFileName = null;
  state.chatAttachedFileContent = null;
  state.chatReasoningByCorrelation = {};
  state.chatThinkingPlacementByCorrelation = {};
  state.chatThinkingExpandedByCorrelation = {};
  state.chatToolRowsByCorrelation = {};
  state.chatToolRowExpandedById = {};
  state.chatStreamCompleteByCorrelation = {};
  state.chatToolIntentByCorrelation = {};
  state.chatFirstAssistantChunkMsByCorrelation = {};
  state.chatFirstReasoningChunkMsByCorrelation = {};
  state.chatTtsLatencyMs = null;
  chatTtsLatencyCapturedByCorrelation.clear();
  state.chatStreaming = false;
  state.activeChatCorrelationId = null;
}
