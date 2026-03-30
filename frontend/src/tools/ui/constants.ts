export const WORKSPACE_DATA_ATTR = {
  tab: "data-workspace-tab"
} as const;

export const TERMINAL_DATA_ATTR = {
  sessionId: "data-terminal-session-id",
  closeSessionId: "data-terminal-close-session-id",
  action: "data-terminal-action",
  shellProfile: "data-terminal-shell-profile"
} as const;

export const TERMINAL_UI_ID = {
  shellButton: "terminalShellBtn",
  shellPopover: "terminalShellPopover"
} as const;

export const MANAGER_DATA_ATTR = {
  toggleToolId: "data-workspace-tool-toggle-id"
} as const;

export const MANAGER_UI_ID = {
  refreshToolsButton: "refreshWorkspaceToolsBtn",
  exportToolsButton: "exportWorkspaceToolsBtn",
  importToolsButton: "importWorkspaceToolsBtn"
} as const;

export const WEB_DATA_ATTR = {
  action: "data-web-action",
  tabId: "data-web-tab-id",
  historyId: "data-web-history-id"
} as const;

export const WEB_UI_ID = {
  searchForm: "webSearchForm",
  queryInput: "webSearchQuery",
  modeSelect: "webSearchMode",
  numInput: "webSearchNum",
  setupForm: "webSearchSetupForm",
  setupAccountInput: "webSearchSetupAccount",
  setupApiKeyInput: "webSearchSetupApiKey"
} as const;
