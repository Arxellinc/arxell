import { Terminal } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { TerminalToolPanel } from "../../components/Workspace/panels/TerminalToolPanel";

export const terminalToolManifest: ToolManifest = {
  id: "terminal",
  version: "1.0.0",
  title: "Terminal",
  description: "Guardrailed system terminal session",
  iconName: "Terminal",
  icon: Terminal,
  category: "main",
  panel: TerminalToolPanel,
  defaultEnabled: true,
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
