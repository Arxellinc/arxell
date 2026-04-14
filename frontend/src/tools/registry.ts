import type { ToolManifest } from "./types";
interface ManifestModuleRecord {
  [key: string]: unknown;
}

const manifestModules = import.meta.glob("./*/manifest.ts", {
  eager: true
}) as Record<string, ManifestModuleRecord>;

function isToolManifest(value: unknown): value is ToolManifest {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    typeof row.description === "string" &&
    typeof row.version === "string"
  );
}

function extractManifest(moduleRecord: ManifestModuleRecord): ToolManifest | null {
  for (const value of Object.values(moduleRecord)) {
    if (isToolManifest(value)) {
      return value;
    }
  }
  return null;
}

function buildRegistry(): Record<string, ToolManifest> {
  const registry: Record<string, ToolManifest> = {};
  Object.values(manifestModules).forEach((moduleRecord) => {
    const manifest = extractManifest(moduleRecord);
    if (!manifest) return;
    registry[manifest.id] = manifest;
  });
  return registry;
}

export const TOOL_REGISTRY: Record<string, ToolManifest> = buildRegistry();

const PREFERRED_TOOL_ORDER = [
  "terminal",
  "files",
  "webSearch",
  "chart",
  "flow",
  "tasks",
  "memory",
  "skills"
] as const;

function buildToolOrder(): string[] {
  const discovered = new Set(Object.keys(TOOL_REGISTRY));
  const ordered: string[] = [];
  PREFERRED_TOOL_ORDER.forEach((toolId) => {
    if (!discovered.has(toolId)) return;
    ordered.push(toolId);
    discovered.delete(toolId);
  });
  return [...ordered, ...Array.from(discovered).sort((a, b) => a.localeCompare(b))];
}

export const TOOL_ORDER = buildToolOrder();

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
