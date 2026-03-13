import { Briefcase } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { BusinessAnalystPanel } from "../../components/Workspace/panels/BusinessAnalystPanel";

export const businessToolManifest: ToolManifest = {
  id: "business",
  version: "1.0.0",
  title: "Business",
  description: "Premium autonomous business analysis and planning",
  iconName: "Briefcase",
  icon: Briefcase,
  category: "main",
  panel: BusinessAnalystPanel,
  defaultEnabled: false,
  core: false,
  allowedModes: ["sandbox", "shell"],
  defaultMode: "sandbox",
  capabilities: {
    net: { hosts: [] },
    process: { allowExec: true },
  },
};
