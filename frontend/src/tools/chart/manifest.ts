import type { ToolManifest } from "../types";

export const chartToolManifest: ToolManifest = {
  id: "chart",
  version: "1.0.0",
  title: "Chart",
  description: "Mermaid flowcharts and diagrams",
  category: "agent",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "git-compare-arrows"
};
