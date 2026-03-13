import { Globe } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { WebPanel } from "../../components/Workspace/panels/WebPanel";

export const webToolManifest: ToolManifest = {
  id: "web",
  version: "1.0.0",
  title: "Web",
  description: "Browse the web",
  iconName: "Globe",
  icon: Globe,
  category: "main",
  panel: WebPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox", "shell"],
  defaultMode: "sandbox",
  capabilities: {
    commands: ["browser.fetch", "browser.search", "browser.search.key_set", "browser.search.key_status", "browser.search.key_test", "browser.search.key_validate"],
    net: { hosts: ["*"] },
  },
};
