import test from "node:test";
import assert from "node:assert/strict";

import { getInstallCommand } from "../src/tools/pi/actions.js";
import { getInitialPiState } from "../src/tools/pi/state.js";

test("Pi tool starts without sessions or stale setup state", () => {
  const state = getInitialPiState();

  assert.deepEqual(state.agents, []);
  assert.equal(state.activeAgentId, null);
  assert.equal(state.installed, null);
  assert.equal(state.version, null);
  assert.equal(state.error, null);
  assert.equal(state.nextAgentIndex, 1);
});

test("Pi installation uses the official npm package without lifecycle scripts", () => {
  assert.equal(
    getInstallCommand(),
    "npm install -g --ignore-scripts @earendil-works/pi-coding-agent"
  );
});
