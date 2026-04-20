import type { ToolManifest } from "../types";

export const sheetsToolManifest: ToolManifest = {
  id: "sheets",
  version: "1.0.0",
  title: "Sheets",
  description: "Backend-backed sheet editor for structured workspace data",
  category: "data",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "table-2"
};
