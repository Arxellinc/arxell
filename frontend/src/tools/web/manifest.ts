import type { ToolManifest } from "../types";

export const webToolManifest: ToolManifest = {
  id: "web",
  version: "1.0.0",
  title: "Web",
  description: "Search and fetch web context for tasks",
  category: "agent",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "list"
};
