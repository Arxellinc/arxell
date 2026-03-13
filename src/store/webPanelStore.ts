import { create } from "zustand";

export interface WebSearchContextItem {
  title: string;
  link: string;
  snippet: string;
}

export interface WebContextPayload {
  kind: "search" | "page";
  route: string;
  query?: string;
  mode?: string;
  results?: WebSearchContextItem[];
  url?: string;
  markdown?: string;
  updated_at: string;
}

interface WebPanelStore {
  pendingUrl: string | null;
  contextPayload: WebContextPayload | null;
  setNavigateUrl: (url: string | null) => void;
  setSearchContext: (params: {
    route: string;
    query: string;
    mode: string;
    results: WebSearchContextItem[];
  }) => void;
  setPageContext: (params: { url: string; markdown: string }) => void;
  clearContext: () => void;
}

export const useWebPanelStore = create<WebPanelStore>((set) => ({
  pendingUrl: null,
  contextPayload: null,
  setNavigateUrl: (pendingUrl) => set({ pendingUrl }),
  setSearchContext: ({ route, query, mode, results }) =>
    set({
      contextPayload: {
        kind: "search",
        route,
        query,
        mode,
        // Keep payload compact so prompt/context stays fast.
        results: results.slice(0, 8),
        updated_at: new Date().toISOString(),
      },
    }),
  setPageContext: ({ url, markdown }) =>
    set({
      contextPayload: {
        kind: "page",
        route: url,
        url,
        // Cap markdown size to avoid oversized context payloads.
        markdown: markdown.slice(0, 24_000),
        updated_at: new Date().toISOString(),
      },
    }),
  clearContext: () => set({ contextPayload: null }),
}));
