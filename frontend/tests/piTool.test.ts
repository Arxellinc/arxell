import test from "node:test";
import assert from "node:assert/strict";

import { checkPiInstalled, ensurePiSession, getInstallCommand, installNow, shouldAutoInstallPi, type PiActionsDeps } from "../src/tools/pi/actions.js";
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

test("opening Pi launches a detected 0.84.2 directly without installation or confirmation", async () => {
  const state = getInitialPiState();
  state.installModalOpen = true;
  const inputs: string[] = [];
  let probes = 0;
  let sessions = 0;
  const deps = {
    client: {
      toolInvoke: async () => {
        probes++;
        return { ok: true, data: {
          installed: true, compatible: false, status: "ready", version: "0.84.2",
          executablePath: "/home/user/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
          nodeAvailable: true, npmAvailable: true, bashPath: "/bin/bash"
        } };
      },
      sendTerminalInput: async (request: { input: string }) => { inputs.push(request.input); }
    },
    terminalManager: {
      createSession: async () => { sessions++; return { sessionId: "pi-session" }; }
    },
    nextCorrelationId: () => "launch-test",
    renderAndBind: () => {},
    defaultCwd: "/project"
  } as unknown as PiActionsDeps;

  await ensurePiSession(state, deps);
  await ensurePiSession(state, deps);
  assert.equal(probes, 1);
  assert.equal(sessions, 1);
  assert.equal(state.installModalOpen, false);
  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0]?.status, "running");
  assert.equal(state.agents[0]?.cwd, "/project");
  assert.equal(inputs.length, 1);
  assert.match(inputs[0]!, /dist\/cli\.js/);
  assert.doesNotMatch(inputs[0]!, /npm install/);
});

test("missing Pi with missing prerequisites shows setup without running an installer", async () => {
  const state = getInitialPiState();
  let sessions = 0;
  const deps = {
    client: { toolInvoke: async () => ({ ok: true, data: {
      installed: false, status: "not_found", nodeAvailable: false, npmAvailable: true,
      errorMessage: "Install Node.js 22.19 or newer."
    } }) },
    terminalManager: { createSession: async () => { sessions++; } },
    nextCorrelationId: () => "missing-test",
    renderAndBind: () => {}
  } as unknown as PiActionsDeps;
  await ensurePiSession(state, deps);
  await installNow(state, deps);
  assert.equal(sessions, 0);
  assert.equal(state.installModalOpen, true);
  assert.match(state.error!, /Node.js/);
});

test("a detected runtime with a launch failure is not replaced by the installer", async () => {
  const state = getInitialPiState();
  let sessions = 0;
  const deps = {
    client: { toolInvoke: async () => ({ ok: true, data: {
      installed: true, status: "launch_failed", version: "0.84.2",
      nodeAvailable: true, npmAvailable: true, errorMessage: "Pi could not be launched."
    } }) },
    terminalManager: { createSession: async () => { sessions++; } },
    nextCorrelationId: () => "failure-test",
    renderAndBind: () => {}
  } as unknown as PiActionsDeps;
  await ensurePiSession(state, deps);
  await installNow(state, deps);
  assert.equal(sessions, 0);
  assert.equal(state.installModalOpen, true);
  assert.match(state.error!, /could not be launched/);
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
