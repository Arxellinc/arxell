export interface GlobalBottomStatus {
  appResourceCpuText?: string | null;
  appResourceMemoryText?: string | null;
  appResourceNetworkText?: string | null;
  engine?: string | null;
  model?: string | null;
  contextText?: string | null;
  speedText?: string | null;
  ttsLatencyText?: string | null;
}

export const BOTTOMBAR_RESOURCE_IDS = {
  container: "bottombarResourceInline",
  cpu: "bottombarResourceCpu",
  memory: "bottombarResourceMemory",
  network: "bottombarResourceNetwork"
} as const;

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderGlobalBottombar(status: GlobalBottomStatus): string {
  const appResourceCpuText = status.appResourceCpuText?.trim() ?? "";
  const appResourceMemoryText = status.appResourceMemoryText?.trim() ?? "";
  const appResourceNetworkText = status.appResourceNetworkText?.trim() ?? "";
  const engineText = status.engine?.trim() ?? "";
  const modelText = status.model?.trim() ?? "";
  const contextText = status.contextText?.trim() ?? "";
  const speedText = status.speedText?.trim() ?? "";
  const ttsLatencyText = status.ttsLatencyText?.trim() ?? "";
  const resourceCpuHidden = appResourceCpuText ? "" : " hidden";
  const resourceMemoryHidden = appResourceMemoryText ? "" : " hidden";
  const resourceNetworkHidden = appResourceNetworkText ? "" : " hidden";
  const resourceContainerHidden =
    appResourceCpuText || appResourceMemoryText || appResourceNetworkText ? "" : " hidden";
  const runtimeItems: string[] = [];
  if (engineText) runtimeItems.push(`<span class="runtime-item"><span class="runtime-label">$ Engine:</span> <span class="runtime-value">${escapeText(engineText)}</span></span>`);
  if (modelText) runtimeItems.push(`<span class="runtime-item"><span class="runtime-label"># </span> <span class="runtime-value">${escapeText(modelText)}</span></span>`);
  if (contextText) runtimeItems.push(`<span class="runtime-item"><span class="runtime-label">◍ Context:</span> <span class="runtime-value">${escapeText(contextText)}</span></span>`);
  if (speedText) runtimeItems.push(`<span class="runtime-item"><span class="runtime-label">⇄ Speed:</span> <span class="runtime-value">${escapeText(speedText)}</span></span>`);
  if (ttsLatencyText) runtimeItems.push(`<span class="runtime-item"><span class="runtime-label">♫ TTS Latency:</span> <span class="runtime-value">${escapeText(ttsLatencyText)}</span></span>`);
  const resourceInlineHtml = `<div class="resource-inline" id="${BOTTOMBAR_RESOURCE_IDS.container}" aria-live="polite"${resourceContainerHidden}>
    <span class="resource-item" id="${BOTTOMBAR_RESOURCE_IDS.cpu}"${resourceCpuHidden}>${escapeText(appResourceCpuText)}</span>
    <span class="resource-item" id="${BOTTOMBAR_RESOURCE_IDS.memory}"${resourceMemoryHidden}>${escapeText(appResourceMemoryText)}</span>
    <span class="resource-item" id="${BOTTOMBAR_RESOURCE_IDS.network}"${resourceNetworkHidden}>${escapeText(appResourceNetworkText)}</span>
  </div>`;
  const runtimeInlineHtml = runtimeItems.length
    ? `<div class="runtime-inline">${runtimeItems.join("")}</div>`
    : "";
  return `
    <footer class="global-bottombar" aria-label="Global status bar">
      ${resourceInlineHtml}
      ${runtimeInlineHtml}
    </footer>
  `;
}
