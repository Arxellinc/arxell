export const WORKSPACE_DATA_ATTR = {
  tab: "data-workspace-tab"
} as const;

export const CONSOLE_DATA_ATTR = {
  view: "data-console-view",
  action: "data-console-action"
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
  toggleToolId: "data-workspace-tool-toggle-id",
  action: "data-workspace-tool-action",
  actionToolId: "data-workspace-tool-action-id"
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

export const FILES_DATA_ATTR = {
  action: "data-files-action",
  path: "data-files-path",
  isDir: "data-files-is-dir",
  column: "data-files-column"
} as const;

export const FILES_UI_ID = {
  refreshButton: "filesToolRefreshBtn"
} as const;

export const TASKS_DATA_ATTR = {
  action: "data-tasks-action",
  taskId: "data-tasks-id",
  sort: "data-tasks-sort",
  folder: "data-tasks-folder",
  field: "data-tasks-field",
  value: "data-tasks-value"
} as const;

export const FLOW_DATA_ATTR = {
  action: "data-flow-action",
  runId: "data-flow-run-id",
  mode: "data-flow-mode"
} as const;

export const FLOW_UI_ID = {
  modeSelect: "flowModeSelect",
  maxIterationsInput: "flowMaxIterationsInput",
  dryRunToggle: "flowDryRunToggle",
  autoPushToggle: "flowAutoPushToggle",
  promptPlanPath: "flowPromptPlanPath",
  promptBuildPath: "flowPromptBuildPath",
  planPath: "flowPlanPath",
  specsGlob: "flowSpecsGlob",
  implementCommand: "flowImplementCommand",
  backpressureCommands: "flowBackpressureCommands",
  eventFilterInput: "flowEventFilterInput"
} as const;
