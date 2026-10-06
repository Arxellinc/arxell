import assert from "node:assert/strict";
import test from "node:test";
import { openMemoryModalState } from "../src/app/memoryOrchestration.js";

test("custom context keys round-trip unchanged, including names resembling system metadata", () => {
  const state: Record<string, any> = { memoryContextItems: [
    { key: "Base system prompt", category: "custom-context", value: "User preference" }
  ] };
  openMemoryModalState(state, "context", 0);
  assert.equal(state.memoryModalTarget, "custom-item");
  assert.equal(state.memoryModalKey, "Base system prompt");
  assert.equal(state.memoryModalNamespace, "context");
});

test("only the configured base prompt is editable as a system prompt", () => {
  const state: Record<string, any> = { memoryContextItems: [
    { key: "Base system prompt", category: "system", value: "Configured instruction" },
    { key: "Runtime metadata and skill index", category: "system", value: "Generated time/skills" }
  ] };
  openMemoryModalState(state, "context", 0);
  assert.equal(state.memoryModalTarget, "system-prompt");
  openMemoryModalState(state, "context", 1);
  assert.equal(state.memoryModalEditable, false);
});
