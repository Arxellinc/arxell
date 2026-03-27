import type { ToolManifest } from "../types";

export const memoryToolManifest: ToolManifest = {
  id: "memory",
  version: "1.0.0",
  title: "Memory",
  description: "Persistent context and memory references",
  category: "data",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "brain"
};
