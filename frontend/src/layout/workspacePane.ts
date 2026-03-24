import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";

export type WorkspaceTab = "events" | "terminal" | "tools";

export function renderWorkspacePane(
  consoleHtml: string,
  consoleActionsHtml: string,
  terminalUiHtml: string,
  toolsUiHtml: string,
  toolsActionsHtml: string,
  activeTab: WorkspaceTab
): string {
  return `
    <section class="pane workspace-pane">
      <header class="pane-topbar workspace-pane-topbar">
        <div class="workspace-topbar-left">
          <button type="button" class="workspace-tool-btn ${activeTab === "tools" ? "is-active" : ""}" data-workspace-tab="tools" aria-label="Open tool panel">
            ${iconHtml(APP_ICON.action.toolsPanel, { size: 16, tone: "dark" })}
            <span>Tool Panel</span>
          </button>
        <div class="workspace-topbar-actions" role="tablist" aria-label="Workspace tabs">
          <button type="button" class="topbar-icon-btn ${activeTab === "events" ? "is-active" : ""}" data-workspace-tab="events" data-title="Console" aria-label="Console">
            ${iconHtml(APP_ICON.bottom.history, { size: 16, tone: "dark" })}
          </button>
          <button type="button" class="topbar-icon-btn ${activeTab === "terminal" ? "is-active" : ""}" data-workspace-tab="terminal" data-title="Terminal" aria-label="Terminal">
            ${iconHtml(APP_ICON.sidebar.terminal, { size: 16, tone: "dark" })}
          </button>
        </div>
        </div>
        ${
          activeTab === "tools"
            ? `<div class="workspace-pane-actions">${toolsActionsHtml}</div>`
            : activeTab === "events"
              ? `<div class="workspace-pane-actions">${consoleActionsHtml}</div>`
              : "<span></span>"
        }
      </header>
      <div class="workspace-content">
        ${
          activeTab === "events"
            ? consoleHtml
            : activeTab === "terminal"
              ? terminalUiHtml
              : toolsUiHtml
        }
      </div>
    </section>
  `;
}

export function attachWorkspacePaneInteractions(onTabSelect: (tab: WorkspaceTab) => void | Promise<void>): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]");
  tabs.forEach((tab) => {
    tab.onclick = () => {
      const nextTab = tab.dataset.workspaceTab as WorkspaceTab | undefined;
      if (!nextTab) return;
      onTabSelect(nextTab);
    };
  });
}
