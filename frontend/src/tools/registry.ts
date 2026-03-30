import type { ToolManifest } from "./types";
import {
  terminalToolManifest,
  filesToolManifest,
  webSearchToolManifest,
  flowToolManifest,
  tasksToolManifest,
  memoryToolManifest,
  skillsToolManifest
} from "./index";

export const TOOL_REGISTRY: Record<string, ToolManifest> = {
  terminal: terminalToolManifest,
  files: filesToolManifest,
  webSearch: webSearchToolManifest,
  flow: flowToolManifest,
  tasks: tasksToolManifest,
  memory: memoryToolManifest,
  skills: skillsToolManifest
};

export const TOOL_ORDER = [
  "terminal",
  "files",
  "webSearch",
  "flow",
  "tasks",
  "memory",
  "skills"
] as const;

function canonicalToolId(toolId: string): string {
  return toolId === "web" ? "webSearch" : toolId;
}

export function getToolManifest(toolId: string): ToolManifest | null {
  const normalized = canonicalToolId(toolId);
  return TOOL_REGISTRY[normalized] ?? null;
}

export function getAllToolManifests(): ToolManifest[] {
  return TOOL_ORDER.map((toolId) => TOOL_REGISTRY[toolId]).filter(
    (manifest): manifest is ToolManifest => Boolean(manifest)
  );
}
