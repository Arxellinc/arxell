/**
 * Tool Manager
 */

import type { WorkspaceToolRecord } from "../../contracts";
import { iconHtml } from "../../icons";
import { APP_ICON } from "../../icons/map";
import type { IconName } from "../../icons";
import { escapeHtml } from "../../panels/utils";
import { getToolManifest } from "../registry";
import { MANAGER_DATA_ATTR, MANAGER_UI_ID } from "../ui/constants";
import { renderToolToolbar } from "../ui/toolbar";
import "./styles.css";

export function renderWorkspaceToolsActions(): string {
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: [
      {
        id: "tools-refresh",
        title: "Refresh tools",
        icon: "history",
        buttonAttrs: { id: MANAGER_UI_ID.refreshToolsButton }
      },
      {
        id: "tools-export",
        title: "Export tools",
        icon: "new",
        buttonAttrs: { id: MANAGER_UI_ID.exportToolsButton }
      },
      {
        id: "tools-import",
        title: "Import tools",
        icon: "folder",
        buttonAttrs: { id: MANAGER_UI_ID.importToolsButton }
      }
    ]
  });
}

export function renderWorkspaceToolsBody(tools: WorkspaceToolRecord[]): string {
  const header = `<div class="tool-header">
    <div class="tool-header-cell tool-header-icon"></div>
    <div class="tool-header-cell tool-header-name">Name</div>
    <div class="tool-header-cell tool-header-description">Description</div>
    <div class="tool-header-cell tool-header-tags">Tags</div>
    <div class="tool-header-cell tool-header-status">Status</div>
    <div class="tool-header-cell tool-header-enabled">Enabled</div>
    <div class="tool-header-cell tool-header-agent">Agent</div>
    <div class="tool-header-cell tool-header-icon-toggle">Icon</div>
    <div class="tool-header-cell tool-header-actions">Actions</div>
  </div>`;

  const dedupedTools = new Map<string, WorkspaceToolRecord>();
  for (const tool of tools) {
    if (!dedupedTools.has(tool.toolId)) {
      dedupedTools.set(tool.toolId, tool);
    }
  }

  const toolRows = [...dedupedTools.values()]
    .sort((a, b) => a.toolId.localeCompare(b.toolId))
    .map((tool) => {
      const manifest = getToolManifest(tool.toolId);
      const icon = toolIcon(tool.toolId, manifest?.icon);
      const status = tool.enabled ? tool.status : "disabled";
      const description = tool.description || manifest?.description || "";
      const category = tool.category || manifest?.category || "workspace";
      const scopeLabel = tool.core ? "core" : "optional";
      const isAgent = category === "agent";
      const showActions = isUserTool(tool);
      const exportButton = `<button type="button" class="tool-row-action" ${MANAGER_DATA_ATTR.action}="export-tool" ${MANAGER_DATA_ATTR.actionToolId}="${escapeHtml(tool.toolId)}" title="Export tool" aria-label="Export ${escapeHtml(tool.toolId)}">${iconHtml("file-output", { size: 16, tone: "dark" })}</button>`;
      const deleteButton = `<button type="button" class="tool-row-action is-danger" ${MANAGER_DATA_ATTR.action}="delete-tool" ${MANAGER_DATA_ATTR.actionToolId}="${escapeHtml(tool.toolId)}" title="Remove tool" aria-label="Remove ${escapeHtml(tool.toolId)}">${iconHtml("trash-2", { size: 16, tone: "dark" })}</button>`;
      return `<div class="tool-row">
        <div class="tool-cell tool-cell-icon">
          <span class="tool-row-icon">${iconHtml(icon, { size: 16, tone: "dark" })}</span>
        </div>
        <div class="tool-cell tool-cell-name">
          <div class="tool-title">${escapeHtml(tool.title)}</div>
        </div>
        <div class="tool-cell tool-cell-description">
          <div class="tool-description">${escapeHtml(description)}</div>
        </div>
        <div class="tool-cell tool-cell-tags">
          <div class="tool-meta-row">
            <span class="tool-meta-pill">${escapeHtml(category)}</span>
            <span class="tool-meta-pill">${escapeHtml(scopeLabel)}</span>
            <span class="tool-meta-pill">${escapeHtml(tool.version)}</span>
          </div>
        </div>
        <div class="tool-cell tool-cell-status">
          <span class="tool-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
        </div>
        <div class="tool-cell tool-cell-enabled">
          <input type="checkbox" class="tool-enabled-checkbox" ${MANAGER_DATA_ATTR.toggleToolId}="${escapeHtml(tool.toolId)}" data-workspace-tool-enable="true" ${tool.enabled ? "checked" : ""} aria-label="Enable tool">
        </div>
        <div class="tool-cell tool-cell-agent">
          ${isAgent ? `<input type="checkbox" class="tool-agent-checkbox" ${MANAGER_DATA_ATTR.toggleToolId}="${escapeHtml(tool.toolId)}" data-workspace-tool-enable="true" ${tool.enabled ? "checked" : ""} aria-label="Enable agent tool">` : ''}
        </div>
        <div class="tool-cell tool-cell-icon-toggle">
          <input type="checkbox" class="tool-icon-checkbox" ${MANAGER_DATA_ATTR.toggleToolIconId}="${escapeHtml(tool.toolId)}" data-workspace-tool-icon="true" ${tool.icon !== false ? "checked" : ""} aria-label="Show tool icon in top toolbar">
        </div>
        <div class="tool-cell tool-cell-actions">
          ${showActions ? `${exportButton}${deleteButton}` : ""}
        </div>
      </div>`;
    })
    .join("");

  const rows = toolRows || '<div class="history-empty">No tools available</div>';

  return `<div class="tools-table primary-pane-body">${header}${rows}</div>`;
}

function isUserTool(tool: WorkspaceToolRecord): boolean {
  const protectedIds = new Set([
    "terminal",
    "files",
    "webSearch",
    "flow",
    "tasks",
    "memory"
  ]);
  if (protectedIds.has(tool.toolId)) return false;
  if (tool.core) return false;
  return true;
}

function toolIcon(toolId: string, manifestIcon?: IconName): IconName {
  if (manifestIcon) return manifestIcon;
  if (toolId === "terminal") return APP_ICON.sidebar.terminal;
  if (toolId === "memory") return "database-zap" as IconName;
  return APP_ICON.action.toolsPanel;
}
