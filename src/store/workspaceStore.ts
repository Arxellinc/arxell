import { create } from "zustand";
import type { OpenTab } from "../types";

type WorkspaceView = "editor" | "diff" | "markdown";

interface DiffState {
  original: string;
  modified: string;
  language: string;
  title: string;
}

interface WorkspaceStore {
  tabs: OpenTab[];
  activeTabPath: string | null;
  view: WorkspaceView;
  diffState: DiffState | null;
  sidebarPath: string;

  openTab: (tab: OpenTab) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  markTabModified: (path: string, modified: boolean) => void;
  renameTab: (oldPath: string, newPath: string, newName: string) => void;
  setView: (view: WorkspaceView) => void;
  setDiff: (diff: DiffState | null) => void;
  setSidebarPath: (path: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  tabs: [],
  activeTabPath: null,
  view: "editor",
  diffState: null,
  sidebarPath: "",

  openTab: (tab) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.path === tab.path);
      if (existing) return { activeTabPath: tab.path, view: "editor" };
      return { tabs: [...s.tabs, tab], activeTabPath: tab.path, view: "editor" };
    }),

  closeTab: (path) =>
    set((s) => {
      const newTabs = s.tabs.filter((t) => t.path !== path);
      let newActive = s.activeTabPath;
      if (s.activeTabPath === path) {
        const idx = s.tabs.findIndex((t) => t.path === path);
        newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.path ?? null;
      }
      return { tabs: newTabs, activeTabPath: newActive };
    }),

  setActiveTab: (path) => set({ activeTabPath: path, view: "editor" }),

  updateTabContent: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, content, modified: true } : t
      ),
    })),

  markTabModified: (path, modified) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, modified } : t)),
    })),

  renameTab: (oldPath, newPath, newName) =>
    set((s) => {
      const tabs = s.tabs.map((t) =>
        t.path === oldPath ? { ...t, path: newPath, name: newName } : t
      );
      const activeTabPath = s.activeTabPath === oldPath ? newPath : s.activeTabPath;
      return { tabs, activeTabPath };
    }),

  setView: (view) => set({ view }),
  setDiff: (diffState) => set({ diffState, view: diffState ? "diff" : "editor" }),
  setSidebarPath: (sidebarPath) => set({ sidebarPath }),
}));
