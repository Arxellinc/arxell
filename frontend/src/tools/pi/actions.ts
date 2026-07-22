import type { TerminalManager } from "../terminal/index";
import type { ChatIpcClient } from "../../ipcClient";
import type { PiAgent, PiToolState } from "./state";

const INSTALL_COMMAND = "npm install -g --ignore-scripts @earendil-works/pi-coding-agent";

function isWindows(): boolean {
  return /Windows/i.test(navigator.userAgent);
}

function getLaunchCommand(): string {
  return isWindows()
    ? "set PI_TELEMETRY=0&& set PI_SKIP_VERSION_CHECK=1&& pi"
    : "PI_TELEMETRY=0 PI_SKIP_VERSION_CHECK=1 pi";
}

export function getInstallCommand(): string {
  return INSTALL_COMMAND;
}

export interface PiActionsDeps {
  terminalManager: TerminalManager;
  client: ChatIpcClient;
  nextCorrelationId: () => string;
  renderAndBind: () => void;
  defaultCwd?: string | undefined;
}

export async function checkPiInstalled(
  state: PiToolState,
  deps: PiActionsDeps
): Promise<boolean> {
  state.installChecking = true;
  state.installed = null;
  state.error = null;
  deps.renderAndBind();

  try {
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "looper",
      action: "check-pi",
      mode: "sandbox",
      payload: { correlationId }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Pi runtime probe failed.");
    }
    const response = invokeResponse.data as {
      installed?: boolean;
      version?: string | null;
    };
    const found = response.installed === true;
    state.installed = found;
    state.version = typeof response.version === "string" ? response.version : null;
    state.installModalOpen = !found;
    return found;
  } catch (error) {
    state.installed = false;
    state.version = null;
    state.error = error instanceof Error ? error.message : "Pi runtime probe failed.";
    state.installModalOpen = true;
    return false;
  } finally {
    state.installChecking = false;
    deps.renderAndBind();
  }
}

export async function spawnAgent(
  state: PiToolState,
  deps: PiActionsDeps,
  opts: { label: string; cwd?: string; prompt?: string }
): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  deps.renderAndBind();

  const agentIndex = state.nextAgentIndex;
  const agentId = `pi-agent-${Date.now()}-${agentIndex}`;
  const label = opts.label.trim() || `Agent ${agentIndex}`;
  const cwd = opts.cwd?.trim() || deps.defaultCwd || undefined;

  try {
    const createOpts: { cwd?: string } = {};
    if (cwd) createOpts.cwd = cwd;

    const session = await deps.terminalManager.createSession({
      ...createOpts,
      owner: "pi",
      title: label
    });
    const agent: PiAgent = {
      id: agentId,
      label,
      sessionId: session.sessionId,
      status: "starting",
      cwd: cwd || ".",
      startedAtMs: Date.now()
    };

    state.agents.push(agent);
    state.activeAgentId = agentId;
    state.nextAgentIndex = agentIndex + 1;
    state.spawnModalOpen = false;

    deps.renderAndBind();

    await sleep(500);

    await deps.client.sendTerminalInput({
      sessionId: session.sessionId,
      input: `${getLaunchCommand()}\n`,
      correlationId: deps.nextCorrelationId()
    });

    if (opts.prompt?.trim()) {
      await sleep(1000);
      await deps.client.sendTerminalInput({
        sessionId: session.sessionId,
        input: `${opts.prompt.trim()}\n`,
        correlationId: deps.nextCorrelationId()
      });
    }

    agent.status = "running";
  } catch (error) {
    state.agents = state.agents.filter((a) => a.id !== agentId);
    state.error = error instanceof Error ? error.message : "Failed to launch Pi.";
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export function switchAgent(
  state: PiToolState,
  agentId: string
): void {
  if (state.activeAgentId === agentId) return;
  state.activeAgentId = agentId;
}

export async function closeAgent(
  state: PiToolState,
  deps: PiActionsDeps,
  agentId: string
): Promise<void> {
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return;

  try {
    await deps.terminalManager.closeSession(agent.sessionId);
    state.agents = state.agents.filter((a) => a.id !== agentId);

    if (state.activeAgentId === agentId) {
      const next = state.agents[state.agents.length - 1];
      state.activeAgentId = next?.id ?? null;
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Failed to close Pi session.";
  } finally {
    deps.renderAndBind();
  }
}

export function openSpawnModal(state: PiToolState): void {
  const nextIndex = state.nextAgentIndex;
  state.spawnLabelDraft = `Agent ${nextIndex}`;
  state.spawnCwdDraft = "";
  state.spawnPromptDraft = "";
  state.spawnModalOpen = true;
}

export function closeSpawnModal(state: PiToolState): void {
  state.spawnModalOpen = false;
}

export async function installNow(
  state: PiToolState,
  deps: PiActionsDeps
): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.installModalOpen = false;
  deps.renderAndBind();

  try {
    const session = await deps.terminalManager.createSession({
      owner: "pi",
      title: "Pi Install"
    });
    const agentId = `pi-agent-${Date.now()}-${state.nextAgentIndex}`;
    const agent: PiAgent = {
      id: agentId,
      label: "Install",
      sessionId: session.sessionId,
      status: "starting",
      cwd: ".",
      startedAtMs: Date.now()
    };
    state.agents.push(agent);
    state.activeAgentId = agentId;
    state.nextAgentIndex++;
    deps.renderAndBind();

    await sleep(500);
    await deps.client.sendTerminalInput({
      sessionId: session.sessionId,
      input: getInstallCommand() + "\n",
      correlationId: deps.nextCorrelationId()
    });
    agent.status = "running";

    await sleep(10000);
    const installed = await checkPiInstalled(state, deps);
    if (installed) {
      state.installModalOpen = false;
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Failed to install Pi.";
    state.installModalOpen = true;
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export async function recheckAfterInstall(
  state: PiToolState,
  deps: PiActionsDeps
): Promise<void> {
  const installed = await checkPiInstalled(state, deps);
  if (installed) {
    state.installModalOpen = false;
    await spawnAgent(state, deps, { label: "Agent 1" });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
