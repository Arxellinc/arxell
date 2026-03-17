import type { ToolId, ToolManifest, ToolPanelId } from "./types";
import {
  flowToolManifest,
  agentsToolManifest,
  avatarToolManifest,
  businessToolManifest,
  codexToolManifest,
  codeToolManifest,
  devicesToolManifest,
  emailToolManifest,
  extensionsToolManifest,
  filesToolManifest,
  helpToolManifest,
  llmToolManifest,
  notesToolManifest,
  piToolManifest,
  serveToolManifest,
  settingsToolManifest,
  syncToolManifest,
  tasksToolManifest,
  terminalToolManifest,
  toolsToolManifest,
  webToolManifest,
} from "../../tools";

export const TOOL_REGISTRY: Record<ToolId, ToolManifest> = {
  avatar: avatarToolManifest,
  settings: settingsToolManifest,
  business: businessToolManifest,
  files: filesToolManifest,
  llm: llmToolManifest,
  tasks: tasksToolManifest,
  tools: toolsToolManifest,
  email: emailToolManifest,
  extensions: extensionsToolManifest,
  devices: devicesToolManifest,
  project: agentsToolManifest,
  flow: flowToolManifest,
  codex: codexToolManifest,
  code: codeToolManifest,
  web: webToolManifest,
  help: helpToolManifest,
  notes: notesToolManifest,
  terminal: terminalToolManifest,
  pi: piToolManifest,
  serve: serveToolManifest,
  sync: syncToolManifest,
};

const TOOL_ORDER: ToolId[] = [
  "avatar",
  "serve",
  "tools",
  "project",
  "flow",
  "terminal",
  "pi",
  "web",
  "business",
  "files",
  "llm",
  "tasks",
  "email",
  "extensions",
  "codex",
  "code",
  "notes",
  "sync",
  "devices",
  "settings",
  "help",
];

export function getToolManifest(id: ToolPanelId) {
  if (id === "none") return null;
  return TOOL_REGISTRY[id] ?? null;
}

export function getAllToolManifests(): ToolManifest[] {
  return TOOL_ORDER.map((id) => TOOL_REGISTRY[id]);
}

export function getToolbarMainTools(): ToolManifest[] {
  return getAllToolManifests().filter((tool) => tool.showInToolbar !== false && tool.category === "main");
}

export function getToolbarAuxTools(): ToolManifest[] {
  return getAllToolManifests().filter((tool) => tool.showInToolbar !== false && tool.category === "aux");
}

export function getHostedPanel(id: ToolPanelId) {
  const manifest = getToolManifest(id);
  if (!manifest || manifest.coreWorkbenchSurface) return null;
  return manifest.panel ?? null;
}
