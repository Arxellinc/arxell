import assert from "node:assert/strict";
import test from "node:test";
import { createSendMessageHandler, interruptChatSend } from "../src/app/chatSend.js";
import { LOCAL_MODEL_READY_TIMEOUT_MS, waitForLocalModelReadiness } from "../src/app/localModelReadiness.js";
import type { ChatSendRequest } from "../src/contracts.js";

type SendDeps = Parameters<typeof createSendMessageHandler>[0];
type Response = Awaited<ReturnType<NonNullable<ReturnType<SendDeps["getClientRef"]>>["sendMessage"]>>;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options: {
  modelId?: string;
  refresh?: () => Promise<void>;
  isReady?: () => boolean;
  onSend?: (request: ChatSendRequest) => Promise<Response>;
} = {}) {
  const state: SendDeps["state"] = {
    messages: [], chatDraft: "draft", chatStreaming: false, activeChatCorrelationId: null,
    chatStreamCompleteByCorrelation: {}, chatTtsLatencyMs: null,
    chatModelOptions: [{ id: options.modelId ?? "local:runtime", modelName: "fixture-model" }],
    chatActiveModelId: options.modelId ?? "local:runtime", chatModelStatusMessage: null,
    conversationId: "conversation-1", chatThinkingEnabled: false,
    chatRoutePreference: "auto", chatActiveModelLabel: "fixture-model", llamaRuntimeMaxTokens: 512,
    chatReasoningByCorrelation: {}, chatThinkingExpandedByCorrelation: {}, chatThinkingPlacementByCorrelation: {},
    chatTtsEnabled: true, memoryAlwaysLoadToolKeys: [], memoryAlwaysLoadSkillKeys: [],
    chatFirstAssistantChunkMsByCorrelation: {}, events: []
  };
  const calls: ChatSendRequest[] = [];
  const speech: string[] = [];
  let refreshCount = 0;
  let sequence = 0;
  const deps: SendDeps = {
    state,
    getClientRef: () => ({ sendMessage: async (request: ChatSendRequest) => {
      calls.push(request);
      return options.onSend ? options.onSend(request) : {
        correlationId: request.correlationId, assistantMessage: "reply"
      };
    } }),
    nextCorrelationId: () => `corr-${++sequence}`,
    normalizeChatText: (text) => text.trim(), clearVoicePrefillState: () => {},
    chatTtsLatencyCapturedByCorrelation: new Set(), chatTtsSawStreamDeltaByCorrelation: new Set(),
    postprocessSpeakableText: (text) => text, extractSpeakableStreamDelta: (text) => text,
    enqueueImmediateTtsChunk: (text) => { speech.push(text); }, enqueueSpeakableChunk: () => {},
    runChatTtsQueue: async () => {}, refreshConversations: async () => {}, renderAndBind: () => {},
    waitForLocalModelReady: (isCurrent) => waitForLocalModelReadiness({
      isCurrent, isReady: options.isReady ?? (() => true),
      refresh: async () => { refreshCount++; await options.refresh?.(); }
    })
  };
  return { state, deps, calls, speech, send: createSendMessageHandler(deps), refreshCount: () => refreshCount };
}

test("local readiness is checked before a single send, with send settings captured", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let checks = 0;
  const h = harness({ isReady: () => ++checks >= 3 });
  const sending = h.send(" hello ");
  await flush();
  assert.equal(h.state.chatModelStatusMessage, "Waiting for model...");
  assert.equal(h.calls.length, 0);
  h.state.llamaRuntimeMaxTokens = 1024;
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(1000); await flush(); }
  await sending;
  assert.equal(h.refreshCount(), 3);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]?.maxTokens, 512);
  assert.equal(h.calls[0]?.userMessage, "hello");
  assert.deepEqual(h.state.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(h.state.chatStreaming, false);
  assert.equal(h.state.chatModelStatusMessage, null);
});

test("never-ready models hit a deadline without sending/persisting a user turn", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness({ isReady: () => false });
  const sending = h.send("hello");
  await flush();
  t.mock.timers.tick(LOCAL_MODEL_READY_TIMEOUT_MS);
  await sending;
  assert.equal(h.calls.length, 0);
  assert.match(h.state.messages[1]?.text ?? "", /45 seconds/);
  assert.equal(h.state.events.length, 1);
  assert.equal(h.state.chatStreaming, false);
  assert.equal(h.state.activeChatCorrelationId, null);
});

test("a hung readiness IPC is bounded and its late result cannot dispatch chat", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const status = deferred<void>();
  const h = harness({ refresh: () => status.promise });
  const sending = h.send("hello");
  t.mock.timers.tick(LOCAL_MODEL_READY_TIMEOUT_MS);
  await sending;
  status.resolve();
  await flush();
  t.mock.timers.tick(LOCAL_MODEL_READY_TIMEOUT_MS);
  assert.equal(h.calls.length, 0);
  assert.equal(h.refreshCount(), 1);
  assert.match(h.state.messages[1]?.text ?? "", /45 seconds/);
});

test("Stop during a polling delay is quiet, clears status, and stops future polling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness({ isReady: () => false });
  const sending = h.send("hello");
  await flush();
  assert.equal(interruptChatSend(h.state), "corr-1");
  assert.equal(h.state.chatModelStatusMessage, null);
  assert.equal(h.state.chatStreaming, false);
  t.mock.timers.tick(50);
  await sending;
  t.mock.timers.tick(LOCAL_MODEL_READY_TIMEOUT_MS);
  assert.equal(h.refreshCount(), 1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.messages.length, 1);
  assert.deepEqual(h.state.events, []);
  assert.deepEqual(h.speech, []);
});

test("Stop releases a hung readiness wait; even a late rejection cannot revive it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const status = deferred<void>();
  const h = harness({ refresh: () => status.promise });
  const sending = h.send("hello");
  interruptChatSend(h.state);
  t.mock.timers.tick(50);
  await sending;
  status.reject(new Error("late status failure"));
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.messages.length, 1);
  assert.deepEqual(h.state.events, []);
  assert.deepEqual(h.speech, []);
});

test("Stop just before readiness completes prevents dispatch", async () => {
  const h = harness({ refresh: async () => { interruptChatSend(h.state); } });
  await h.send("hello");
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.messages.length, 1);
});

test("Stop after readiness but before dispatch still prevents the single send", async () => {
  const h = harness();
  let waitingWasShown = false;
  h.deps.renderAndBind = () => {
    if (h.state.chatModelStatusMessage === "Waiting for model...") waitingWasShown = true;
    else if (waitingWasShown) interruptChatSend(h.state);
  };
  await h.send("hello");
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.messages.length, 1);
});

test("stopping one pane does not cancel another pane's readiness wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const status = deferred<void>();
  const primary = harness({ refresh: () => status.promise });
  const split = harness({ refresh: () => status.promise });
  const first = primary.send("primary");
  const second = split.send("split");
  interruptChatSend(primary.state);
  t.mock.timers.tick(50);
  await first;
  assert.equal(split.state.chatStreaming, true);
  status.resolve();
  await second;
  assert.equal(primary.calls.length, 0);
  assert.equal(split.calls.length, 1);
});

test("readiness refresh failures surface once without retrying chat", async () => {
  const h = harness({ refresh: async () => { throw new Error("status unavailable"); } });
  await h.send("hello");
  assert.equal(h.calls.length, 0);
  assert.match(h.state.messages[1]?.text ?? "", /status unavailable/);
  assert.equal(h.state.events.length, 1);
});

for (const modelId of ["local:runtime", "api:fixture:model"]) {
  test(`a 503 after dispatch is surfaced once, never resubmitted (${modelId})`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const h = harness({ modelId, onSend: async () => { throw new Error("503: loading model"); } });
    await h.send("hello");
    t.mock.timers.tick(LOCAL_MODEL_READY_TIMEOUT_MS * 2);
    await flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.refreshCount(), modelId.startsWith("local:") ? 1 : 0);
    assert.match(h.state.messages[1]?.text ?? "", /503: loading model/);
    assert.equal(h.state.messages.filter((message) => message.role === "user").length, 1);
    assert.equal(h.state.events.length, 1);
  });
}

test("duplicate submit while waiting does not allocate a second request", async () => {
  const status = deferred<void>();
  const h = harness({ refresh: () => status.promise });
  const sending = h.send("hello");
  await h.send("duplicate click");
  status.resolve();
  await sending;
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.messages.filter((message) => message.role === "user").length, 1);
});

for (const outcome of ["success", "failure"]) {
  test(`an old request's late ${outcome} cannot alter a newer conversation/send`, async () => {
    const old = deferred<Response>();
    const next = deferred<Response>();
    const h = harness({ modelId: "api:fixture:model", onSend: (request) => request.correlationId === "corr-1" ? old.promise : next.promise });
    const oldSend = h.send("old conversation");
    interruptChatSend(h.state);
    h.state.conversationId = "conversation-2";
    h.state.messages = [];
    const nextSend = h.send("new conversation");
    h.state.chatModelStatusMessage = "new progress";
    if (outcome === "success") old.resolve({ correlationId: "corr-1", assistantMessage: "stale" });
    else old.reject(new Error("stale failure"));
    await oldSend;
    assert.equal(h.state.activeChatCorrelationId, "corr-2");
    assert.equal(h.state.chatStreaming, true);
    assert.equal(h.state.chatModelStatusMessage, "new progress");
    assert.equal(h.state.messages.length, 1);
    assert.deepEqual(h.state.events, []);
    assert.deepEqual(h.speech, []);
    next.resolve({ correlationId: "corr-2", assistantMessage: "fresh" });
    await nextSend;
    assert.equal(h.state.messages[1]?.text, "fresh");
    assert.equal(h.state.chatStreaming, false);
  });
}

test("changing the conversation invalidates a pending readiness wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const status = deferred<void>();
  const h = harness({ refresh: () => status.promise });
  const sending = h.send("hello");
  h.state.conversationId = "conversation-2";
  h.state.messages = [];
  t.mock.timers.tick(50);
  await sending;
  status.resolve();
  await flush();
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.state.messages, []);
  assert.deepEqual(h.state.events, []);
});
