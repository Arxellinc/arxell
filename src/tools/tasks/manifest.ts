import { ListTodo } from "lucide-react";
import type { ToolManifest } from "../../core/tooling/types";
import { TasksPanel } from "../../components/Workspace/panels/TasksPanel";

export const tasksToolManifest: ToolManifest = {
  id: "tasks",
  version: "1.0.0",
  title: "Tasks",
  description: "Scheduled tasks and jobs",
  iconName: "ListTodo",
  icon: ListTodo,
  category: "main",
  panel: TasksPanel,
  defaultEnabled: true,
  core: true,
  allowedModes: ["sandbox"],
  defaultMode: "sandbox",
  capabilities: {},
};
