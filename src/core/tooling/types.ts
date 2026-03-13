import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type ToolPanelId =
  | "avatar"
  | "settings"
  | "codex"
  | "files"
  | "llm"
  | "tasks"
  | "tools"
  | "email"
  | "business"
  | "extensions"
  | "devices"
  | "project"
  | "flow"
  | "code"
  | "web"
  | "help"
  | "notes"
  | "terminal"
  | "pi"
  | "serve"
  | "sync"
  | "none";

export type ToolId = Exclude<ToolPanelId, "none">;

export type ToolMode = "sandbox" | "shell" | "root";

export interface ToolCapabilities {
  commands?: string[];
  fs?: {
    read?: string[];
    write?: string[];
  };
  net?: {
    hosts?: string[];
  };
  process?: {
    allowExec?: boolean;
    allowRoot?: boolean;
  };
}

export interface ToolManifest {
  id: ToolId;
  version: string;
  title: string;
  description: string;
  iconName: string;
  icon: LucideIcon;
  category: "main" | "aux";
  // Core workbench surfaces are not hosted as independent tool panels.
  coreWorkbenchSurface?: boolean;
  showInToolbar?: boolean;
  // When false/omitted, ToolHost suppresses native context menu for this tool panel.
  allowNativeContextMenu?: boolean;
  panel?: ComponentType;
  defaultEnabled: boolean;
  core: boolean;
  allowedModes: ToolMode[];
  defaultMode: ToolMode;
  capabilities: ToolCapabilities;
}

export interface ToolInvokeRequest {
  toolId: ToolId;
  action: string;
  mode: ToolMode;
  payload?: unknown;
}
