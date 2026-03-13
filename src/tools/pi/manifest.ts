import { Bot } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { PiToolPanel } from "../../components/Workspace/panels/PiToolPanel";

export const piToolManifest: ToolManifest = {
  id: "pi",
  version: "1.0.0",
  title: "Pi",
  description: "CLI coding agent terminal (Pi)",
  iconName: "Bot",
  icon: Bot,
  category: "main",
  panel: PiToolPanel,
  allowNativeContextMenu: true,
  defaultEnabled: false,
  core: true,
  allowedModes: ["sandbox", "shell", "root"],
  defaultMode: "sandbox",
  capabilities: {
    commands: [
      "terminal.resolve_path",
      "terminal.exec",
      "terminal.session_start",
      "terminal.session_write",
      "terminal.session_read",
      "terminal.session_resize",
      "terminal.session_close",
    ],
    process: { allowExec: true, allowRoot: true },
    fs: { read: ["workspace"], write: ["workspace"] },
  },
};
