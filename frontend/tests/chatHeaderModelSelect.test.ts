import assert from "node:assert/strict";
import test from "node:test";
import { renderChatHeaderModelSelect } from "../src/app/chatHeaderModelSelect.js";

test("chat header model select keeps a full-name tooltip and a truncatable label", () => {
  const label = "HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF-Q5_K_P.gguf";
  const html = renderChatHeaderModelSelect({
    options: [{ id: "local:long", label }],
    activeModelId: "local:long",
    paneId: "primary"
  });

  assert.match(html, /class="chat-header-model-wrap"/);
  assert.match(html, /class="chat-header-model-label"[^>]*aria-hidden="true"/);
  assert.match(html, /class="chat-header-model-select"/);
  assert.match(html, /data-chat-pane-id="primary"/);
  assert.ok(html.includes(`title="${label}"`), "full model name must remain available as a tooltip");
  assert.ok(html.includes(label), "the label text must be rendered");
});

test("chat header model select falls back when no models are configured", () => {
  const html = renderChatHeaderModelSelect({
    options: [],
    activeModelId: "",
    paneId: "primary"
  });

  assert.match(html, /chat-header-model-fallback/);
  assert.doesNotMatch(html, /<select/);
});
