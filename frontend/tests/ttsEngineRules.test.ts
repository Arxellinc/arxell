import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultVoiceForEngine,
  defaultVoicesForEngine,
  getTtsEngineUiConfig,
  resetTtsStateForEngine,
  type TtsEngineResettableState
} from "../src/tts/engineRules.js";

function makeSeedState(): TtsEngineResettableState {
  return {
    status: "error",
    message: "stale error",
    engineId: "kokoro",
    engine: "kokoro",
    ready: true,
    modelPath: "/tmp/model.onnx",
    voices: ["af_heart", "af"],
    selectedVoice: "af",
    speed: 1.4,
    testText: "Keep this text",
    lastDurationMs: 1200,
    lastBytes: 32_000,
    lastSampleRate: 24_000
  };
}

test("default voices are engine specific", () => {
  assert.equal(defaultVoiceForEngine("kokoro"), "af_heart");
  assert.equal(defaultVoiceForEngine("pocket"), "speaker_0");
  assert.deepEqual(defaultVoicesForEngine("kokoro"), ["af_heart"]);
  assert.deepEqual(defaultVoicesForEngine("pocket"), ["speaker_0"]);
});

test("engine UI config provides engine labels and hints", () => {
  const kokoro = getTtsEngineUiConfig("kokoro");
  assert.equal(kokoro.engineLabel, "Kokoro");
  assert.match(kokoro.engineHint, /bundled/i);

  const pocket = getTtsEngineUiConfig("pocket");
  assert.equal(pocket.engineLabel, "PocketTTS");
  assert.match(pocket.engineHint, /bundled/i);
});

test("resetTtsStateForEngine clears stale engine-scoped values for every engine", () => {
  const engines = ["kokoro", "pocket"] as const;
  for (const engine of engines) {
    const reset = resetTtsStateForEngine(makeSeedState(), engine);
    assert.equal(reset.engine, engine);
    assert.equal(reset.status, "idle");
    assert.equal(reset.message, null);
    assert.equal(reset.ready, false);
    assert.equal(reset.modelPath, "");
    assert.equal(reset.selectedVoice, defaultVoiceForEngine(engine));
    assert.deepEqual(reset.voices, defaultVoicesForEngine(engine));
    assert.equal(reset.speed, 1);
    assert.equal(reset.lastBytes, null);
    assert.equal(reset.lastDurationMs, null);
    assert.equal(reset.lastSampleRate, null);
    assert.equal(reset.testText, "Keep this text");
  }
});
