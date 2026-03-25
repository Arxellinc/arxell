export interface GlobalBottomStatus {
  runtimeMode: "tauri" | "mock" | "unknown";
  engine: string;
  model: string;
  contextText: string;
  speedText: string;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderGlobalBottombar(status: GlobalBottomStatus): string {
  return `
    <footer class="global-bottombar" aria-label="Global status bar">
      <div class="runtime-inline">
        <span class="runtime-item runtime-item-runtime"><span class="runtime-label">◧ Runtime:</span><span class="runtime-value">${escapeText(status.runtimeMode)}</span></span>
        <span class="runtime-item runtime-item-engine"><span class="runtime-label">◆ Engine:</span><span class="runtime-value">${escapeText(status.engine)}</span></span>
        <span class="runtime-item runtime-item-model"><span class="runtime-label">◈ Model:</span><span class="runtime-value">${escapeText(status.model)}</span></span>
        <span class="runtime-item runtime-item-context"><span class="runtime-label">◍ Context:</span><span class="runtime-value">${escapeText(status.contextText)}</span></span>
        <span class="runtime-item runtime-item-speed"><span class="runtime-label">⇄ Speed:</span><span class="runtime-value">${escapeText(status.speedText)}</span></span>
      </div>
    </footer>
  `;
}
