import type { ToolManifest } from "../types";

export const flowToolManifest: ToolManifest = {
  id: "flow",
  version: "1.0.0",
  title: "Flow",
  description: "Node-based workflow orchestration surface",
  category: "agent",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "git-compare-arrows"
};
