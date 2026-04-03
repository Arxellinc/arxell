import { renderToolToolbar } from "../ui/toolbar";
import type { CreateToolRuntimeSlice } from "./state";
import "./styles.css";

const DATA_ACTION = "data-create-tool-action";
const DATA_FIELD = "data-create-tool-field";
const DATA_GUARD = "data-create-tool-guard";
const DATA_PATH = "data-create-tool-path";

export function renderCreateToolActions(view: CreateToolRuntimeSlice): string {
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: [
      {
        id: "create-tool-preview",
        title: "Generate Preview",
        icon: "edit",
        buttonAttrs: {
          [DATA_ACTION]: "generate-preview"
        }
      },
      {
        id: "create-tool-validate",
        title: "Validate",
        icon: "triangle-alert",
        buttonAttrs: {
          [DATA_ACTION]: "validate"
        }
      },
      {
        id: "create-tool-write",
        title: "Create Files",
        icon: "file-plus",
        disabled: view.createToolBusy,
        buttonAttrs: {
          [DATA_ACTION]: "create-files"
        }
      },
      {
        id: "create-tool-register",
        title: "Register Tool",
        icon: "save",
        disabled: view.createToolBusy,
        buttonAttrs: {
          [DATA_ACTION]: "register-tool"
        }
      }
    ]
  });
}

export function renderCreateToolBody(view: CreateToolRuntimeSlice): string {
  const spec = view.createToolSpec;
  const selectedPreview =
    view.createToolSelectedPreviewPath && view.createToolPreviewFiles[view.createToolSelectedPreviewPath]
      ? view.createToolSelectedPreviewPath
      : view.createToolPreviewOrder[0] ?? "";
  const previewContent = selectedPreview ? view.createToolPreviewFiles[selectedPreview] ?? "" : "";

  return `<section class="create-tool-root">
    <div class="create-tool-config">
      <h2>Create Tool</h2>
      <p>Scaffold a new workspace tool with guardrails and registration wiring.</p>
      <label class="create-tool-field">
        <span>Tool Name</span>
        <input type="text" value="${escapeAttr(spec.toolName)}" ${DATA_FIELD}="toolName" />
      </label>
      <label class="create-tool-field">
        <span>Tool ID</span>
        <input type="text" value="${escapeAttr(spec.toolId)}" ${DATA_FIELD}="toolId" placeholder="my-tool" />
      </label>
      <label class="create-tool-field">
        <span>Description</span>
        <textarea ${DATA_FIELD}="description">${escapeHtml(spec.description)}</textarea>
      </label>
      <div class="create-tool-grid2">
        <label class="create-tool-field">
          <span>Category</span>
          <select ${DATA_FIELD}="category">
            ${renderOptions(["workspace", "agent", "models", "data", "media", "ops"], spec.category)}
          </select>
        </label>
        <label class="create-tool-field">
          <span>Template</span>
          <select ${DATA_FIELD}="templateId">
            ${renderOptions(["basic-view", "list-detail", "form-tool", "event-viewer", "agent-utility"], spec.templateId)}
          </select>
        </label>
      </div>
      <div class="create-tool-grid2">
        <label class="create-tool-field">
          <span>Icon Key</span>
          <input type="text" value="${escapeAttr(spec.iconKey)}" ${DATA_FIELD}="iconKey" placeholder="wrench" />
        </label>
        <label class="create-tool-field">
          <span>Custom Icon from icons-all (optional)</span>
          <input type="text" value="${escapeAttr(spec.customIconFromAll)}" ${DATA_FIELD}="customIconFromAll" placeholder="my-icon.svg" />
        </label>
      </div>
      <div class="create-tool-guardrails">
        <h3>Guardrails</h3>
        ${renderGuard("allowLocalStorage", "Allow localStorage", spec.guardrails.allowLocalStorage)}
        ${renderGuard("allowIpc", "Allow IPC hooks", spec.guardrails.allowIpc)}
        ${renderGuard("allowExternalNetwork", "Allow external network", spec.guardrails.allowExternalNetwork)}
        ${renderGuard("readOnlyMode", "Read-only template", spec.guardrails.readOnlyMode)}
      </div>
      <div class="create-tool-status">${escapeHtml(view.createToolStatusMessage || "Ready")}</div>
      ${
        view.createToolValidationErrors.length
          ? `<div class="create-tool-errors">${view.createToolValidationErrors.map((error) => `<div>${escapeHtml(error)}</div>`).join("")}</div>`
          : ""
      }
      ${
        view.createToolValidationWarnings.length
          ? `<div class="create-tool-warnings">${view.createToolValidationWarnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}</div>`
          : ""
      }
    </div>
    <div class="create-tool-preview">
      <div class="create-tool-preview-head">
        <div class="create-tool-preview-paths">
          ${
            view.createToolPreviewOrder.length
              ? view.createToolPreviewOrder
                  .map((path) => {
                    const active = path === selectedPreview;
                    return `<button type="button" class="create-tool-path-btn ${active ? "is-active" : ""}" ${DATA_ACTION}="select-preview" ${DATA_PATH}="${escapeAttr(path)}">${escapeHtml(path)}</button>`;
                  })
                  .join("")
              : `<div class="create-tool-empty">Generate preview to inspect scaffold files.</div>`
          }
        </div>
        <button type="button" class="create-tool-open-files" ${DATA_ACTION}="open-files-root">Open Files Root</button>
      </div>
      <textarea class="create-tool-preview-editor" spellcheck="false">${escapeHtml(previewContent)}</textarea>
      <div class="create-tool-result-json">
        <div class="create-tool-result-head">Last Result JSON</div>
        <textarea readonly>${escapeHtml(view.createToolLastResultJson || "{}")} </textarea>
      </div>
    </div>
  </section>`;
}

function renderGuard(key: string, label: string, value: boolean): string {
  return `<label class="create-tool-guard-row">
    <input type="checkbox" ${DATA_GUARD}="${key}" ${value ? "checked" : ""} />
    <span>${escapeHtml(label)}</span>
  </label>`;
}

function renderOptions(options: string[], selected: string): string {
  return options
    .map((option) => `<option value="${escapeAttr(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`)
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
