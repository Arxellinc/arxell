import { Server } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { ApiPanel } from "../../components/Workspace/panels/ApiPanel";

export const llmToolManifest: ToolManifest = {
  id: "llm",
  version: "1.0.0",
  title: "API's",
  description: "Available APIs and accounts",
  iconName: "Server",
  icon: Server,
  category: "main",
  panel: ApiPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {
    commands: [
      "model.list_all",
      "model.add",
      "model.update",
      "model.delete",
      "model.set_primary",
      "model.verify",
    ],
    net: { hosts: ["*"] },
  },
};
