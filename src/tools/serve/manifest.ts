import { Cpu } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { ServePanelWrapper } from "../../components/Workspace/panels/ServePanelWrapper";

export const serveToolManifest: ToolManifest = {
  id: "serve",
  version: "1.0.0",
  title: "Serve",
  description: "Local model server",
  iconName: "Cpu",
  icon: Cpu,
  category: "main",
  panel: ServePanelWrapper,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox", "shell"],
  defaultMode: "sandbox",
  capabilities: {
    commands: ["serve.load", "serve.unload", "serve.runtime"],
    fs: { read: ["app_data/models"] },
    process: { allowExec: true },
  },
};
