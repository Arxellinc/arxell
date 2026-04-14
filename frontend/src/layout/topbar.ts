import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";

export type DisplayMode = "dark" | "light" | "terminal";
export type LayoutOrientation = "landscape" | "portrait";

export function renderGlobalTopbar(
  displayMode: DisplayMode,
  layoutOrientation: LayoutOrientation,
  appVersion: string,
  runtimeMode: "tauri" | "mock" | "unknown"
): string {
  const orientationLabel =
    layoutOrientation === "portrait" ? "Switch to landscape layout" : "Switch to portrait layout";
  const nextDisplayMode: DisplayMode =
    displayMode === "terminal" ? "dark" : displayMode === "dark" ? "light" : "terminal";
  const displayModeLabel = `Switch to ${nextDisplayMode} mode`;
  const displayModeIcon =
    nextDisplayMode === "terminal"
      ? APP_ICON.sidebar.terminal
      : nextDisplayMode === "dark"
        ? APP_ICON.action.displayModeDark
        : APP_ICON.action.displayModeLight;
  const showWindowControls = runtimeMode === "tauri";
  return `
    <header class="global-topbar">
      <div class="topbar-drag-region" data-tauri-drag-region>
        <div class="runtime-title">${iconHtml(APP_ICON.brand, { size: 16, tone: "dark" })}<span>Arxell Lite ${appVersion}</span></div>
      </div>
      <div class="topbar-right">
        <button type="button" class="topbar-icon-btn display-mode-btn" id="displayModeToggle" data-title="${displayModeLabel}" title="${displayModeLabel}" aria-label="${displayModeLabel}">
          ${iconHtml(displayModeIcon, { size: 16, tone: "dark" })}
        </button>
        <button type="button" class="topbar-icon-btn" id="layoutOrientationToggle" data-title="${orientationLabel}" title="${orientationLabel}" aria-label="${orientationLabel}">
          ${iconHtml(APP_ICON.action.layoutOrientation, { size: 16, tone: "dark" })}
        </button>
        ${
          showWindowControls
            ? `
          <div class="window-controls" aria-label="Window controls">
            <button type="button" class="window-control-btn" id="windowMinimizeBtn" title="Minimize" aria-label="Minimize">
              ${iconHtml("minus", { size: 16, tone: "dark" })}
            </button>
            <button type="button" class="window-control-btn" id="windowMaximizeBtn" title="Maximize or restore" aria-label="Maximize or restore">
              ${iconHtml("square", { size: 16, tone: "dark", className: "window-maximize-icon" })}
            </button>
            <button type="button" class="window-control-btn window-control-btn-close" id="windowCloseBtn" title="Close" aria-label="Close">
              ${iconHtml("x", { size: 16, tone: "dark" })}
            </button>
          </div>
        `
            : ""
        }
      </div>
    </header>
  `;
}
