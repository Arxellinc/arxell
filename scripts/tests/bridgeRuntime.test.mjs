import test from "node:test";
import assert from "node:assert/strict";

import {
  createCorrelationIdFrom,
  typedBridgeEnabledFrom,
} from "../../src/lib/bridgeRuntime.js";

test("typedBridgeEnabledFrom returns false when both flags are false", () => {
  assert.equal(typedBridgeEnabledFrom(false, false), false);
});

test("typedBridgeEnabledFrom returns true when env flag is true", () => {
  assert.equal(typedBridgeEnabledFrom(true, false), true);
});

test("typedBridgeEnabledFrom returns true when storage flag is true", () => {
  assert.equal(typedBridgeEnabledFrom(false, true), true);
});

test("createCorrelationIdFrom uses randomUuid when available", () => {
  const id = createCorrelationIdFrom({
    randomUuid: () => "uuid-123",
    now: () => 1,
    randomHex: () => "abc",
  });

  assert.equal(id, "uuid-123");
});

test("createCorrelationIdFrom falls back to deterministic corr pattern", () => {
  const id = createCorrelationIdFrom({
    now: () => 1700000000000,
    randomHex: () => "deadbeef",
  });

  assert.equal(id, "corr-1700000000000-deadbeef");
});
