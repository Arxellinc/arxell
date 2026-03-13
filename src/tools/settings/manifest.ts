import { SlidersHorizontal } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { SafeSettingsPanel } from "../../components/Workspace/panels/SafeSettingsPanel";

export const settingsToolManifest: ToolManifest = {
  id: "settings",
  version: "1.0.0",
  title: "Settings",
  description: "Safe runtime settings for the primary agent",
  iconName: "SlidersHorizontal",
  icon: SlidersHorizontal,
  category: "aux",
  panel: SafeSettingsPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {},
};
