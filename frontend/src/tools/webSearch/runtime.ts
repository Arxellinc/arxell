import type { WebSearchHistoryItem, WebTabState } from "./state";

const WEB_SEARCH_HISTORY_STORAGE_KEY = "arxell.webSearch.history.v1";

export function createWebTab(index: number): WebTabState {
  return {
    id: `web-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: `Search ${index}`,
    query: "",
    mode: "search",
    viewMode: "markdown",
    num: 10,
    busy: false,
    message: null,
    result: null
  };
}

export function loadPersistedWebSearchHistory(): WebSearchHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(WEB_SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeWebHistoryItem(item))
      .filter((item): item is WebSearchHistoryItem => item !== null)
      .slice(0, 200);
  } catch {
    return [];
  }
}

export function persistWebSearchHistory(entries: WebSearchHistoryItem[]): void {
  try {
    window.localStorage.setItem(WEB_SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, 200)));
  } catch {
    // Ignore local storage failures.
  }
}

function normalizeWebHistoryItem(value: unknown): WebSearchHistoryItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as {
    id?: unknown;
    query?: unknown;
    mode?: unknown;
    num?: unknown;
    timestampMs?: unknown;
  };
  const query = typeof item.query === "string" ? item.query.trim() : "";
  if (!query) return null;
  const mode = typeof item.mode === "string" && item.mode.trim() ? item.mode.trim() : "search";
  const numRaw = typeof item.num === "number" ? item.num : 10;
  const num = Number.isFinite(numRaw) ? Math.max(1, Math.min(20, Math.trunc(numRaw))) : 10;
  const tsRaw = typeof item.timestampMs === "number" ? item.timestampMs : Date.now();
  const timestampMs = Number.isFinite(tsRaw) ? tsRaw : Date.now();
  const id =
    typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : `webh-${timestampMs}-${Math.floor(Math.random() * 1000)}`;
  return { id, query, mode, num, timestampMs };
}
