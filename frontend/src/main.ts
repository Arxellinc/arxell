import "./styles.css";
import "xterm/css/xterm.css";
import type {
  AppEvent,
  ChatStreamChunkPayload,
  ConversationSummaryRecord,
  LlamaRuntimeStatusResponse,
  WorkspaceToolRecord
} from "./contracts";
import { iconHtml } from "./icons";
import type { IconName } from "./icons";
import type { ChatIpcClient } from "./ipcClient";
import { createChatIpcClient } from "./ipcClient";
import {
  attachWorkspacePaneInteractions,
  renderGlobalBottombar,
  renderGlobalTopbar,
  renderSidebarRail,
  renderWorkspacePane
} from "./layout";
import { attachPrimaryPanelInteractions, getPanelDefinition } from "./panels";
import type { SidebarTab, UiMessage } from "./panels/types";
import type { DisplayMode, WorkspaceTab } from "./layout";
import { escapeHtml } from "./panels/utils";
import { TerminalManager } from "./terminal/manager";
import { renderTerminalWorkspace } from "./terminal/view";
import {
  bindWorkspaceToolsPanel,
  renderWorkspaceToolsActions,
  renderWorkspaceToolsBody
} from "./workspace-tools/panel";

const terminalManager = new TerminalManager();
const MAX_CONSOLE_ENTRIES = 600;

const state: {
  conversationId: string;
  messages: UiMessage[];
  events: AppEvent[];
  consoleEntries: Array<{
    timestampMs: number;
    level: "log" | "info" | "warn" | "error" | "debug";
    source: "browser" | "app";
    message: string;
  }>;
  runtimeMode: "tauri" | "mock" | "unknown";
  chatPanePercent: number;
  sidebarTab: SidebarTab;
  workspaceTab: WorkspaceTab;
  activeTerminalSessionId: string | null;
  conversations: ConversationSummaryRecord[];
  workspaceTools: WorkspaceToolRecord[];
  displayMode: DisplayMode;
  llamaRuntime: LlamaRuntimeStatusResponse | null;
  llamaRuntimeSelectedEngineId: string;
  llamaRuntimeModelPath: string;
  llamaRuntimePort: number;
  llamaRuntimeCtxSize: number;
  llamaRuntimeGpuLayers: number;
  llamaRuntimeBusy: boolean;
  llamaRuntimeLogs: string[];
} = {
  conversationId: "foundation-chat",
  messages: [],
  events: [],
  consoleEntries: [],
  runtimeMode: "unknown",
  chatPanePercent: 35,
  sidebarTab: "chat",
  workspaceTab: "events",
  activeTerminalSessionId: null,
  conversations: [],
  workspaceTools: [],
  displayMode: "dark",
  llamaRuntime: null,
  llamaRuntimeSelectedEngineId: "",
  llamaRuntimeModelPath: "",
  llamaRuntimePort: 8080,
  llamaRuntimeCtxSize: 8192,
  llamaRuntimeGpuLayers: 999,
  llamaRuntimeBusy: false,
  llamaRuntimeLogs: []
};

let clientRef: ChatIpcClient | null = null;
let consoleCaptureInstalled = false;

function nextCorrelationId(): string {
  return `corr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  document.documentElement.setAttribute("data-theme", state.displayMode);

  const consoleHtml = `
    <div class="console-panel">
      <div class="console-lines">
        ${
          state.consoleEntries.length
            ? state.consoleEntries
                .map((entry) => {
                  const time = new Date(entry.timestampMs).toLocaleTimeString();
                  return `<div class="console-line level-${entry.level}">
                    <span class="console-time">${escapeHtml(time)}</span>
                    <span class="console-source">[${escapeHtml(entry.source)}]</span>
                    <span class="console-level">${escapeHtml(entry.level)}</span>
                    <span class="console-message">${escapeHtml(entry.message)}</span>
                  </div>`;
                })
                .join("")
            : "<div class='console-empty'>No console output yet.</div>"
        }
      </div>
    </div>
  `;
  const consoleActionsHtml = `<button type="button" class="topbar-icon-btn" id="clearConsoleBtn" aria-label="Clear console">⌫</button>`;

  const terminalUiHtml = renderTerminalWorkspace(
    terminalManager.listSessions(),
    state.activeTerminalSessionId
  );
  const toolsUiHtml = renderWorkspaceToolsBody(state.workspaceTools);
  const toolsActionsHtml = renderWorkspaceToolsActions();

  const panel = getPanelDefinition(state.sidebarTab, {
    conversationId: state.conversationId,
    messages: state.messages,
    conversations: state.conversations,
    llamaRuntime: state.llamaRuntime,
    llamaRuntimeSelectedEngineId: state.llamaRuntimeSelectedEngineId,
    llamaRuntimeModelPath: state.llamaRuntimeModelPath,
    llamaRuntimePort: state.llamaRuntimePort,
    llamaRuntimeCtxSize: state.llamaRuntimeCtxSize,
    llamaRuntimeGpuLayers: state.llamaRuntimeGpuLayers,
    llamaRuntimeBusy: state.llamaRuntimeBusy,
    llamaRuntimeLogs: state.llamaRuntimeLogs
  });

  app.innerHTML = `
    <main class="app-frame" style="--chat-pane-percent: ${state.chatPanePercent};">
      ${renderGlobalTopbar(state.displayMode)}
      <section class="app-body">
        ${renderSidebarRail(state.sidebarTab)}
        <section class="main-column">
        <div class="split-layout" id="splitLayout">
          <section class="pane primary-pane ${state.sidebarTab === "chat" ? "chat-pane" : ""}">
            <header class="pane-topbar">
              <span class="pane-title">${renderPanelTitleIcon(panel.icon, panel.title)}</span>
              ${panel.renderActions()}
            </header>
            ${panel.renderBody()}
          </section>

          <div class="pane-divider" id="paneDivider" aria-label="Resize panels" role="separator">
            <div class="pane-divider-line"></div>
          </div>

          ${renderWorkspacePane(consoleHtml, consoleActionsHtml, terminalUiHtml, toolsUiHtml, toolsActionsHtml, state.workspaceTab)}
        </div>
        </section>
      </section>
      ${renderGlobalBottombar(state.runtimeMode)}
    </main>
  `;
}

function renderPanelTitleIcon(icon: IconName, title: string): string {
  return `${iconHtml(icon, { size: 16, tone: "dark" })}<span>${title}</span>`;
}

function pushConsoleEntry(
  level: "log" | "info" | "warn" | "error" | "debug",
  source: "browser" | "app",
  message: string
): void {
  state.consoleEntries.push({
    timestampMs: Date.now(),
    level,
    source,
    message
  });
  if (state.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
    state.consoleEntries.splice(0, state.consoleEntries.length - MAX_CONSOLE_ENTRIES);
  }
}

function updateAssistantDraft(correlationId: string, delta: string): void {
  const existing = state.messages.find(
    (m) => m.role === "assistant" && m.correlationId === correlationId
  );

  if (existing) {
    existing.text += delta;
    return;
  }

  state.messages.push({ role: "assistant", text: delta, correlationId });
}

function parseStreamChunk(payload: AppEvent["payload"]): ChatStreamChunkPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.conversationId !== "string" ||
    typeof value.delta !== "string" ||
    typeof value.done !== "boolean"
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId,
    delta: value.delta,
    done: value.done
  };
}

function parseTerminalOutput(payload: AppEvent["payload"]): { sessionId: string; data: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.sessionId !== "string" || typeof value.data !== "string") return null;
  return { sessionId: value.sessionId, data: value.data };
}

function parseTerminalExit(payload: AppEvent["payload"]): { sessionId: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.sessionId !== "string") return null;
  return { sessionId: value.sessionId };
}

function isNoisyTerminalControlEvent(event: AppEvent): boolean {
  if (event.subsystem !== "ipc") return false;
  if (event.stage === "error") return false;
  return event.action === "cmd.terminal.resize" || event.action === "cmd.terminal.send_input";
}

function isNoisyRuntimeStatusEvent(event: AppEvent): boolean {
  return (
    event.subsystem === "runtime" &&
    event.action === "llama.runtime.status" &&
    event.stage === "complete"
  );
}

async function refreshConversations(): Promise<void> {
  if (!clientRef) return;
  const list = await clientRef.listConversations({ correlationId: nextCorrelationId() });
  state.conversations = list.conversations;
}

async function loadConversation(conversationId: string): Promise<void> {
  if (!clientRef) return;
  state.conversationId = conversationId;
  const history = await clientRef.getMessages({
    conversationId,
    correlationId: nextCorrelationId()
  });
  state.messages = history.messages.map((m) => ({
    role: m.role,
    text: m.content,
    correlationId: m.correlationId
  }));
}

async function refreshTools(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.listWorkspaceTools({ correlationId: nextCorrelationId() });
  state.workspaceTools = response.tools;
}

async function refreshLlamaRuntime(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.getLlamaRuntimeStatus({ correlationId: nextCorrelationId() });
  state.llamaRuntime = response;
  const hasSelected = response.engines.some(
    (engine) => engine.engineId === state.llamaRuntimeSelectedEngineId
  );
  if (hasSelected) return;

  const preferredLinuxVulkan = response.engines.find(
    (engine) => engine.backend === "vulkan" && engine.isReady
  );
  if (preferredLinuxVulkan) {
    state.llamaRuntimeSelectedEngineId = preferredLinuxVulkan.engineId;
    return;
  }

  const preferredAnyGpu = response.engines.find(
    (engine) => engine.backend !== "cpu" && engine.isReady
  );
  if (preferredAnyGpu) {
    state.llamaRuntimeSelectedEngineId = preferredAnyGpu.engineId;
    return;
  }

  const firstEngine = response.engines.at(0);
  if (firstEngine) {
    state.llamaRuntimeSelectedEngineId = firstEngine.engineId;
  }
}

function renderAndBind(sendMessage: (text: string) => Promise<void>): void {
  render();
  attachDividerResize();
  attachTopbarInteractions(sendMessage);
  attachSidebarInteractions(sendMessage);
  attachWorkspaceInteractions(sendMessage);
  attachPrimaryPanelInteractions(state.sidebarTab, {
    onSendMessage: sendMessage,
    onCreateConversation: async () => {
      const id = `conversation-${Date.now()}`;
      state.conversationId = id;
      state.messages = [];
      state.sidebarTab = "chat";
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onSelectConversation: async (conversationId: string) => {
      await loadConversation(conversationId);
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeRefresh: async () => {
      state.llamaRuntimeBusy = true;
      try {
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeInstall: async (engineId: string) => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      state.llamaRuntimeSelectedEngineId = engineId;
      try {
        await clientRef.installLlamaRuntimeEngine({
          correlationId: nextCorrelationId(),
          engineId
        });
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeStart: async ({ engineId, modelPath, port, ctxSize, nGpuLayers }) => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      state.llamaRuntimeSelectedEngineId = engineId;
      state.llamaRuntimeModelPath = modelPath;
      state.llamaRuntimePort = port;
      state.llamaRuntimeCtxSize = ctxSize;
      state.llamaRuntimeGpuLayers = nGpuLayers;
      try {
        await clientRef.startLlamaRuntime({
          correlationId: nextCorrelationId(),
          engineId,
          modelPath,
          port,
          ctxSize,
          nGpuLayers
        });
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeStop: async () => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      try {
        await clientRef.stopLlamaRuntime({ correlationId: nextCorrelationId() });
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    }
  });
}

function attachTopbarInteractions(sendMessage: (text: string) => Promise<void>): void {
  const toggle = document.querySelector<HTMLButtonElement>("#displayModeToggle");
  if (!toggle) return;
  toggle.onclick = () => {
    state.displayMode = state.displayMode === "dark" ? "light" : "dark";
    terminalManager.setDisplayMode(state.displayMode);
    renderAndBind(sendMessage);
  };
}

function attachSidebarInteractions(sendMessage: (text: string) => Promise<void>): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]");

  tabs.forEach((tab) => {
    tab.onclick = async () => {
      const nextTab = tab.dataset.sidebarTab as SidebarTab | undefined;
      if (!nextTab) return;
      state.sidebarTab = nextTab;
      if (nextTab === "llama_cpp") {
        await refreshLlamaRuntime();
      }
      renderAndBind(sendMessage);
    };
  });
}

function attachWorkspaceInteractions(sendMessage: (text: string) => Promise<void>): void {
  attachWorkspacePaneInteractions(async (tab) => {
    state.workspaceTab = tab;
    if (tab === "terminal") {
      await ensureTerminalSession();
    }
    if (tab === "tools") {
      await refreshTools();
    }
    renderAndBind(sendMessage);
  });

  const tabButtons = document.querySelectorAll<HTMLButtonElement>("[data-terminal-session-id]");
  tabButtons.forEach((button) => {
    button.onclick = () => {
      const sessionId = button.dataset.terminalSessionId;
      if (!sessionId) return;
      state.activeTerminalSessionId = sessionId;
      renderAndBind(sendMessage);
    };
  });

  const closeButtons = document.querySelectorAll<HTMLElement>("[data-terminal-close-session-id]");
  closeButtons.forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sessionId = button.dataset.terminalCloseSessionId;
      if (!sessionId) return;
      await terminalManager.closeSession(sessionId);
      const remaining = terminalManager.listSessions();
      state.activeTerminalSessionId = remaining[0]?.sessionId ?? null;
      renderAndBind(sendMessage);
    };
  });

  const actionButtons = document.querySelectorAll<HTMLButtonElement>("[data-terminal-action]");
  const shellSelect = document.querySelector<HTMLSelectElement>("#terminalShellSelect");
  actionButtons.forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.terminalAction;
      if (!action) return;
      if (action === "new") {
        const shellProfile = shellSelect?.value ?? "default";
        const shell = shellProfileToCommand(shellProfile);
        const session = await terminalManager.createSession(
          shell ? { shell } : undefined
        );
        state.activeTerminalSessionId = session.sessionId;
        renderAndBind(sendMessage);
        return;
      }
      if (!state.activeTerminalSessionId) return;
    };
  });

  if (state.workspaceTab === "terminal") {
    const host = document.querySelector<HTMLElement>("#terminalHost");
    if (host && state.activeTerminalSessionId) {
      terminalManager.mountSession(state.activeTerminalSessionId, host);
    }
  }

  const clearConsole = document.querySelector<HTMLButtonElement>("#clearConsoleBtn");
  if (clearConsole) {
    clearConsole.onclick = () => {
      state.consoleEntries = [];
      renderAndBind(sendMessage);
    };
  }

  if (state.workspaceTab === "tools") {
    bindWorkspaceToolsPanel(
      async () => {
        await refreshTools();
        renderAndBind(sendMessage);
      },
      async (toolId, enabled) => {
        if (!clientRef) return;
        await clientRef.setWorkspaceToolEnabled({
          toolId,
          enabled,
          correlationId: nextCorrelationId()
        });
        await refreshTools();
        renderAndBind(sendMessage);
      }
    );
  }
}

async function ensureTerminalSession(): Promise<void> {
  if (state.activeTerminalSessionId) return;
  const sessions = terminalManager.listSessions();
  const first = sessions.at(0);
  if (first) {
    state.activeTerminalSessionId = first.sessionId;
    return;
  }
  const shell = shellProfileToCommand("default");
  const session = await terminalManager.createSession(shell ? { shell } : undefined);
  state.activeTerminalSessionId = session.sessionId;
}

function shellProfileToCommand(profile: string): string | undefined {
  if (profile === "bash") return "bash";
  if (profile === "zsh") return "zsh";
  if (profile === "powershell") return "powershell.exe";
  return undefined;
}

async function bootstrap(): Promise<void> {
  installConsoleCapture();
  const { client, runtimeMode } = await createChatIpcClient();
  clientRef = client;
  state.runtimeMode = runtimeMode;
  terminalManager.setClient(client);
  terminalManager.setDisplayMode(state.displayMode);

  await refreshConversations();
  await refreshTools();
  await refreshLlamaRuntime();
  const firstConversation = state.conversations[0];
  if (firstConversation) {
    state.conversationId = firstConversation.conversationId;
  }
  await loadConversation(state.conversationId);

  window.addEventListener("beforeunload", () => {
    void terminalManager.closeAll();
  });

  client.onEvent((event) => {
    if (!isNoisyRuntimeStatusEvent(event)) {
      pushConsoleEntry(
        event.severity === "error" ? "error" : "info",
        "app",
        `[${event.subsystem}] ${event.action} ${event.stage} corr=${event.correlationId}`
      );
    }

    if (event.action === "terminal.output") {
      const output = parseTerminalOutput(event.payload);
      if (output) {
        terminalManager.writeOutput(output.sessionId, output.data);
      }
      return;
    }

    if (event.action === "terminal.exit") {
      const exiting = parseTerminalExit(event.payload);
      if (exiting) {
        terminalManager.markExited(exiting.sessionId);
        renderAndBind(sendMessage);
      }
      return;
    }

    if (isNoisyTerminalControlEvent(event)) {
      return;
    }

    if (event.action.startsWith("llama.runtime")) {
      if (!isNoisyRuntimeStatusEvent(event)) {
        const payloadText =
          event.payload && typeof event.payload === "object"
            ? JSON.stringify(event.payload)
            : String(event.payload);
        state.llamaRuntimeLogs.push(
          `${new Date(event.timestampMs).toLocaleTimeString()} ${event.action} ${event.stage} ${payloadText}`
        );
        if (state.llamaRuntimeLogs.length > 300) {
          state.llamaRuntimeLogs.splice(0, state.llamaRuntimeLogs.length - 300);
        }
      }
      if (
        (event.stage === "complete" || event.stage === "error") &&
        event.action !== "llama.runtime.status"
      ) {
        void refreshLlamaRuntime().then(() => renderAndBind(sendMessage));
      }
    }

    state.events.push(event);

    if (event.action === "chat.stream.chunk") {
      const chunk = parseStreamChunk(event.payload);
      if (chunk && chunk.conversationId === state.conversationId) {
        updateAssistantDraft(event.correlationId, chunk.delta);
      }
    }

    renderAndBind(sendMessage);
  });

  async function sendMessage(text: string): Promise<void> {
    if (!clientRef) return;

    const correlationId = nextCorrelationId();
    state.messages.push({ role: "user", text });
    renderAndBind(sendMessage);

    try {
      const response = await clientRef.sendMessage({
        conversationId: state.conversationId,
        userMessage: text,
        correlationId
      });

      const existing = state.messages.find(
        (m) => m.role === "assistant" && m.correlationId === response.correlationId
      );
      if (existing) {
        existing.text = response.assistantMessage;
      } else {
        state.messages.push({
          role: "assistant",
          text: response.assistantMessage,
          correlationId: response.correlationId
        });
      }

      await refreshConversations();
      renderAndBind(sendMessage);
    } catch (error) {
      state.events.push({
        timestampMs: Date.now(),
        correlationId,
        subsystem: "frontend",
        action: "chat.send",
        stage: "error",
        severity: "error",
        payload: { message: String(error) }
      });
      renderAndBind(sendMessage);
    }
  }

  renderAndBind(sendMessage);
}

function installConsoleCapture(): void {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;

  const originals = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  console.log = (...args: unknown[]) => {
    originals.log(...args);
    pushConsoleEntry("log", "browser", stringifyConsoleArgs(args));
  };
  console.info = (...args: unknown[]) => {
    originals.info(...args);
    pushConsoleEntry("info", "browser", stringifyConsoleArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    originals.warn(...args);
    pushConsoleEntry("warn", "browser", stringifyConsoleArgs(args));
  };
  console.error = (...args: unknown[]) => {
    originals.error(...args);
    pushConsoleEntry("error", "browser", stringifyConsoleArgs(args));
  };
  console.debug = (...args: unknown[]) => {
    originals.debug(...args);
    pushConsoleEntry("debug", "browser", stringifyConsoleArgs(args));
  };
}

function stringifyConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

bootstrap().catch((error) => {
  state.events.push({
    timestampMs: Date.now(),
    correlationId: "bootstrap",
    subsystem: "frontend",
    action: "app.bootstrap",
    stage: "error",
    severity: "error",
    payload: { message: String(error) }
  });
  render();
  attachDividerResize();
});

function attachDividerResize(): void {
  const split = document.querySelector<HTMLDivElement>("#splitLayout");
  const divider = document.querySelector<HTMLDivElement>("#paneDivider");
  const root = document.querySelector<HTMLElement>(".app-frame");
  if (!split || !divider || !root) return;

  divider.onpointerdown = (event) => {
    event.preventDefault();
    divider.classList.add("dragging");
    divider.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const bounds = split.getBoundingClientRect();
      const rawPercent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      const clamped = Math.max(22, Math.min(78, rawPercent));
      state.chatPanePercent = Number(clamped.toFixed(2));
      root.style.setProperty("--chat-pane-percent", String(state.chatPanePercent));
    };

    const onUp = (upEvent: PointerEvent) => {
      divider.classList.remove("dragging");
      divider.releasePointerCapture(upEvent.pointerId);
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      divider.removeEventListener("pointercancel", onUp);
    };

    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
    divider.addEventListener("pointercancel", onUp);
  };
}
