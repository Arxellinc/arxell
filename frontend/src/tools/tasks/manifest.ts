import type { ToolManifest } from "../types";

export const tasksToolManifest: ToolManifest = {
  id: "tasks",
  version: "1.0.0",
  title: "Tasks",
  description: "Task planning and status tracking",
  category: "agent",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "history"
};
