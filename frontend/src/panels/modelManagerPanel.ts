import { escapeHtml } from "./utils";
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

export function renderModelManagerActions(): string {
  return `
    <div class="llama-actions">
      <button type="button" class="topbar-icon-btn" id="modelManagerRefreshBtn" aria-label="Refresh models" data-title="Refresh Models" title="Refresh Models">↻</button>
    </div>
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
  return caps
    .map(
      (cap) =>
        `<span class="model-manager-cap-icon" title="${escapeHtml(cap.label)}" aria-label="${escapeHtml(cap.label)}">${escapeHtml(cap.icon)}</span>`
    )
    .join("");
}

export function renderModelManagerBody(state: PrimaryPanelRenderState): string {
  const collectionOptions = MODEL_COLLECTIONS.map((item) => {
    const selected = item.id === state.modelManagerCollection ? " selected" : "";
    return `<option value="${escapeHtml(item.id)}"${selected}>${escapeHtml(item.label)}</option>`;
  }).join("");
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

  const searchRows = state.modelManagerSearchResults.length
    ? state.modelManagerSearchResults
        .map(
          (result) => `
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
          class="tool-action-btn"
          data-hf-download-repo="${escapeHtml(result.repoId)}"
          data-hf-download-file="${escapeHtml(result.fileName)}"
        >
          Download
        </button>
      </div>
    `
        )
        .join("")
    : "";
  const filteredUnslothUdRows = state.modelManagerUnslothUdCatalog.filter((row) => {
    const query = state.modelManagerQuery.trim().toLowerCase();
    if (!query) return true;
    return row.repoId.toLowerCase().includes(query) || row.modelName.toLowerCase().includes(query);
  });
  const unslothTableHtml =
    state.modelManagerCollection === "unsloth_ud"
      ? `
        <div class="llama-form">
          <div class="model-manager-collection-link-row">
            <a href="${UNSLOTH_UD_COLLECTION_URL}" target="_blank" rel="noreferrer">Open collection</a>
          </div>
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
                      class="tool-action-btn"
                      data-hf-download-repo="${escapeHtml(row.repoId)}"
                      data-hf-download-file="${escapeHtml(selectedAsset?.fileName ?? "")}"
                    >
                      Download
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

  return `
    <div class="primary-pane-body">
      <div class="llama-form">
        <h3 class="model-manager-title">Available Models</h3>
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

      <div class="llama-form">
        <h3 class="model-manager-title">Download Models</h3>
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

      ${
        state.modelManagerMessage
          ? `<div class="llama-runtime-console"><div class="llama-runtime-line">${escapeHtml(state.modelManagerMessage)}</div></div>`
          : ""
      }
    </div>
  `;
}

export function bindModelManagerPanel(bindings: PrimaryPanelBindings): void {
  const refreshBtn = document.querySelector<HTMLButtonElement>("#modelManagerRefreshBtn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      await bindings.onModelManagerRefreshInstalled();
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
}
