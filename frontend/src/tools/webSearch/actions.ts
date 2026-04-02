import type { ChatIpcClient } from "../../ipcClient";
import type { WebSearchResponse } from "../../contracts";
import type { WebSearchSlice, WebTabState } from "./state";

interface WebSearchDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
  refreshApiConnections: () => Promise<void>;
  persistWebSearchHistory: (items: WebSearchSlice["webHistory"]) => void;
  createWebTab: (index: number) => WebTabState;
}

export function getActiveWebTab(slice: WebSearchSlice): WebTabState | null {
  if (!slice.webTabs.length) return null;
  const found = slice.webTabs.find((tab) => tab.id === slice.activeWebTabId);
  return found ?? slice.webTabs[0] ?? null;
}

export function withActiveWebTab(
  slice: WebSearchSlice,
  mutator: (tab: WebTabState) => void
): void {
  const active = getActiveWebTab(slice);
  if (!active) return;
  mutator(active);
}

export function ensureWebTabs(slice: WebSearchSlice, deps: Pick<WebSearchDeps, "createWebTab">): void {
  if (slice.webTabs.length) return;
  const tab = deps.createWebTab(slice.nextWebTabIndex++);
  slice.webTabs = [tab];
  slice.activeWebTabId = tab.id;
}

export function createAndActivateWebTab(
  slice: WebSearchSlice,
  deps: Pick<WebSearchDeps, "createWebTab">
): void {
  const tab = deps.createWebTab(slice.nextWebTabIndex++);
  slice.webTabs = [...slice.webTabs, tab];
  slice.activeWebTabId = tab.id;
}

function getWebResultCount(response: WebSearchResponse): number | null {
  const raw = response.result as {
    items?: unknown;
    organic?: unknown;
    news?: unknown;
    images?: unknown;
    videos?: unknown;
    shopping?: unknown;
    places?: unknown;
  };
  if (Array.isArray(raw.items)) return raw.items.length;
  if (Array.isArray(raw.organic)) return raw.organic.length;
  if (Array.isArray(raw.news)) return raw.news.length;
  if (Array.isArray(raw.images)) return raw.images.length;
  if (Array.isArray(raw.videos)) return raw.videos.length;
  if (Array.isArray(raw.shopping)) return raw.shopping.length;
  if (Array.isArray(raw.places)) return raw.places.length;
  return null;
}

export function hasVerifiedSearchConnection(slice: WebSearchSlice): boolean {
  return slice.apiConnections.some(
    (connection) => connection.apiType === "search" && connection.status === "verified"
  );
}

function isMissingSearchApiError(message: string): boolean {
  const value = message.toLowerCase();
  return value.includes("no verified search api configured") || value.includes("search api key");
}

function recordWebSearchHistory(
  slice: WebSearchSlice,
  deps: Pick<WebSearchDeps, "persistWebSearchHistory">,
  query: string,
  mode: string,
  num: number
): void {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return;
  const entry = {
    id: `webh-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    query: normalizedQuery,
    mode: mode.trim() || "search",
    num: Math.max(1, Math.min(20, Math.trunc(num))),
    timestampMs: Date.now()
  };
  const deduped = slice.webHistory.filter(
    (item) =>
      !(
        item.query.toLowerCase() === entry.query.toLowerCase() &&
        item.mode === entry.mode &&
        item.num === entry.num
      )
  );
  slice.webHistory = [entry, ...deduped].slice(0, 200);
  deps.persistWebSearchHistory(slice.webHistory);
}

export async function runWebSearch(slice: WebSearchSlice, deps: WebSearchDeps): Promise<void> {
  const activeTab = getActiveWebTab(slice);
  if (!deps.client || !activeTab || activeTab.busy) return;
  await deps.refreshApiConnections();
  if (!hasVerifiedSearchConnection(slice)) {
    slice.webSetupModalOpen = true;
    slice.webSetupMessage = "Add and verify a Serper Search API connection to continue.";
    return;
  }
  const query = activeTab.query.trim();
  if (!query) {
    activeTab.message = "Enter a query.";
    return;
  }

  activeTab.busy = true;
  activeTab.message = null;
  try {
    const request = {
      correlationId: deps.nextCorrelationId(),
      query,
      mode: activeTab.mode,
      num: activeTab.num
    };
    const invokeResponse = await deps.client.toolInvoke({
      correlationId: request.correlationId,
      toolId: "webSearch",
      action: "search",
      mode: "sandbox",
      payload: request
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Web search failed.");
    }
    const response = invokeResponse.data as unknown as WebSearchResponse;
    activeTab.result = response.result;
    const resultCount = getWebResultCount(response);
    activeTab.message =
      resultCount !== null
        ? `Fetched ${resultCount} result${resultCount === 1 ? "" : "s"}.`
        : "Search completed.";
    recordWebSearchHistory(slice, deps, query, activeTab.mode, activeTab.num);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Web search failed.";
    activeTab.message = message;
    if (isMissingSearchApiError(message)) {
      slice.webSetupModalOpen = true;
      slice.webSetupMessage = "Search API is missing or not verified. Configure Serper to continue.";
    }
  } finally {
    activeTab.busy = false;
  }
}

export async function saveWebSearchSetup(slice: WebSearchSlice, deps: WebSearchDeps): Promise<void> {
  if (!deps.client || slice.webSetupBusy) return;
  const account = slice.webSetupAccount.trim();
  const apiKey = slice.webSetupApiKey.trim();
  if (!account || !apiKey) {
    slice.webSetupMessage = "Account name and API key are required.";
    return;
  }

  slice.webSetupBusy = true;
  slice.webSetupMessage = "Saving and verifying Serper connection...";
  try {
    const created = await deps.client.createApiConnection({
      correlationId: deps.nextCorrelationId(),
      apiType: "search",
      apiUrl: "https://google.serper.dev",
      name: account,
      apiKey
    });
    await deps.refreshApiConnections();
    if (created.connection.status === "verified") {
      slice.webSetupMessage = "Serper connection verified.";
      slice.webSetupModalOpen = false;
      slice.webSetupApiKey = "";
      withActiveWebTab(slice, (tab) => {
        tab.message = "Search API configured. You can run searches now.";
      });
      return;
    }
    slice.webSetupMessage = created.connection.statusMessage;
  } catch (error) {
    slice.webSetupMessage =
      error instanceof Error ? error.message : "Failed saving Serper connection.";
  } finally {
    slice.webSetupBusy = false;
  }
}
