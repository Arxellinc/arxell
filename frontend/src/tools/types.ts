import type { IconName } from "../icons";

export type ToolCategory = "workspace" | "agent" | "models" | "data" | "media" | "ops";

export interface ToolManifest {
  id: string;
  version: string;
  title: string;
  description: string;
  category: ToolCategory;
  core: boolean;
  defaultEnabled: boolean;
  source: "builtin" | "imported";
  icon: IconName;
}
