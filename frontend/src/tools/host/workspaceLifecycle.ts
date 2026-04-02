import type { WorkspaceTab } from "../../layout";

export interface WorkspaceToolLifecycleState {
  workspaceTab: WorkspaceTab;
  webSetupModalOpen: boolean;
  webSetupMessage: string | null;
}

export interface WorkspaceToolLifecycleDeps {
  ensureWebTabs: () => void;
  refreshApiConnections: () => Promise<void>;
  hasVerifiedSearchConnection: () => boolean;
  ensureFilesExplorerLoaded: () => Promise<void>;
  refreshFlowRuns: () => Promise<void>;
}

export async function handleWorkspaceToolTabActivation(
  workspaceTab: WorkspaceTab,
  state: WorkspaceToolLifecycleState,
  deps: WorkspaceToolLifecycleDeps
): Promise<boolean> {
  if (workspaceTab === "webSearch-tool" || workspaceTab === "web-tool") {
    state.workspaceTab = "webSearch-tool";
    deps.ensureWebTabs();
    await deps.refreshApiConnections();
    if (!deps.hasVerifiedSearchConnection()) {
      state.webSetupModalOpen = true;
      state.webSetupMessage = "Set up Serper Search API to enable this tool.";
    }
    return true;
  }

  if (workspaceTab === "files-tool") {
    await deps.ensureFilesExplorerLoaded();
    return true;
  }

  if (workspaceTab === "flow-tool") {
    await deps.refreshFlowRuns();
    return true;
  }

  return false;
}
