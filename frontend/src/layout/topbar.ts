import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";

export type DisplayMode = "dark" | "light";
export type LayoutOrientation = "landscape" | "portrait";

export function renderGlobalTopbar(
  displayMode: DisplayMode,
  layoutOrientation: LayoutOrientation
): string {
  const orientationLabel =
    layoutOrientation === "portrait" ? "Switch to landscape layout" : "Switch to portrait layout";
  return `
    <header class="global-topbar">
      <div class="runtime-title">${iconHtml(APP_ICON.brand, { size: 16, tone: "dark" })}<span>Arxell Lite 0.1.2</span></div>
      <div class="topbar-right">
        <button type="button" class="topbar-icon-btn display-mode-btn" id="displayModeToggle" aria-label="Toggle display mode">
          ${iconHtml(
            displayMode === "dark" ? APP_ICON.action.displayModeLight : APP_ICON.action.displayModeDark,
            { size: 16, tone: "dark" }
          )}
        </button>
        <button type="button" class="topbar-icon-btn" id="layoutOrientationToggle" data-title="${orientationLabel}" title="${orientationLabel}" aria-label="${orientationLabel}">
          ${iconHtml(APP_ICON.action.layoutOrientation, { size: 16, tone: "dark" })}
        </button>
      </div>
    </header>
  `;
}
