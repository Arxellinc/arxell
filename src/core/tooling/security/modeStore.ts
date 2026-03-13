import { create } from "zustand";
import type { ToolId, ToolMode } from "../types";

const STORAGE_KEY = "arx.toolModes.v1";

function loadModes(): Partial<Record<ToolId, ToolMode>> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<ToolId, ToolMode>>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function persistModes(modes: Partial<Record<ToolId, ToolMode>>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // ignore storage failures
  }
}

interface ModeState {
  toolModes: Partial<Record<ToolId, ToolMode>>;
  setMode: (toolId: ToolId, mode: ToolMode) => void;
  getMode: (toolId: ToolId, defaultMode: ToolMode) => ToolMode;
  resetModes: () => void;
}

export const useToolModeStore = create<ModeState>((set, get) => ({
  toolModes: loadModes(),
  setMode: (toolId, mode) =>
    set((state) => {
      const next = { ...state.toolModes, [toolId]: mode };
      persistModes(next);
      return { toolModes: next };
    }),
  getMode: (toolId, defaultMode) => get().toolModes[toolId] ?? defaultMode,
  resetModes: () => {
    persistModes({});
    set({ toolModes: {} });
  },
}));
