import type { ToolManifest } from "../types";

export const flowToolManifest: ToolManifest = {
  id: "flow",
  version: "1.0.0",
  title: "Flow",
  description: "Node-based workflow orchestration surface",
  category: "agent",
  core: false,
  defaultEnabled: false,
  source: "builtin",
  icon: "wrench"
};
