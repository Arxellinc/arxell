import type { ToolManifest } from "./types";
import {
  terminalToolManifest,
  filesToolManifest,
  webToolManifest,
  flowToolManifest,
  llmToolManifest,
  tasksToolManifest,
  memoryToolManifest,
  skillsToolManifest,
  modelsToolManifest,
  voiceToolManifest,
  devicesToolManifest,
  settingsToolManifest
} from "./index";

export const TOOL_REGISTRY: Record<string, ToolManifest> = {
  terminal: terminalToolManifest,
  files: filesToolManifest,
  web: webToolManifest,
  flow: flowToolManifest,
  llm: llmToolManifest,
  tasks: tasksToolManifest,
  memory: memoryToolManifest,
  skills: skillsToolManifest,
  models: modelsToolManifest,
  voice: voiceToolManifest,
  devices: devicesToolManifest,
  settings: settingsToolManifest
};

export const TOOL_ORDER = [
  "terminal",
  "files",
  "web",
  "flow",
  "llm",
  "tasks",
  "memory",
  "skills",
  "models",
  "voice",
  "devices",
  "settings"
] as const;

export function getToolManifest(toolId: string): ToolManifest | null {
  return TOOL_REGISTRY[toolId] ?? null;
}

export function getAllToolManifests(): ToolManifest[] {
  return TOOL_ORDER.map((toolId) => TOOL_REGISTRY[toolId]).filter(
    (manifest): manifest is ToolManifest => Boolean(manifest)
  );
}
