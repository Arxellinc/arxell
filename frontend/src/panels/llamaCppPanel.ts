import type { PrimaryPanelBindings, PrimaryPanelRenderState } from "./types";
import { iconHtml } from "../icons";
import { escapeHtml } from "./utils";

function modelNameFromPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? trimmed;
}

export function renderLlamaCppActions(state: PrimaryPanelRenderState): string {
  const runtime = state.llamaRuntime;
  const selected =
    runtime?.engines.find((engine) => engine.engineId === state.llamaRuntimeSelectedEngineId) ??
    runtime?.engines[0] ??
    null;
  const engineOptions = runtime?.engines.length
    ? runtime.engines
        .map((engine) => {
          const selectedAttr =
            engine.engineId === state.llamaRuntimeSelectedEngineId ? " selected" : "";
          return `<option value="${escapeHtml(engine.engineId)}"${selectedAttr}>${escapeHtml(engine.label)}</option>`;
        })
        .join("")
    : `<option value="${escapeHtml(state.llamaRuntimeSelectedEngineId)}">${escapeHtml(state.llamaRuntimeSelectedEngineId)}</option>`;
  const engineStatusClass = selected?.isReady ? " is-ready" : "";
  const engineStatusLabel = selected?.isReady ? "Ready" : selected?.isInstalled ? "Installed" : "Not installed";
  const isBusy = state.llamaRuntimeBusy;
  const runtimeState = (runtime?.state || "").toLowerCase();
  const isRunning = runtimeState === "healthy" && Boolean(runtime?.pid);
  const isStarting = runtimeState === "starting";
  const hasModelPath = Boolean(state.llamaRuntimeModelPath.trim());
  const canInstall = !isBusy && Boolean(selected) && !selected.isInstalled;
  const canStart = !isBusy && !isRunning && !isStarting && Boolean(selected?.isReady) && hasModelPath;
  const canStop = !isBusy && (isRunning || isStarting);
  const refreshDisabledAttr = isBusy ? " disabled" : "";
  const installDisabledAttr = canInstall ? "" : " disabled";
  const startDisabledAttr = canStart ? "" : " disabled";
  const stopDisabledAttr = canStop ? "" : " disabled";
  const engineSelectDisabledAttr = isBusy ? " disabled" : "";
  return `
    <div class="llama-actions">
      <div class="llama-actions-engine">
        <select id="llamaEngineSelect" class="llama-input" aria-label="Engine"${engineSelectDisabledAttr}>
          ${engineOptions}
        </select>
        <span class="llama-engine-status${engineStatusClass}" title="${escapeHtml(engineStatusLabel)}" aria-label="${escapeHtml(engineStatusLabel)}">${selected?.isReady ? "✓" : "•"}</span>
      </div>
      <button type="button" class="topbar-icon-btn" id="llamaRefreshBtn" aria-label="Refresh llama runtime" data-title="Refresh Runtime" title="Refresh Runtime"${refreshDisabledAttr}>↻</button>
      <button type="button" class="topbar-icon-btn" id="llamaInstallBtn" aria-label="Install selected engine" data-title="Install Engine" title="Install Engine"${installDisabledAttr}>⇣</button>
      <button type="button" class="topbar-icon-btn" id="llamaStartBtn" aria-label="Start runtime" data-title="Start Server" title="Start Server"${startDisabledAttr}>▶</button>
      <button type="button" class="topbar-icon-btn" id="llamaStopBtn" aria-label="Stop runtime" data-title="Stop Server" title="Stop Server"${stopDisabledAttr}>■</button>
    </div>
  `;
}

export function renderLlamaCppBody(state: PrimaryPanelRenderState): string {
  const runtime = state.llamaRuntime;
  const activeModelPath = (state.llamaRuntimeActiveModelPath || "").trim();
  const hasActiveRuntime =
    runtime?.state === "healthy" && Boolean(runtime?.activeEngineId) && Boolean(runtime?.pid);
  const activeModelName = hasActiveRuntime ? modelNameFromPath(activeModelPath) : "";
  const currentModelPath = state.llamaRuntimeModelPath.trim();
  const installedModelOptions = state.modelManagerInstalled
    .map((model) => {
      const selected = model.path === currentModelPath ? " selected" : "";
      return `<option value="${escapeHtml(model.path)}"${selected}>${escapeHtml(model.name)}</option>`;
    })
    .join("");
  const hasCurrentInInstalled = state.modelManagerInstalled.some(
    (model) => model.path === currentModelPath
  );
  const customOption =
    currentModelPath && !hasCurrentInInstalled
      ? `<option value="${escapeHtml(currentModelPath)}" selected>${escapeHtml(modelNameFromPath(currentModelPath))} (custom)</option>`
      : "";
  const placeholderSelected = !currentModelPath ? " selected" : "";
  const modelPathOptions = `<option value="" disabled${placeholderSelected}>Select model...</option>${customOption}${installedModelOptions}`;
  const activeRows = activeModelName
    ? `
      <div class="model-manager-installed-row">
        <span class="model-manager-installed-model" title="${escapeHtml(activeModelName)}">${escapeHtml(activeModelName)}</span>
        <span class="model-manager-active-check" aria-label="Loaded" title="Loaded">✓</span>
        <span class="model-manager-active-endpoint">${escapeHtml(
          state.llamaRuntime?.endpoint ?? "offline"
        )}</span>
        <span class="model-manager-installed-actions">
          <button type="button" class="model-manager-row-icon-btn is-danger" title="Eject model and stop llama.cpp" aria-label="Eject model and stop llama.cpp" data-model-eject-active="true">⏏</button>
        </span>
      </div>
    `
    : `<div class="model-manager-installed-row is-empty"><span>No active model selected</span><span>-</span><span>-</span><span>-</span></div>`;
  const selected =
    runtime?.engines.find((e) => e.engineId === state.llamaRuntimeSelectedEngineId) ??
    runtime?.engines[0] ??
    null;
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
  const runtimeConsoleHtml = state.llamaRuntimeLogs.length
    ? state.llamaRuntimeLogs
        .map((line) => `<div class="llama-runtime-line">${escapeHtml(line)}</div>`)
        .join("")
    : `<div class="llama-runtime-line is-empty">No runtime output yet.</div>`;

  const loadingMessage = state.llamaRuntimeBusy
    ? (state.chat?.chatModelStatusMessage?.trim() || "Loading model...")
    : null;

  return `
    <div class="primary-pane-body">
      ${loadingMessage ? `<div class="llama-loading-banner"><span class="llama-loading-text">${escapeHtml(loadingMessage)}</span></div>` : ""}
      <div class="llama-form llama-panel-form">
        <h3 class="model-manager-title">Active Models</h3>
        <div class="model-manager-installed-table is-active">
          <div class="model-manager-installed-header">
            <span>Model</span>
            <span>State</span>
            <span>Endpoint</span>
            <span>Action</span>
          </div>
          ${activeRows}
        </div>
      </div>

      <div class="llama-form llama-settings-form llama-panel-form">
        <h3>Settings</h3>
        <div class="llama-settings-actions">
          <button type="button" class="tool-action-btn" id="llamaClearLogsBtn" title="Clear runtime logs">
            Clear Logs
          </button>
          <button type="button" class="tool-action-btn is-primary" id="llamaStartBottomBtn" title="Start local llama.cpp server">
            Start Server
          </button>
        </div>
        <div class="config-row">
          <span class="config-key">Model Path</span>
          <select
            id="llamaModelPathSelect"
            class="llama-input"
            aria-label="Model Path"
          >
            ${modelPathOptions}
          </select>
          <span class="config-meta">
            <button
              type="button"
              class="llama-input-action llama-input-action-icon-only"
              id="llamaModelPathBrowseBtn"
              aria-label="Browse model path"
              title="Browse model path"
            >
              ${iconHtml("folder", { size: 16, tone: "dark" })}
            </button>
          </span>
        </div>
        <div class="config-row">
          <span class="config-key">GPU Acceleration</span>
          <span class="config-value">${escapeHtml(detectedGpu.label)}</span>
          <span class="config-meta">${escapeHtml(detectedGpu.meta)}</span>
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
          <span class="config-key">Threads</span>
          <input
            id="llamaThreadsInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeThreads ?? ""}"
            min="1"
            max="256"
            placeholder="auto"
          />
          <span class="config-meta">auto if blank</span>
        </label>
        <label class="config-row">
          <span class="config-key">Batch Size</span>
          <input
            id="llamaBatchSizeInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeBatchSize ?? ""}"
            min="1"
            max="65536"
          />
          <span class="config-meta">tokens</span>
        </label>
        <label class="config-row">
          <span class="config-key">Ubatch Size</span>
          <input
            id="llamaUbatchSizeInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeUbatchSize ?? ""}"
            min="1"
            max="65536"
          />
          <span class="config-meta">tokens</span>
        </label>
        <label class="config-row">
          <span class="config-key">Temperature</span>
          <input
            id="llamaTemperatureInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeTemperature}"
            min="0"
            max="2"
            step="0.01"
          />
          <span class="config-meta">sampling</span>
        </label>
        <label class="config-row">
          <span class="config-key">Top P</span>
          <input
            id="llamaTopPInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeTopP}"
            min="0"
            max="1"
            step="0.01"
          />
          <span class="config-meta">sampling</span>
        </label>
        <label class="config-row">
          <span class="config-key">Top K</span>
          <input
            id="llamaTopKInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeTopK}"
            min="0"
            max="500"
          />
          <span class="config-meta">sampling</span>
        </label>
        <label class="config-row">
          <span class="config-key">Repeat Penalty</span>
          <input
            id="llamaRepeatPenaltyInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeRepeatPenalty}"
            min="0.8"
            max="2"
            step="0.01"
          />
          <span class="config-meta">sampling</span>
        </label>
        <label class="config-row">
          <span class="config-key">Seed</span>
          <input
            id="llamaSeedInput"
            class="llama-input"
            type="number"
            value="${state.llamaRuntimeSeed ?? ""}"
            min="0"
            max="4294967295"
            placeholder="random"
          />
          <span class="config-meta">random if blank</span>
        </label>
        <label class="config-row">
          <span class="config-key">Flash Attention</span>
          <span class="llama-checkbox-inline">
            <input id="llamaFlashAttnInput" type="checkbox" ${
              state.llamaRuntimeFlashAttn ? "checked" : ""
            } />
            <span>Enabled</span>
          </span>
          <span class="config-meta">--flash-attn</span>
        </label>
        <label class="config-row">
          <span class="config-key">mmap</span>
          <span class="llama-checkbox-inline">
            <input id="llamaMmapInput" type="checkbox" ${
              state.llamaRuntimeMmap ? "checked" : ""
            } />
            <span>Enabled</span>
          </span>
          <span class="config-meta">disable uses --no-mmap</span>
        </label>
        <label class="config-row">
          <span class="config-key">mlock</span>
          <span class="llama-checkbox-inline">
            <input id="llamaMlockInput" type="checkbox" ${
              state.llamaRuntimeMlock ? "checked" : ""
            } />
            <span>Enabled</span>
          </span>
          <span class="config-meta">--mlock</span>
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

      <div class="config-key">Console</div>
      <div class="llama-runtime-console" id="llamaLogs">${runtimeConsoleHtml}</div>
    </div>
  `;
}

export function bindLlamaCppPanel(bindings: PrimaryPanelBindings): void {
  const readRuntimeStartInput = () => {
    const engineId =
      document.querySelector<HTMLSelectElement>("#llamaEngineSelect")?.value || "llama.cpp-cpu";
    const modelPath =
      document.querySelector<HTMLSelectElement>("#llamaModelPathSelect")?.value.trim() || "";
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
    const threadsRaw =
      document.querySelector<HTMLInputElement>("#llamaThreadsInput")?.value.trim() ?? "";
    const threadsParsed = threadsRaw ? Number.parseInt(threadsRaw, 10) : Number.NaN;
    const batchRaw =
      document.querySelector<HTMLInputElement>("#llamaBatchSizeInput")?.value.trim() ?? "";
    const batchParsed = batchRaw ? Number.parseInt(batchRaw, 10) : Number.NaN;
    const ubatchRaw =
      document.querySelector<HTMLInputElement>("#llamaUbatchSizeInput")?.value.trim() ?? "";
    const ubatchParsed = ubatchRaw ? Number.parseInt(ubatchRaw, 10) : Number.NaN;
    const temperature = Number.parseFloat(
      document.querySelector<HTMLInputElement>("#llamaTemperatureInput")?.value || "0.7"
    );
    const topP = Number.parseFloat(
      document.querySelector<HTMLInputElement>("#llamaTopPInput")?.value || "0.95"
    );
    const topK = Number.parseInt(
      document.querySelector<HTMLInputElement>("#llamaTopKInput")?.value || "40",
      10
    );
    const repeatPenalty = Number.parseFloat(
      document.querySelector<HTMLInputElement>("#llamaRepeatPenaltyInput")?.value || "1.1"
    );
    const seedRaw = document.querySelector<HTMLInputElement>("#llamaSeedInput")?.value.trim() ?? "";
    const seedParsed = seedRaw ? Number.parseInt(seedRaw, 10) : Number.NaN;
    const flashAttn =
      document.querySelector<HTMLInputElement>("#llamaFlashAttnInput")?.checked ?? true;
    const mmap = document.querySelector<HTMLInputElement>("#llamaMmapInput")?.checked ?? true;
    const mlock =
      document.querySelector<HTMLInputElement>("#llamaMlockInput")?.checked ?? false;
    return {
      engineId,
      modelPath,
      port,
      ctxSize,
      nGpuLayers,
      threads: Number.isFinite(threadsParsed) ? threadsParsed : null,
      batchSize: Number.isFinite(batchParsed) ? batchParsed : null,
      ubatchSize: Number.isFinite(ubatchParsed) ? ubatchParsed : null,
      temperature: Number.isFinite(temperature) ? temperature : 0.7,
      topP: Number.isFinite(topP) ? topP : 0.95,
      topK: Number.isFinite(topK) ? topK : 40,
      repeatPenalty: Number.isFinite(repeatPenalty) ? repeatPenalty : 1.1,
      flashAttn,
      mmap,
      mlock,
      seed: Number.isFinite(seedParsed) ? seedParsed : null
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

  const modelPathSelect = document.querySelector<HTMLSelectElement>("#llamaModelPathSelect");
  if (modelPathSelect) {
    modelPathSelect.onchange = async () => {
      const modelPath = modelPathSelect.value.trim();
      if (!modelPath) return;
      await bindings.onModelManagerUseAsLlamaPath(modelPath);
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

  const ejectBtns = document.querySelectorAll<HTMLButtonElement>("[data-model-eject-active]");
  ejectBtns.forEach((btn) => {
    btn.onclick = async () => {
      await bindings.onModelManagerEjectActive();
    };
  });
}
