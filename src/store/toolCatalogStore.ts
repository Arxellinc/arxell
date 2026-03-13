import { create } from "zustand";
import type { ToolId } from "../core/tooling/types";

export interface OptionalToolDefinition {
  id: string;
  title: string;
  description: string;
  source: "local" | "github";
  repo?: string;
  installed: boolean;
  enabled: boolean;
  linkedToolId?: ToolId;
}

interface ToolCatalogState {
  enabledToolIds: ToolId[];
  optionalTools: OptionalToolDefinition[];
  isToolEnabled: (id: ToolId) => boolean;
  setToolEnabled: (id: ToolId, enabled: boolean) => void;
  installOptionalTool: (id: string) => void;
  uninstallOptionalTool: (id: string) => void;
  setOptionalToolEnabled: (id: string, enabled: boolean) => void;
}

const STORAGE_KEY = "arx.toolCatalog.v1";

const ALL_TOOL_IDS: ToolId[] = [
  "avatar",
  "settings",
  "codex",
  "files",
  "llm",
  "tasks",
  "tools",
  "email",
  "business",
  "extensions",
  "devices",
  "project",
  "flow",
  "code",
  "web",
  "help",
  "notes",
  "terminal",
  "pi",
  "serve",
  "sync",
];

const DEFAULT_ENABLED_TOOL_IDS: ToolId[] = [
  "avatar",
  "settings",
  "files",
  "llm",
  "tasks",
  "sync",
  "tools",
  "devices",
  "flow",
  "code",
  "web",
  "pi",
  "terminal",
  "serve",
  "help",
];

const DEFAULT_OPTIONAL_TOOLS: OptionalToolDefinition[] = [
  {
    id: "optional-email",
    title: "Email Client",
    description: "Ultralight text-only IMAP/SMTP client.",
    source: "local",
    installed: false,
    enabled: false,
    linkedToolId: "email",
  },
  {
    id: "premium-business-analyst",
    title: "Business Analyst",
    description: "Autonomous market, feasibility, GTM, and roadmap planning.",
    source: "local",
    installed: false,
    enabled: false,
    linkedToolId: "business",
  },
  {
    id: "github-coding-agents",
    title: "Coding Agents",
    description: "Install additional coding-agent tool adapters (e.g. non-Codex providers).",
    source: "github",
    repo: "github.com/arx/coding-agent-tools",
    installed: false,
    enabled: false,
  },
  {
    id: "github-toolpacks",
    title: "GitHub Tool Packs",
    description: "Install curated tool bundles from GitHub repositories.",
    source: "github",
    repo: "github.com/arx/toolpacks",
    installed: false,
    enabled: false,
  },
  {
    id: "github-community",
    title: "Community Integrations",
    description: "Browse and install community-maintained tool adapters.",
    source: "github",
    repo: "github.com/arx/community-tools",
    installed: false,
    enabled: false,
  },
];

type PersistedCatalogState = {
  enabledToolIds?: ToolId[];
  optionalTools?: OptionalToolDefinition[];
};

function sanitizeToolIds(ids: unknown): ToolId[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => {
      if (id === "agents") return "project";
      if (id === "a2a") return "flow";
      return id;
    })
    .filter((id): id is ToolId => typeof id === "string" && ALL_TOOL_IDS.includes(id as ToolId));
}

function loadPersistedState(): PersistedCatalogState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedCatalogState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function persistState(state: Pick<ToolCatalogState, "enabledToolIds" | "optionalTools">) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        enabledToolIds: state.enabledToolIds,
        optionalTools: state.optionalTools,
      } satisfies PersistedCatalogState)
    );
  } catch {
    // ignore storage failures
  }
}

function initialEnabledToolIds(): ToolId[] {
  const persisted = loadPersistedState();
  const persistedIds = sanitizeToolIds(persisted?.enabledToolIds);
  if (persistedIds.length > 0) return Array.from(new Set(persistedIds));
  return DEFAULT_ENABLED_TOOL_IDS;
}

function initialOptionalTools(): OptionalToolDefinition[] {
  const persisted = loadPersistedState();
  const persistedTools = persisted?.optionalTools;
  if (!Array.isArray(persistedTools) || persistedTools.length === 0) return DEFAULT_OPTIONAL_TOOLS;

  return DEFAULT_OPTIONAL_TOOLS.map((tool) => {
    const saved = persistedTools.find((candidate) => candidate?.id === tool.id);
    if (!saved) return tool;
    return {
      ...tool,
      installed: saved.installed === true,
      enabled: saved.enabled === true,
    };
  });
}

export const useToolCatalogStore = create<ToolCatalogState>((set, get) => ({
  enabledToolIds: initialEnabledToolIds(),
  optionalTools: initialOptionalTools(),

  isToolEnabled: (id) => get().enabledToolIds.includes(id),

  setToolEnabled: (id, enabled) =>
    set((state) => {
      const alreadyEnabled = state.enabledToolIds.includes(id);
      if (enabled && !alreadyEnabled) {
        const nextState = { enabledToolIds: [...state.enabledToolIds, id] };
        persistState({ ...state, ...nextState });
        return nextState;
      }
      if (!enabled && alreadyEnabled) {
        const nextState = { enabledToolIds: state.enabledToolIds.filter((toolId) => toolId !== id) };
        persistState({ ...state, ...nextState });
        return nextState;
      }
      return state;
    }),

  installOptionalTool: (id) =>
    set((state) => {
      const nextState = {
        optionalTools: state.optionalTools.map((tool) =>
        tool.id === id ? { ...tool, installed: true, enabled: true } : tool
      ),
        enabledToolIds: state.optionalTools.reduce<ToolId[]>((acc, tool) => {
        if (tool.id === id && tool.linkedToolId && !acc.includes(tool.linkedToolId)) {
          return [...acc, tool.linkedToolId];
        }
        return acc;
      }, state.enabledToolIds),
      };
      persistState({ ...state, ...nextState });
      return nextState;
    }),

  uninstallOptionalTool: (id) =>
    set((state) => {
      const target = state.optionalTools.find((tool) => tool.id === id) ?? null;
      const nextEnabledToolIds =
        target?.linkedToolId && state.enabledToolIds.includes(target.linkedToolId)
          ? state.enabledToolIds.filter((toolId) => toolId !== target.linkedToolId)
          : state.enabledToolIds;
      const nextState = {
        optionalTools: state.optionalTools.map((tool) =>
          tool.id === id ? { ...tool, installed: false, enabled: false } : tool
        ),
        enabledToolIds: nextEnabledToolIds,
      };
      persistState({ ...state, ...nextState });
      return nextState;
    }),

  setOptionalToolEnabled: (id, enabled) =>
    set((state) => {
      const target = state.optionalTools.find((tool) => tool.id === id) ?? null;
      if (!target || !target.installed) return state;

      const nextEnabledToolIds =
        target.linkedToolId && enabled && !state.enabledToolIds.includes(target.linkedToolId)
          ? [...state.enabledToolIds, target.linkedToolId]
          : target.linkedToolId && !enabled
            ? state.enabledToolIds.filter((toolId) => toolId !== target.linkedToolId)
            : state.enabledToolIds;

      const nextState = {
        optionalTools: state.optionalTools.map((tool) =>
          tool.id === id ? { ...tool, enabled } : tool
        ),
        enabledToolIds: nextEnabledToolIds,
      };
      persistState({ ...state, ...nextState });
      return nextState;
    }),
}));
