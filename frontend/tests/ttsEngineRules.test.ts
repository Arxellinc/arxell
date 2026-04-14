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
    engineId: "sherpa-kokoro",
    engine: "kokoro",
    ready: true,
    runtimeArchivePresent: true,
    availableModelPaths: ["/tmp/bundle/model.onnx"],
    modelPath: "/tmp/model.onnx",
    secondaryPath: "/tmp/secondary.bin",
    voicesPath: "/tmp/voices.bin",
    tokensPath: "/tmp/tokens.txt",
    dataDir: "/tmp/espeak-ng-data",
    pythonPath: "/tmp/python",
    scriptPath: "/tmp/script.py",
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
  assert.equal(defaultVoiceForEngine("piper"), "speaker_0");
  assert.equal(defaultVoiceForEngine("matcha"), "speaker_0");
  assert.equal(defaultVoiceForEngine("kitten"), "speaker_0");
  assert.equal(defaultVoiceForEngine("pocket"), "speaker_0");
  assert.deepEqual(defaultVoicesForEngine("kokoro"), ["af_heart"]);
  assert.deepEqual(defaultVoicesForEngine("piper"), ["speaker_0"]);
});

test("engine UI config hides optional piper lexicon path and keeps required matcha vocoder path", () => {
  const piper = getTtsEngineUiConfig("piper");
  assert.equal(piper.showSecondaryPath, false);
  assert.equal(piper.secondaryRequired, false);
  assert.equal(piper.secondaryLabel, "Lexicon Path");

  const matcha = getTtsEngineUiConfig("matcha");
  assert.equal(matcha.showSecondaryPath, true);
  assert.equal(matcha.secondaryRequired, true);
  assert.equal(matcha.secondaryLabel, "Vocoder Path");

  const pocket = getTtsEngineUiConfig("pocket");
  assert.equal(pocket.showSecondaryPath, false);
  assert.equal(pocket.secondaryRequired, false);
});

test("resetTtsStateForEngine clears stale engine-scoped values for every engine", () => {
  const engines = ["kokoro", "piper", "matcha", "kitten", "pocket"] as const;
  for (const engine of engines) {
    const reset = resetTtsStateForEngine(makeSeedState(), engine);
    assert.equal(reset.engine, engine);
    assert.equal(reset.status, "idle");
    assert.equal(reset.message, null);
    assert.equal(reset.ready, false);
    assert.equal(reset.runtimeArchivePresent, false);
    assert.deepEqual(reset.availableModelPaths, []);
    assert.equal(reset.modelPath, "");
    assert.equal(reset.secondaryPath, "");
    assert.equal(reset.voicesPath, "");
    assert.equal(reset.tokensPath, "");
    assert.equal(reset.dataDir, "");
    assert.equal(reset.pythonPath, "");
    assert.equal(reset.scriptPath, "");
    assert.equal(reset.selectedVoice, defaultVoiceForEngine(engine));
    assert.deepEqual(reset.voices, defaultVoicesForEngine(engine));
    assert.equal(reset.speed, 1);
    assert.equal(reset.lastBytes, null);
    assert.equal(reset.lastDurationMs, null);
    assert.equal(reset.lastSampleRate, null);
    assert.equal(reset.testText, "Keep this text");
  }
});
