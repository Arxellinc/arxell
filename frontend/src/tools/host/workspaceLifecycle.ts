import type { WorkspaceTab } from "../../layout";

export interface WorkspaceToolLifecycleState {
  workspaceTab: WorkspaceTab;
  webSetupModalOpen: boolean;
  webSetupMessage: string | null;
  opencodeNeedsInit: boolean;
  looperNeedsInit: boolean;
  memoryLoading: boolean;
}

export interface WorkspaceToolLifecycleDeps {
  ensureWebTabs: () => void;
  refreshApiConnections: () => Promise<void>;
  refreshFlowRuns?: () => Promise<void>;
  hasVerifiedSearchConnection: () => boolean;
  ensureFilesExplorerLoaded: () => Promise<void>;
  ensureDocsLoaded: () => Promise<void>;
  ensureNotepadReady: () => Promise<void>;
  ensureSheetReady: () => Promise<void>;
  ensureMemoryLoaded: () => Promise<void>;
  ensureOpenCodeInit: () => Promise<void>;
  ensureLooperInit: () => Promise<void>;
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

  if (workspaceTab === "docs-tool") {
    await deps.ensureDocsLoaded();
    return true;
  }

  if (workspaceTab === "notepad-tool") {
    await deps.ensureNotepadReady();
    return true;
  }

  if (workspaceTab === "sheets-tool") {
    await deps.ensureSheetReady();
    return true;
  }

  if (workspaceTab === "memory-tool") {
    if (!state.memoryLoading) {
      await deps.ensureMemoryLoaded();
    }
    return true;
  }

  if (workspaceTab === "opencode-tool") {
    if (state.opencodeNeedsInit) {
      state.opencodeNeedsInit = false;
      await deps.ensureOpenCodeInit();
    }
    return true;
  }

  if (workspaceTab === "looper-tool") {
    if (state.looperNeedsInit) {
      state.looperNeedsInit = false;
      await deps.ensureLooperInit();
    }
    return true;
  }

  return false;
}
