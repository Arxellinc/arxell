import { getToolManifest } from "./registry";
import { renderToolToolbar } from "./ui/toolbar";
import type { WorkspaceTab } from "../layout/workspaceTabs";

interface WorkspaceViewRenderContext {
  consoleHtml: string;
  consoleActionsHtml: string;
  terminalUiHtml: string;
  terminalActionsHtml: string;
  toolsUiHtml: string;
  toolsActionsHtml: string;
  webUiHtml: string;
  webActionsHtml: string;
}

interface WorkspaceTabView {
  renderActionsHtml: (ctx: WorkspaceViewRenderContext) => string;
  renderBodyHtml: (ctx: WorkspaceViewRenderContext, tab: string) => string;
}

const WORKSPACE_TAB_VIEWS: Record<string, WorkspaceTabView> = {
  events: {
    renderActionsHtml: (ctx) => ctx.consoleActionsHtml,
    renderBodyHtml: (ctx) => ctx.consoleHtml
  },
  terminal: {
    renderActionsHtml: (ctx) => ctx.terminalActionsHtml,
    renderBodyHtml: (ctx) => ctx.terminalUiHtml
  },
  "manager-tool": {
    renderActionsHtml: (ctx) => ctx.toolsActionsHtml,
    renderBodyHtml: (ctx) => ctx.toolsUiHtml
  },
  "webSearch-tool": {
    renderActionsHtml: (ctx) => ctx.webActionsHtml,
    renderBodyHtml: (ctx) => ctx.webUiHtml
  },
  "web-tool": {
    renderActionsHtml: (ctx) => ctx.webActionsHtml,
    renderBodyHtml: (ctx) => ctx.webUiHtml
  }
};

export function resolveWorkspaceView(tab: WorkspaceTab, ctx: WorkspaceViewRenderContext): {
  actionsHtml: string;
  bodyHtml: string;
} {
  const entry = WORKSPACE_TAB_VIEWS[tab];
  if (entry) {
    return {
      actionsHtml: entry.renderActionsHtml(ctx),
      bodyHtml: entry.renderBodyHtml(ctx, tab)
    };
  }

  const toolId = tab.replace(/-tool$/, "");
  const manifest = getToolManifest(toolId);
  return {
    actionsHtml: renderToolToolbar({
      tabsMode: "none",
      tabs: [],
      actions: []
    }),
    bodyHtml: `<div class="tool-placeholder-container">
      <h2>${manifest?.title || tab}</h2>
      <p>${manifest?.description || ""}</p>
      <div class="tool-placeholder-message">This tool is not yet implemented.</div>
    </div>`
  };
}
