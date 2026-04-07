import {
  advanceCreateToolStage,
  autoFillCreateToolPrdFromMeta,
  applyCreateToolIconSearch,
  closeCreateToolIconBrowser,
  browseCreateToolIcons,
  generateCreateToolDevPlanFromModel,
  generateCreateToolPrdFromModel,
  generateCreateToolPrdSectionFromModel,
  generateCreateToolPreview,
  runCreateToolPrdReview,
  retreatCreateToolStage,
  selectCreateToolIcon,
  toggleCreateToolLayoutModifier,
  setCreateToolBuildViewMode,
  setCreateToolStage,
  selectCreateToolPreviewPath,
  updateCreateToolField,
  updateCreateToolGuardrail,
  validateCreateToolPreview
} from "./actions";
import type { CreateToolPrdSection, CreateToolRuntimeSlice } from "./state";

const DATA_ACTION = "data-create-tool-action";
const DATA_FIELD = "data-create-tool-field";
const DATA_GUARD = "data-create-tool-guard";
const DATA_PATH = "data-create-tool-path";
const DATA_ICON = "data-create-tool-icon";
const DATA_UI_PRESET = "data-create-tool-ui-preset";
const DATA_LAYOUT_MOD = "data-create-tool-layout-mod";
const DATA_PRD_SECTION = "data-create-tool-prd-section";
const PRD_SECTION_ORDER: CreateToolPrdSection[] = [
  "UI",
  "INPUTS",
  "PROCESS",
  "CONNECTIONS",
  "DEPENDENCIES",
  "EXPECTED_BEHAVIOR",
  "OUTPUTS"
];

interface CreateToolDeps {
  createTool: {
    createScaffold: () => Promise<void>;
    browseIcons: () => Promise<void>;
    generatePrd: () => Promise<void>;
    generatePrdSection: (section: CreateToolPrdSection, onUpdate?: () => void) => Promise<void>;
    runPrdReview: () => Promise<void>;
    generateDevPlan: () => Promise<void>;
    registerTool: () => Promise<void>;
  };
  files: {
    listFilesDirectory: (path?: string) => Promise<void>;
  };
}

export async function handleCreateToolClick(
  target: HTMLElement,
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps
): Promise<boolean> {
  const actionTarget = target.closest<HTMLElement>(`[${DATA_ACTION}]`);
  const action = actionTarget?.getAttribute(DATA_ACTION);
  if (!action) return false;

  if (action === "generate-preview") {
    generateCreateToolPreview(slice);
    return true;
  }
  if (action === "browse-icons") {
    if (deps.createTool.browseIcons) {
      await deps.createTool.browseIcons();
    } else {
      await browseCreateToolIcons(slice, {
        client: null,
        nextCorrelationId: () => "create-tool-local",
        refreshTools: async () => {}
      });
    }
    return true;
  }
  if (action === "close-icons-browser") {
    closeCreateToolIconBrowser(slice);
    return true;
  }
  if (action === "apply-icon-search") {
    applyCreateToolIconSearch(slice);
    return true;
  }
  if (action === "select-icon") {
    const iconName = actionTarget?.getAttribute(DATA_ICON) ?? "";
    selectCreateToolIcon(slice, iconName);
    return true;
  }
  if (action === "select-ui-preset") {
    const preset = actionTarget?.getAttribute(DATA_UI_PRESET) ?? "";
    updateCreateToolField(slice, "prdUiPreset", preset);
    return true;
  }
  if (action === "toggle-layout-modifier") {
    const modifier = actionTarget?.getAttribute(DATA_LAYOUT_MOD) ?? "";
    if (
      modifier === "modal-focused" ||
      modifier === "secondary-toolbar" ||
      modifier === "chat-sidecar" ||
      modifier === "bottom-console" ||
      modifier === "wizard-steps" ||
      modifier === "map-canvas" ||
      modifier === "split-main-detail" ||
      modifier === "triple-panel" ||
      modifier === "timeline-console" ||
      modifier === "dashboard-cards" ||
      modifier === "tabbed-workbench" ||
      modifier === "command-palette-first"
    ) {
      toggleCreateToolLayoutModifier(slice, modifier);
      return true;
    }
  }
  if (action === "stage-prev") {
    retreatCreateToolStage(slice);
    return true;
  }
  if (action === "stage-next") {
    const from = slice.createToolStage;
    advanceCreateToolStage(slice);
    if (
      from === "meta" &&
      slice.createToolStage === "prd" &&
      !slice.createToolPrdUiNotes.trim() &&
      !slice.createToolPrdInputs.trim() &&
      !slice.createToolPrdProcess.trim() &&
      !slice.createToolPrdConnections.trim() &&
      !slice.createToolPrdDependencies.trim() &&
      !slice.createToolPrdExpectedBehavior.trim() &&
      !slice.createToolPrdOutputs.trim()
    ) {
      slice.createToolStatusMessage = "Generating PRD draft...";
      await deps.createTool.generatePrd();
    }
    if (from === "prd" && slice.createToolStage === "build" && !slice.createToolDevPlan.trim()) {
      await deps.createTool.generateDevPlan();
    }
    return true;
  }
  if (action === "goto-stage") {
    const stage = actionTarget?.getAttribute("data-create-tool-stage");
    if (stage === "meta" || stage === "prd" || stage === "build" || stage === "fix") {
      setCreateToolStage(slice, stage);
      return true;
    }
  }
  if (action === "auto-fill-prd") {
    autoFillCreateToolPrdFromMeta(slice);
    if (deps.createTool.generatePrd) {
      await deps.createTool.generatePrd();
    } else {
      await generateCreateToolPrdFromModel(slice, {
        client: null,
        nextCorrelationId: () => "create-tool-local",
        refreshTools: async () => {}
      });
    }
    return true;
  }
  if (action === "generate-prd-section") {
    if (slice.createToolPrdGeneratingAll) {
      return true;
    }
    if (slice.createToolPrdGeneratingSection) {
      return true;
    }
    const section = actionTarget?.getAttribute(DATA_PRD_SECTION) ?? "";
    if (
      section === "UI" ||
      section === "INPUTS" ||
      section === "PROCESS" ||
      section === "CONNECTIONS" ||
      section === "DEPENDENCIES" ||
      section === "EXPECTED_BEHAVIOR" ||
      section === "OUTPUTS"
    ) {
      if (deps.createTool.generatePrdSection) {
        await deps.createTool.generatePrdSection(section);
      } else {
        await generateCreateToolPrdSectionFromModel(slice, {
          client: null,
          nextCorrelationId: () => "create-tool-local",
          refreshTools: async () => {}
        }, section);
      }
      return true;
    }
  }
  if (action === "generate-prd-all") {
    if (slice.createToolPrdGeneratingAll) return true;
    slice.createToolPrdGeneratingAll = true;
    try {
      for (const section of PRD_SECTION_ORDER) {
        if (deps.createTool.generatePrdSection) {
          await deps.createTool.generatePrdSection(section);
        } else {
          await generateCreateToolPrdSectionFromModel(
            slice,
            {
              client: null,
              nextCorrelationId: () => "create-tool-local",
              refreshTools: async () => {}
            },
            section
          );
        }
      }
      slice.createToolStatusMessage = "All PRD sections generated.";
    } finally {
      slice.createToolPrdGeneratingAll = false;
      slice.createToolPrdGeneratingSection = null;
    }
    return true;
  }
  if (action === "run-prd-review") {
    if (deps.createTool.runPrdReview) {
      await deps.createTool.runPrdReview();
    } else {
      await runCreateToolPrdReview(slice, {
        client: null,
        nextCorrelationId: () => "create-tool-local",
        refreshTools: async () => {}
      });
    }
    return true;
  }
  if (action === "generate-dev-plan") {
    if (deps.createTool.generateDevPlan) {
      await deps.createTool.generateDevPlan();
    } else {
      await generateCreateToolDevPlanFromModel(slice, {
        client: null,
        nextCorrelationId: () => "create-tool-local",
        refreshTools: async () => {}
      });
    }
    return true;
  }
  if (action === "build-view-code") {
    setCreateToolBuildViewMode(slice, "code");
    return true;
  }
  if (action === "build-view-preview") {
    setCreateToolBuildViewMode(slice, "preview");
    return true;
  }
  if (action === "open-fix-chat") {
    const toolName = slice.createToolSpec.toolName.trim() || "Custom Tool";
    const toolId = slice.createToolSpec.toolId.trim() || "custom-tool";
    const modelId = slice.createToolSelectedModelId || "primary-agent";
    (slice as unknown as { sidebarTab?: string; chatDraft?: string }).sidebarTab = "chat";
    (slice as unknown as { sidebarTab?: string; chatDraft?: string }).chatDraft =
      `Fix pass for ${toolName} (${toolId}).\nModel: ${modelId}\n\nContext:\n${slice.createToolPrdExpectedBehavior || "No PRD summary yet."}`;
    slice.createToolStatusMessage = "Opened fix workflow in Chat with seeded context.";
    return true;
  }
  if (action === "validate") {
    validateCreateToolPreview(slice);
    return true;
  }
  if (action === "create-files") {
    await deps.createTool.createScaffold();
    const toolId = slice.createToolSpec.toolId.trim();
    if (toolId) {
      (slice as unknown as { workspaceTab?: string }).workspaceTab = `${toolId}-tool`;
    }
    return true;
  }
  if (action === "register-tool") {
    await deps.createTool.registerTool();
    return true;
  }
  if (action === "open-files-root") {
    await deps.files.listFilesDirectory();
    return true;
  }
  if (action === "select-preview") {
    const path = actionTarget?.getAttribute(DATA_PATH) ?? "";
    selectCreateToolPreviewPath(slice, path);
    return true;
  }
  return false;
}

export function handleCreateToolInput(
  target: HTMLElement,
  slice: CreateToolRuntimeSlice
): { handled: boolean; rerender: boolean } {
  const field = target.getAttribute(DATA_FIELD);
  if (!field) return { handled: false, rerender: false };
  const input = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (
    field === "selectedModelId" ||
    field === "toolName" ||
    field === "description" ||
    field === "iconKey" ||
    field === "customIconFromAll" ||
    field === "prdUiPreset" ||
    field === "prdUiNotes" ||
    field === "prdInputs" ||
    field === "prdProcess" ||
    field === "prdConnections" ||
    field === "prdDependencies" ||
    field === "prdExpectedBehavior" ||
    field === "prdOutputs" ||
    field === "prdMarkdownDoc" ||
    field === "iconBrowserQuery" ||
    field === "devPlan" ||
    field === "fixNotes"
  ) {
    updateCreateToolField(slice, field, input.value);
    if (field === "iconBrowserQuery" && /\s$/.test(input.value)) {
      applyCreateToolIconSearch(slice);
      return {
        handled: true,
        rerender: true
      };
    }
    return {
      handled: true,
      rerender: false
    };
  }
  return { handled: false, rerender: false };
}

export function handleCreateToolChange(target: HTMLElement, slice: CreateToolRuntimeSlice): boolean {
  if (!(target instanceof HTMLInputElement)) return false;
  const guard = target.getAttribute(DATA_GUARD);
  if (!guard) return false;
  if (
    guard === "allowLocalStorage" ||
    guard === "allowIpc" ||
    guard === "allowExternalNetwork" ||
    guard === "readOnlyMode"
  ) {
    updateCreateToolGuardrail(slice, guard, target.checked);
    return true;
  }
  return false;
}
