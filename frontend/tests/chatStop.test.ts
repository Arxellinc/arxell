import assert from "node:assert/strict";
import test from "node:test";
import { requestChatStop } from "../src/app/chatStop.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a hanging speech stop cannot delay model cancellation or Stop completion", async () => {
  let releaseSpeech!: () => void;
  const speech = new Promise<void>((resolve) => { releaseSpeech = resolve; });
  let modelCancelled = false;
  await requestChatStop(
    async () => { modelCancelled = true; },
    () => speech,
    () => assert.fail("no failure expected")
  );
  assert.equal(modelCancelled, true);
  releaseSpeech();
});

test("speech rejection and synchronous model-cancel failure are observed independently", async () => {
  let speechCalled = false;
  const failures: string[] = [];
  await requestChatStop(
    () => { throw new Error("cancel unavailable"); },
    async () => { speechCalled = true; throw new Error("speech unavailable"); },
    (target) => { failures.push(target); }
  );
  await flush();
  assert.equal(speechCalled, true);
  assert.deepEqual(failures.sort(), ["model", "speech"]);
});

test("speech failures are reported even while model cancellation is pending", async () => {
  let releaseModel!: () => void;
  const model = new Promise<void>((resolve) => { releaseModel = resolve; });
  const failures: string[] = [];
  const stopping = requestChatStop(
    () => model,
    async () => { throw new Error("speech unavailable"); },
    (target) => { failures.push(target); }
  );
  await flush();
  assert.deepEqual(failures, ["speech"]);
  releaseModel();
  await stopping;
});
