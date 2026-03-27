import type { WorkspaceToolRecord } from "../contracts";
import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { IconName } from "../icons";
import { escapeHtml } from "../panels/utils";
import { getToolManifest } from "../tools/registry";

export function renderWorkspaceToolsActions(): string {
  return [
    '<button type="button" class="topbar-icon-btn" id="refreshWorkspaceToolsBtn" aria-label="Refresh tools">↻</button>',
    '<button type="button" class="topbar-icon-btn" id="exportWorkspaceToolsBtn" aria-label="Export tools">⇩</button>',
    '<button type="button" class="topbar-icon-btn" id="importWorkspaceToolsBtn" aria-label="Import tools">⇧</button>'
  ].join("");
}

export function renderWorkspaceToolsBody(tools: WorkspaceToolRecord[]): string {
  const rows =
    tools
      .map((tool) => {
        const manifest = getToolManifest(tool.toolId);
        const icon = toolIcon(tool.toolId, manifest?.icon);
        const status = tool.enabled ? tool.status : "disabled";
        const description = tool.description || manifest?.description || "";
        const category = tool.category || manifest?.category || "workspace";
        const scopeLabel = tool.core ? "core" : "optional";
        return `<div class="tool-row">
          <div class="tool-cell tool-cell-main">
            <span class="tool-row-icon">${iconHtml(icon, { size: 16, tone: "dark" })}</span>
            <div class="tool-main-copy">
              <div class="tool-title">${escapeHtml(tool.title)}</div>
              <div class="tool-description">${escapeHtml(description)}</div>
              <div class="tool-meta-row">
                <span class="tool-meta-pill">${escapeHtml(category)}</span>
                <span class="tool-meta-pill">${escapeHtml(scopeLabel)}</span>
                <span class="tool-meta-pill">${escapeHtml(tool.version)}</span>
              </div>
            </div>
          </div>
          <div class="tool-cell tool-cell-status">
            <span class="tool-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
          </div>
          <div class="tool-cell tool-cell-actions">
            <button type="button" class="tool-action-btn" data-workspace-tool-toggle-id="${escapeHtml(tool.toolId)}" data-workspace-tool-enable="true" ${tool.enabled ? "disabled" : ""} aria-label="Enable tool">Enable</button>
            <button type="button" class="tool-action-btn" data-workspace-tool-toggle-id="${escapeHtml(tool.toolId)}" data-workspace-tool-enable="false" ${tool.enabled ? "" : "disabled"} aria-label="Disable tool">Disable</button>
          </div>
        </div>`;
      })
      .join("") || '<div class="history-empty">No tools registered</div>';

  return `<div class="tools-table primary-pane-body">${rows}</div>`;
}

export function bindWorkspaceToolsPanel(
  onRefreshTools: () => Promise<void>,
  onSetToolEnabled: (toolId: string, enabled: boolean) => Promise<void>,
  onExportTools: () => Promise<void>,
  onImportTools: () => Promise<void>
): void {
  const refreshBtn = document.querySelector<HTMLButtonElement>("#refreshWorkspaceToolsBtn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      await onRefreshTools();
    };
  }
  const exportBtn = document.querySelector<HTMLButtonElement>("#exportWorkspaceToolsBtn");
  if (exportBtn) {
    exportBtn.onclick = async () => {
      await onExportTools();
    };
  }
  const importBtn = document.querySelector<HTMLButtonElement>("#importWorkspaceToolsBtn");
  if (importBtn) {
    importBtn.onclick = async () => {
      await onImportTools();
    };
  }

  const toggles = document.querySelectorAll<HTMLButtonElement>("[data-workspace-tool-toggle-id]");
  toggles.forEach((button) => {
    button.onclick = async () => {
      const toolId = button.dataset.workspaceToolToggleId;
      const enabled = button.dataset.workspaceToolEnable === "true";
      if (!toolId) return;
      await onSetToolEnabled(toolId, enabled);
    };
  });
}

function toolIcon(toolId: string, manifestIcon?: IconName): IconName {
  if (manifestIcon) return manifestIcon;
  if (toolId === "terminal") return APP_ICON.sidebar.terminal;
  return APP_ICON.action.toolsPanel;
}
