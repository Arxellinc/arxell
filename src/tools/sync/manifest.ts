import { Wifi } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { SyncPanel } from "../../components/Workspace/panels/SyncPanel";

export const syncToolManifest: ToolManifest = {
  id: "sync",
  version: "1.0.0",
  title: "Sync",
  description: "P2P and cloud sync coordination across devices",
  iconName: "Wifi",
  icon: Wifi,
  category: "main",
  showInToolbar: false,
  panel: SyncPanel,
  defaultEnabled: true,
  core: false,
  allowedModes: ["sandbox", "shell"],
  defaultMode: "sandbox",
  capabilities: {
    net: { hosts: [] },
  },
};
