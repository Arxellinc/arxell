import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";

export function renderGlobalBottombar(runtimeMode: "tauri" | "mock" | "unknown"): string {
  return `
    <footer class="global-bottombar" aria-label="Global status bar">
      <div class="runtime-inline">runtime: ${runtimeMode}</div>
      <div class="bottombar-icons">
        <button type="button" class="bottom-icon-btn" aria-label="History quick action">
          ${iconHtml(APP_ICON.bottom.history, { size: 16, tone: "dark" })}
        </button>
        <button type="button" class="bottom-icon-btn" aria-label="Terminal quick action">
          ${iconHtml(APP_ICON.bottom.terminal, { size: 16, tone: "dark" })}
        </button>
        <button type="button" class="bottom-icon-btn" aria-label="Tools quick action">
          ${iconHtml(APP_ICON.bottom.tools, { size: 16, tone: "dark" })}
        </button>
      </div>
    </footer>
  `;
}
