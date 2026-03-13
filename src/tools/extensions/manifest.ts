import { Puzzle } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { McpPanel } from "../../components/Workspace/panels/McpPanel";

export const extensionsToolManifest: ToolManifest = {
  id: "extensions",
  version: "1.0.0",
  title: "MCP",
  description: "Manage local MCP servers for agent access",
  iconName: "Puzzle",
  icon: Puzzle,
  category: "main",
  panel: McpPanel,
  defaultEnabled: false,
  core: true,
  allowedModes: ["sandbox", "shell"],
  defaultMode: "sandbox",
  capabilities: {
    process: { allowExec: true },
  },
};
