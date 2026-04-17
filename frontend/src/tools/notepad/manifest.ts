import type { ToolManifest } from "../types";

export const notepadToolManifest: ToolManifest = {
  id: "notepad",
  version: "1.0.0",
  title: "Notepad",
  description: "Tabbed text editor for workspace files and scratch buffers",
  category: "workspace",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "file-text"
};
