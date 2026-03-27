import type { ToolManifest } from "../types";

export const devicesToolManifest: ToolManifest = {
  id: "devices",
  version: "1.0.0",
  title: "Devices",
  description: "Audio and hardware device controls",
  category: "ops",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "monitor"
};
