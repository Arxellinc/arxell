import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { bindFirstRunOnboardingInteractions, type FirstRunOnboardingDeps } from "../src/onboarding/firstRunOnboardingInteractions.js";

type State = FirstRunOnboardingDeps["state"];
function harness(t: TestContext, initial: Partial<State> = {}) {
  const controls = new Map<string, { onclick: (() => void | Promise<void>) | null; onchange: (() => void) | null; value: string; checked: boolean }>();
  for (const selector of [".first-run-next", ".first-run-back", ".first-run-skip", ".first-run-skip-step", ".first-run-select-custom-model", ".first-run-open-model-browser", ".first-run-download-model", "#firstRunTermsCheckbox", 'input[name="firstRunModel"]']) {
    controls.set(selector, { onclick: null, onchange: null, value: "preset", checked: false });
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    querySelector: (selector: string) => controls.get(selector) ?? null,
    querySelectorAll: (selector: string) => controls.has(selector) ? [controls.get(selector)] : []
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as { document?: unknown }).document;
  });

  const state: State = {
    firstRunOnboardingOpen: true, firstRunOnboardingStep: "model", firstRunSelectedModelId: "custom-gguf",
    firstRunTermsAccepted: true, firstRunCustomModelPath: "", firstRunBusy: false,
    firstRunMessage: null, llamaRuntimeModelPath: "/models/previous.gguf", ...initial
  };
  const paths: string[] = [];
  const calls = { starts: 0, dismissed: 0, renders: 0, browses: 0, catalogs: 0 };
  const deps: FirstRunOnboardingDeps = {
    state,
    modelOptions: [
      { id: "preset", name: "Starter", size: "1GB", description: "Starter", repoId: "example/model", fileName: "starter.gguf" },
      { id: "custom-gguf", name: "Custom", size: "Local", description: "Custom", custom: true }
    ],
    getClient: () => null, nextCorrelationId: () => "onboarding-test",
    browseModelPath: async () => { calls.browses++; return null; },
    openModelCatalog: async () => { calls.catalogs++; },
    persistLlamaModelPath: (path) => { paths.push(path); },
    refreshModelManagerInstalled: async () => {},
    persistFirstRunOnboardingDismissed: () => { calls.dismissed++; },
    autoStartLlamaRuntimeIfConfigured: async () => { calls.starts++; },
    render: () => { calls.renders++; }
  };
  const click = (selector: string) => controls.get(selector)!.onclick!();
  return { state, paths, calls, deps, controls, click, bind: () => bindFirstRunOnboardingInteractions(deps) };
}

test("Finish handler rejects invalid custom paths and busy state, not just disabled markup", (t) => {
  const h = harness(t);
  h.bind();
  for (const path of ["", "/model.bin"]) {
    h.state.firstRunCustomModelPath = path;
    h.click(".first-run-next");
    assert.equal(h.state.firstRunOnboardingOpen, true);
  }
  h.state.firstRunCustomModelPath = "/model.gguf";
  h.state.firstRunBusy = true;
  h.click(".first-run-next");
  h.click(".first-run-skip");
  h.click(".first-run-skip-step");
  h.click(".first-run-back");
  assert.equal(h.state.firstRunOnboardingOpen, true);
  assert.equal(h.state.firstRunOnboardingStep, "model");
  assert.equal(h.calls.starts, 0);
  assert.equal(h.calls.dismissed, 0);
});

test("Next handler enforces terms acceptance", (t) => {
  const h = harness(t, { firstRunOnboardingStep: "welcome", firstRunTermsAccepted: false });
  h.bind();
  h.click(".first-run-next");
  assert.equal(h.state.firstRunOnboardingStep, "welcome");
  h.state.firstRunTermsAccepted = true;
  h.click(".first-run-next");
  assert.equal(h.state.firstRunOnboardingStep, "model");
});

test("Finish starts the selected custom model once, even after a preset replaced runtime path", (t) => {
  const h = harness(t, { firstRunCustomModelPath: " /models/custom.GGUF " });
  h.bind();
  h.click(".first-run-next");
  h.click(".first-run-next");
  assert.equal(h.state.llamaRuntimeModelPath, "/models/custom.GGUF");
  assert.deepEqual(h.paths, ["/models/custom.GGUF"]);
  assert.equal(h.calls.starts, 1);
  assert.equal(h.calls.dismissed, 1);
});

test("Browse cancellation preserves selection and model paths", async (t) => {
  const h = harness(t, { firstRunSelectedModelId: "preset", firstRunCustomModelPath: "/old.gguf" });
  h.bind();
  await h.click(".first-run-select-custom-model");
  assert.equal(h.state.firstRunSelectedModelId, "preset");
  assert.equal(h.state.firstRunCustomModelPath, "/old.gguf");
  assert.equal(h.state.llamaRuntimeModelPath, "/models/previous.gguf");
  assert.equal(h.state.firstRunBusy, false);
  assert.equal(h.state.firstRunMessage, null);
  assert.deepEqual(h.paths, []);
});

test("Browse rejects non-GGUF selections without persisting them", async (t) => {
  const h = harness(t);
  h.deps.browseModelPath = async () => "/models/model.bin";
  h.bind();
  await h.click(".first-run-select-custom-model");
  assert.match(h.state.firstRunMessage!, /valid .gguf/);
  assert.equal(h.state.firstRunCustomModelPath, "");
  assert.equal(h.state.llamaRuntimeModelPath, "/models/previous.gguf");
  assert.equal(h.state.firstRunBusy, false);
  assert.deepEqual(h.paths, []);
});

test("Browse reports rejection and restores controls", async (t) => {
  const h = harness(t);
  h.deps.browseModelPath = async () => { throw new Error("picker failed"); };
  h.bind();
  await h.click(".first-run-select-custom-model");
  assert.match(h.state.firstRunMessage!, /Model selection failed:.*picker failed/);
  assert.equal(h.state.firstRunBusy, false);
  assert.deepEqual(h.paths, []);
});

test("Browse blocks duplicate selection and Finish until the picker settles", async (t) => {
  const h = harness(t, { firstRunCustomModelPath: "/old.gguf" });
  let finish!: (path: string) => void;
  h.deps.browseModelPath = () => { h.calls.browses++; return new Promise((resolve) => { finish = resolve; }); };
  h.bind();
  const picking = h.click(".first-run-select-custom-model");
  await h.click(".first-run-select-custom-model");
  h.click(".first-run-next");
  assert.equal(h.calls.browses, 1);
  assert.equal(h.calls.starts, 0);
  assert.equal(h.state.firstRunBusy, true);
  finish(" C:\\models\\new.GGUF ");
  await picking;
  assert.equal(h.state.firstRunBusy, false);
  assert.equal(h.state.firstRunSelectedModelId, "custom-gguf");
  assert.equal(h.state.firstRunCustomModelPath, "C:\\models\\new.GGUF");
  assert.equal(h.state.llamaRuntimeModelPath, "C:\\models\\new.GGUF");
  assert.deepEqual(h.paths, ["C:\\models\\new.GGUF"]);
});

test("catalog errors are visible and don't mutate the local model", async (t) => {
  const h = harness(t);
  h.deps.openModelCatalog = async () => { throw new Error("opener denied"); };
  h.bind();
  await h.click(".first-run-open-model-browser");
  assert.match(h.state.firstRunMessage!, /Could not open the model catalog:.*opener denied/);
  assert.equal(h.state.firstRunBusy, false);
  assert.equal(h.state.llamaRuntimeModelPath, "/models/previous.gguf");
  assert.deepEqual(h.paths, []);
});

test("catalog opening explains the external-download/Browse flow", async (t) => {
  const h = harness(t);
  h.bind();
  await h.click(".first-run-open-model-browser");
  assert.equal(h.calls.catalogs, 1);
  assert.match(h.state.firstRunMessage!, /then use Browse/);
  assert.equal(h.state.firstRunBusy, false);
});
