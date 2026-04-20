import { iconHtml } from "../../icons";
import type { IconName } from "../../icons";

export type ToolToolbarTabsMode = "none" | "static" | "dynamic";

export interface ToolToolbarTab {
  id: string;
  label: string;
  icon?: IconName;
  mutedIcon?: boolean;
  active?: boolean;
  closable?: boolean;
  buttonAttrs?: Record<string, string>;
  closeAttrs?: Record<string, string>;
}

export interface ToolToolbarAction {
  id: string;
  title: string;
  icon?: IconName;
  label?: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  buttonAttrs?: Record<string, string>;
}

export interface ToolToolbarTabAction {
  title: string;
  icon?: IconName;
  disabled?: boolean;
  buttonAttrs?: Record<string, string>;
}

export interface ToolToolbarConfig {
  tabsMode: ToolToolbarTabsMode;
  tabs: ToolToolbarTab[];
  tabAction?: ToolToolbarTabAction;
  actions: ToolToolbarAction[];
}

export function renderToolToolbar(config: ToolToolbarConfig): string {
  const tabsHtml =
    config.tabsMode === "none"
      ? '<div class="tool-toolbar-tabs is-empty" aria-hidden="true"></div>'
      : `<div class="tool-toolbar-tabs">${config.tabs
          .map((tab) => {
            const activeClass = tab.active ? " is-active" : "";
            const tabAttrs = attrsToHtml(tab.buttonAttrs);
            const canClose = config.tabsMode === "dynamic" && tab.closable !== false;
            const closeClass = canClose ? " is-closable" : " is-fixed";
            const closeHtml = canClose
              ? `<span class="tool-toolbar-tab-close" role="button" ${attrsToHtml(tab.closeAttrs)} aria-label="Close ${escapeHtml(tab.label)} tab" title="Close tab">×</span>`
              : "";
            const iconHtmlPart = tab.icon
              ? `<span class="tool-toolbar-tab-icon${tab.mutedIcon ? " is-muted" : ""}">${iconHtml(tab.icon, { size: 16, tone: "dark" })}</span>`
              : "";
            return `<button type="button" class="tool-toolbar-tab${activeClass}${closeClass}" ${tabAttrs} title="${escapeHtml(tab.label)}">
              ${iconHtmlPart}
              <span class="tool-toolbar-tab-label">${escapeHtml(tab.label)}</span>
              ${closeHtml}
            </button>`;
          })
          .join("")}${renderTabAction(config.tabAction)}</div>`;

  const actionsHtml = `<div class="tool-toolbar-actions">${config.actions
    .map((action) => {
      const activeClass = action.active ? " is-active" : "";
      const className = action.className ? ` ${action.className}` : "";
      const disabledAttr = action.disabled ? " disabled" : "";
      const attrs = attrsToHtml(action.buttonAttrs);
      const inner =
        action.icon !== undefined && action.label
          ? `${iconHtml(action.icon, { size: 16, tone: "dark" })}<span class="tool-toolbar-btn-label">${escapeHtml(action.label)}</span>`
          : action.icon !== undefined
            ? iconHtml(action.icon, { size: 16, tone: "dark" })
            : escapeHtml(action.label ?? action.title);
      return `<button type="button" class="tool-toolbar-btn${activeClass}${className}" aria-label="${escapeHtml(action.title)}" title="${escapeHtml(action.title)}"${disabledAttr} ${attrs}>
        ${inner}
      </button>`;
    })
    .join("")}</div>`;

  return `<div class="tool-toolbar">${tabsHtml}${actionsHtml}</div>`;
}

function renderTabAction(action?: ToolToolbarTabAction): string {
  if (!action) return "";
  const disabledAttr = action.disabled ? " disabled" : "";
  const attrs = attrsToHtml(action.buttonAttrs);
  const icon = action.icon ? iconHtml(action.icon, { size: 16, tone: "dark" }) : "+";
  return `<button type="button" class="tool-toolbar-tab tool-toolbar-tab-action is-fixed" aria-label="${escapeHtml(action.title)}" title="${escapeHtml(action.title)}"${disabledAttr} ${attrs}>
    <span class="tool-toolbar-tab-action-icon">${icon}</span>
  </button>`;
}

function attrsToHtml(attrs?: Record<string, string>): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .map(([key, value]) => `${escapeHtml(key)}="${escapeHtml(value)}"`)
    .join(" ");
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
