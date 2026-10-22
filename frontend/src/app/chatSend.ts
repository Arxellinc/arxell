import type { AppEvent, ChatAttachment, ChatStructuredPayload } from "../contracts.js";
import { appendAppEvent } from "./events.js";

interface ChatSendState {
  messages: Array<{ role: string; text: string; correlationId?: string; structuredPayload?: ChatStructuredPayload | null; attachments?: ChatAttachment[] }>;
  chatDraft: string;
  chatStreaming: boolean;
  activeChatCorrelationId: string | null;
  chatStreamCompleteByCorrelation: Record<string, boolean>;
  chatTtsLatencyMs: number | null;
  chatModelOptions: Array<{ id: string; modelName: string }>;
  chatActiveModelId: string;
  chatModelStatusMessage: string | null;
  conversationId: string;
  chatThinkingEnabled: boolean;
  chatRoutePreference: string;
  chatActiveModelLabel: string;
  llamaRuntimeMaxTokens: number | null;
  chatReasoningByCorrelation: Record<string, string>;
  chatThinkingExpandedByCorrelation: Record<string, boolean>;
  chatThinkingPlacementByCorrelation: Record<string, "before" | "after">;
  chatTtsEnabled: boolean;
  memoryAlwaysLoadToolKeys: string[];
  memoryAlwaysLoadSkillKeys: string[];
  chatFirstAssistantChunkMsByCorrelation: Record<string, number>;
  events: AppEvent[];
}

interface ChatSendDeps {
  getClientRef: () => {
    sendMessage: (payload: any) => Promise<{
      correlationId: string;
      assistantMessage: string;
      assistantThinking?: string | null;
      structuredPayload?: ChatStructuredPayload | null;
    }>;
  } | null;
  state: ChatSendState;
  nextCorrelationId: () => string;
  normalizeChatText: (input: string) => string;
  clearVoicePrefillState: () => void;
  chatTtsLatencyCapturedByCorrelation: Set<string>;
  chatTtsSawStreamDeltaByCorrelation: Set<string>;
  postprocessSpeakableText: (raw: string) => string;
  extractSpeakableStreamDelta: (delta: string) => string;
  enqueueImmediateTtsChunk: (text: string, correlationId: string) => void;
  enqueueSpeakableChunk: (text: string, isFinalFlush?: boolean, correlationId?: string | null) => void;
  runChatTtsQueue: (sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>) => Promise<void>;
  refreshConversations: () => Promise<void>;
  waitForLocalModelReady: (isCurrent: () => boolean) => Promise<boolean>;
  renderAndBind: (sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>) => void;
}

/** Invalidate synchronously, before awaiting TTS or backend cancellation. */
export function interruptChatSend(
  state: Pick<ChatSendState, "chatStreaming" | "activeChatCorrelationId" | "chatModelStatusMessage">
): string | null {
  const correlationId = state.activeChatCorrelationId;
  state.chatStreaming = false;
  state.activeChatCorrelationId = null;
  state.chatModelStatusMessage = null;
  return correlationId;
}

export function createSendMessageHandler(
  deps: ChatSendDeps
): (text: string, attachments?: ChatAttachment[]) => Promise<void> {
  const sendMessage = async (text: string, attachments?: ChatAttachment[]): Promise<void> => {
    const clientRef = deps.getClientRef();
    if (!clientRef || deps.state.chatStreaming) return;

    deps.clearVoicePrefillState();

    const normalizedUserText = deps.normalizeChatText(text);
    if (!normalizedUserText && !attachments?.length) {
      return;
    }
    const correlationId = deps.nextCorrelationId();
    const conversationId = deps.state.conversationId;
    const modelId = deps.state.chatActiveModelId;
    const isCurrent = () => deps.state.chatStreaming
      && deps.state.activeChatCorrelationId === correlationId
      && deps.state.conversationId === conversationId;
    deps.state.messages.push(
      attachments?.length
        ? { role: "user", text: normalizedUserText, attachments }
        : { role: "user", text: normalizedUserText }
    );
    deps.state.chatDraft = "";
    deps.state.chatStreaming = true;
    deps.state.activeChatCorrelationId = correlationId;
    deps.state.chatStreamCompleteByCorrelation[correlationId] = false;
    deps.state.chatTtsLatencyMs = null;
    deps.state.chatModelStatusMessage = null;
    deps.chatTtsLatencyCapturedByCorrelation.delete(correlationId);
    deps.renderAndBind(sendMessage);

    try {
      const selectedChatModel = deps.state.chatModelOptions.find(
        (option) => option.id === modelId
      );
      const requestPayloadBase = {
        conversationId,
        userMessage: normalizedUserText,
        correlationId,
        thinkingEnabled: deps.state.chatThinkingEnabled,
        chatMode: deps.state.chatRoutePreference,
        modelId,
        modelName: selectedChatModel?.modelName || deps.state.chatActiveModelLabel,
        alwaysLoadToolKeys: deps.state.memoryAlwaysLoadToolKeys,
        alwaysLoadSkillKeys: deps.state.memoryAlwaysLoadSkillKeys
      } as const;
      const requestPayload = attachments?.length
        ? {
            ...requestPayloadBase,
            attachments
          }
        : requestPayloadBase;
      const payload = deps.state.llamaRuntimeMaxTokens === null
        ? requestPayload
        : { ...requestPayload, maxTokens: deps.state.llamaRuntimeMaxTokens };
      if (!isCurrent()) return;
      if (modelId.startsWith("local:")) {
        deps.state.chatModelStatusMessage = "Waiting for model...";
        deps.renderAndBind(sendMessage);
        const ready = await deps.waitForLocalModelReady(isCurrent);
        if (!isCurrent()) return;
        if (!ready) {
          throw new Error("Local model did not become ready within 45 seconds. Check the runtime and try again.");
        }
        deps.state.chatModelStatusMessage = null;
        deps.renderAndBind(sendMessage);
      }
      if (!isCurrent()) return;
      // Send once. Even a 503 can arrive after the backend persisted the user
      // message; replaying this command would duplicate that conversation turn.
      const response = await clientRef.sendMessage(payload);
      if (!isCurrent()) return;

      const existing = deps.state.messages.find(
        (m) => m.role === "assistant" && m.correlationId === response.correlationId
      );
      if (existing) {
        existing.text = deps.normalizeChatText(response.assistantMessage);
        existing.structuredPayload = response.structuredPayload ?? null;
      } else {
        deps.state.messages.push({
          role: "assistant",
          text: deps.normalizeChatText(response.assistantMessage),
          correlationId: response.correlationId,
          structuredPayload: response.structuredPayload ?? null
        });
      }
      if (response.assistantThinking?.trim()) {
        deps.state.chatReasoningByCorrelation[response.correlationId] = deps.normalizeChatText(
          response.assistantThinking
        );
        deps.state.chatThinkingExpandedByCorrelation[response.correlationId] =
          deps.state.chatThinkingExpandedByCorrelation[response.correlationId] === true;
        if (!deps.state.chatThinkingPlacementByCorrelation[response.correlationId]) {
          deps.state.chatThinkingPlacementByCorrelation[response.correlationId] = "after";
        }
      }

      if (
        deps.state.chatTtsEnabled &&
        response.assistantMessage?.trim() &&
        !deps.chatTtsSawStreamDeltaByCorrelation.has(response.correlationId)
      ) {
        if (!deps.state.chatFirstAssistantChunkMsByCorrelation[response.correlationId]) {
          deps.state.chatFirstAssistantChunkMsByCorrelation[response.correlationId] = Date.now();
        }
        const seed = deps.postprocessSpeakableText(
          deps.extractSpeakableStreamDelta(response.assistantMessage)
        );
        if (seed) {
          const firstTarget = 48;
          const splitAt = seed.length <= firstTarget
            ? seed.length
            : Math.max(seed.lastIndexOf(" ", firstTarget), 24);
          const first = seed.slice(0, splitAt).trim();
          const rest = seed.slice(splitAt).trim();
          if (first) {
            deps.enqueueImmediateTtsChunk(first, response.correlationId);
          }
          if (rest) {
            deps.enqueueSpeakableChunk(rest, true, response.correlationId);
          }
        }
        void deps.runChatTtsQueue(sendMessage);
      }

      deps.chatTtsSawStreamDeltaByCorrelation.delete(response.correlationId);
      await deps.refreshConversations();
    } catch (error) {
      if (!isCurrent()) return;
      deps.state.chatModelStatusMessage = null;
      const message = error instanceof Error ? error.message : String(error);
      const existing = deps.state.messages.find(
        (m) => m.role === "assistant" && m.correlationId === correlationId
      );
      const errorText = `Failed to generate response: ${message}`;
      if (existing) {
        existing.text = errorText;
      } else {
        deps.state.messages.push({
          role: "assistant",
          text: errorText,
          correlationId
        });
      }
      appendAppEvent(deps.state.events, {
        timestampMs: Date.now(),
        correlationId,
        subsystem: "frontend",
        action: "chat.send",
        stage: "error",
        severity: "error",
        payload: { message }
      });
      if (deps.state.chatTtsEnabled) {
        deps.enqueueImmediateTtsChunk(errorText, correlationId);
        void deps.runChatTtsQueue(sendMessage);
      }
    } finally {
      // A stopped/older send must not clear the state of a newer request.
      if (deps.state.activeChatCorrelationId === correlationId) {
        deps.state.chatModelStatusMessage = null;
        deps.state.activeChatCorrelationId = null;
        deps.state.chatStreaming = false;
        deps.renderAndBind(sendMessage);
      }
    }
  };

  return sendMessage;
}
