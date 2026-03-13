import { Users } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { AgentsPanel } from "../../components/Workspace/panels/AgentsPanel";

export const agentsToolManifest: ToolManifest = {
  id: "project",
  version: "1.0.0",
  title: "Project",
  description: "Delegate to child agents",
  iconName: "Users",
  icon: Users,
  category: "main",
  panel: AgentsPanel,
  defaultEnabled: false,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {},
};
