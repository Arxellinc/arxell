import type { ToolManifest } from "../types";

export const createToolManifest: ToolManifest = {
  id: "createTool",
  version: "1.0.0",
  title: "Create Tool",
  description: "Scaffold and register new custom tools with guardrails",
  category: "workspace",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "package-search"
};
