import { StickyNote } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { NotesPanel } from "../../components/Workspace/panels/NotesPanel";

export const notesToolManifest: ToolManifest = {
  id: "notes",
  version: "1.0.0",
  title: "Notes",
  description: "Notes to self for the agent",
  iconName: "StickyNote",
  icon: StickyNote,
  category: "main",
  panel: NotesPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {},
};
