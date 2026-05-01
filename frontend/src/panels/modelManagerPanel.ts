import { escapeHtml } from "./utils";
import { iconHtml } from "../icons";
import type { PrimaryPanelBindings, PrimaryPanelRenderState } from "./types";

const MODEL_COLLECTIONS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All Collections" },
  { id: "unsloth_ud", label: "Unsloth UD Quants" },
  { id: "arxell", label: "Arxell" },
  { id: "qwen", label: "Qwen" },
  { id: "glm", label: "GLM" },
  { id: "ministral", label: "Ministral" }
];

const UNSLOTH_UD_COLLECTION_URL =
  "https://huggingface.co/collections/unsloth/unsloth-dynamic-20-quants";

export function renderModelManagerActions(state: PrimaryPanelRenderState): string {
  const activeTab = state.modelManagerActiveTab;
  const tabAllModelsClass = activeTab === "all_models" ? " is-active" : "";
  const tabDownloadClass = activeTab === "download" ? " is-active" : "";
  return `
    <div class="mm-tab-bar">
      <button type="button" class="mm-tab-btn${tabAllModelsClass}" data-mm-tab="all_models">All Available Models</button>
      <button type="button" class="mm-tab-btn${tabDownloadClass}" data-mm-tab="download">Download Models</button>
    </div>
    <button type="button" class="topbar-icon-btn" id="modelManagerRefreshBtn" aria-label="Refresh models" data-title="Refresh Models" title="Refresh Models">↻</button>
  `;
}

function formatModelSize(sizeMb: number): string {
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(2)} GB`;
  return `${sizeMb} MB`;
}

function capabilityIconsForModel(modelName: string): string {
  const lowered = modelName.toLowerCase();
  const caps: Array<{ icon: string; label: string }> = [{ icon: "✍", label: "Text Gen" }];
  if (
    lowered.includes("vision") ||
    lowered.includes("-vl") ||
    lowered.includes("llava") ||
    lowered.includes("minicpm-v") ||
    lowered.includes("glm-4.6v")
  ) {
    caps.push({ icon: "◉", label: "Vision" });
  }
  if (
    lowered.includes("thinking") ||
    lowered.includes("reasoning") ||
    lowered.includes("deepseek-r1") ||
    lowered.includes("qwq")
  ) {
    caps.push({ icon: "🧠", label: "Thinking" });
  }
  if (lowered.includes("coder") || lowered.includes("code")) {
    caps.push({ icon: "⌨", label: "Coding" });
  }
  if (
    lowered.includes("gpt-4o") ||
    lowered.includes("omni") ||
    lowered.includes("tool") ||
    lowered.includes("function") ||
    !lowered.includes("base")
  ) {
    caps.push({ icon: "🔧", label: "Tool Use" });
  }
  return caps
    .map(
      (cap) =>
        `<span class="model-manager-cap-icon" title="${escapeHtml(cap.label)}" aria-label="${escapeHtml(cap.label)}">${escapeHtml(cap.icon)}</span>`
    )
    .join("");
}

function allModelsCapabilityIcons(modelName: string): string {
  const lowered = modelName.toLowerCase();
  const icons: string[] = [];
  const hasVision =
    lowered.includes("vision") ||
    lowered.includes("-vl") ||
    lowered.includes("llava") ||
    lowered.includes("minicpm-v") ||
    lowered.includes("gpt-4o") ||
    lowered.includes("gemini") ||
    lowered.includes("claude-3") ||
    lowered.includes("claude-4") ||
    lowered.includes("omni");
  const hasThinking =
    lowered.includes("thinking") ||
    lowered.includes("reasoning") ||
    lowered.includes("deepseek-r1") ||
    lowered.includes("qwq") ||
    lowered.includes("o1") ||
    lowered.includes("o3") ||
    lowered.includes("o4");
  const hasCoding =
    lowered.includes("coder") || lowered.includes("code");
  const hasToolUse = true;
  if (hasThinking) icons.push(`<span class="mm-cap-icon is-thinking" title="Thinking / Reasoning">${iconHtml("brain", { size: 16, tone: "dark" })}</span>`);
  if (hasCoding) icons.push(`<span class="mm-cap-icon is-coding" title="Coding">${iconHtml("code", { size: 16, tone: "dark" })}</span>`);
  if (hasToolUse) icons.push(`<span class="mm-cap-icon" title="Tool Use">${iconHtml("wrench", { size: 16, tone: "dark" })}</span>`);
  if (hasVision) icons.push(`<span class="mm-cap-icon is-vision" title="Vision">${iconHtml("eye", { size: 16, tone: "dark" })}</span>`);
  return icons.join("");
}

function extractProviderFromLabel(label: string): string {
  const slashIdx = label.indexOf("/");
  if (slashIdx < 0) return "local";
  return label.slice(0, slashIdx);
}

function extractModelNameFromLabel(label: string): string {
  const slashIdx = label.indexOf("/");
  if (slashIdx < 0) return label;
  return label.slice(slashIdx + 1);
}

function estimateParameterCount(modelName: string): string {
  const lower = modelName.toLowerCase();
  const match = lower.match(/(\d+(?:\.\d+)?)\s*[xb]/);
  if (match && match[1]) {
    const num = parseFloat(match[1]);
    if (num >= 1) return num >= 100 ? `${(num / 1000).toFixed(1)}T` : `${num}B`;
  }
  const tMatch = lower.match(/(\d+(?:\.\d+)?)\s*t/);
  if (tMatch && tMatch[1]) return `${parseFloat(tMatch[1])}T`;
  if (lower.includes("mini") || lower.includes("micro") || lower.includes("nano")) return "<1B";
  if (lower.includes("flash")) return "-";
  if (lower.includes("gpt-4")) return "-";
  if (lower.includes("claude")) return "-";
  if (lower.includes("o1") || lower.includes("o3") || lower.includes("o4")) return "-";
  return "-";
}

function renderLocalModelsSection(state: PrimaryPanelRenderState): string {
  const installedRows = state.modelManagerInstalled.length
    ? state.modelManagerInstalled
        .map(
          (model) => `
      <div class="model-manager-installed-row">
        <span class="model-manager-installed-model" title="${escapeHtml(model.name)}">${escapeHtml(model.name)}</span>
        <span class="model-manager-installed-size">${escapeHtml(formatModelSize(model.sizeMb))}</span>
        <span class="model-manager-installed-capabilities">${capabilityIconsForModel(model.name)}</span>
        <span class="model-manager-installed-actions">
          <button type="button" class="model-manager-row-icon-btn" title="Load in llama.cpp" aria-label="Load in llama.cpp" data-model-use-path="${escapeHtml(model.path)}">▶</button>
          <button type="button" class="model-manager-row-icon-btn is-danger" title="Delete model" aria-label="Delete model" data-model-delete-id="${escapeHtml(model.id)}">🗑</button>
        </span>
      </div>
    `
        )
        .join("")
    : `<div class="model-manager-installed-row is-empty"><span>No local GGUF models</span><span>-</span><span>-</span><span>-</span></div>`;

  return `
    <div class="llama-form">
      <h3 class="model-manager-title">My Local Models</h3>
      <div class="model-manager-installed-table">
        <div class="model-manager-installed-header">
          <span>Model</span>
          <span>Size</span>
          <span>Capabilities</span>
          <span>Action</span>
        </div>
        ${installedRows}
      </div>
    </div>
  `;
}

function renderAllModelsTable(state: PrimaryPanelRenderState): string {
  const localModelsHtml = renderLocalModelsSection(state);
  const allOptions = state.allModelsList;
  if (!allOptions.length) {
    return `<div class="mm-all-table"><div class="mm-all-row is-empty"><span>No models available. Connect an API or load a local model.</span></div></div>
      <div class="mm-action-btns">
        <button type="button" class="mm-action-btn" data-mm-nav="apis">+ Add New API Model</button>
        <button type="button" class="mm-action-btn" data-mm-nav="download">Download Local Model</button>
      </div>`;
  }

  const headerHtml = `
    <div class="mm-all-header">
      <span>Provider</span>
      <span>Model</span>
      <span>Params</span>
      <span>Cap</span>
      <span></span>
      <span></span>
    </div>
  `;

  const rowsHtml = allOptions
    .map((opt) => {
      const provider = extractProviderFromLabel(opt.label);
      const modelName = extractModelNameFromLabel(opt.label);
      const params = estimateParameterCount(opt.modelName);
      const isDisabled = state.modelManagerDisabledModelIds.includes(opt.id);
      const dimClass = isDisabled ? " is-dimmed" : "";
      const checkedAttr = isDisabled ? "" : " checked";
      const checkIcon = isDisabled
        ? iconHtml("square", { size: 16, tone: "dark" })
        : iconHtml("square-check-big", { size: 16, tone: "dark" });
      const capIcons = allModelsCapabilityIcons(opt.modelName);
      const infoAttrs = `data-model-info-id="${escapeHtml(opt.id)}"`;

      return `
        <div class="mm-all-row${dimClass}">
          <span class="mm-all-provider">${escapeHtml(provider)}</span>
          <span class="mm-all-model-name is-clickable" ${infoAttrs} title="${escapeHtml(opt.detail)}">${escapeHtml(modelName)}</span>
          <span class="mm-all-params">${escapeHtml(params)}</span>
          <span class="mm-all-caps">${capIcons}</span>
          <span class="mm-all-check">
            <span class="mm-check-toggle ${isDisabled ? "is-off" : "is-on"}" data-model-avail-id="${escapeHtml(opt.id)}" title="${isDisabled ? "Enable model" : "Disable model"}" aria-label="${isDisabled ? "Enable model" : "Disable model"}" role="checkbox" aria-checked="${isDisabled ? "false" : "true"}">${checkIcon}</span>
          </span>
          <span class="mm-all-info">
            <span class="mm-action-icon" ${infoAttrs} title="Model details" aria-label="Model details">${iconHtml("info", { size: 16, tone: "dark" })}</span>
          </span>
        </div>
      `;
    })
    .join("");

  return `
    ${localModelsHtml}
    <div style="height: 2rem;"></div>
    <h3 class="model-manager-title">All Available Models (Local and API)</h3>
    <div class="mm-all-table">
      ${headerHtml}
      ${rowsHtml}
    </div>
    <div class="mm-action-btns">
      <button type="button" class="mm-action-btn" data-mm-nav="apis">+ Add New API Model</button>
      <button type="button" class="mm-action-btn" data-mm-nav="download">Download Local Model</button>
    </div>
  `;
}

function renderModelInfoModal(state: PrimaryPanelRenderState): string {
  const modelId = state.modelManagerInfoModalModelId;
  if (!modelId) return "";

  const opt = state.allModelsList.find((o) => o.id === modelId);
  if (!opt) return "";

  const provider = extractProviderFromLabel(opt.label);
  const modelName = extractModelNameFromLabel(opt.label);
  const params = estimateParameterCount(opt.modelName);
  const isDisabled = state.modelManagerDisabledModelIds.includes(opt.id);
  const source = opt.source === "local" ? "Local (llama.cpp)" : "API";
  const capIcons = allModelsCapabilityIcons(opt.modelName);

  const detailRows: Array<{ label: string; value: string }> = [
    { label: "Source", value: source },
    { label: "Provider", value: provider },
    { label: "Model ID", value: opt.modelName },
    { label: "Parameters (est.)", value: params || "Unknown" },
    { label: "Detail", value: opt.detail },
    { label: "Status", value: isDisabled ? "Disabled" : "Enabled" }
  ];

  if (opt.source === "api") {
    detailRows.push({ label: "API Standard", value: "OpenAI-compatible" });
    const curlCmd = `curl ${escapeHtml(opt.detail)}/v1/chat/completions -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"model":"${escapeHtml(opt.modelName)}","messages":[{"role":"user","content":"Hello"}]}'`;
    detailRows.push({ label: "Verify (curl)", value: curlCmd });
  }

  const detailsHtml = detailRows
    .map(
      (row) => `
      <div class="mm-info-row">
        <span class="mm-info-label">${escapeHtml(row.label)}</span>
        <span class="mm-info-value${row.label === "Verify (curl)" ? " is-code" : ""}">${escapeHtml(row.value)}</span>
      </div>
    `
    )
    .join("");

  return `
    <div class="mm-modal-overlay" id="mmInfoModalOverlay">
      <div class="mm-modal">
        <div class="mm-modal-header">
          <h3>${escapeHtml(modelName)}</h3>
          <button type="button" class="mm-modal-close" id="mmInfoModalClose" aria-label="Close">${iconHtml("circle-x", { size: 16, tone: "inactive" })}</button>
        </div>
        <div class="mm-modal-caps">${capIcons}</div>
        <div class="mm-modal-details">
          ${detailsHtml}
        </div>
        <div class="mm-modal-actions">
          <button type="button" class="mm-modal-btn" id="mmInfoModalDone">Close</button>
        </div>
      </div>
    </div>
  `;
}

export function renderModelManagerBody(state: PrimaryPanelRenderState): string {
  const activeTab = state.modelManagerActiveTab;

  const allModelsContent = activeTab === "all_models" ? renderAllModelsTable(state) : "";
  const downloadContent = activeTab === "download" ? renderDownloadTab(state) : "";
  const messageHtml =
    activeTab === "download" && state.modelManagerMessage
      ? `<div class="llama-runtime-console"><div class="llama-runtime-line">${escapeHtml(state.modelManagerMessage)}</div></div>`
      : "";

  return `
    <div class="primary-pane-body">
      <div class="mm-tab-content">
        ${allModelsContent}
        ${downloadContent}
      </div>
      ${messageHtml}
      ${renderModelInfoModal(state)}
    </div>
  `;
}

function renderDownloadTab(state: PrimaryPanelRenderState): string {
  const activeDownloadKey = state.modelManagerActiveDownloadKey;
  const isAnyDownloadActive = state.modelManagerDownloading;
  const collectionOptions = MODEL_COLLECTIONS.map((item) => {
    const selected = item.id === state.modelManagerCollection ? " selected" : "";
    return `<option value="${escapeHtml(item.id)}"${selected}>${escapeHtml(item.label)}</option>`;
  }).join("");

  const searchRows = state.modelManagerSearchResults.length
    ? state.modelManagerSearchResults
        .map(
          (result) => {
            const downloadKey = `${result.repoId}::${result.fileName}`;
            const isDownloading = isAnyDownloadActive && activeDownloadKey === downloadKey;
            return `
      <div class="config-row">
        <span class="config-key">${escapeHtml(result.repoId)}</span>
        <span class="config-value">${escapeHtml(result.fileName)}</span>
        <span class="config-meta">${escapeHtml(
          result.sizeMb === null ? "size unknown" : formatModelSize(result.sizeMb)
        )}</span>
      </div>
      <div class="model-manager-actions-row">
        <button
          type="button"
          class="tool-action-btn mm-download-btn${isDownloading ? " is-downloading" : ""}"
          data-hf-download-repo="${escapeHtml(result.repoId)}"
          data-hf-download-file="${escapeHtml(result.fileName)}"
          ${isDownloading ? "disabled" : ""}
        >
          ${isDownloading ? "Downloading" : "Download"}
        </button>
      </div>
    `
          }
        )
        .join("")
    : "";

  const filteredUnslothUdRows = state.modelManagerUnslothUdCatalog.filter((row) => {
    const query = state.modelManagerQuery.trim().toLowerCase();
    if (!query) return true;
    return row.repoId.toLowerCase().includes(query) || row.modelName.toLowerCase().includes(query);
  });

  const collectionLinkHtml =
    state.modelManagerCollection === "unsloth_ud"
      ? `<div class="model-manager-collection-link-row"><a href="${UNSLOTH_UD_COLLECTION_URL}" target="_blank" rel="noreferrer">Open collection</a></div>`
      : "";

  const unslothTableHtml =
    state.modelManagerCollection === "unsloth_ud"
      ? `
        <div class="llama-form">
          <div class="model-manager-simple-table">
            <div class="model-manager-simple-header">
              <span>Model name</span>
              <span>Params</span>
              <span>Quant</span>
              <span>Size</span>
              <span>Action</span>
            </div>
            ${
              state.modelManagerUnslothUdLoading
                ? `<div class="model-manager-simple-row is-empty"><span>Loading UD quant catalog...</span><span>-</span><span>-</span><span>-</span><span>-</span></div>`
                :
              filteredUnslothUdRows.length
                ? filteredUnslothUdRows
                    .map(
                      (row) => {
                        const selectedAsset =
                          row.udAssets.find((asset) => asset.fileName === row.selectedAssetFileName) ??
                          row.udAssets[0];
                        const downloadKey = `${row.repoId}::${selectedAsset?.fileName ?? ""}`;
                        const isDownloading = isAnyDownloadActive && activeDownloadKey === downloadKey;
                        return `
                <div class="model-manager-simple-row">
                  <span>${escapeHtml(row.modelName)}</span>
                  <span>${escapeHtml(row.parameterCount)}</span>
                  <span>
                    <select
                      class="llama-input model-manager-quant-select"
                      data-ud-quant-repo="${escapeHtml(row.repoId)}"
                    >
                      ${row.udAssets
                        .map((asset) => {
                          const selected = asset.fileName === row.selectedAssetFileName ? " selected" : "";
                          return `<option value="${escapeHtml(asset.fileName)}"${selected}>${escapeHtml(asset.quant)}</option>`;
                        })
                        .join("")}
                    </select>
                  </span>
                  <span>${escapeHtml(selectedAsset?.sizeGb ?? "n/a")}</span>
                  <span>
                    <button
                      type="button"
                      class="tool-action-btn mm-download-btn${isDownloading ? " is-downloading" : ""}"
                      data-hf-download-repo="${escapeHtml(row.repoId)}"
                      data-hf-download-file="${escapeHtml(selectedAsset?.fileName ?? "")}" 
                      ${isDownloading ? "disabled" : ""}
                    >
                      ${isDownloading ? "Downloading" : "Download"}
                    </button>
                  </span>
                </div>
              `
                      }
                    )
                    .join("")
                : `<div class="model-manager-simple-row is-empty"><span>No models match this filter.</span><span>-</span><span>-</span><span>-</span><span>-</span></div>`
            }
          </div>
        </div>
      `
      : "";

  const progressValue = Number.isFinite(state.modelManagerDownloadPercent ?? NaN)
    ? Math.max(0, Math.min(100, state.modelManagerDownloadPercent ?? 0))
    : 0;
  const progressLabel = state.modelManagerDownloadPercent !== null
    ? `${progressValue.toFixed(1)}%`
    : state.modelManagerDownloadReceivedBytes !== null
      ? "Downloading"
      : "";
  const progressDetail = state.modelManagerDownloadReceivedBytes !== null
    ? state.modelManagerDownloadTotalBytes !== null
      ? `${formatModelSize(Math.round(state.modelManagerDownloadReceivedBytes / (1024 * 1024)))} of ${formatModelSize(Math.round(state.modelManagerDownloadTotalBytes / (1024 * 1024)))}`
      : formatModelSize(Math.round(state.modelManagerDownloadReceivedBytes / (1024 * 1024)))
    : "";
  const progressHtml = state.modelManagerDownloading
    ? `<div class="tts-download-progress" role="status" aria-live="polite">
        <div class="tts-download-progress-top">
          <span>Downloading ${escapeHtml(state.modelManagerActiveDownloadFileName ?? "model")}</span>
          <span>${escapeHtml(progressLabel)}</span>
        </div>
        <progress ${state.modelManagerDownloadPercent !== null ? `value="${progressValue.toFixed(2)}" max="100"` : ""}></progress>
        <div class="mm-download-progress-bottom">
          ${progressDetail ? `<div class="tts-download-progress-detail">${escapeHtml(progressDetail)}${state.modelManagerDownloadSpeedBytesPerSec !== null ? ` (${escapeHtml(formatModelSize(Math.round(state.modelManagerDownloadSpeedBytesPerSec / (1024 * 1024))) + "/s")})` : ""}</div>` : ""}
          <button type="button" class="tool-action-btn mm-download-cancel-btn" id="modelManagerCancelDownloadBtn">Cancel</button>
        </div>
      </div>`
    : "";

  return `
    <div class="llama-form">
      ${progressHtml}
      ${collectionLinkHtml}
      <label class="config-row">
        <select id="modelManagerCollectionSelect" class="llama-input model-manager-collection-select">${collectionOptions}</select>
        <input
          id="modelManagerQueryInput"
          class="llama-input"
          value="${escapeHtml(state.modelManagerQuery)}"
          placeholder="Search query"
        />
        <span class="config-meta"><button type="button" class="tool-action-btn" id="modelManagerSearchBtn">Search</button></span>
      </label>
      ${
        state.modelManagerCollection === "unsloth_ud"
          ? ""
          : `<div class="config-table">${searchRows}</div>`
      }
    </div>
    ${unslothTableHtml}
  `;
}

export function bindModelManagerPanel(bindings: PrimaryPanelBindings): void {
  const refreshBtn = document.querySelector<HTMLButtonElement>("#modelManagerRefreshBtn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      await bindings.onModelManagerRefreshInstalled();
    };
  }

  document.querySelectorAll<HTMLButtonElement>("[data-mm-tab]").forEach((btn) => {
    btn.onclick = async () => {
      const tab = btn.dataset.mmTab;
      if (tab === "all_models" || tab === "download") {
        await bindings.onModelManagerSetActiveTab(tab);
      }
    };
  });

  document.querySelectorAll<HTMLButtonElement>("[data-mm-nav]").forEach((btn) => {
    btn.onclick = async () => {
      const target = btn.dataset.mmNav;
      if (target === "apis") {
        await bindings.onModelManagerNavigateToApis();
      } else if (target === "download") {
        await bindings.onModelManagerSetActiveTab("download");
      }
    };
  });

  document.querySelectorAll<HTMLSpanElement>("[data-model-avail-id]").forEach((el) => {
    el.onclick = async () => {
      const modelId = el.dataset.modelAvailId;
      if (!modelId) return;
      await bindings.onModelManagerToggleModelAvailability(modelId);
    };
  });

  document.querySelectorAll<HTMLElement>("[data-model-info-id]").forEach((el) => {
    el.onclick = async () => {
      const modelId = el.dataset.modelInfoId;
      if (!modelId) return;
      await bindings.onModelManagerSetInfoModalModelId(modelId);
    };
  });

  const modalCloseBtn = document.querySelector<HTMLButtonElement>("#mmInfoModalClose");
  if (modalCloseBtn) {
    modalCloseBtn.onclick = async () => {
      await bindings.onModelManagerSetInfoModalModelId(null);
    };
  }
  const modalDoneBtn = document.querySelector<HTMLButtonElement>("#mmInfoModalDone");
  if (modalDoneBtn) {
    modalDoneBtn.onclick = async () => {
      await bindings.onModelManagerSetInfoModalModelId(null);
    };
  }
  const modalOverlay = document.querySelector<HTMLElement>("#mmInfoModalOverlay");
  if (modalOverlay) {
    modalOverlay.onclick = async (e) => {
      if (e.target === modalOverlay) {
        await bindings.onModelManagerSetInfoModalModelId(null);
      }
    };
  }

  const queryInput = document.querySelector<HTMLInputElement>("#modelManagerQueryInput");
  if (queryInput) {
    const apply = async () => {
      await bindings.onModelManagerSetQuery(queryInput.value);
    };
    queryInput.onchange = async () => {
      await apply();
    };
    queryInput.onblur = async () => {
      await apply();
    };
  }

  const collectionSelect = document.querySelector<HTMLSelectElement>("#modelManagerCollectionSelect");
  if (collectionSelect) {
    collectionSelect.onchange = async () => {
      await bindings.onModelManagerSetCollection(collectionSelect.value);
    };
  }

  const searchBtn = document.querySelector<HTMLButtonElement>("#modelManagerSearchBtn");
  if (searchBtn) {
    searchBtn.onclick = async () => {
      await bindings.onModelManagerSearchHf();
    };
  }

  const useBtns = document.querySelectorAll<HTMLButtonElement>("[data-model-use-path]");
  useBtns.forEach((btn) => {
    btn.onclick = async () => {
      const modelPath = btn.dataset.modelUsePath;
      if (!modelPath) return;
      await bindings.onModelManagerUseAsLlamaPath(modelPath);
    };
  });

  const deleteBtns = document.querySelectorAll<HTMLButtonElement>("[data-model-delete-id]");
  deleteBtns.forEach((btn) => {
    btn.onclick = async () => {
      const modelId = btn.dataset.modelDeleteId;
      if (!modelId) return;
      const confirmed = window.confirm(`Remove model ${modelId}?`);
      if (!confirmed) return;
      await bindings.onModelManagerDeleteInstalled(modelId);
    };
  });

  const downloadBtns = document.querySelectorAll<HTMLButtonElement>("[data-hf-download-repo]");
  downloadBtns.forEach((btn) => {
    btn.onclick = async () => {
      const repoId = btn.dataset.hfDownloadRepo;
      const fileName = btn.dataset.hfDownloadFile;
      if (!repoId || !fileName) return;
      await bindings.onModelManagerDownloadHf({ repoId, fileName });
    };
  });

  const quantSelects = document.querySelectorAll<HTMLSelectElement>("[data-ud-quant-repo]");
  quantSelects.forEach((select) => {
    select.onchange = async () => {
      const repoId = select.dataset.udQuantRepo;
      if (!repoId) return;
      await bindings.onModelManagerSetUdQuant({ repoId, fileName: select.value });
    };
  });

  const cancelDownloadBtn = document.querySelector<HTMLButtonElement>("#modelManagerCancelDownloadBtn");
  if (cancelDownloadBtn) {
    cancelDownloadBtn.onclick = async () => {
      await bindings.onModelManagerCancelDownload();
    };
  }
}
