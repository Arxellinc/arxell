import type { ChatPanelState } from "../panels/types";

type AnyState = Record<string, any>;

export function syncPrimaryChatPanelFromFlatState(state: AnyState): void {
  const cp = state.chatPanels[0];
  if (!cp) return;
  cp.conversationId = state.conversationId;
  cp.messages = state.messages;
  cp.chatReasoningByCorrelation = state.chatReasoningByCorrelation;
  cp.chatThinkingPlacementByCorrelation = state.chatThinkingPlacementByCorrelation;
  cp.chatThinkingExpandedByCorrelation = state.chatThinkingExpandedByCorrelation;
  cp.chatToolRowsByCorrelation = state.chatToolRowsByCorrelation;
  cp.chatToolRowExpandedById = state.chatToolRowExpandedById;
  cp.chatStreamCompleteByCorrelation = state.chatStreamCompleteByCorrelation;
  cp.chatStreaming = state.chatStreaming;
  cp.chatDraft = state.chatDraft;
  cp.chatAttachedFileName = state.chatAttachedFileName;
  cp.chatAttachedFileContent = state.chatAttachedFileContent;
  cp.chatActiveModelId = state.chatActiveModelId;
  cp.chatActiveModelLabel = state.chatActiveModelLabel;
  cp.chatActiveModelCapabilities = state.chatActiveModelCapabilities;
  cp.chatThinkingEnabled = state.chatThinkingEnabled;
  cp.chatTtsEnabled = state.chatTtsEnabled;
  cp.chatTtsPlaying = state.chatTtsPlaying;
  cp.chatModelStatusMessage = state.chatModelStatusMessage;
  cp.llamaRuntimeBusy = state.llamaRuntimeBusy;
  cp.activeChatCorrelationId = state.activeChatCorrelationId;
}

export function getPrimaryChatPanelState(
  state: AnyState,
  primaryPaneId: string,
  createChatPanelState: (panelId: string, src: AnyState) => ChatPanelState,
): ChatPanelState {
  let cp = state.chatPanels[0];
  if (!cp) {
    cp = createChatPanelState(primaryPaneId, state);
    state.chatPanels[0] = cp;
  }
  syncPrimaryChatPanelFromFlatState(state);
  return cp;
}

export function getSecondaryChatPanelState(state: AnyState, primaryPaneId: string, panelId: string): ChatPanelState | null {
  if (panelId === primaryPaneId) return null;
  return state.chatPanels.find((panel: ChatPanelState) => panel.panelId === panelId) ?? null;
}

export function getChatPanelById(
  state: AnyState,
  primaryPaneId: string,
  panelId: string,
  createChatPanelState: (panelId: string, src: AnyState) => ChatPanelState,
): ChatPanelState | null {
  if (panelId === primaryPaneId) {
    return getPrimaryChatPanelState(state, primaryPaneId, createChatPanelState);
  }
  return getSecondaryChatPanelState(state, primaryPaneId, panelId);
}

export function rememberChatCorrelationTarget(
  chatPaneIdByCorrelation: Map<string, string>,
  panelId: string,
  correlationId: string
): void {
  chatPaneIdByCorrelation.set(correlationId, panelId);
}

export function resolveChatPaneIdForEvent(
  state: AnyState,
  primaryPaneId: string,
  chatPaneIdByCorrelation: Map<string, string>,
  correlationId: string,
  conversationId?: string | null
): string | null {
  const knownPaneId = chatPaneIdByCorrelation.get(correlationId);
  if (knownPaneId) return knownPaneId;
  if (state.activeChatCorrelationId === correlationId || state.conversationId === conversationId) {
    return primaryPaneId;
  }
  for (const cp of state.chatPanels.slice(1)) {
    if (cp.activeChatCorrelationId === correlationId || cp.conversationId === conversationId) {
      return cp.panelId;
    }
  }
  return null;
}
