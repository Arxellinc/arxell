import type { PrimaryPanelBindings, PrimaryPanelRenderState } from "./types";
import { iconHtml } from "../icons";
import { escapeHtml } from "./utils";

export function renderLlamaCppActions(): string {
  return `
    <div class="llama-actions">
      <button type="button" class="topbar-icon-btn" id="llamaRefreshBtn" aria-label="Refresh llama runtime" data-title="Refresh Runtime" title="Refresh Runtime">↻</button>
      <button type="button" class="topbar-icon-btn" id="llamaInstallBtn" aria-label="Install selected engine" data-title="Install Engine" title="Install Engine">⇣</button>
      <button type="button" class="topbar-icon-btn" id="llamaStartBtn" aria-label="Start runtime" data-title="Start Server" title="Start Server">▶</button>
      <button type="button" class="topbar-icon-btn" id="llamaStopBtn" aria-label="Stop runtime" data-title="Stop Server" title="Stop Server">■</button>
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
  const detectGpuEngine = () => {
    if (!runtime) return { label: "None detected", meta: "CPU only" };
    const activeGpu = runtime.engines.find(
      (engine) => engine.engineId === runtime.activeEngineId && engine.backend !== "cpu"
    );
    if (activeGpu) {
      return { label: activeGpu.label, meta: "Running" };
    }
    const hasConcreteSignal = (engine: (typeof runtime.engines)[number]) =>
      engine.isReady || engine.isInstalled || engine.prerequisites.some((item) => item.ok);
    const gpuEngines = runtime.engines.filter((engine) => {
      if (engine.backend === "cpu") return false;
      if (!engine.isApplicable) return false;
      return hasConcreteSignal(engine);
    });
    const preferred =
      gpuEngines.find((engine) => engine.backend === "vulkan") ??
      gpuEngines.find((engine) => engine.backend === "rocm") ??
      gpuEngines.find((engine) => engine.backend === "cuda") ??
      gpuEngines.find((engine) => engine.backend === "metal") ??
      gpuEngines[0];
    if (!preferred) {
      const applicableGpu = runtime.engines.find(
        (engine) => engine.backend !== "cpu" && engine.isApplicable
      );
      if (applicableGpu) {
        return { label: "GPU available", meta: "Probe unavailable" };
      }
      return { label: "None detected", meta: "CPU only" };
    }
    if (preferred.isReady) {
      return { label: preferred.label, meta: "Ready" };
    }
    return {
      label: preferred.label,
      meta: preferred.isInstalled ? "Installed" : "Available"
    };
  };
  const detectedGpu = detectGpuEngine();
  const engineOptions = runtime?.engines.length
    ? runtime.engines
        .map((engine) => {
          const selectedAttr =
            engine.engineId === state.llamaRuntimeSelectedEngineId ? " selected" : "";
          return `<option value="${escapeHtml(engine.engineId)}"${selectedAttr}>${escapeHtml(engine.label)}</option>`;
        })
        .join("")
    : `<option value="${escapeHtml(state.llamaRuntimeSelectedEngineId)}">${escapeHtml(state.llamaRuntimeSelectedEngineId)}</option>`;

  const runtimeConsoleHtml = state.llamaRuntimeLogs.length
    ? state.llamaRuntimeLogs
        .map((line) => `<div class="llama-runtime-line">${escapeHtml(line)}</div>`)
        .join("")
    : `<div class="llama-runtime-line is-empty">No runtime output yet.</div>`;

  return `
    <div class="primary-pane-body">
      <div class="llama-status-table">
        <div class="llama-status-inline">
          <div class="llama-status-item">
            <span class="llama-status-label">State:</span>
            <span class="llama-status-value">${escapeHtml(runtime?.state ?? "unknown")}</span>
          </div>
          <div class="llama-status-item">
            <span class="llama-status-label">Engine:</span>
            <span class="llama-status-value">${escapeHtml(runtime?.activeEngineId ?? "none")}</span>
          </div>
          <div class="llama-status-item">
            <span class="llama-status-label">Endpoint:</span>
            <span class="llama-status-value">${escapeHtml(runtime?.endpoint ?? "offline")}</span>
          </div>
        </div>
      </div>

      <div class="llama-form">
        <br />
        <h3>Settings</h3>
        <div class="config-row">
          <span class="config-key">GPU Acceleration</span>
          <span class="config-value">${escapeHtml(detectedGpu.label)}</span>
          <span class="config-meta">${escapeHtml(detectedGpu.meta)}</span>
        </div>
        <label class="config-row">
          <span class="config-key">Engine</span>
          <select id="llamaEngineSelect" class="llama-input">${engineOptions}</select>
          <span class="config-meta">${escapeHtml(selected?.backend ?? "unknown")}</span>
        </label>
        <div class="config-row">
          <span class="config-key">Model Path</span>
          <div class="llama-input-with-action">
            <input
              id="llamaModelPathInput"
              class="llama-input"
              value="${escapeHtml(state.llamaRuntimeModelPath)}"
              aria-label="Model Path"
            />
            <button
              type="button"
              class="llama-input-action"
              id="llamaModelPathBrowseBtn"
              aria-label="Browse model path"
              title="Browse model path"
            >
              ${iconHtml("folder", { size: 16, tone: "dark" })}<span>Browse</span>
            </button>
          </div>
          <span class="config-meta">GGUF</span>
        </div>
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
        <label class="config-row">
          <span class="config-key">Max Tokens</span>
          <input
            id="llamaMaxTokensInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeMaxTokens ?? ""}"
            min="128"
            max="4096"
            placeholder="Unlimited"
          />
          <span class="config-meta">blank = unlimited</span>
        </label>
      </div>

      <div class="llama-bottom-actions">
        <button type="button" class="tool-action-btn" id="llamaClearLogsBtn" title="Clear runtime logs">
          Clear Logs
        </button>
        <button type="button" class="tool-action-btn is-primary" id="llamaStartBottomBtn" title="Start local llama.cpp server">
          Start Server
        </button>
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

      <div class="llama-runtime-console" id="llamaLogs">${runtimeConsoleHtml}</div>
    </div>
  `;
}

export function bindLlamaCppPanel(bindings: PrimaryPanelBindings): void {
  const readRuntimeStartInput = () => {
    const engineId =
      document.querySelector<HTMLSelectElement>("#llamaEngineSelect")?.value || "llama.cpp-cpu";
    const modelPath =
      document.querySelector<HTMLInputElement>("#llamaModelPathInput")?.value.trim() || "";
    const port = Number.parseInt(
      document.querySelector<HTMLInputElement>("#llamaPortInput")?.value || "1420",
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
    return {
      engineId,
      modelPath,
      port,
      ctxSize,
      nGpuLayers
    };
  };

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

  const browseBtn = document.querySelector<HTMLButtonElement>("#llamaModelPathBrowseBtn");
  if (browseBtn) {
    browseBtn.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await bindings.onLlamaRuntimeBrowseModelPath();
    };
  }

  const startBtn = document.querySelector<HTMLButtonElement>("#llamaStartBtn");
  if (startBtn) {
    startBtn.onclick = async () => {
      await bindings.onLlamaRuntimeStart(readRuntimeStartInput());
    };
  }

  const startBottomBtn = document.querySelector<HTMLButtonElement>("#llamaStartBottomBtn");
  if (startBottomBtn) {
    startBottomBtn.onclick = async () => {
      await bindings.onLlamaRuntimeStart(readRuntimeStartInput());
    };
  }

  const clearLogsBtn = document.querySelector<HTMLButtonElement>("#llamaClearLogsBtn");
  if (clearLogsBtn) {
    clearLogsBtn.onclick = async () => {
      await bindings.onLlamaRuntimeClearLogs();
    };
  }

  const maxTokensInput = document.querySelector<HTMLInputElement>("#llamaMaxTokensInput");
  if (maxTokensInput) {
    const applyMaxTokens = async () => {
      const raw = maxTokensInput.value.trim();
      if (!raw) {
        await bindings.onLlamaRuntimeSetMaxTokens(null);
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed)) return;
      await bindings.onLlamaRuntimeSetMaxTokens(parsed);
    };
    maxTokensInput.onchange = async () => {
      await applyMaxTokens();
    };
    maxTokensInput.onblur = async () => {
      await applyMaxTokens();
    };
  }

  const stopBtn = document.querySelector<HTMLButtonElement>("#llamaStopBtn");
  if (stopBtn) {
    stopBtn.onclick = async () => {
      await bindings.onLlamaRuntimeStop();
    };
  }
}
