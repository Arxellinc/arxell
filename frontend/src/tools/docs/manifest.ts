import type { ToolManifest } from "../types";

export const docsToolManifest: ToolManifest = {
  id: "docs",
  version: "1.0.0",
  title: "Docs",
  description: "Browse and read documentation files",
  category: "workspace",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "circle-question-mark"
};