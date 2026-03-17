import { Network } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { FlowPanel } from "../../components/Workspace/panels/FlowPanel";

export const flowToolManifest: ToolManifest = {
  id: "flow",
  version: "1.0.0",
  title: "Flow",
  description: "Create and execute agentic workflows",
  iconName: "Network",
  icon: Network,
  category: "main",
  panel: FlowPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {
    process: { allowExec: true },
  },
};
