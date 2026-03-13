import { Wrench } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { ToolsPanel } from "../../components/Workspace/panels/ExtensionsPanel";

export const toolsToolManifest: ToolManifest = {
  id: "tools",
  version: "1.0.0",
  title: "Tools",
  description: "Manage active and optional tools",
  iconName: "Wrench",
  icon: Wrench,
  category: "main",
  panel: ToolsPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox", "shell"],
  defaultMode: "sandbox",
  capabilities: {
    process: { allowExec: true },
  },
};
