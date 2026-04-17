import test from "node:test";
import assert from "node:assert/strict";

import type { AppEvent } from "../src/contracts.js";
import { applyLooperEvent } from "../src/tools/looper/runtime.js";
import { createLoopRun, getInitialLooperState } from "../src/tools/looper/state.js";

function makeEvent(action: string, payload: Record<string, unknown>, timestampMs = 1000): AppEvent {
  return {
    timestampMs,
    correlationId: "corr-1",
    subsystem: "tool",
    action,
    stage: "complete",
    severity: "info",
    payload
  };
}

test("createLoopRun includes project context only in the planner prompt", () => {
  const loop = createLoopRun(1, "/tmp", {
    projectName: "Sample Tool",
    projectType: "app-tool",
    projectIcon: "wrench",
    projectDescription: "Build a focused workspace tool"
  });

  assert.match(loop.phases.planner.prompt, /Project: Sample Tool/);
  assert.match(loop.phases.planner.prompt, /Icon: wrench/);
  assert.doesNotMatch(loop.phases.executor.prompt, /Project: Sample Tool/);
});

test("getInitialLooperState starts with empty loop state", () => {
  const state = getInitialLooperState();

  assert.equal(state.loops.length, 0);
  assert.equal(state.activeLoopId, null);
  assert.equal(state.maxIterations, 10);
  assert.equal(state.taskPath, "task.md");
  assert.equal(state.specsGlob, "specs/*.md");
});

test("applyLooperEvent starts loops and phases from supported looper events", () => {
  const state = getInitialLooperState();
  const loop = createLoopRun(1, "/tmp");
  state.loops.push(loop);

  applyLooperEvent(
    state,
    makeEvent("looper.loop.start", {
      loopId: loop.id,
      iteration: loop.iteration,
      activePhase: "planner",
      status: "running"
    })
  );

  applyLooperEvent(
    state,
    makeEvent("looper.phase.start", {
      loopId: loop.id,
      iteration: loop.iteration,
      phase: "planner",
      sessionId: "planner-session",
      status: "running"
    })
  );

  assert.equal(loop.status, "running");
  assert.equal(loop.activePhase, "planner");
  assert.equal(loop.phases.planner.status, "running");
  assert.equal(loop.phases.planner.sessionId, "planner-session");
  assert.equal(loop.phases.planner.substeps[0]?.status, "running");
});

test("applyLooperEvent accepts backend transition payloads that send toPhase", () => {
  const state = getInitialLooperState();
  const loop = createLoopRun(1, "/tmp");
  loop.status = "running";
  loop.activePhase = "planner";
  loop.phases.planner.status = "running";
  loop.phases.planner.substeps[0]!.status = "running";
  state.loops.push(loop);

  applyLooperEvent(
    state,
    makeEvent("looper.phase.transition", {
      loopId: loop.id,
      fromPhase: "planner",
      toPhase: "executor",
      sessionId: "executor-session"
    })
  );

  assert.equal(loop.activePhase, "executor");
  assert.equal(loop.phases.planner.status, "complete");
  assert.equal(loop.phases.executor.status, "running");
  assert.equal(loop.phases.executor.sessionId, "executor-session");
});
