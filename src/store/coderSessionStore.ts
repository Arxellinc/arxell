import { create } from "zustand";

export type CoderEntryKind = "command" | "stdout" | "stderr" | "meta" | "warn";

export interface CoderSessionEntry {
  id: string;
  kind: CoderEntryKind;
  text: string;
}

export interface CoderSessionTab {
  id: string;
  title: string;
  sessionId: number | null;
  cwd: string;
  entries: CoderSessionEntry[];
  createdAt: number;
}

interface CoderSessionState {
  tabs: CoderSessionTab[];
  activeTabId: string | null;
  counter: number;
  addTab: (tab: Omit<CoderSessionTab, "entries">) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  appendEntry: (tabId: string, kind: CoderEntryKind, text: string) => void;
  updateTabCwd: (tabId: string, cwd: string) => void;
  setSessionId: (tabId: string, sessionId: number | null) => void;
  renameTab: (tabId: string, title: string) => void;
  clearEntries: (tabId: string) => void;
  nextSessionIndex: () => number;
}

export const useCoderSessionStore = create<CoderSessionState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  counter: 0,

  addTab: (tab) =>
    set((state) => ({
      tabs: [...state.tabs, { ...tab, entries: [] }],
      activeTabId: tab.id,
    })),

  removeTab: (tabId) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      const nextTabs = state.tabs.filter((t) => t.id !== tabId);
      let nextActive = state.activeTabId;
      if (state.activeTabId === tabId) {
        if (nextTabs.length === 0) nextActive = null;
        else nextActive = nextTabs[Math.max(0, idx - 1)].id;
      }
      return { tabs: nextTabs, activeTabId: nextActive };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  appendEntry: (tabId, kind, text) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              entries: [...tab.entries, { id: `${Date.now()}-${Math.random()}`, kind, text }],
            }
          : tab
      ),
    })),

  updateTabCwd: (tabId, cwd) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, cwd } : tab)),
    })),

  setSessionId: (tabId, sessionId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, sessionId } : tab)),
    })),

  renameTab: (tabId, title) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
    })),

  clearEntries: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, entries: [] } : tab)),
    })),

  nextSessionIndex: () => {
    const next = get().counter + 1;
    set({ counter: next });
    return next;
  },
}));
