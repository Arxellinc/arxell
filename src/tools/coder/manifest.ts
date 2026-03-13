import { Bot } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { CoderPanel } from "../../components/Workspace/panels/CoderPanel";

export const codexToolManifest: ToolManifest = {
  id: "codex",
  version: "1.0.0",
  title: "Codex",
  description: "Agentic coding with Codex (`codex` CLI)",
  iconName: "Bot",
  icon: Bot,
  category: "main",
  panel: CoderPanel,
  defaultEnabled: false,
  core: true,
  allowedModes: ["sandbox", "shell", "root"],
  defaultMode: "shell",
  capabilities: {
    commands: ["coder.pi_prompt", "coder.pi_version", "coder.pi_diagnostics"],
    process: { allowExec: true, allowRoot: true },
    fs: { read: ["workspace"], write: ["workspace"] },
  },
};
