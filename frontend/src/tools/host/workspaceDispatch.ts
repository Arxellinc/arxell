import {
  handleFilesClick,
  handleFilesDoubleClick,
  handleFilesInput,
  handleFilesKeyDown,
  handleFilesPointerDown
} from "../files/bindings";
import { handleFlowChange, handleFlowClick, handleFlowInput } from "../flow/bindings";
import {
  handleWebChange,
  handleWebClick,
  handleWebInput,
  handleWebKeyDown,
  handleWebSubmit
} from "../webSearch/bindings";
import {
  handleCreateToolChange,
  handleCreateToolClick,
  handleCreateToolInput
} from "../createTool/bindings";
import { handleTasksChange, handleTasksClick, handleTasksInput } from "../tasks/bindings";
import {
  FILES_DATA_ATTR,
  FILES_UI_ID,
  FLOW_DATA_ATTR,
  MANAGER_UI_ID,
  TASKS_DATA_ATTR,
  TERMINAL_DATA_ATTR,
  TERMINAL_UI_ID,
  WEB_DATA_ATTR,
  WORKSPACE_DATA_ATTR
} from "../ui/constants";
import type { FlowRunView, FlowRuntimeSlice } from "../flow/state";
export type WorkspaceToolState = FlowRuntimeSlice & Record<string, unknown>;

export const WORKSPACE_TOOL_TARGET_SELECTOR = [
  `[${WORKSPACE_DATA_ATTR.tab}]`,
  `[${TERMINAL_DATA_ATTR.closeSessionId}]`,
  `[${TERMINAL_DATA_ATTR.sessionId}]`,
  `[${TERMINAL_DATA_ATTR.action}]`,
  `#${TERMINAL_UI_ID.shellButton}`,
  `[${TERMINAL_DATA_ATTR.shellProfile}]`,
  `#${MANAGER_UI_ID.refreshToolsButton}`,
  `#${MANAGER_UI_ID.exportToolsButton}`,
  `#${MANAGER_UI_ID.importToolsButton}`,
  `[${WEB_DATA_ATTR.action}]`,
  `[${WEB_DATA_ATTR.tabId}]`,
  `[${FILES_DATA_ATTR.action}]`,
  `[${FILES_DATA_ATTR.path}]`,
  `#${FILES_UI_ID.refreshButton}`,
  `[${TASKS_DATA_ATTR.action}]`,
  `[${TASKS_DATA_ATTR.taskId}]`,
  `[${TASKS_DATA_ATTR.field}]`,
  "[data-create-tool-action]",
  "[data-create-tool-field]",
  "[data-create-tool-guard]",
  `[${FLOW_DATA_ATTR.action}]`,
  `[${FLOW_DATA_ATTR.runId}]`
].join(", ");

export interface WorkspaceToolDispatchDeps {
  flow: {
    refreshRuns: () => Promise<void>;
    startRun: () => Promise<void>;
    stopRun: () => Promise<void>;
    resumeRun: (run: FlowRunView) => Promise<void>;
    retryRun: (run: FlowRunView) => Promise<void>;
    rerunValidation: (run: FlowRunView) => Promise<void>;
  };
  files: {
    listFilesDirectory: (path?: string) => Promise<void>;
    selectFilesPath: (path: string) => Promise<void>;
    toggleFilesNode: (path: string) => Promise<void>;
    openFilesFile: (path: string) => Promise<void>;
    activateFilesTab: (path: string) => void;
    closeFilesTab: (path: string) => void;
    updateFilesBuffer: (path: string, content: string) => void;
    saveActiveFilesTab: () => Promise<void>;
    saveActiveFilesTabAs: (path: string) => Promise<void>;
    saveAllFilesTabs: () => Promise<void>;
    createNewFilesFile: (path: string) => Promise<void>;
    duplicateActiveFilesTab: (path: string) => Promise<void>;
  };
  web: {
    runWebSearch: () => Promise<void>;
    createAndActivateWebTab: () => void;
    ensureTerminalSession: () => Promise<void>;
    persistWebSearchHistory: (items: any[]) => void;
    withActiveWebTab: (mutator: any) => void;
    saveWebSearchSetup: () => Promise<void>;
  };
  createTool: {
    createScaffold: () => Promise<void>;
    registerTool: () => Promise<void>;
  };
}

export async function dispatchWorkspaceToolClick(
  target: HTMLElement,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): Promise<boolean> {
  if (await handleFlowClick(target, state as any, deps.flow)) {
    return true;
  }
  if (await handleFilesClick(target, state as any, deps.files)) {
    return true;
  }
  if (await handleTasksClick(target, state as any)) {
    return true;
  }
  if (await handleCreateToolClick(target, state as any, deps as any)) {
    return true;
  }
  if (await handleWebClick(target, state as any, deps.web as any)) {
    return true;
  }
  return false;
}

export function dispatchWorkspaceToolChange(
  target: HTMLElement,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): boolean {
  const webHandled = handleWebChange(target, { withActiveWebTab: deps.web.withActiveWebTab as any });
  const flowHandled = handleFlowChange(target, state as any);
  const tasksHandled = handleTasksChange(target, state as any);
  const createToolHandled = handleCreateToolChange(target, state as any);
  return webHandled || flowHandled || tasksHandled || createToolHandled;
}

export function dispatchWorkspaceToolInput(
  target: HTMLElement,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): { handled: boolean; rerender: boolean } {
  const filesResult = handleFilesInput(target, state as any);
  const tasksHandled = handleTasksInput(target, state as any);
  const createToolHandled = handleCreateToolInput(target, state as any);
  const webHandled = handleWebInput(target, state as any, { withActiveWebTab: deps.web.withActiveWebTab as any });
  const flowResult = handleFlowInput(target, state as any);
  return {
    handled: filesResult.handled || tasksHandled || createToolHandled || webHandled || flowResult.handled,
    rerender: filesResult.rerender || tasksHandled || createToolHandled || flowResult.rerender
  };
}

export async function dispatchWorkspaceToolSubmit(
  target: HTMLElement,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): Promise<boolean> {
  return handleWebSubmit(target, state as any, deps.web as any);
}

export async function dispatchWorkspaceToolKeyDown(
  event: KeyboardEvent,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): Promise<boolean> {
  if (
    await handleFilesKeyDown(event, state as any, {
      saveActiveFilesTab: deps.files.saveActiveFilesTab,
      saveActiveFilesTabAs: deps.files.saveActiveFilesTabAs,
      saveAllFilesTabs: deps.files.saveAllFilesTabs,
      openFilesFile: deps.files.openFilesFile,
      closeFilesTab: deps.files.closeFilesTab,
      updateFilesBuffer: deps.files.updateFilesBuffer
    })
  ) {
    return true;
  }
  return handleWebKeyDown(event, {
    runWebSearch: deps.web.runWebSearch,
    withActiveWebTab: deps.web.withActiveWebTab as any
  });
}

export async function dispatchWorkspaceToolDoubleClick(
  target: HTMLElement,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): Promise<boolean> {
  return handleFilesDoubleClick(target, state as any, {
    selectFilesPath: deps.files.selectFilesPath
  });
}

export function dispatchWorkspaceToolPointerDown(
  event: MouseEvent,
  target: HTMLElement,
  state: WorkspaceToolState
): boolean {
  return handleFilesPointerDown(event, target, state as any);
}
