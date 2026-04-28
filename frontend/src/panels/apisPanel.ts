import { iconHtml, type IconName } from "../icons";
import { APP_ICON } from "../icons/map";
import type { ApiConnectionStatus, ApiConnectionType } from "../contracts";
import { escapeHtml } from "./utils";
import type { PrimaryPanelBindings, PrimaryPanelRenderState } from "./types";

let apiUrlProbeTimer: number | null = null;

export function renderApisActions(): string {
  return `
    <div class="llama-actions">
      <button type="button" class="tool-action-btn" id="apiConnectionsImportJsonBtn">Import JSON</button>
      <button type="button" class="tool-action-btn" id="apiConnectionsImportCsvBtn">Import CSV</button>
      <button type="button" class="tool-action-btn" id="apiConnectionsExportJsonBtn">Export JSON</button>
      <button type="button" class="tool-action-btn" id="apiConnectionsExportCsvBtn">Export CSV</button>
      <button type="button" class="topbar-icon-btn" id="apiConnectionsRefreshBtn" aria-label="Refresh APIs" data-title="Refresh APIs" title="Refresh APIs">↻</button>
    </div>
  `;
}

export function renderApisBody(state: PrimaryPanelRenderState): string {
  const rows = state.apiConnections.length
    ? state.apiConnections
        .map((connection) => {
          const endpointUrl = connection.apiUrl.replace(/^https?:\/\//, "");
          return `
            <div class="api-row">
              <div class="api-col api-col-type" title="${escapeHtml(typeLabel(connection.apiType))}">
                <span class="api-type-icon">${iconHtml(typeIcon(connection.apiType), { size: 16, tone: "dark" })}</span>
                <span class="api-type-label">${escapeHtml(typeLabel(connection.apiType))}</span>
              </div>
              <div class="api-col api-col-provider">
                <span class="api-provider-url" title="${escapeHtml(connection.apiUrl)}">${escapeHtml(endpointUrl)}</span>
              </div>
              <div class="api-col api-col-key">${escapeHtml(connection.apiKeyMasked)}</div>
              <div class="api-col api-col-models" title="${escapeHtml(connection.modelName || "")}">
                ${escapeHtml((connection.modelName || "").trim() || "-")}
              </div>
              <div class="api-col api-col-actions">
                <span class="api-action-icon" data-api-edit-id="${escapeHtml(connection.id)}" title="Edit">
                  ${iconHtml("edit", { size: 16, tone: "dark" })}
                </span>
                <span class="api-action-icon delete" data-api-delete-id="${escapeHtml(connection.id)}" title="Delete">
                  ${iconHtml("trash-2", { size: 16, tone: "dark" })}
                </span>
                <span class="api-status-icon ${statusClass(connection.status, connection.statusMessage)}">
                  ${iconHtml(statusIcon(connection.status, connection.statusMessage), { size: 16, tone: "dark" })}
                </span>
              </div>
            </div>
          `;
        })
        .join("")
    : '<div class="history-empty">No API connections saved.</div>';

  const formHtml = state.apiFormOpen
    ? `
      <div class="api-form-wrap">
        <div class="api-form-grid">
          <label class="api-form-field">
            <span>Provider</span>
            <input id="apiProviderInput" class="llama-input" value="${escapeHtml(state.apiDraft.name)}" placeholder="z.ai or Serper" />
          </label>
          <label class="api-form-field">
            <span>Type</span>
            <select id="apiTypeInput" class="llama-input">
              ${typeOptions(state.apiDraft.apiType)}
            </select>
          </label>
          <label class="api-form-field api-form-wide">
            <span>API URL</span>
            <input id="apiUrlInput" class="llama-input" value="${escapeHtml(state.apiDraft.apiUrl)}" placeholder="https://api.example.com/v1/models" />
            <div class="api-url-probe-bar ${state.apiProbeStatus ? `is-${state.apiProbeStatus}` : ""}">
              ${escapeHtml(
                state.apiProbeBusy
                  ? "Testing endpoint..."
                  : state.apiProbeMessage ?? "Enter API URL to auto-detect endpoint standard and available models."
              )}
            </div>
          </label>
          <label class="api-form-field api-form-wide">
            <span>API Standard Path (optional)</span>
            <input id="apiStandardPathInput" class="llama-input" value="${escapeHtml(state.apiDraft.apiStandardPath)}" placeholder="/chat/completions" />
          </label>
          <label class="api-form-field api-form-wide">
            <span>API Key</span>
            <input id="apiKeyInput" class="llama-input" value="${escapeHtml(state.apiDraft.apiKey)}" placeholder="${state.apiDraft.apiKey ? "New API key entered" : "Leave blank to keep existing key"}" />
          </label>
          <label class="api-form-field api-form-half">
            <span>Model Name</span>
            <input id="apiModelNameInput" list="apiModelNameOptions" class="llama-input" value="${escapeHtml(state.apiDraft.modelName ?? "")}" placeholder="Optional" />
            <datalist id="apiModelNameOptions">
              ${state.apiDetectedModels
                .map((model) => `<option value="${escapeHtml(model)}"></option>`)
                .join("")}
            </datalist>
          </label>
          <label class="api-form-field api-form-half">
            <span>Cost / Month (USD)</span>
            <input id="apiCostInput" class="llama-input" value="${escapeHtml(state.apiDraft.costPerMonthUsd)}" placeholder="Optional" />
          </label>
        </div>
        <label class="api-form-field api-form-wide">
          <span>Verification Command</span>
          <textarea class="api-verify-command" readonly spellcheck="false">${escapeHtml(buildVerificationCommand(state.apiDraft))}</textarea>
        </label>
        <div class="api-form-actions">
          <button type="button" class="tool-action-btn" id="apiCancelBtn">Cancel</button>
          <button type="button" class="tool-action-btn" id="apiSaveBtn" ${state.apiSaveBusy ? "disabled" : ""}>${state.apiSaveBusy ? "Saving..." : "Save"}</button>
        </div>
      </div>
    `
    : "";

  return `
    <div class="primary-pane-body">
      <div class="api-table">
        <div class="api-header">
          <span>Type</span>
          <span>Provider</span>
          <span class="api-header-key">Key</span>
          <span>Models</span>
          <span class="api-header-actions">Actions</span>
        </div>
        ${rows}
      </div>
      ${
        state.apiFormOpen
          ? ""
          : '<div class="api-add-wrap"><button type="button" class="tool-action-btn" id="apiAddBtn">+ add new API</button></div>'
      }
      ${formHtml}
      ${
        state.apiMessage
          ? `<div class="llama-runtime-console"><div class="llama-runtime-line">${escapeHtml(state.apiMessage)}</div></div>`
          : ""
      }
    </div>
  `;
}

export function bindApisPanel(bindings: PrimaryPanelBindings): void {
  const refreshBtn = document.querySelector<HTMLButtonElement>("#apiConnectionsRefreshBtn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      await bindings.onApiConnectionsRefresh();
    };
  }
  const exportJsonBtn = document.querySelector<HTMLButtonElement>("#apiConnectionsExportJsonBtn");
  if (exportJsonBtn) {
    exportJsonBtn.onclick = async () => {
      await bindings.onApiConnectionsExportJson();
    };
  }
  const exportCsvBtn = document.querySelector<HTMLButtonElement>("#apiConnectionsExportCsvBtn");
  if (exportCsvBtn) {
    exportCsvBtn.onclick = async () => {
      await bindings.onApiConnectionsExportCsv();
    };
  }
  const importJsonBtn = document.querySelector<HTMLButtonElement>("#apiConnectionsImportJsonBtn");
  if (importJsonBtn) {
    importJsonBtn.onclick = async () => {
      await bindings.onApiConnectionsImportJson();
    };
  }
  const importCsvBtn = document.querySelector<HTMLButtonElement>("#apiConnectionsImportCsvBtn");
  if (importCsvBtn) {
    importCsvBtn.onclick = async () => {
      await bindings.onApiConnectionsImportCsv();
    };
  }

  const addBtn = document.querySelector<HTMLButtonElement>("#apiAddBtn");
  if (addBtn) {
    addBtn.onclick = async () => {
      await bindings.onApiConnectionsSetFormOpen(true);
    };
  }

  const cancelBtn = document.querySelector<HTMLButtonElement>("#apiCancelBtn");
  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      await bindings.onApiConnectionsSetFormOpen(false);
    };
  }

  const typeInput = document.querySelector<HTMLSelectElement>("#apiTypeInput");
  if (typeInput) {
    typeInput.onchange = async () => {
      await bindings.onApiConnectionDraftChange({ apiType: typeInput.value as ApiConnectionType });
    };
  }

  const urlInput = document.querySelector<HTMLInputElement>("#apiUrlInput");
  if (urlInput) {
    urlInput.oninput = async () => {
      await bindings.onApiConnectionDraftChange({ apiUrl: urlInput.value });
      if (apiUrlProbeTimer !== null) {
        window.clearTimeout(apiUrlProbeTimer);
      }
      apiUrlProbeTimer = window.setTimeout(() => {
        void bindings.onApiConnectionProbe();
      }, 500);
    };
    urlInput.onblur = async () => {
      if (apiUrlProbeTimer !== null) {
        window.clearTimeout(apiUrlProbeTimer);
        apiUrlProbeTimer = null;
      }
      await bindings.onApiConnectionProbe();
    };
  }

  const providerInput = document.querySelector<HTMLInputElement>("#apiProviderInput");
  if (providerInput) {
    providerInput.oninput = async () => {
      await bindings.onApiConnectionDraftChange({ name: providerInput.value });
    };
  }

  const keyInput = document.querySelector<HTMLInputElement>("#apiKeyInput");
  if (keyInput) {
    keyInput.oninput = async () => {
      await bindings.onApiConnectionDraftChange({ apiKey: keyInput.value });
    };
  }

  const costInput = document.querySelector<HTMLInputElement>("#apiCostInput");
  if (costInput) {
    costInput.oninput = async () => {
      await bindings.onApiConnectionDraftChange({ costPerMonthUsd: costInput.value });
    };
  }

  const modelNameInput = document.querySelector<HTMLInputElement>("#apiModelNameInput");
  if (modelNameInput) {
    modelNameInput.oninput = async () => {
      await bindings.onApiConnectionDraftChange({ modelName: modelNameInput.value });
    };
  }

  const apiStandardPathInput = document.querySelector<HTMLInputElement>("#apiStandardPathInput");
  if (apiStandardPathInput) {
    apiStandardPathInput.oninput = async () => {
      await bindings.onApiConnectionDraftChange({ apiStandardPath: apiStandardPathInput.value });
    };
  }

  const saveBtn = document.querySelector<HTMLButtonElement>("#apiSaveBtn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      await bindings.onApiConnectionSave();
    };
  }

  const editIcons = document.querySelectorAll<HTMLElement>("[data-api-edit-id]");
  editIcons.forEach((icon) => {
    icon.onclick = async () => {
      const id = icon.dataset.apiEditId;
      if (!id) return;
      await bindings.onApiConnectionEdit(id);
    };
  });

  const deleteIcons = document.querySelectorAll<HTMLElement>("[data-api-delete-id]");
  deleteIcons.forEach((icon) => {
    icon.onclick = async () => {
      const id = icon.dataset.apiDeleteId;
      if (!id) return;
      await bindings.onApiConnectionDelete(id);
    };
  });
}

function typeOptions(selected: ApiConnectionType): string {
  const options: ApiConnectionType[] = ["llm", "search", "stt", "tts", "image", "other"];
  return options
    .map((value) => {
      const isSelected = value === selected ? " selected" : "";
      return `<option value="${value}"${isSelected}>${typeLabel(value)}</option>`;
    })
    .join("");
}

function typeIcon(apiType: ApiConnectionType): IconName {
  if (apiType === "llm") return "brain";
  if (apiType === "search") return "search";
  if (apiType === "stt") return APP_ICON.sidebar.stt;
  if (apiType === "tts") return APP_ICON.sidebar.tts;
  if (apiType === "image") return "image";
  return "plug";
}

function typeLabel(apiType: ApiConnectionType): string {
  if (apiType === "llm") return "LLM";
  if (apiType === "search") return "Search";
  if (apiType === "stt") return "STT";
  if (apiType === "tts") return "TTS";
  if (apiType === "image") return "Image";
  return "Other";
}

function statusClass(status: ApiConnectionStatus, statusMessage: string): string {
  if (status === "verified") return "is-verified";
  if (status === "pending") return "is-pending";
  if (isExhaustedLimitWarning(status, statusMessage)) return "is-limit";
  return "is-warning";
}

function statusIcon(status: ApiConnectionStatus, statusMessage: string): IconName {
  if (status === "verified") return "circle-check-big";
  if (status === "pending") return "calendar-clock";
  if (isExhaustedLimitWarning(status, statusMessage)) return "octagon-pause";
  return "triangle-alert";
}

function isExhaustedLimitWarning(status: ApiConnectionStatus, statusMessage: string): boolean {
  if (status !== "warning") return false;
  const lower = statusMessage.toLowerCase();
  const hasLimitContext =
    lower.includes("rate") ||
    lower.includes("quota") ||
    lower.includes("limit") ||
    lower.includes("429");
  const hasExhaustedContext =
    lower.includes("exhaust") ||
    lower.includes("reached") ||
    lower.includes("remaining=0") ||
    lower.includes("blocked");
  return hasLimitContext && hasExhaustedContext;
}

function statusLabel(status: ApiConnectionStatus): string {
  if (status === "verified") return "Verified";
  if (status === "warning") return "Warning";
  return "Pending";
}

function buildVerificationCommand(draft: PrimaryPanelRenderState["apiDraft"]): string {
  const endpoint = resolveVerifyEndpoint(draft);
  if (!endpoint) {
    return "Enter API URL to generate verification command.";
  }
  const apiKey = "YOUR_API_KEY";
  const payload =
    draft.apiType === "search"
      ? JSON.stringify({ q: "test", num: 1 })
      : JSON.stringify({
          model: draft.modelName.trim() || "glm-4",
          messages: [
            { role: "system", content: "You are a helpful AI assistant." },
            { role: "user", content: "Hello, please introduce yourself." }
          ],
          temperature: 1.0,
          stream: true
        });
  const keyLine = `API_KEY=${shellQuote(apiKey)}`;
  return `${keyLine}
curl -sS -X POST ${shellQuote(endpoint)} \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "x-api-key: $API_KEY" \\
  -H "Accept-Language: en-US,en" \\
  -H "Content-Type: application/json" \\
  -d ${shellQuote(payload)}`;
}

function resolveVerifyEndpoint(draft: PrimaryPanelRenderState["apiDraft"]): string {
  const base = draft.apiUrl.trim().replace(/\/+$/g, "");
  if (!base) return "";
  const standardPath = draft.apiStandardPath.trim();
  const defaultPath = draft.apiType === "search" ? "/search" : "/chat/completions";
  const path = standardPath || defaultPath;

  if (/^https?:\/\//i.test(path)) {
    return path.trim();
  }

  if (looksLikeFullVerifyEndpoint(base, draft.apiType)) {
    return base;
  }

  if (!path) return base;
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

function looksLikeFullVerifyEndpoint(apiUrl: string, apiType: ApiConnectionType): boolean {
  const lower = apiUrl.toLowerCase();
  if (apiType === "search") {
    return (
      lower.endsWith("/search") ||
      lower.endsWith("/images") ||
      lower.endsWith("/news") ||
      lower.endsWith("/maps") ||
      lower.endsWith("/places") ||
      lower.endsWith("/videos") ||
      lower.endsWith("/shopping") ||
      lower.endsWith("/scholar")
    );
  }
  return lower.endsWith("/chat/completions");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
