import assert from "node:assert/strict";
import test from "node:test";
import {
  isFirstRunPrimaryActionDisabled,
  isValidFirstRunCustomGgufPath
} from "../src/onboarding/firstRunOnboardingRules.js";

test("custom GGUF paths require a .gguf filename extension", () => {
  assert.equal(isValidFirstRunCustomGgufPath(" /models/model.gguf "), true);
  assert.equal(isValidFirstRunCustomGgufPath("/models/model.GGUF"), true);
  assert.equal(isValidFirstRunCustomGgufPath("/models/model.bin"), false);
  assert.equal(isValidFirstRunCustomGgufPath(""), false);
});

test("Finish is disabled for a custom model until a GGUF path is browsed", () => {
  const state = {
    step: "model" as const,
    busy: false,
    termsAccepted: true,
    customModelSelected: true,
    customModelPath: ""
  };
  assert.equal(isFirstRunPrimaryActionDisabled(state), true);
  assert.equal(isFirstRunPrimaryActionDisabled({ ...state, customModelPath: "/models/model.bin" }), true);
  assert.equal(isFirstRunPrimaryActionDisabled({ ...state, customModelPath: "/models/model.gguf" }), false);
});

test("Finish stays enabled for the predefined model options", () => {
  assert.equal(isFirstRunPrimaryActionDisabled({
    step: "model",
    busy: false,
    termsAccepted: true,
    customModelSelected: false,
    customModelPath: ""
  }), false);
});

test("Next remains gated by terms and busy state", () => {
  const state = {
    step: "welcome" as const,
    busy: false,
    termsAccepted: false,
    customModelSelected: false,
    customModelPath: ""
  };
  assert.equal(isFirstRunPrimaryActionDisabled(state), true);
  assert.equal(isFirstRunPrimaryActionDisabled({ ...state, termsAccepted: true }), false);
  assert.equal(isFirstRunPrimaryActionDisabled({ ...state, termsAccepted: true, busy: true }), true);
});
