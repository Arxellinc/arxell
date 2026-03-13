import { create } from "zustand";
import type { ToolId, ToolMode } from "../core/tooling/types";

interface SessionEntry {
  sessionId: number | null;
  mode: ToolMode;
  ready: boolean;
}

interface TerminalSessionState {
  sessions: Partial<Record<ToolId, SessionEntry>>;
  setSession: (toolId: ToolId, sessionId: number | null, mode: ToolMode, ready?: boolean) => void;
  setReady: (toolId: ToolId, ready: boolean) => void;
  getSession: (toolId: ToolId) => SessionEntry | null;
  clearSession: (toolId: ToolId) => void;
}

export const useTerminalSessionStore = create<TerminalSessionState>((set, get) => ({
  sessions: {},

  setSession: (toolId, sessionId, mode, ready) =>
    set((state) => {
      const existing = state.sessions[toolId];
      const nextReady =
        typeof ready === "boolean" ? ready : existing?.ready ?? false;
      return {
        sessions: {
          ...state.sessions,
          [toolId]: { sessionId, mode, ready: nextReady },
        },
      };
    }),

  setReady: (toolId, ready) =>
    set((state) => {
      const existing = state.sessions[toolId];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [toolId]: { ...existing, ready },
        },
      };
    }),

  getSession: (toolId) => get().sessions[toolId] ?? null,

  clearSession: (toolId) =>
    set((state) => {
      const next = { ...state.sessions };
      delete next[toolId];
      return { sessions: next };
    }),
}));
