export type CreateToolStage = "meta" | "prd" | "build" | "fix";
export type CreateToolPrdSection =
  | "UI"
  | "INPUTS"
  | "PROCESS"
  | "CONNECTIONS"
  | "DEPENDENCIES"
  | "EXPECTED_BEHAVIOR"
  | "OUTPUTS";

export type CreateToolUiPreset =
  | "left-sidebar"
  | "right-sidebar"
  | "both-sidebars"
  | "no-sidebar";

export type CreateToolLayoutModifier =
  | "modal-focused"
  | "secondary-toolbar"
  | "chat-sidecar"
  | "bottom-console"
  | "wizard-steps"
  | "map-canvas"
  | "split-main-detail"
  | "triple-panel"
  | "timeline-console"
  | "dashboard-cards"
  | "tabbed-workbench"
  | "command-palette-first";

export interface CreateToolModelOption {
  id: string;
  label: string;
  source: "primary" | "api" | "model-manager";
  detail?: string;
}

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
  iconKey: string;
  customIconFromAll: string;
  guardrails: CreateToolGuardrails;
}

export interface CreateToolRuntimeSlice {
  createToolStage: CreateToolStage;
  createToolModelOptions: CreateToolModelOption[];
  createToolSelectedModelId: string;
  createToolPrdUiPreset: CreateToolUiPreset;
  createToolLayoutModifiers: CreateToolLayoutModifier[];
  createToolPrdUiNotes: string;
  createToolPrdInputs: string;
  createToolPrdProcess: string;
  createToolPrdConnections: string;
  createToolPrdDependencies: string;
  createToolPrdExpectedBehavior: string;
  createToolPrdOutputs: string;
  createToolDevPlan: string;
  createToolBuildViewMode: "code" | "preview";
  createToolUiPreviewHtml: string;
  createToolFixNotes: string;
  createToolIconBrowserOpen: boolean;
  createToolIconBrowserQuery: string;
  createToolIconBrowserAppliedQuery: string;
  createToolIconLibrary: Array<{ name: string; svg: string }>;
  createToolSpec: CreateToolSpec;
  createToolWorkspaceRoot: string;
  createToolPreviewFiles: Record<string, string>;
  createToolPreviewOrder: string[];
  createToolSelectedPreviewPath: string;
  createToolValidationErrors: string[];
  createToolValidationWarnings: string[];
  createToolStatusMessage: string | null;
  createToolLastResultJson: string;
  createToolPrdGeneratingSection: CreateToolPrdSection | null;
  createToolPrdGeneratingAll: boolean;
  createToolPrdReviewBusy: boolean;
  createToolPrdReviewFindings: Array<{
    severity: "critical" | "high" | "medium";
    section: "INPUTS" | "PROCESS" | "CONNECTIONS" | "DEPENDENCIES" | "EXPECTED_BEHAVIOR" | "OUTPUTS";
    title: string;
    detail: string;
    suggestion: string;
  }>;
  createToolBusy: boolean;
}

export const DEFAULT_CREATE_TOOL_SPEC: CreateToolSpec = {
  toolName: "",
  toolId: "",
  description: "",
  category: "workspace",
  iconKey: "wrench",
  customIconFromAll: "",
  guardrails: {
    allowLocalStorage: true,
    allowIpc: false,
    allowExternalNetwork: false,
    readOnlyMode: false
  }
};

export const DEFAULT_CREATE_TOOL_UI_PREVIEW_HTML = `<div style="padding:12px;font:13px/1.4 ui-sans-serif,system-ui,sans-serif;color:#3f4b59;">
  Build preview will appear here after Step 3.
</div>`;
