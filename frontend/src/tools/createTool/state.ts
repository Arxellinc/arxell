export type CreateToolTemplateId =
  | "basic-view"
  | "list-detail"
  | "form-tool"
  | "event-viewer"
  | "agent-utility";

export interface CreateToolGuardrails {
  allowLocalStorage: boolean;
  allowIpc: boolean;
  allowExternalNetwork: boolean;
  readOnlyMode: boolean;
}

export interface CreateToolSpec {
  toolName: string;
  toolId: string;
  description: string;
  category: "workspace" | "agent" | "models" | "data" | "media" | "ops";
  templateId: CreateToolTemplateId;
  iconKey: string;
  customIconFromAll: string;
  guardrails: CreateToolGuardrails;
}

export interface CreateToolRuntimeSlice {
  createToolSpec: CreateToolSpec;
  createToolWorkspaceRoot: string;
  createToolPreviewFiles: Record<string, string>;
  createToolPreviewOrder: string[];
  createToolSelectedPreviewPath: string;
  createToolValidationErrors: string[];
  createToolValidationWarnings: string[];
  createToolStatusMessage: string | null;
  createToolLastResultJson: string;
  createToolBusy: boolean;
}

export const DEFAULT_CREATE_TOOL_SPEC: CreateToolSpec = {
  toolName: "",
  toolId: "",
  description: "",
  category: "workspace",
  templateId: "basic-view",
  iconKey: "wrench",
  customIconFromAll: "",
  guardrails: {
    allowLocalStorage: true,
    allowIpc: false,
    allowExternalNetwork: false,
    readOnlyMode: false
  }
};
