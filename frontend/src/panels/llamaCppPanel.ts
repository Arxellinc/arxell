import type { PrimaryPanelBindings, PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

export function renderLlamaCppActions(): string {
  return `
    <div class="llama-actions">
      <button type="button" class="topbar-icon-btn" id="llamaRefreshBtn" aria-label="Refresh llama runtime">↻</button>
      <button type="button" class="topbar-icon-btn" id="llamaInstallBtn" aria-label="Install selected engine">⇣</button>
      <button type="button" class="topbar-icon-btn" id="llamaStartBtn" aria-label="Start runtime">▶</button>
      <button type="button" class="topbar-icon-btn" id="llamaStopBtn" aria-label="Stop runtime">■</button>
    </div>
  `;
}

export function renderLlamaCppBody(state: PrimaryPanelRenderState): string {
  const runtime = state.llamaRuntime;
  const selected =
    runtime?.engines.find((e) => e.engineId === state.llamaRuntimeSelectedEngineId) ??
    runtime?.engines[0] ??
    null;
  const readyMeta = selected
    ? selected.isReady
      ? "Ready"
      : selected.isInstalled
        ? "Installed"
        : "Not installed"
    : "Unknown";
  const prerequisites = selected?.prerequisites ?? [];
  const engineOptions = runtime?.engines.length
    ? runtime.engines
        .map((engine) => {
          const selectedAttr =
            engine.engineId === state.llamaRuntimeSelectedEngineId ? " selected" : "";
          return `<option value="${escapeHtml(engine.engineId)}"${selectedAttr}>${escapeHtml(engine.label)}</option>`;
        })
        .join("")
    : `<option value="${escapeHtml(state.llamaRuntimeSelectedEngineId)}">${escapeHtml(state.llamaRuntimeSelectedEngineId)}</option>`;

  const logHtml = state.llamaRuntimeLogs.length
    ? state.llamaRuntimeLogs
        .map((line) => `<div class="llama-log-line">${escapeHtml(line)}</div>`)
        .join("")
    : `<div class="llama-log-line is-empty">No runtime logs yet.</div>`;

  return `
    <div class="primary-pane-body">
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">State</span>
          <span class="config-value">${escapeHtml(runtime?.state ?? "unknown")}</span>
          <span class="config-meta">${escapeHtml(state.llamaRuntimeBusy ? "Working" : "Idle")}</span>
        </div>
        <div class="config-row">
          <span class="config-key">Active Engine</span>
          <span class="config-value">${escapeHtml(runtime?.activeEngineId ?? "none")}</span>
          <span class="config-meta">${escapeHtml(readyMeta)}</span>
        </div>
        <div class="config-row">
          <span class="config-key">Endpoint</span>
          <span class="config-value">${escapeHtml(runtime?.endpoint ?? "offline")}</span>
          <span class="config-meta">${escapeHtml(runtime?.pid ? `PID ${runtime.pid}` : "No process")}</span>
        </div>
      </div>

      <div class="llama-form">
        <label class="config-row">
          <span class="config-key">Engine</span>
          <select id="llamaEngineSelect" class="llama-input">${engineOptions}</select>
          <span class="config-meta">${escapeHtml(selected?.backend ?? "unknown")}</span>
        </label>
        <label class="config-row">
          <span class="config-key">Model Path</span>
          <input id="llamaModelPathInput" class="llama-input" value="${escapeHtml(state.llamaRuntimeModelPath)}" />
          <span class="config-meta">GGUF</span>
        </label>
        <label class="config-row">
          <span class="config-key">Port</span>
          <input id="llamaPortInput" class="llama-input" type="number" value="${state.llamaRuntimePort}" min="1" max="65535" />
          <span class="config-meta">127.0.0.1</span>
        </label>
        <label class="config-row">
          <span class="config-key">Context</span>
          <input id="llamaCtxInput" class="llama-input" type="number" value="${state.llamaRuntimeCtxSize}" min="128" max="262144" />
          <span class="config-meta">tokens</span>
        </label>
        <label class="config-row">
          <span class="config-key">GPU Layers</span>
          <input id="llamaGpuLayersInput" class="llama-input" type="number" value="${state.llamaRuntimeGpuLayers}" min="-1" max="999" />
          <span class="config-meta">-1/999 = auto</span>
        </label>
      </div>

      <div class="llama-prereqs">
        <div class="config-key">Prerequisites</div>
        ${
          prerequisites.length
            ? prerequisites
                .map(
                  (item) => `
              <div class="config-row">
                <span class="config-key">${escapeHtml(item.key)}</span>
                <span class="config-value">${escapeHtml(item.message)}</span>
                <span class="config-meta">${escapeHtml(item.ok ? "OK" : "Missing")}</span>
              </div>
            `
                )
                .join("")
            : `<div class="config-row"><span class="config-key">none</span><span class="config-value">No extra prerequisites required.</span><span class="config-meta">OK</span></div>`
        }
      </div>

      <div class="llama-logs" id="llamaLogs">${logHtml}</div>
    </div>
  `;
}

export function bindLlamaCppPanel(bindings: PrimaryPanelBindings): void {
  const refreshBtn = document.querySelector<HTMLButtonElement>("#llamaRefreshBtn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      await bindings.onLlamaRuntimeRefresh();
    };
  }

  const installBtn = document.querySelector<HTMLButtonElement>("#llamaInstallBtn");
  if (installBtn) {
    installBtn.onclick = async () => {
      const engineId =
        document.querySelector<HTMLSelectElement>("#llamaEngineSelect")?.value || "llama.cpp-cpu";
      await bindings.onLlamaRuntimeInstall(engineId);
    };
  }

  const startBtn = document.querySelector<HTMLButtonElement>("#llamaStartBtn");
  if (startBtn) {
    startBtn.onclick = async () => {
      const engineId =
        document.querySelector<HTMLSelectElement>("#llamaEngineSelect")?.value || "llama.cpp-cpu";
      const modelPath =
        document.querySelector<HTMLInputElement>("#llamaModelPathInput")?.value.trim() || "";
      const port = Number.parseInt(
        document.querySelector<HTMLInputElement>("#llamaPortInput")?.value || "8080",
        10
      );
      const ctxSize = Number.parseInt(
        document.querySelector<HTMLInputElement>("#llamaCtxInput")?.value || "8192",
        10
      );
      const nGpuLayers = Number.parseInt(
        document.querySelector<HTMLInputElement>("#llamaGpuLayersInput")?.value || "999",
        10
      );
      await bindings.onLlamaRuntimeStart({
        engineId,
        modelPath,
        port,
        ctxSize,
        nGpuLayers
      });
    };
  }

  const stopBtn = document.querySelector<HTMLButtonElement>("#llamaStopBtn");
  if (stopBtn) {
    stopBtn.onclick = async () => {
      await bindings.onLlamaRuntimeStop();
    };
  }
}
