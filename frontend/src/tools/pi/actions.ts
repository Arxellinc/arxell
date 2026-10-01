import type { TerminalManager } from "../terminal/index";
import type { ChatIpcClient } from "../../ipcClient";
import type { PiAgent, PiToolState } from "./state";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

function isWindows(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

function quoteExecutable(path: string): string {
  if (isWindows()) {
    return `"${path.replaceAll('"', '""')}"`;
  }
  return `'${path.replaceAll("'", `'"'"'`)}'`;
}

function getLaunchCommand(executablePath: string | null): string {
  const executable = executablePath ? quoteExecutable(executablePath) : "pi";
  return isWindows()
    ? `set PI_TELEMETRY=0&& set PI_SKIP_VERSION_CHECK=1&& ${executable}`
    : `PI_TELEMETRY=0 PI_SKIP_VERSION_CHECK=1 ${executable}`;
}

export function getInstallCommand(windows = isWindows()): string {
  const prefix = windows ? '"%USERPROFILE%\\.arxell\\pi-runtime"' : '"$HOME/.arxell/pi-runtime"';
  return `npm install --prefix ${prefix} --ignore-scripts --no-audit --no-fund ${PI_PACKAGE}`;
}

export function shouldAutoInstallPi(
  state: Pick<PiToolState, "installed" | "runtimeStatus" | "nodeAvailable" | "npmAvailable" | "bashPath" | "executablePathDraft">,
  isWindows: boolean
): boolean {
  return state.installed === false &&
    state.runtimeStatus === "not_found" &&
    state.nodeAvailable === true &&
    state.npmAvailable === true &&
    !state.executablePathDraft.trim() &&
    (!isWindows || Boolean(state.bashPath));
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
  deps: PiActionsDeps,
  deferSetupModalForAutoInstall = false
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
      payload: {
        correlationId,
        executablePath: state.executablePathDraft.trim() || undefined
      }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Pi runtime probe failed.");
    }
    const response = invokeResponse.data as {
      installed?: boolean;
      compatible?: boolean;
      version?: string | null;
      executablePath?: string | null;
      bashPath?: string | null;
      nodeAvailable?: boolean;
      npmAvailable?: boolean;
      status?: string;
      errorMessage?: string | null;
    };
    const ready = response.installed === true && response.status === "ready";
    state.installed = response.installed === true;
    state.version = typeof response.version === "string" ? response.version : null;
    state.executablePath = typeof response.executablePath === "string" ? response.executablePath : null;
    if (state.executablePath) state.executablePathDraft = state.executablePath;
    state.bashPath = typeof response.bashPath === "string" ? response.bashPath : null;
    state.nodeAvailable = typeof response.nodeAvailable === "boolean" ? response.nodeAvailable : null;
    state.npmAvailable = typeof response.npmAvailable === "boolean" ? response.npmAvailable : null;
    state.runtimeStatus = typeof response.status === "string" ? response.status : null;
    state.error = ready ? null : response.errorMessage || "Pi runtime is not ready.";
    const autoInstallWillRun = deferSetupModalForAutoInstall && shouldAutoInstallPi(state, isWindows());
    state.installModalOpen = !ready && !state.busy && !autoInstallWillRun;
    return ready;
  } catch (error) {
    state.installed = false;
    state.version = null;
    state.runtimeStatus = "launch_failed";
    state.error = error instanceof Error ? error.message : "Pi runtime probe failed.";
    state.installModalOpen = !state.busy;
    return false;
  } finally {
    state.installChecking = false;
    deps.renderAndBind();
  }
}

export async function ensurePiSession(
  state: PiToolState,
  deps: PiActionsDeps
): Promise<void> {
  if (state.busy || state.installChecking || state.agents.length) return;
  if (await checkPiInstalled(state, deps, true)) {
    await spawnAgent(state, deps, { label: `Agent ${state.nextAgentIndex}` });
  } else if (shouldAutoInstallPi(state, isWindows())) {
    await installNow(state, deps);
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
      input: `${getLaunchCommand(state.executablePath)}\n`,
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
  // Never replace/reinstall a detected runtime or bypass missing prerequisites.
  if (state.busy || !shouldAutoInstallPi(state, isWindows())) return;
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

    const installDeadline = Date.now() + 120_000;
    let installed = false;
    while (Date.now() < installDeadline) {
      await sleep(2500);
      installed = await checkPiInstalled(state, deps);
      if (installed) break;
    }

    if (installed) {
      await sleep(1000);
      const installAgent = state.agents.find((agent) => agent.id === agentId);
      if (installAgent) {
        installAgent.label = "Agent 1";
        installAgent.cwd = deps.defaultCwd || ".";
        installAgent.status = "starting";
        await deps.client.sendTerminalInput({
          sessionId: installAgent.sessionId,
          input: `${getLaunchCommand(state.executablePath)}\n`,
          correlationId: deps.nextCorrelationId()
        });
        installAgent.status = "running";
      }
      state.installModalOpen = false;
    } else {
      state.installModalOpen = true;
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
