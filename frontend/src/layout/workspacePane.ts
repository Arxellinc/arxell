import { iconHtml } from "../icons";
import type { IconName } from "../icons";
import { APP_ICON } from "../icons/map";
import type { WorkspaceToolRecord } from "../contracts";
import { getToolManifest, TOOL_ORDER } from "../tools/registry";
import { WORKSPACE_DATA_ATTR } from "../tools/ui/constants";
import { resolveWorkspaceView } from "../tools/workspaceViewRegistry";
import type { WorkspacePrimaryTab, WorkspaceTab } from "./workspaceTabs";
import { toWorkspaceToolTabId } from "./workspaceTabs";
import { renderPaneMenu } from "./paneMenu";

export function renderWorkspacePane(
  consoleHtml: string,
  consoleActionsHtml: string,
  terminalUiHtml: string,
  terminalActionsHtml: string,
  toolsUiHtml: string,
  toolsActionsHtml: string,
  toolViews: Record<
    string,
    {
      actionsHtml: string;
      bodyHtml: string;
    }
  >,
  workspaceTools: WorkspaceToolRecord[],
  activeTab: WorkspaceTab,
  overlayHtml = "",
  overlayPlacement: "pane" | "content" = "pane"
): string {
  const workspaceToolsById = Object.fromEntries(
    workspaceTools.map((tool) => [tool.toolId === "web" ? "webSearch" : tool.toolId, tool])
  );
  const {
    actionsHtml: contentActionsHtml,
    bodyHtml: contentBodyHtml,
    usesIframe
  } = resolveWorkspaceView(
    activeTab,
    {
      consoleHtml,
      consoleActionsHtml,
      terminalUiHtml,
      terminalActionsHtml,
      toolsUiHtml,
      toolsActionsHtml,
      workspaceToolsById,
      toolViews
    }
  );
  const workspaceContentClass = contentActionsHtml
    ? "workspace-content"
    : usesIframe
      ? "workspace-content no-actions iframe-content"
      : "workspace-content no-actions";
  
  return `
    <section class="pane workspace-pane">
      ${renderWorkspaceTopbar(activeTab, workspaceTools)}
      <div class="${workspaceContentClass}">
        ${contentActionsHtml ? `<div class="workspace-panel-actions">${contentActionsHtml}</div>` : ""}
        ${contentBodyHtml}
        ${overlayPlacement === "content" ? overlayHtml : ""}
      </div>
      ${overlayPlacement === "pane" ? overlayHtml : ""}
    </section>
  `;
}

function renderWorkspaceTopbar(activeTab: WorkspaceTab, workspaceTools: WorkspaceToolRecord[]): string {
  const leftButtons = [
    {
      tabId: "terminal",
      icon: APP_ICON.sidebar.terminal,
      title: "Terminal"
    }
  ] satisfies Array<{ tabId: WorkspacePrimaryTab; icon: IconName; title: string }>;
  const rightButtons = [
    {
      tabId: "events",
      icon: APP_ICON.bottom.history,
      title: "Console"
    },
    {
      tabId: "manager-tool",
      icon: APP_ICON.bottom.tools,
      title: "Tool Manager"
    }
  ] satisfies Array<{ tabId: WorkspacePrimaryTab; icon: IconName; title: string }>;
  const docsTool = workspaceTools.find((tool) => tool.enabled && tool.icon !== false && tool.toolId === "docs");
  const docsButtonHtml = docsTool ? renderWorkspaceToolButton(docsTool, activeTab) : "";
  const toolButtons = renderWorkspaceToolButtons(activeTab, workspaceTools);
  const leftButtonsHtml = [
    ...leftButtons.map((button) =>
      renderWorkspaceTopbarButton(button.tabId, button.icon, button.title, activeTab)
    ),
    toolButtons
  ].join("");
  const rightButtonsHtml = rightButtons
    .slice()
    .reverse()
    .map((button) => renderWorkspaceTopbarButton(button.tabId, button.icon, button.title, activeTab))
    .join("");
  const workspaceMenuHtml = renderPaneMenu("workspacePaneMenu", APP_ICON.action.paneMenu);
  return `<header class="pane-topbar workspace-pane-topbar">
    <div class="workspace-topbar-left">
      ${leftButtonsHtml}
    </div>
    <div class="workspace-topbar-right">
      ${docsButtonHtml}
      ${rightButtonsHtml}
      ${workspaceMenuHtml}
    </div>
  </header>`;
}

function renderWorkspaceTopbarButton(
  tabId: WorkspaceTab,
  icon: IconName,
  title: string,
  activeTab: WorkspaceTab
): string {
  return `<button type="button" class="topbar-icon-btn ${activeTab === tabId ? "is-active" : ""}" ${WORKSPACE_DATA_ATTR.tab}="${tabId}" data-title="${title}" title="${title}" aria-label="${title}">
    ${iconHtml(icon, { size: 16, tone: "dark" })}
  </button>`;
}

function renderWorkspaceToolButtons(activeTab: WorkspaceTab, workspaceTools: WorkspaceToolRecord[]): string {
  const seenToolIds = new Set<string>();
  const toolOrderIndex = new Map<string, number>();
  TOOL_ORDER.forEach((toolId, index) => toolOrderIndex.set(toolId, index));
  return workspaceTools
    .filter((tool) => tool.enabled && tool.icon !== false)
    .filter((tool) => tool.toolId !== "terminal")
    .filter((tool) => tool.toolId !== "docs")
    .filter((tool) => {
      if (seenToolIds.has(tool.toolId)) return false;
      seenToolIds.add(tool.toolId);
      return true;
    })
    .sort((a, b) => {
      const aIndex = toolOrderIndex.get(a.toolId) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = toolOrderIndex.get(b.toolId) ?? Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.toolId.localeCompare(b.toolId);
    })
    .map((tool) => renderWorkspaceToolButton(tool, activeTab))
    .join("");
}

function renderWorkspaceToolButton(tool: WorkspaceToolRecord, activeTab: WorkspaceTab): string {
  const toolId = tool.toolId === "web" ? "webSearch" : tool.toolId;
  const manifest = getToolManifest(toolId);
  const tabId = toWorkspaceToolTabId(toolId);
  const icon = manifest?.icon || "wrench";
  const title = manifest?.title || tool.title || tool.toolId;
  return `<button type="button" class="topbar-icon-btn ${activeTab === tabId ? "is-active" : ""}" ${WORKSPACE_DATA_ATTR.tab}="${tabId}" data-title="${title}" title="${title}" aria-label="${title}">
    ${iconHtml(icon, { size: 16, tone: "dark" })}
  </button>`;
}
