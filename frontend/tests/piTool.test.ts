import test from "node:test";
import assert from "node:assert/strict";

import { checkPiInstalled, getInstallCommand, shouldAutoInstallPi, type PiActionsDeps } from "../src/tools/pi/actions.js";
import { getInitialPiState } from "../src/tools/pi/state.js";

test("Pi tool starts without sessions or stale setup state", () => {
  const state = getInitialPiState();

  assert.deepEqual(state.agents, []);
  assert.equal(state.activeAgentId, null);
  assert.equal(state.installed, null);
  assert.equal(state.version, null);
  assert.equal(state.executablePath, null);
  assert.equal(state.runtimeStatus, null);
  assert.equal(state.error, null);
  assert.equal(state.nextAgentIndex, 1);
});

test("Pi installation is app-local, cross-platform, and skips package lifecycle scripts", () => {
  assert.equal(
    getInstallCommand(false),
    'npm install --prefix "$HOME/.arxell/pi-runtime" --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent'
  );
  assert.equal(
    getInstallCommand(true),
    'npm install --prefix "%USERPROFILE%\\.arxell\\pi-runtime" --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent'
  );
});

test("Pi probe accepts an installed runtime even when a legacy compatibility flag is false", async () => {
  const state = getInitialPiState();
  const deps = {
    client: {
      toolInvoke: async () => ({
        ok: true,
        data: {
          installed: true,
          compatible: false,
          status: "ready",
          version: "0.84.2",
          executablePath: "/usr/local/bin/pi",
          bashPath: "/bin/bash",
          nodeAvailable: true,
          npmAvailable: true
        }
      })
    },
    terminalManager: {},
    nextCorrelationId: () => "probe-id",
    renderAndBind: () => {}
  } as unknown as PiActionsDeps;

  assert.equal(await checkPiInstalled(state, deps), true);
  assert.equal(state.version, "0.84.2");
  assert.equal(state.installModalOpen, false);
});

test("Pi auto-install is limited to genuine misses with working prerequisites", () => {
  const missing = {
    installed: false,
    runtimeStatus: "not_found",
    nodeAvailable: true,
    npmAvailable: true,
    bashPath: "/usr/bin/bash",
    executablePathDraft: ""
  } as const;

  assert.equal(shouldAutoInstallPi(missing, false), true);
  assert.equal(shouldAutoInstallPi(missing, true), true);
  assert.equal(shouldAutoInstallPi({ ...missing, bashPath: null }, true), false);
  assert.equal(shouldAutoInstallPi({ ...missing, nodeAvailable: false }, false), false);
  assert.equal(shouldAutoInstallPi({ ...missing, npmAvailable: false }, false), false);
  assert.equal(shouldAutoInstallPi({ ...missing, executablePathDraft: "/custom/pi" }, false), false);
  assert.equal(shouldAutoInstallPi({ ...missing, runtimeStatus: "launch_failed" }, false), false);
});
