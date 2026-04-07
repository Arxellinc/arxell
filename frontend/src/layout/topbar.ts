import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";

export type DisplayMode = "dark" | "light" | "terminal";
export type LayoutOrientation = "landscape" | "portrait";

export function renderGlobalTopbar(
  displayMode: DisplayMode,
  layoutOrientation: LayoutOrientation,
  appVersion: string
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
  return `
    <header class="global-topbar">
      <div class="runtime-title">${iconHtml(APP_ICON.brand, { size: 16, tone: "dark" })}<span>Arxell Lite ${appVersion}</span></div>
      <div class="topbar-right">
        <button type="button" class="topbar-icon-btn display-mode-btn" id="displayModeToggle" data-title="${displayModeLabel}" title="${displayModeLabel}" aria-label="${displayModeLabel}">
          ${iconHtml(displayModeIcon, { size: 16, tone: "dark" })}
        </button>
        <button type="button" class="topbar-icon-btn" id="layoutOrientationToggle" data-title="${orientationLabel}" title="${orientationLabel}" aria-label="${orientationLabel}">
          ${iconHtml(APP_ICON.action.layoutOrientation, { size: 16, tone: "dark" })}
        </button>
      </div>
    </header>
  `;
}
