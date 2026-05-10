export interface WebTabState {
  id: string;
  title: string;
  query: string;
  mode: string;
  viewMode: "markdown" | "json";
  num: number;
  busy: boolean;
  message: string | null;
  result: Record<string, unknown> | null;
}

export interface WebSearchHistoryItem {
  id: string;
  query: string;
  mode: string;
  num: number;
  timestampMs: number;
}

export interface WebSearchSlice {
  webTabs: WebTabState[];
  activeWebTabId: string;
  nextWebTabIndex: number;
  webHistory: WebSearchHistoryItem[];
  webSetupModalOpen: boolean;
  webSetupAccount: string;
  webSetupApiKey: string;
  webSetupMessage: string | null;
  webSetupBusy: boolean;
  apiConnections: Array<{ id: string; apiType: string; apiUrl: string; name: string; status: string }>;
}
