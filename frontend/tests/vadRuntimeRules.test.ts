import assert from "node:assert/strict";
import test from "node:test";
import {
  canRequestVadHandoff,
  canStartShadowEval,
  canStopShadowEval,
  isVoiceRuntimeIdle
} from "../src/app/vadRuntimeRules.js";

test("VAD method selector stays V1-compatible in idle", () => {
  assert.equal(isVoiceRuntimeIdle("idle"), true);
  assert.equal(isVoiceRuntimeIdle("running_single"), false);
});

test("handoff controls require running state and no active handoff", () => {
  assert.equal(
    canRequestVadHandoff({ runtimeState: "running_single", handoffState: "none", targetCount: 1 }),
    true
  );
  assert.equal(
    canRequestVadHandoff({ runtimeState: "idle", handoffState: "none", targetCount: 1 }),
    false
  );
  assert.equal(
    canRequestVadHandoff({ runtimeState: "running_single", handoffState: "preparing", targetCount: 1 }),
    false
  );
});

test("shadow controls reflect backend runtime truth", () => {
  assert.equal(canStartShadowEval({ runtimeState: "running_single", shadowMethodId: "microturn-v1" }), true);
  assert.equal(canStartShadowEval({ runtimeState: "running_single", shadowMethodId: null }), false);
  assert.equal(canStopShadowEval("running_dual"), true);
  assert.equal(canStopShadowEval("running_single"), false);
});
