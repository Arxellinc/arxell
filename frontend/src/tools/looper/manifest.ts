import type { ToolManifest } from "../types";

export const looperToolManifest: ToolManifest = {
  id: "looper",
  version: "1.0.0",
  title: "Looper",
  description: "Multi-agent Ralph loop orchestration with Planner, Executor, Validator, and Critic",
  category: "workspace",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "refresh-cw"
};
