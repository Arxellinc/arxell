import type { ToolManifest } from "../types";

export const settingsToolManifest: ToolManifest = {
  id: "settings",
  version: "1.0.0",
  title: "Settings",
  description: "System and tool runtime preferences",
  category: "ops",
  core: true,
  defaultEnabled: true,
  source: "builtin",
  icon: "settings"
};
