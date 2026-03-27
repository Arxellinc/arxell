import type { ToolManifest } from "../types";

export const terminalToolManifest: ToolManifest = {
  id: "terminal",
  version: "1.0.0",
  title: "Terminal",
  description: "PTY shell sessions for local command execution",
  category: "workspace",
  core: true,
  defaultEnabled: true,
  source: "builtin",
  icon: "square-terminal"
};
