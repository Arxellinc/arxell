import { Network } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { A2APanel } from "../../components/Workspace/panels/A2APanel";

export const a2aToolManifest: ToolManifest = {
  id: "flow",
  version: "1.0.0",
  title: "Flow",
  description: "Create and execute agentic workflows",
  iconName: "Network",
  icon: Network,
  category: "main",
  panel: A2APanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {
    process: { allowExec: true },
  },
};
