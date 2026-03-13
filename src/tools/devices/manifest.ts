import { Computer } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { NewProjectPanel } from "../../components/Workspace/panels/SystemPanel";

export const devicesToolManifest: ToolManifest = {
  id: "devices",
  version: "1.0.0",
  title: "Devices",
  description: "System topology, connected devices, and resources",
  iconName: "Computer",
  icon: Computer,
  category: "main",
  panel: NewProjectPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {
    commands: ["system.resources", "system.storage", "system.display", "system.identity"],
  },
};
