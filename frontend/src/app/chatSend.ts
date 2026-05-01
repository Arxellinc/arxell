import type { AppEvent, ChatAttachment } from "../contracts.js";

interface ChatSendState {
  messages: Array<{ role: string; text: string; correlationId?: string }>;
  chatDraft: string;
  chatStreaming: boolean;
  activeChatCorrelationId: string | null;
  chatStreamCompleteByCorrelation: Record<string, boolean>;
  chatTtsLatencyMs: number | null;
  chatModelOptions: Array<{ id: string; modelName: string }>;
  chatActiveModelId: string;
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
  renderAndBind: (sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>) => void;
}

export function createSendMessageHandler(
  deps: ChatSendDeps
): (text: string, attachments?: ChatAttachment[]) => Promise<void> {
  const sendMessage = async (text: string, attachments?: ChatAttachment[]): Promise<void> => {
    const clientRef = deps.getClientRef();
    if (!clientRef) return;

    deps.clearVoicePrefillState();

    const normalizedUserText = deps.normalizeChatText(text);
    if (!normalizedUserText && !attachments?.length) {
      return;
    }
    const correlationId = deps.nextCorrelationId();
    deps.state.messages.push({ role: "user", text: normalizedUserText });
    deps.state.chatDraft = "";
    deps.state.chatStreaming = true;
    deps.state.activeChatCorrelationId = correlationId;
    deps.state.chatStreamCompleteByCorrelation[correlationId] = false;
    deps.state.chatTtsLatencyMs = null;
    deps.chatTtsLatencyCapturedByCorrelation.delete(correlationId);
    deps.renderAndBind(sendMessage);

    try {
      const selectedChatModel = deps.state.chatModelOptions.find(
        (option) => option.id === deps.state.chatActiveModelId
      );
      const requestPayloadBase = {
        conversationId: deps.state.conversationId,
        userMessage: normalizedUserText,
        correlationId,
        thinkingEnabled: deps.state.chatThinkingEnabled,
        chatMode: deps.state.chatRoutePreference,
        modelId: deps.state.chatActiveModelId,
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
      const response = await clientRef.sendMessage(
        deps.state.llamaRuntimeMaxTokens === null
          ? requestPayload
          : {
              ...requestPayload,
              maxTokens: deps.state.llamaRuntimeMaxTokens
            }
      );

      const existing = deps.state.messages.find(
        (m) => m.role === "assistant" && m.correlationId === response.correlationId
      );
      if (existing) {
        existing.text = deps.normalizeChatText(response.assistantMessage);
      } else {
        deps.state.messages.push({
          role: "assistant",
          text: deps.normalizeChatText(response.assistantMessage),
          correlationId: response.correlationId
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
      deps.state.events.push({
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
      if (deps.state.activeChatCorrelationId === correlationId) {
        deps.state.activeChatCorrelationId = null;
      }
      deps.state.chatStreaming = false;
      deps.renderAndBind(sendMessage);
    }
  };

  return sendMessage;
}
