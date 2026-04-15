import type { TerminalManager } from "../terminal/index";
import type { ChatIpcClient } from "../../ipcClient";
import type { OpenCodeAgent, OpenCodeToolState } from "./state";

const INSTALL_COMMAND = "curl -fsSL https://opencode.ai/install | bash";

export interface OpenCodeActionsDeps {
  terminalManager: TerminalManager;
  client: ChatIpcClient;
  nextCorrelationId: () => string;
  renderAndBind: () => void;
  defaultCwd?: string;
}

export async function checkOpenCodeInstalled(
  state: OpenCodeToolState,
  deps: OpenCodeActionsDeps
): Promise<boolean> {
  state.installChecking = true;
  state.installed = null;
  deps.renderAndBind();

  try {
    const correlationId = deps.nextCorrelationId();
    const probe = await deps.terminalManager.createSession({ shell: "/bin/sh" });
    const probeId = probe.sessionId;

    let outputBuffer = "";

    const cleanup = deps.client.onEvent((event) => {
      if (event.action === "terminal.output") {
        const payload = event.payload as Record<string, unknown>;
        if (payload?.sessionId === probeId && typeof payload?.data === "string") {
          outputBuffer += payload.data;
        }
      }
    });

    await deps.client.sendTerminalInput({
      sessionId: probeId,
      input: "which opencode\n",
      correlationId
    });

    await sleep(2000);
    cleanup();

    const found =
      outputBuffer.includes("/") &&
      !outputBuffer.includes("not found") &&
      !outputBuffer.includes("which: no");

    await deps.terminalManager.closeSession(probeId);

    state.installed = found;
    if (!found) {
      state.installModalOpen = true;
    }
    return found;
  } catch {
    state.installed = false;
    state.installModalOpen = true;
    return false;
  } finally {
    state.installChecking = false;
    deps.renderAndBind();
  }
}

export async function spawnAgent(
  state: OpenCodeToolState,
  deps: OpenCodeActionsDeps,
  opts: { label: string; cwd?: string; prompt?: string }
): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  deps.renderAndBind();

  const agentIndex = state.nextAgentIndex;
  const agentId = `opencode-agent-${Date.now()}-${agentIndex}`;
  const label = opts.label.trim() || `Agent ${agentIndex}`;
  const cwd = opts.cwd?.trim() || deps.defaultCwd || undefined;

  try {
    const createOpts: { cwd?: string } = {};
    if (cwd) createOpts.cwd = cwd;

    const session = await deps.terminalManager.createSession(createOpts);
    const agent: OpenCodeAgent = {
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
      input: "opencode\n",
      correlationId: deps.nextCorrelationId()
    });

    agent.status = "running";
  } catch {
    state.agents = state.agents.filter((a) => a.id !== agentId);
  } finally {
    state.busy = false;
    deps.renderAndBind();
  }
}

export function switchAgent(
  state: OpenCodeToolState,
  agentId: string
): void {
  if (state.activeAgentId === agentId) return;
  state.activeAgentId = agentId;
}

export async function closeAgent(
  state: OpenCodeToolState,
  deps: OpenCodeActionsDeps,
  agentId: string
): Promise<void> {
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return;

  await deps.terminalManager.closeSession(agent.sessionId);
  state.agents = state.agents.filter((a) => a.id !== agentId);

  if (state.activeAgentId === agentId) {
    const next = state.agents[state.agents.length - 1];
    state.activeAgentId = next?.id ?? null;
  }
}

export function openSpawnModal(state: OpenCodeToolState): void {
  const nextIndex = state.nextAgentIndex;
  state.spawnLabelDraft = `Agent ${nextIndex}`;
  state.spawnCwdDraft = "";
  state.spawnPromptDraft = "";
  state.spawnModalOpen = true;
}

export function closeSpawnModal(state: OpenCodeToolState): void {
  state.spawnModalOpen = false;
}

export async function recheckAfterInstall(
  state: OpenCodeToolState,
  deps: OpenCodeActionsDeps
): Promise<void> {
  const installed = await checkOpenCodeInstalled(state, deps);
  if (installed) {
    state.installModalOpen = false;
    await spawnAgent(state, deps, { label: "Agent 1" });
  }
}

export function getInstallCommand(): string {
  return INSTALL_COMMAND;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
