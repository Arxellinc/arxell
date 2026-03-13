import { CircleHelp } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { HelpPanel } from "../../components/Workspace/panels/HelpPanel";

export const helpToolManifest: ToolManifest = {
  id: "help",
  version: "1.0.0",
  title: "Help",
  description: "Browse project help markdown files",
  iconName: "CircleHelp",
  icon: CircleHelp,
  category: "aux",
  panel: HelpPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {
    commands: ["workspace.list_dir", "workspace.read_file"],
    fs: { read: ["workspace/help", "workspace/docs"] },
  },
};
