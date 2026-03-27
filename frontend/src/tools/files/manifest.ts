import type { ToolManifest } from "../types";

export const filesToolManifest: ToolManifest = {
  id: "files",
  version: "1.0.0",
  title: "Files",
  description: "Workspace file browsing and editing integrations",
  category: "workspace",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "folder"
};
