import {
  generateCreateToolPreview,
  selectCreateToolPreviewPath,
  updateCreateToolField,
  updateCreateToolGuardrail,
  validateCreateToolPreview
} from "./actions";
import type { CreateToolRuntimeSlice } from "./state";

const DATA_ACTION = "data-create-tool-action";
const DATA_FIELD = "data-create-tool-field";
const DATA_GUARD = "data-create-tool-guard";
const DATA_PATH = "data-create-tool-path";

interface CreateToolDeps {
  createTool: {
    createScaffold: () => Promise<void>;
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

export function handleCreateToolInput(target: HTMLElement, slice: CreateToolRuntimeSlice): boolean {
  const field = target.getAttribute(DATA_FIELD);
  if (!field) return false;
  const input = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (
    field === "toolName" ||
    field === "toolId" ||
    field === "description" ||
    field === "category" ||
    field === "templateId" ||
    field === "iconKey" ||
    field === "customIconFromAll"
  ) {
    updateCreateToolField(slice, field, input.value);
    return true;
  }
  return false;
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
