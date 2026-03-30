import type { ToolManifest } from "../types";

export const webSearchToolManifest: ToolManifest = {
  id: "webSearch",
  version: "1.0.0",
  title: "WebSearch",
  description: "Search and fetch web context for tasks",
  category: "agent",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "search"
};
