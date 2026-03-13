import { FolderTree } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";

export const filesToolManifest: ToolManifest = {
  id: "files",
  version: "1.0.0",
  title: "Files",
  description: "Browse workspace files",
  iconName: "FolderTree",
  icon: FolderTree,
  category: "main",
  coreWorkbenchSurface: true,
  showInToolbar: true,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {
    fs: { read: ["workspace"] },
  },
};
