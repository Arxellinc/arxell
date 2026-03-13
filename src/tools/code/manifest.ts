import { Code2 } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";

export const codeToolManifest: ToolManifest = {
  id: "code",
  version: "1.0.0",
  title: "IDE",
  description: "Current workspace code",
  iconName: "Code2",
  icon: Code2,
  category: "main",
  coreWorkbenchSurface: true,
  showInToolbar: true,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {
    fs: { read: ["workspace"], write: ["workspace"] },
  },
};
