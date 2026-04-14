import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { SidebarTab } from "../panels/types";
import { SIDEBAR_PRIMARY_PANELS } from "../panels/sidebarRegistry";

export function renderSidebarRail(
  tab: SidebarTab,
  llamaRuntimeOnline: boolean,
  sttRunning: boolean,
  ttsActive: boolean,
  hasVerifiedModelApi: boolean
): string {
  const panelButtons = SIDEBAR_PRIMARY_PANELS.map((panel) => {
        const isActive = tab === panel.tab ? "is-active" : "";
    const showStatusDot =
      (panel.statusSignal === "stt" && sttRunning) ||
      (panel.statusSignal === "llama" && llamaRuntimeOnline) ||
      (panel.statusSignal === "tts" && ttsActive) ||
      (panel.statusSignal === "apis" && hasVerifiedModelApi);
    return `<button type="button" class="sidebar-icon-btn ${isActive}" data-sidebar-tab="${panel.tab}" data-title="${panel.title}" title="${panel.title}" aria-label="${panel.title}">
          ${iconHtml(panel.icon, {
            size: 24,
            tone: "dark",
            label: panel.title,
            className: "sidebar-icon-glyph"
          })}
          ${showStatusDot ? '<span class="sidebar-status-dot" aria-hidden="true"></span>' : ""}
        </button>`;
  }).join("");

  const settingsActiveClass = tab === "settings" ? "is-active" : "";
  return `
    <aside class="left-sidebar" id="leftSidebar">
      <nav class="sidebar-nav" aria-label="Primary">
        ${panelButtons}
      </nav>
      <div class="sidebar-bottom">
        <button type="button" class="sidebar-icon-btn ${settingsActiveClass}" data-sidebar-tab="settings" data-title="Settings" title="Settings" aria-label="Settings">
          ${iconHtml(APP_ICON.sidebar.settings, {
            size: 24,
            tone: "dark",
            label: "Settings",
            className: "sidebar-icon-glyph"
          })}
        </button>
      </div>
    </aside>
  `;
}
