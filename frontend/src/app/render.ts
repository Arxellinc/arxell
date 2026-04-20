import { iconHtml } from "../icons";
import type { IconName } from "../icons";
import { escapeHtml } from "../panels/utils";
import type { CONSOLE_DATA_ATTR } from "../tools/ui/constants";
import { renderToolToolbar } from "../tools/ui/toolbar";
import { APP_ICON } from "../icons/map";
import { renderPaneMenu } from "../layout/paneMenu";

export function modelNameFromPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "none";
  const normalized = trimmed.replace(/\\/g, "/");
  const tail = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  return tail || "none";
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  if (value >= 100) return "100";
  return value.toFixed(1);
}

export function formatBytesShort(bytes: number | null): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatRateShort(bytesPerSec: number | null): string {
  if (typeof bytesPerSec !== "number" || !Number.isFinite(bytesPerSec) || bytesPerSec < 0) {
    return "n/a";
  }
  return `${formatBytesShort(bytesPerSec)}/s`;
}

export function buildBottomStatus(input: {
  activeEngineBackend: string | null;
  showBottomEngine: boolean;
  showBottomModel: boolean;
  showBottomContext: boolean;
  showBottomSpeed: boolean;
  showBottomTtsLatency: boolean;
  showAppResourceCpu: boolean;
  showAppResourceMemory: boolean;
  showAppResourceNetwork: boolean;
  modelPath: string;
  modelLabel?: string | null;
  contextTokens: number | null;
  contextCapacity: number | null;
  tokensPerSecond: number | null;
  ttsLatencyMs: number | null;
  appResourceCpuPercent: number | null;
  appResourceMemoryBytes: number | null;
  appResourceNetworkRxBytesPerSec: number | null;
  appResourceNetworkTxBytesPerSec: number | null;
}) {
  const engine = input.activeEngineBackend?.trim() || "offline";
  const contextText =
    input.contextTokens && input.contextCapacity && input.contextCapacity > 0
      ? `${input.contextTokens}/${input.contextCapacity} (${formatPercent((input.contextTokens / input.contextCapacity) * 100)}%)`
      : "n/a";
  const speedText =
    typeof input.tokensPerSecond === "number"
      ? `${input.tokensPerSecond >= 100 ? input.tokensPerSecond.toFixed(0) : input.tokensPerSecond.toFixed(1)} tok/s`
      : "n/a";
  const ttsLatencyText =
    typeof input.ttsLatencyMs === "number" ? `${Math.max(0, Math.round(input.ttsLatencyMs))} ms` : "n/a";
  const appResourceCpuText = input.showAppResourceCpu
    ? `CPU ${typeof input.appResourceCpuPercent === "number" ? input.appResourceCpuPercent.toFixed(1) : "n/a"}%`
    : null;
  const appResourceMemoryText = input.showAppResourceMemory
    ? `RAM ${formatBytesShort(input.appResourceMemoryBytes)}`
    : null;
  const appResourceNetworkText = input.showAppResourceNetwork
    ? `Net ${formatRateShort(input.appResourceNetworkRxBytesPerSec)}/${formatRateShort(input.appResourceNetworkTxBytesPerSec)}`
    : null;
  return {
    appResourceCpuText,
    appResourceMemoryText,
    appResourceNetworkText,
    engine: input.showBottomEngine ? engine : null,
    model: input.showBottomModel ? (input.modelLabel?.trim() || modelNameFromPath(input.modelPath)) : null,
    contextText: input.showBottomContext ? contextText : null,
    speedText: input.showBottomSpeed ? speedText : null,
    ttsLatencyText: input.showBottomTtsLatency ? ttsLatencyText : null
  };
}

export interface HeaderModelOption {
  id: string;
  label: string;
}

export function renderChatHeaderModelSelect(input: {
  options: HeaderModelOption[];
  activeModelId: string;
  paneId: string;
  scopeId?: string;
}): string {
  const options = input.options;
  if (!options.length) {
    return '<span class="chat-header-model-wrap"><span class="chat-header-model-fallback">No models</span></span>';
  }
  const optionsHtml = options
    .map((option) => {
      const selected = option.id === input.activeModelId ? " selected" : "";
      return `<option value="${escapeHtml(option.id)}"${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join("");
  return `
    <span class="chat-header-model-wrap">
      <select id="chatHeaderModelSelect${input.scopeId ?? ""}" class="chat-header-model-select" title="Select chat model" data-chat-pane-id="${escapeHtml(input.paneId)}">
        ${optionsHtml}
      </select>
    </span>
  `;
}

export function resolveTtsLoadedHeaderSuffix(input: {
  sidebarTab: string;
  ttsReady: boolean;
  ttsEngine: "kokoro" | "piper" | "matcha" | "kitten" | "pocket";
}): string {
  if (input.sidebarTab !== "tts" || !input.ttsReady) {
    return "";
  }
  const engineLabel =
    input.ttsEngine === "piper"
      ? "Piper"
      : input.ttsEngine === "matcha"
        ? "Matcha"
        : input.ttsEngine === "kitten"
          ? "KittenTTS"
          : input.ttsEngine === "pocket"
            ? "PocketTTS"
            : "Kokoro";
  return `<span class="pane-title-note">(${escapeHtml(engineLabel)} Ready ✓)</span>`;
}

export function renderPanelTitleIcon(input: {
  icon: IconName;
  title: string;
  sidebarTab: string;
  chatModelOptions: HeaderModelOption[];
  chatActiveModelId: string;
  chatPaneId: string;
  scopeId?: string;
  ttsReady: boolean;
  ttsEngine: "kokoro" | "piper" | "matcha" | "kitten" | "pocket";
}): string {
  const ttsSuffix = resolveTtsLoadedHeaderSuffix({
    sidebarTab: input.sidebarTab,
    ttsReady: input.ttsReady,
    ttsEngine: input.ttsEngine
  });
  const chatModelSelect =
    input.sidebarTab === "chat"
      ? renderChatHeaderModelSelect(
          input.scopeId
            ? {
                options: input.chatModelOptions,
                activeModelId: input.chatActiveModelId,
                paneId: input.chatPaneId,
                scopeId: input.scopeId
              }
            : {
                options: input.chatModelOptions,
                activeModelId: input.chatActiveModelId,
                paneId: input.chatPaneId
              }
        )
      : "";
  return `${iconHtml(input.icon, { size: 16, tone: "dark" })}<span>${input.title}</span>${chatModelSelect}${ttsSuffix}`;
}

export function shouldShowMicPermissionBubble(input: {
  microphonePermission: string;
  micPermissionBubbleDismissed: boolean;
}): boolean {
  if (input.microphonePermission === "enabled") return false;
  if (input.microphonePermission === "no_device") return false;
  return !input.micPermissionBubbleDismissed;
}

export function renderMicPermissionBubble(input: {
  microphonePermission: string;
  micPermissionBubbleDismissed: boolean;
}): string {
  if (!shouldShowMicPermissionBubble(input)) return "";
  return `
    <div class="permission-bubble" role="status" aria-live="polite">
      <button type="button" class="permission-bubble-close" id="micPermissionDismissBtn" aria-label="Dismiss microphone permission notice">×</button>
      <span class="permission-bubble-text">Allow microphone access for Local Speech Recognition</span>
      <div class="permission-bubble-actions permission-bubble-actions-second-row">
        <button type="button" class="tool-action-btn permission-enable-btn is-warning" id="micPermissionEnableBtn">Enable Microphone</button>
      </div>
    </div>
  `;
}

export type ConsoleView = "all" | "errors-warnings" | "security-events";

export interface ConsoleEntry {
  timestampMs: number;
  level: "log" | "info" | "warn" | "error" | "debug";
  source: "browser" | "app";
  message: string;
}

export function isSecurityConsoleEntry(message: string): boolean {
  return /(security|auth|permission|credential|token|secret|oauth|forbidden|denied|unauthorized|tls|ssl|csrf|xss|csp|injection)/i.test(
    message
  );
}

export function getVisibleConsoleEntries(entries: ConsoleEntry[], view: ConsoleView): ConsoleEntry[] {
  if (view === "errors-warnings") {
    return entries.filter((entry) => entry.level === "warn" || entry.level === "error");
  }
  if (view === "security-events") {
    return entries.filter((entry) => isSecurityConsoleEntry(entry.message));
  }
  return entries;
}

export function renderConsoleToolbar(consoleView: ConsoleView, consoleDataAttr: typeof CONSOLE_DATA_ATTR): string {
  return renderToolToolbar({
    tabsMode: "static",
    tabs: [
      {
        id: "console-all",
        label: "Console",
        active: consoleView === "all",
        buttonAttrs: {
          [consoleDataAttr.view]: "all"
        }
      },
      {
        id: "console-errors",
        label: "Errors & Warnings",
        active: consoleView === "errors-warnings",
        buttonAttrs: {
          [consoleDataAttr.view]: "errors-warnings"
        }
      },
      {
        id: "console-security",
        label: "Security Events",
        active: consoleView === "security-events",
        buttonAttrs: {
          [consoleDataAttr.view]: "security-events"
        }
      }
    ],
    actions: [
      {
        id: "console-copy",
        title: "Copy all visible console lines",
        icon: "copy",
        label: "Copy",
        className: "is-text is-compact",
        buttonAttrs: {
          [consoleDataAttr.action]: "copy"
        }
      },
      {
        id: "console-save",
        title: "Save all visible console lines to a .txt file",
        icon: "save",
        label: "Save .txt",
        className: "is-text is-compact",
        buttonAttrs: {
          [consoleDataAttr.action]: "save"
        }
      }
    ]
  });
}

export function formatConsoleEntryLine(entry: ConsoleEntry): string {
  const time = new Date(entry.timestampMs).toLocaleTimeString();
  const legacyTag = entry.message.includes("cmd.legacy_wrapper.used") ? " [Legacy]" : "";
  return `${time} [${entry.source}] ${entry.level.toUpperCase()}${legacyTag} ${entry.message}`;
}

export function buildConsoleCopyText(entries: ConsoleEntry[]): string {
  return entries.map((entry) => formatConsoleEntryLine(entry)).join("\n");
}

export function buildConsoleFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `console-${stamp}.txt`;
}

export function composePrimaryPaneHtml(input: {
  isChatTab: boolean;
  chatSplitMode: "none" | "vertical" | "horizontal";
  chatSplitPercent: number;
  paneTitleHtml: string;
  panelActionsHtml: string;
  panelBodyHtml: string;
  extraPanelHtmls?: Array<{
    paneTitleHtml: string;
    panelActionsHtml: string;
    panelBodyHtml: string;
  }> | undefined;
}): string {
  const paneMenuHtml = input.isChatTab
    ? renderPaneMenu("chatPaneMenu", APP_ICON.action.paneMenu)
    : "";
  const chatClass = input.isChatTab ? "chat-pane" : "";
  const mainPanelHtml = `
    <section class="pane primary-pane ${chatClass}" data-chat-panel="0">
      <header class="pane-topbar">
        <span class="pane-title">${input.paneTitleHtml}</span>
        ${paneMenuHtml}
      </header>
      <div class="primary-panel-actions">${input.panelActionsHtml}</div>
      ${input.panelBodyHtml}
    </section>
  `;
  if (input.chatSplitMode === "none" || !input.extraPanelHtmls?.length) {
    return mainPanelHtml;
  }
  const dirClass = input.chatSplitMode === "vertical" ? "is-vertical" : "is-horizontal";
  const dividerClass = input.chatSplitMode === "vertical" ? "" : "pane-divider-horizontal";
  const extraHtmls = input.extraPanelHtmls.map((panel, i) => {
    const menuId = `chatPaneMenu-${i + 1}`;
    const menuHtml = renderPaneMenu(menuId, APP_ICON.action.paneMenu);
    return `
      <section class="pane primary-pane ${chatClass}" data-chat-panel="${i + 1}">
        <header class="pane-topbar">
          <span class="pane-title">${panel.paneTitleHtml}</span>
          ${menuHtml}
        </header>
        <div class="primary-panel-actions">${panel.panelActionsHtml}</div>
        ${panel.panelBodyHtml}
      </section>
    `;
  });
  return `<section class="chat-split-wrap ${dirClass}" id="chatSplitWrap" style="--chat-split-percent: ${input.chatSplitPercent}">
    ${mainPanelHtml}
    <div class="pane-divider ${dividerClass}" id="chatSplitDivider" aria-label="Resize chat panels" role="separator">
      <div class="pane-divider-line"></div>
    </div>
    ${extraHtmls.join("")}
  </section>`;
}

export function composeAppBodyHtml(input: {
  layoutOrientation: "landscape" | "portrait";
  sidebarRailHtml: string;
  primaryPaneHtml: string;
  workspacePaneHtml: string;
}): string {
  if (input.layoutOrientation === "portrait") {
    return `
      <section class="app-body app-body-portrait" id="portraitLayout">
        <section class="portrait-workspace-row">
          ${input.workspacePaneHtml}
        </section>
        <div class="pane-divider pane-divider-horizontal" id="portraitPaneDivider" aria-label="Resize portrait panels" aria-orientation="horizontal" role="separator">
          <div class="pane-divider-line"></div>
        </div>
        <section class="portrait-main-row">
          ${input.sidebarRailHtml}
          <section class="main-column">
            <div class="portrait-primary-wrap">
              ${input.primaryPaneHtml}
            </div>
          </section>
        </section>
      </section>
    `;
  }
  return `
    <section class="app-body">
      ${input.sidebarRailHtml}
      <section class="main-column">
      <div class="split-layout" id="splitLayout">
        ${input.primaryPaneHtml}
        <div class="pane-divider" id="paneDivider" aria-label="Resize panels" role="separator">
          <div class="pane-divider-line"></div>
        </div>
        ${input.workspacePaneHtml}
      </div>
      </section>
    </section>
  `;
}

export function composeAppFrameHtml(input: {
  chatPanePercent: number;
  portraitWorkspacePercent: number;
  topbarHtml: string;
  micPermissionBubbleHtml: string;
  appBodyHtml: string;
  bottombarHtml: string;
}): string {
  return `
    <main class="app-frame" style="--chat-pane-percent: ${input.chatPanePercent}; --portrait-workspace-percent: ${input.portraitWorkspacePercent};">
      ${input.topbarHtml}
      ${input.micPermissionBubbleHtml}
      ${input.appBodyHtml}
      ${input.bottombarHtml}
    </main>
  `;
}

export function conversationMarkdownFilename(conversationId: string): string {
  const safe = conversationId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `chat-${safe || "conversation"}.md`;
}

export function buildConversationMarkdown(
  conversationId: string,
  title: string,
  messages: Array<{ role: "user" | "assistant"; content: string; timestampMs: number }>
): string {
  const lines: string[] = [];
  lines.push(`# ${title || conversationId}`);
  lines.push("");
  lines.push(`- Conversation ID: \`${conversationId}\``);
  lines.push(`- Exported: ${new Date().toLocaleString()}`);
  lines.push("");
  for (const msg of messages) {
    const heading = msg.role === "user" ? "User" : "Assistant";
    lines.push(`## ${heading} (${new Date(msg.timestampMs).toLocaleString()})`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }
  return lines.join("\n");
}
