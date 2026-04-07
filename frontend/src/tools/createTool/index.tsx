import { renderToolToolbar } from "../ui/toolbar";
import type {
  CreateToolPrdSection,
  CreateToolRuntimeSlice,
  CreateToolStage,
  CreateToolUiPreset
} from "./state";
import "./styles.css";

const DATA_ACTION = "data-create-tool-action";
const DATA_FIELD = "data-create-tool-field";
const DATA_GUARD = "data-create-tool-guard";
const DATA_PATH = "data-create-tool-path";
const DATA_STAGE = "data-create-tool-stage";
const DATA_ICON = "data-create-tool-icon";
const DATA_UI_PRESET = "data-create-tool-ui-preset";
const DATA_LAYOUT_MOD = "data-create-tool-layout-mod";
const DATA_PRD_SECTION = "data-create-tool-prd-section";

export function renderCreateToolActions(view: CreateToolRuntimeSlice): string {
  const stage = view.createToolStage;
  const prevDisabled = stage === "meta";
  const nextDisabled = stage === "fix";
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: [
      {
        id: "create-tool-prev",
        title: "Previous Step",
        icon: "chevron-left",
        disabled: prevDisabled,
        buttonAttrs: {
          [DATA_ACTION]: "stage-prev"
        }
      },
      {
        id: "create-tool-next",
        title: "Next Step",
        icon: "play",
        disabled: nextDisabled,
        buttonAttrs: {
          [DATA_ACTION]: "stage-next"
        }
      },
      {
        id: "create-tool-prd-fill",
        title: "Generate PRD",
        icon: "brain",
        disabled: stage !== "prd",
        buttonAttrs: {
          [DATA_ACTION]: "auto-fill-prd"
        }
      },
      {
        id: "create-tool-plan-generate",
        title: "Generate Dev Plan",
        icon: "list-checks",
        disabled: stage !== "prd" && stage !== "build",
        buttonAttrs: {
          [DATA_ACTION]: "generate-dev-plan"
        }
      },
      {
        id: "create-tool-write",
        title: "Build Tool",
        icon: "file-plus",
        disabled: view.createToolBusy || stage !== "build",
        buttonAttrs: {
          [DATA_ACTION]: "create-files"
        }
      },
      {
        id: "create-tool-fix-chat",
        title: "Open Fix In Chat",
        icon: "messages-square",
        disabled: stage !== "fix",
        buttonAttrs: {
          [DATA_ACTION]: "open-fix-chat"
        }
      }
    ]
  });
}

export function renderCreateToolBody(view: CreateToolRuntimeSlice): string {
  const spec = view.createToolSpec;
  const stages: Array<{ id: CreateToolStage; label: string; n: string }> = [
    { id: "meta", label: "Meta", n: "1" },
    { id: "prd", label: "PRD", n: "2" },
    { id: "build", label: "Build", n: "3" },
    { id: "fix", label: "Fix", n: "4" }
  ];
  const trackerHtml = stages
    .map((stage) => {
      const active = view.createToolStage === stage.id;
      return `<button type="button" class="create-tool-stage-btn ${active ? "is-active" : ""}" ${DATA_ACTION}="goto-stage" ${DATA_STAGE}="${stage.id}">
        <span class="create-tool-stage-num">${stage.n}</span>
        <span class="create-tool-stage-label">${escapeHtml(stage.label)}</span>
      </button>`;
    })
    .join("");

  const stageBody = renderStageBody(view);
  const selectedPreview =
    view.createToolSelectedPreviewPath && view.createToolPreviewFiles[view.createToolSelectedPreviewPath]
      ? view.createToolSelectedPreviewPath
      : view.createToolPreviewOrder[0] ?? "";
  const previewContent = selectedPreview ? view.createToolPreviewFiles[selectedPreview] ?? "" : "";
  const prdDocContent =
    view.createToolPreviewFiles["PRD.md"] ||
    `# Product Requirements Definition\n\nTool: ${
      view.createToolSpec.toolName || "Untitled Tool"
    } (${view.createToolSpec.toolId || "untitled-tool"})\n`;
  const rightPanelContent = view.createToolIconBrowserOpen
    ? renderIconBrowserPanel(view)
    : view.createToolStage === "prd"
      ? `<textarea class="create-tool-preview-editor" ${DATA_FIELD}="prdMarkdownDoc" spellcheck="false">${escapeHtml(prdDocContent)}</textarea>`
    : view.createToolBuildViewMode === "preview" &&
        (view.createToolStage === "build" || view.createToolStage === "fix")
      ? `<div class="create-tool-ui-preview">${view.createToolUiPreviewHtml}</div>`
      : `<textarea class="create-tool-preview-editor" spellcheck="false">${escapeHtml(previewContent)}</textarea>`;

  return `<section class="create-tool-root">
    <div class="create-tool-config">
      <div class="create-tool-stage-tracker">
        ${trackerHtml}
      </div>
      ${stageBody}
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
      <div class="create-tool-footer">
        <button type="button" class="create-tool-next-btn" ${DATA_ACTION}="stage-next" ${view.createToolStage === "fix" ? "disabled" : ""}>Next</button>
      </div>
    </div>
    <div class="create-tool-preview">
      <div class="create-tool-preview-head">
        ${
          view.createToolIconBrowserOpen
            ? `<div class="create-tool-preview-modes">
              <div class="create-tool-empty">Icon Browser</div>
              <button type="button" class="create-tool-path-btn" ${DATA_ACTION}="close-icons-browser">Close</button>
            </div>`
            : view.createToolStage === "prd"
            ? `<div class="create-tool-preview-modes">
              <div class="create-tool-empty">PRD.md</div>
            </div>`
            : view.createToolStage === "build" || view.createToolStage === "fix"
            ? `<div class="create-tool-preview-modes">
              <button type="button" class="create-tool-path-btn ${view.createToolBuildViewMode === "code" ? "is-active" : ""}" ${DATA_ACTION}="build-view-code">Code</button>
              <button type="button" class="create-tool-path-btn ${view.createToolBuildViewMode === "preview" ? "is-active" : ""}" ${DATA_ACTION}="build-view-preview">UI Preview</button>
            </div>`
            : `<div class="create-tool-empty">Preview panel</div>`
        }
        <button type="button" class="create-tool-open-files" ${DATA_ACTION}="open-files-root">Open Files Root</button>
      </div>
      ${rightPanelContent}
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

function renderStageBody(view: CreateToolRuntimeSlice): string {
  if (view.createToolStage === "meta") {
    return renderMetaStage(view);
  }
  if (view.createToolStage === "prd") {
    return renderPrdStage(view);
  }
  if (view.createToolStage === "build") {
    return renderBuildStage(view);
  }
  return renderFixStage(view);
}

function renderMetaStage(view: CreateToolRuntimeSlice): string {
  const spec = view.createToolSpec;
  return `<div class="create-tool-stage">
    <h2>Step 1: Meta</h2>
    <label class="create-tool-field">
      <span>Model</span>
      <select ${DATA_FIELD}="selectedModelId">
        ${renderModelOptions(view.createToolModelOptions, view.createToolSelectedModelId)}
      </select>
    </label>
    <label class="create-tool-field">
      <span>Tool Name</span>
      <input type="text" value="${escapeAttr(spec.toolName)}" ${DATA_FIELD}="toolName" />
      <div class="create-tool-toolid-hint"><em>Tool ID: ${escapeHtml(spec.toolId || "(autogenerated)")}</em></div>
    </label>
    <label class="create-tool-field">
      <span>Icon</span>
      <div class="create-tool-icon-controls">
        <button type="button" class="create-tool-path-btn" ${DATA_ACTION}="browse-icons">Browse Icons</button>
        ${renderSelectedIconInline(view)}
      </div>
      <input type="text" value="${escapeAttr(spec.iconKey)}" ${DATA_FIELD}="iconKey" placeholder="wrench" />
    </label>
    <label class="create-tool-field">
      <span>Description</span>
      <textarea ${DATA_FIELD}="description">${escapeHtml(spec.description)}</textarea>
    </label>
    <div class="create-tool-field">
      <span>UI Layout Preset</span>
      <div class="create-tool-ui-preset-grid">
        ${renderUiPresetCards(view.createToolPrdUiPreset)}
      </div>
    </div>
    <div class="create-tool-field">
      <span>Other UI Features</span>
      <div class="create-tool-layout-mods">
        ${renderLayoutModifierChips(view.createToolLayoutModifiers)}
      </div>
    </div>
  </div>`;
}

function renderPrdStage(view: CreateToolRuntimeSlice): string {
  return `<div class="create-tool-stage">
    <div class="create-tool-prd-head">
      <h2>Step 2: PRD</h2>
      <button type="button" class="create-tool-path-btn" ${DATA_ACTION}="generate-prd-all" ${view.createToolPrdGeneratingAll ? "disabled" : ""}>
        ${view.createToolPrdGeneratingAll ? "Generating..." : "Generate All"}
      </button>
    </div>
    <p>Draft, refine, and confirm requirements before building.</p>
    ${renderPrdSectionField(view, "UI", "prdUiNotes", view.createToolPrdUiNotes)}
    ${renderPrdSectionField(view, "Inputs", "prdInputs", view.createToolPrdInputs)}
    ${renderPrdSectionField(view, "Process", "prdProcess", view.createToolPrdProcess)}
    ${renderPrdSectionField(view, "Connections", "prdConnections", view.createToolPrdConnections)}
    ${renderPrdSectionField(view, "Dependencies", "prdDependencies", view.createToolPrdDependencies)}
    ${renderPrdSectionField(
      view,
      "Expected Behavior",
      "prdExpectedBehavior",
      view.createToolPrdExpectedBehavior
    )}
    ${renderPrdSectionField(view, "Outputs", "prdOutputs", view.createToolPrdOutputs)}
    <label class="create-tool-field"><span>Development Plan (auto-generated before build)</span><textarea ${DATA_FIELD}="devPlan">${escapeHtml(view.createToolDevPlan)}</textarea></label>
    ${renderPrdReviewBlock(view)}
  </div>`;
}

function renderPrdReviewBlock(view: CreateToolRuntimeSlice): string {
  const findingsHtml = view.createToolPrdReviewFindings.length
    ? view.createToolPrdReviewFindings
        .map((item) => {
          return `<div class="create-tool-review-item sev-${item.severity}">
            <div class="create-tool-review-title">${escapeHtml(item.severity.toUpperCase())} · ${escapeHtml(item.section)} · ${escapeHtml(item.title)}</div>
            <div class="create-tool-review-detail">${escapeHtml(item.detail)}</div>
            <div class="create-tool-review-suggest">${escapeHtml(item.suggestion)}</div>
          </div>`;
        })
        .join("")
    : `<div class="create-tool-empty">Run review to detect missing core requirements before build.</div>`;
  return `<div class="create-tool-prd-review">
    <div class="create-tool-prd-review-head">
      <h3>PRD Review</h3>
      <button type="button" class="create-tool-path-btn" ${DATA_ACTION}="run-prd-review" ${view.createToolPrdReviewBusy ? "disabled" : ""}>
        ${view.createToolPrdReviewBusy ? "Reviewing..." : "Run Review"}
      </button>
    </div>
    <p>Checks for missing critical requirements (for example SMTP/IMAP inputs for email clients).</p>
    <div class="create-tool-review-list">${findingsHtml}</div>
  </div>`;
}

function renderPrdSectionField(
  view: CreateToolRuntimeSlice,
  label: string,
  field: string,
  value: string
): string {
  const section = toPrdSectionTag(label);
  const generating = view.createToolPrdGeneratingSection === section;
  return `<label class="create-tool-field">
    <span class="create-tool-field-title">
      <span>${escapeHtml(label)}</span>
      <button type="button" class="create-tool-inline-generate" ${DATA_ACTION}="generate-prd-section" ${DATA_PRD_SECTION}="${section}" ${generating || view.createToolPrdGeneratingAll ? "disabled" : ""}>
        Auto generate ${generating ? `<span class="create-tool-inline-spinner" aria-hidden="true"></span>` : ""}
      </button>
    </span>
    <textarea ${DATA_FIELD}="${field}">${escapeHtml(value)}</textarea>
  </label>`;
}

function toPrdSectionTag(label: string): CreateToolPrdSection {
  if (label === "UI") return "UI";
  if (label === "Inputs") return "INPUTS";
  if (label === "Process") return "PROCESS";
  if (label === "Connections") return "CONNECTIONS";
  if (label === "Dependencies") return "DEPENDENCIES";
  if (label === "Expected Behavior") return "EXPECTED_BEHAVIOR";
  return "OUTPUTS";
}

function renderBuildStage(view: CreateToolRuntimeSlice): string {
  return `<div class="create-tool-stage">
    <h2>Step 3: Build</h2>
    <p>Use the selected model and Flow runtime to generate and wire the tool implementation.</p>
    <div class="create-tool-guardrails">
      <h3>Guardrails</h3>
      ${renderGuard("allowLocalStorage", "Allow localStorage", view.createToolSpec.guardrails.allowLocalStorage)}
      ${renderGuard("allowIpc", "Allow IPC hooks", view.createToolSpec.guardrails.allowIpc)}
      ${renderGuard("allowExternalNetwork", "Allow external network", view.createToolSpec.guardrails.allowExternalNetwork)}
      ${renderGuard("readOnlyMode", "Read-only template", view.createToolSpec.guardrails.readOnlyMode)}
    </div>
    <div class="create-tool-preview-paths">
      <label class="create-tool-field">
        <span>Development Plan</span>
        <textarea ${DATA_FIELD}="devPlan">${escapeHtml(view.createToolDevPlan)}</textarea>
      </label>
      ${
        view.createToolPreviewOrder.length
          ? view.createToolPreviewOrder
              .map((path) => {
                const active = path === view.createToolSelectedPreviewPath;
                return `<button type="button" class="create-tool-path-btn ${active ? "is-active" : ""}" ${DATA_ACTION}="select-preview" ${DATA_PATH}="${escapeAttr(path)}">${escapeHtml(path)}</button>`;
              })
              .join("")
          : `<div class="create-tool-empty">Run Build Tool to generate code files.</div>`
      }
    </div>
  </div>`;
}

function renderFixStage(view: CreateToolRuntimeSlice): string {
  return `<div class="create-tool-stage">
    <h2>Step 4: Fix</h2>
    <p>Use primary chat to iterate on defects and refinements after initial build.</p>
    <label class="create-tool-field">
      <span>Fix Notes For Chat</span>
      <textarea ${DATA_FIELD}="fixNotes">${escapeHtml(view.createToolFixNotes)}</textarea>
    </label>
  </div>`;
}

function renderUiPresetCards(selected: CreateToolUiPreset): string {
  const presets: Array<{ id: CreateToolUiPreset; label: string }> = [
    { id: "left-sidebar", label: "Left Sidebar" },
    { id: "right-sidebar", label: "Right Sidebar" },
    { id: "both-sidebars", label: "Both Sidebars" },
    { id: "no-sidebar", label: "No Sidebar" }
  ];
  const cards = presets
    .map((preset) => {
      const active = preset.id === selected;
      return `<button type="button" class="create-tool-ui-preset-card ${active ? "is-active" : ""}" ${DATA_ACTION}="select-ui-preset" ${DATA_UI_PRESET}="${preset.id}">
        <span class="create-tool-ui-preset-svg">${renderUiPresetSvg(preset.id)}</span>
        <span class="create-tool-ui-preset-label">${escapeHtml(preset.label)}</span>
      </button>`;
    })
    .join("");
  return cards;
}

function renderUiPresetSvg(preset: CreateToolUiPreset): string {
  const hasLeft = preset === "left-sidebar" || preset === "both-sidebars";
  const hasRight = preset === "right-sidebar" || preset === "both-sidebars";
  return `<svg viewBox="0 0 96 28" role="img" aria-hidden="true">
    <rect x="0.75" y="0.75" width="94.5" height="26.5" rx="3.5" class="ui-frame"/>
    ${hasLeft ? `<rect x="4" y="4" width="14" height="20" rx="1.5" class="ui-block"/>` : ""}
    ${hasRight ? `<rect x="78" y="4" width="14" height="20" rx="1.5" class="ui-block"/>` : ""}
    <rect x="${hasLeft ? 21 : 4}" y="4" width="${hasLeft && hasRight ? 54 : hasLeft || hasRight ? 71 : 88}" height="20" rx="1.5" class="ui-main"/>
  </svg>`;
}

function renderLayoutModifierChips(
  selected: CreateToolRuntimeSlice["createToolLayoutModifiers"]
): string {
  const mods: Array<{ id: CreateToolRuntimeSlice["createToolLayoutModifiers"][number]; label: string }> = [
    { id: "modal-focused", label: "Modal" },
    { id: "secondary-toolbar", label: "Secondary Toolbar" },
    { id: "chat-sidecar", label: "Chat Sidecar" },
    { id: "bottom-console", label: "Bottom Console" },
    { id: "wizard-steps", label: "Wizard Steps" },
    { id: "map-canvas", label: "Map Canvas" },
    { id: "split-main-detail", label: "Split Main/Detail" },
    { id: "triple-panel", label: "Triple Panel" },
    { id: "timeline-console", label: "Timeline Console" },
    { id: "dashboard-cards", label: "Dashboard Cards" },
    { id: "tabbed-workbench", label: "Tabbed Workbench" },
    { id: "command-palette-first", label: "Command Palette" }
  ];
  return mods
    .map((mod) => {
      const active = selected.includes(mod.id);
      return `<button type="button" class="create-tool-layout-mod-chip ${active ? "is-active" : ""}" ${DATA_ACTION}="toggle-layout-modifier" ${DATA_LAYOUT_MOD}="${mod.id}">${escapeHtml(mod.label)}</button>`;
    })
    .join("");
}

function renderSelectedIconInline(view: CreateToolRuntimeSlice): string {
  const selectedName = view.createToolSpec.customIconFromAll.trim();
  if (!selectedName) {
    return `<span class="create-tool-selected-icon-empty">No icon selected</span>`;
  }
  const selected = view.createToolIconLibrary.find((item) => item.name === selectedName);
  if (selected) {
    return `<span class="create-tool-selected-icon">
      <span class="create-tool-selected-icon-art">${selected.svg}</span>
      <span class="create-tool-selected-icon-name">${escapeHtml(selectedName)}</span>
    </span>`;
  }
  return `<span class="create-tool-selected-icon-empty">${escapeHtml(selectedName)}</span>`;
}

function renderIconBrowserPanel(view: CreateToolRuntimeSlice): string {
  const query = view.createToolIconBrowserAppliedQuery.trim().toLowerCase();
  const filtered = query
    ? view.createToolIconLibrary.filter((entry) => entry.name.toLowerCase().includes(query))
    : view.createToolIconLibrary;

  if (!view.createToolIconLibrary.length) {
    return `<div class="create-tool-icon-browser-empty">No icons loaded. Click Browse Icons in Step 1.</div>`;
  }
  return `<div class="create-tool-icon-browser">
    <div class="create-tool-icon-browser-search">
      <div class="create-tool-icon-search-row">
        <input type="text" ${DATA_FIELD}="iconBrowserQuery" value="${escapeAttr(view.createToolIconBrowserQuery)}" placeholder="Search icons (e.g. arrow)" />
        <button type="button" class="create-tool-path-btn" ${DATA_ACTION}="apply-icon-search">Search</button>
      </div>
      <div class="create-tool-empty">${filtered.length} shown</div>
    </div>
    <div class="create-tool-icon-browser-grid">
    ${filtered
      .map((entry) => {
        const selected = view.createToolSpec.customIconFromAll === entry.name;
        return `<button type="button" class="create-tool-icon-tile ${selected ? "is-selected" : ""}" ${DATA_ACTION}="select-icon" ${DATA_ICON}="${escapeAttr(entry.name)}" title="${escapeAttr(entry.name)}">
          <span class="create-tool-icon-art">${entry.svg}</span>
          <span class="create-tool-icon-name">${escapeHtml(entry.name)}</span>
        </button>`;
      })
      .join("")}
    </div>
  </div>`;
}

function renderModelOptions(
  options: CreateToolRuntimeSlice["createToolModelOptions"],
  selectedModelId: string
): string {
  if (!options.length) {
    return `<option value="primary-agent" selected>Primary Agent</option>`;
  }
  return options
    .map((opt) => {
      const suffix = opt.detail ? ` (${opt.detail})` : "";
      const label = `${opt.label}${suffix}`;
      return `<option value="${escapeAttr(opt.id)}" ${opt.id === selectedModelId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
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
