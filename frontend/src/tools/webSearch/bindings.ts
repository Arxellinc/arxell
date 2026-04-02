import type { ApiConnectionDraft } from "../../panels/types";
import { WEB_DATA_ATTR, WEB_UI_ID } from "../ui/constants";
import type { WebSearchSlice, WebTabState } from "./state";

interface WebUiSlice extends WebSearchSlice {
  webHistoryOpen: boolean;
  webHistoryClearConfirmOpen: boolean;
  workspaceTab: string;
  sidebarTab: string;
  apiFormOpen: boolean;
  apiDraft: ApiConnectionDraft;
}

interface WebActionDeps {
  runWebSearch: () => Promise<void>;
  createAndActivateWebTab: () => void;
  ensureTerminalSession: () => Promise<void>;
  persistWebSearchHistory: (items: WebSearchSlice["webHistory"]) => void;
  withActiveWebTab: (mutator: (tab: WebTabState) => void) => void;
  saveWebSearchSetup: () => Promise<void>;
}

export async function handleWebClick(
  target: HTMLElement,
  slice: WebUiSlice,
  deps: WebActionDeps
): Promise<boolean> {
  const webAction = target.getAttribute(WEB_DATA_ATTR.action);
  const webTabId = target.getAttribute(WEB_DATA_ATTR.tabId);
  if (webTabId && !webAction) {
    slice.activeWebTabId = webTabId;
    return true;
  }
  if (!webAction) return false;

  if (webAction === "run") {
    await deps.runWebSearch();
    return true;
  }
  if (webAction === "new-tab") {
    deps.createAndActivateWebTab();
    return true;
  }
  if (webAction === "toggle-history") {
    slice.webHistoryOpen = !slice.webHistoryOpen;
    if (!slice.webHistoryOpen) {
      slice.webHistoryClearConfirmOpen = false;
    }
    return true;
  }
  if (webAction === "clear-history") {
    slice.webHistoryClearConfirmOpen = true;
    return true;
  }
  if (webAction === "clear-history-cancel") {
    slice.webHistoryClearConfirmOpen = false;
    return true;
  }
  if (webAction === "clear-history-confirm") {
    slice.webHistory = [];
    slice.webHistoryClearConfirmOpen = false;
    deps.persistWebSearchHistory(slice.webHistory);
    return true;
  }
  if (webAction === "run-history-item") {
    const historyId = target.getAttribute(WEB_DATA_ATTR.historyId);
    if (!historyId) return true;
    const item = slice.webHistory.find((entry) => entry.id === historyId);
    if (!item) return true;
    deps.withActiveWebTab((tab) => {
      tab.query = item.query;
      tab.mode = item.mode;
      tab.num = item.num;
    });
    await deps.runWebSearch();
    return true;
  }
  if (webAction === "toggle-view-mode") {
    deps.withActiveWebTab((tab) => {
      tab.viewMode = tab.viewMode === "markdown" ? "json" : "markdown";
    });
    return true;
  }
  if (webAction === "close-tab") {
    if (!webTabId) return true;
    const remaining = slice.webTabs.filter((tab) => tab.id !== webTabId);
    if (!remaining.length) {
      slice.workspaceTab = "terminal";
      await deps.ensureTerminalSession();
    } else {
      slice.webTabs = remaining;
      if (slice.activeWebTabId === webTabId) {
        slice.activeWebTabId = remaining[remaining.length - 1]?.id ?? remaining[0]?.id ?? "";
      }
    }
    return true;
  }
  if (webAction === "setup-cancel") {
    slice.webSetupModalOpen = false;
    slice.webSetupMessage = null;
    slice.webSetupApiKey = "";
    return true;
  }
  if (webAction === "setup-open-apis") {
    slice.webSetupModalOpen = false;
    slice.sidebarTab = "apis";
    slice.apiFormOpen = true;
    slice.apiDraft = {
      apiType: "search",
      apiUrl: "https://google.serper.dev",
      name: slice.webSetupAccount.trim(),
      apiKey: slice.webSetupApiKey,
      modelName: "",
      costPerMonthUsd: "",
      apiStandardPath: ""
    };
    return true;
  }

  return false;
}

export function handleWebChange(target: HTMLElement, deps: Pick<WebActionDeps, "withActiveWebTab">): boolean {
  const modeSelect = target.closest<HTMLSelectElement>(`#${WEB_UI_ID.modeSelect}`);
  if (modeSelect) {
    deps.withActiveWebTab((tab) => {
      tab.mode = modeSelect.value || "search";
    });
    return true;
  }

  const numInput = target.closest<HTMLInputElement>(`#${WEB_UI_ID.numInput}`);
  if (numInput) {
    const parsed = Number.parseInt(numInput.value, 10);
    deps.withActiveWebTab((tab) => {
      tab.num = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 10;
    });
    return true;
  }

  return false;
}

export async function handleWebSubmit(
  target: HTMLElement,
  slice: WebUiSlice,
  deps: WebActionDeps
): Promise<boolean> {
  const form = target.closest<HTMLFormElement>(`#${WEB_UI_ID.searchForm}`);
  if (form) {
    const queryInput = form.querySelector<HTMLInputElement>(`#${WEB_UI_ID.queryInput}`);
    deps.withActiveWebTab((tab) => {
      tab.query = queryInput?.value ?? "";
    });
    await deps.runWebSearch();
    return true;
  }

  const setupForm = target.closest<HTMLFormElement>(`#${WEB_UI_ID.setupForm}`);
  if (!setupForm) return false;
  const accountInput = setupForm.querySelector<HTMLInputElement>(`#${WEB_UI_ID.setupAccountInput}`);
  const keyInput = setupForm.querySelector<HTMLInputElement>(`#${WEB_UI_ID.setupApiKeyInput}`);
  slice.webSetupAccount = accountInput?.value ?? "";
  slice.webSetupApiKey = keyInput?.value ?? "";
  await deps.saveWebSearchSetup();
  return true;
}

export function handleWebInput(target: HTMLElement, slice: WebUiSlice, deps: Pick<WebActionDeps, "withActiveWebTab">): boolean {
  const queryInput = target.closest<HTMLInputElement>(`#${WEB_UI_ID.queryInput}`);
  if (queryInput) {
    deps.withActiveWebTab((tab) => {
      tab.query = queryInput.value;
    });
    return true;
  }

  const accountInput = target.closest<HTMLInputElement>(`#${WEB_UI_ID.setupAccountInput}`);
  if (accountInput) {
    slice.webSetupAccount = accountInput.value;
    slice.webSetupMessage = null;
    return true;
  }

  const keyInput = target.closest<HTMLInputElement>(`#${WEB_UI_ID.setupApiKeyInput}`);
  if (keyInput) {
    slice.webSetupApiKey = keyInput.value;
    slice.webSetupMessage = null;
    return true;
  }

  return false;
}

export async function handleWebKeyDown(
  event: KeyboardEvent,
  deps: Pick<WebActionDeps, "runWebSearch" | "withActiveWebTab">
): Promise<boolean> {
  if (event.key !== "Enter") return false;
  const queryInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(`#${WEB_UI_ID.queryInput}`);
  if (!queryInput) return false;
  deps.withActiveWebTab((tab) => {
    tab.query = queryInput.value;
  });
  await deps.runWebSearch();
  return true;
}
