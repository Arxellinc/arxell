import assert from "node:assert/strict";
import test from "node:test";
import { initializeSendMessageBinding } from "../src/app/sendMessageBootstrap.js";

function makeState() {
  return {
    messages: [] as Array<{ role: string; text: string; correlationId?: string }>,
    chatDraft: "draft",
    chatStreaming: false,
    activeChatCorrelationId: null as string | null,
    chatStreamCompleteByCorrelation: {} as Record<string, boolean>,
    chatTtsLatencyMs: 123,
    chatModelOptions: [{ id: "m1", modelName: "model-1" }],
    chatActiveModelId: "m1",
    conversationId: "C123",
    chatThinkingEnabled: true,
    chatRoutePreference: "auto",
    chatActiveModelLabel: "model-1",
    llamaRuntimeMaxTokens: null as number | null,
    chatReasoningByCorrelation: {} as Record<string, string>,
    chatThinkingExpandedByCorrelation: {} as Record<string, boolean>,
    chatThinkingPlacementByCorrelation: {} as Record<string, "before" | "after">,
    chatTtsEnabled: false,
    chatFirstAssistantChunkMsByCorrelation: {} as Record<string, number>,
    events: [] as Array<{
      timestampMs: number;
      correlationId: string;
      subsystem: "frontend";
      action: "chat.send";
      stage: "error";
      severity: "error";
      payload: { message: string };
    }>
  };
}

test("initializeSendMessageBinding assigns a live send handler used by submit path", async () => {
  const state = makeState();
  let sendCount = 0;
  let assigned:
    | ((text: string, attachments?: Array<{ kind: "image"; fileName: string; mimeType: string; dataBase64: string }>) => Promise<void>)
    | null = null;

  const sendMessage = initializeSendMessageBinding(
    {
      getClientRef: () => ({
        sendMessage: async (payload: any) => {
          sendCount += 1;
          return {
            correlationId: payload.correlationId,
            assistantMessage: "ok",
            assistantThinking: ""
          };
        }
      }),
      state,
      nextCorrelationId: () => "corr-1",
      normalizeChatText: (input: string) => input.trim(),
      clearVoicePrefillState: () => undefined,
      chatTtsLatencyCapturedByCorrelation: new Set<string>(),
      chatTtsSawStreamDeltaByCorrelation: new Set<string>(),
      postprocessSpeakableText: (raw: string) => raw,
      extractSpeakableStreamDelta: (raw: string) => raw,
      enqueueImmediateTtsChunk: () => undefined,
      enqueueSpeakableChunk: () => undefined,
      runChatTtsQueue: async () => undefined,
      refreshConversations: async () => undefined,
      renderAndBind: () => undefined
    },
    (bound) => {
      assigned = bound;
    }
  );

  assert.ok(assigned, "send handler should be assigned for render/polling paths");
  assert.equal(assigned, sendMessage, "assigned handler should be the live sendMessage function");

  await sendMessage(" hello ");
  assert.equal(sendCount, 1, "chat submit should call IPC sendMessage exactly once");
  assert.equal(state.messages[0]?.role, "user");
  assert.equal(state.messages[0]?.text, "hello");
  assert.equal(state.messages[1]?.role, "assistant");
  assert.equal(state.messages[1]?.text, "ok");
});
