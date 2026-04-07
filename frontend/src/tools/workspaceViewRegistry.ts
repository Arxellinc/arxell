import { getToolManifest } from "./registry";
import { renderToolToolbar } from "./ui/toolbar";
import type { WorkspaceToolRecord } from "../contracts";
import type { WorkspaceTab } from "../layout/workspaceTabs";

interface WorkspaceViewRenderContext {
  consoleHtml: string;
  consoleActionsHtml: string;
  terminalUiHtml: string;
  terminalActionsHtml: string;
  toolsUiHtml: string;
  toolsActionsHtml: string;
  workspaceToolsById: Record<string, WorkspaceToolRecord>;
  toolViews: Record<
    string,
    {
      actionsHtml: string;
      bodyHtml: string;
    }
  >;
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
  }
};

export function resolveWorkspaceView(tab: WorkspaceTab, ctx: WorkspaceViewRenderContext): {
  actionsHtml: string;
  bodyHtml: string;
  usesIframe: boolean;
} {
  const entry = WORKSPACE_TAB_VIEWS[tab];
  if (entry) {
    return {
      actionsHtml: entry.renderActionsHtml(ctx),
      bodyHtml: entry.renderBodyHtml(ctx, tab),
      usesIframe: false
    };
  }

  const toolId = tab.replace(/-tool$/, "");
  const normalizedToolId = toolId === "web" ? "webSearch" : toolId;
  const view = ctx.toolViews[normalizedToolId];
  if (view) {
    return {
      actionsHtml: view.actionsHtml,
      bodyHtml: view.bodyHtml,
      usesIframe: false
    };
  }
  const workspaceTool = ctx.workspaceToolsById[normalizedToolId];
  if (
    workspaceTool &&
    (workspaceTool.source === "custom" || workspaceTool.source === "plugin") &&
    workspaceTool.enabled &&
    workspaceTool.entry
  ) {
    const src = toFileUrl(workspaceTool.entry);
    return {
      actionsHtml: "",
      bodyHtml: `<div class="tool-plugin-iframe-wrap tool-custom-tool-iframe-wrap">
        <iframe class="tool-plugin-iframe tool-custom-tool-iframe" sandbox="allow-scripts allow-forms allow-downloads" src="${escapeAttr(src)}" data-custom-tool-id="${escapeAttr(normalizedToolId)}" data-plugin-tool-id="${escapeAttr(normalizedToolId)}" title="${escapeAttr(workspaceTool.title)}"></iframe>
      </div>`,
      usesIframe: true
    };
  }
  const manifest = getToolManifest(normalizedToolId);
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
    </div>`,
    usesIframe: false
  };
}

function toFileUrl(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) return "";
  if (normalized.startsWith("file://")) return normalized;
  if (/^[A-Za-z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`);
  }
  if (normalized.startsWith("/")) {
    return encodeURI(`file://${normalized}`);
  }
  return encodeURI(normalized);
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
