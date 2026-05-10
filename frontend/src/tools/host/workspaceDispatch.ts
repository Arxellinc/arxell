import {
  handleFilesClick,
  handleFilesContextMenu,
  handleFilesDoubleClick,
  handleFilesInput,
  handleFilesKeyDown,
  handleFilesMouseMove,
  handleFilesPointerDown
} from "../files/bindings";
import type { FilesConflictResolution } from "../files/actions";
import {
  handleWebChange,
  handleWebClick,
  handleWebInput,
  handleWebKeyDown,
  handleWebSubmit
} from "../webSearch/bindings";
import { handleChartClick, handleChartInput } from "../chart/bindings";
import { handleTasksChange, handleTasksClick, handleTasksInput } from "../tasks/bindings";
import type { ChatIpcClient } from "../../ipcClient";
import { handleOpenCodeClick } from "../opencode/bindings";
import type { OpenCodeToolState } from "../opencode/state";
import type { OpenCodeActionsDeps } from "../opencode/actions";
import { handleLooperClick, handleLooperInput } from "../looper/bindings";
import type { LooperToolState } from "../looper/state";
import type { LooperActionsDeps } from "../looper/actions";
import { handleDocsClick, handleDocsPointerDown } from "../docs/bindings";
import { handleDocsInput, handleDocsKeyDown } from "../docs/bindings";
import { handleNotepadClick, handleNotepadInput, handleNotepadKeyDown } from "../notepad/bindings";
import { handleSheetsClick } from "../sheets/bindings";
import {
  FILES_DATA_ATTR,
  FILES_UI_ID,
  LOOPER_DATA_ATTR,
  MANAGER_DATA_ATTR,
  MANAGER_UI_ID,
  NOTEPAD_DATA_ATTR,
  OPENCODE_DATA_ATTR,
  SHEETS_DATA_ATTR,
  TASKS_DATA_ATTR,
  TERMINAL_DATA_ATTR,
  TERMINAL_UI_ID,
  WEB_DATA_ATTR,
  WORKSPACE_DATA_ATTR
} from "../ui/constants";
export type WorkspaceToolState = Record<string, unknown>;

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
  `[${MANAGER_DATA_ATTR.action}]`,
  `[${WEB_DATA_ATTR.action}]`,
  `[${WEB_DATA_ATTR.tabId}]`,
  `[${FILES_DATA_ATTR.action}]`,
  `[${FILES_DATA_ATTR.path}]`,
  `#${FILES_UI_ID.refreshButton}`,
  `[${NOTEPAD_DATA_ATTR.action}]`,
  `[${NOTEPAD_DATA_ATTR.tabId}]`,
  `[${SHEETS_DATA_ATTR.action}]`,
  `[${TASKS_DATA_ATTR.action}]`,
  `[${TASKS_DATA_ATTR.taskId}]`,
  `[${TASKS_DATA_ATTR.field}]`,
  "#memoryRefreshBtn",
  "[data-memory-action]",
  "[data-chart-action]",
  `[${OPENCODE_DATA_ATTR.action}]`,
  `[${OPENCODE_DATA_ATTR.closeAgentId}]`,
  `[${LOOPER_DATA_ATTR.action}]`,
  `[${LOOPER_DATA_ATTR.closeLoopId}]`,
  `[${LOOPER_DATA_ATTR.loopId}]`,
  `[${LOOPER_DATA_ATTR.phase}]`
].join(", ");

export interface WorkspaceToolDispatchDeps {
  flow: {
    refreshRuns: () => Promise<void>;
    startRun: () => Promise<void>;
    stopRun: () => Promise<void>;
    resumeRun: (run: { runId: string }) => Promise<void>;
    retryRun: (run: { runId: string }) => Promise<void>;
    rerunValidation: (run: { runId: string }) => Promise<void>;
    openPhaseTerminal: (phase: string) => Promise<void>;
    closePhaseTerminal: (phase: string) => Promise<void>;
    createProjectSetup: (
      name: string,
      projectType: string,
      icon: string,
      description: string
    ) => Promise<void>;
    setPaused: (paused: boolean) => Promise<void>;
    nudgeRun: (message: string) => Promise<void>;
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
    createNewFilesFolder: (path: string) => Promise<void>;
    duplicateActiveFilesTab: (path: string) => Promise<void>;
    deleteFilesPath: (path: string, recursive?: boolean) => Promise<void>;
    renameFilesPath: (from: string, to: string) => Promise<void>;
    pasteFilesClipboard: (
      targetDirectory: string,
      resolveConflictChoice?: (name: string) => Promise<FilesConflictResolution>
    ) => Promise<void>;
    undoLastFilesDelete: () => Promise<void>;
    openPathInTerminal: (path: string) => Promise<void>;
  };
  notepad: {
    ensureNotepadReady: () => Promise<void>;
    createUntitledNotepadTab: () => string;
    openNotepadFile: (path: string) => Promise<void>;
    activateNotepadTab: (tabId: string) => void;
    closeNotepadTab: (tabId: string) => void;
    updateNotepadBuffer: (tabId: string, content: string) => void;
    saveActiveNotepadTab: () => Promise<void>;
    saveActiveNotepadTabAs: (path: string) => Promise<void>;
    saveAllNotepadTabs: () => Promise<void>;
    duplicateActiveNotepadTab: (path: string) => Promise<void>;
    deleteActiveNotepadFile: () => Promise<void>;
  };
  sheets: {
    createNewSheet: () => Promise<void>;
    openSheetWithDialog: () => Promise<void>;
    saveSheetCurrent: () => Promise<void>;
    saveSheetWithDialog: () => Promise<void>;
    undoSheet: () => Promise<void>;
    redoSheet: () => Promise<void>;
    insertRows: (index: number, count?: number) => Promise<void>;
    insertColumns: (index: number, count?: number) => Promise<void>;
    deleteRows: (index: number, count?: number) => Promise<void>;
    deleteColumns: (index: number, count?: number) => Promise<void>;
  };
  docs: {
    listDocsDirectory: (path?: string) => Promise<void>;
    selectDocsPath: (path: string) => Promise<void>;
    toggleDocsNode: (path: string) => Promise<void>;
    openDocsFile: (path: string) => Promise<void>;
    createNewDocsFile: (path: string) => Promise<void>;
    activateDocsTab: (path: string) => void;
    closeDocsTab: (path: string) => void;
    updateDocsBuffer: (path: string, content: string) => void;
    saveActiveDocsTab: () => Promise<void>;
    saveActiveDocsTabAs: (path: string) => Promise<void>;
    saveAllDocsTabs: () => Promise<void>;
  };
  web: {
    runWebSearch: () => Promise<void>;
    createAndActivateWebTab: () => void;
    ensureTerminalSession: () => Promise<void>;
    persistWebSearchHistory: (items: any[]) => void;
    withActiveWebTab: (mutator: any) => void;
    saveWebSearchSetup: () => Promise<void>;
  };
  opencode: {
    state: OpenCodeToolState;
    actionsDeps: OpenCodeActionsDeps;
  };
  looper: {
    state: LooperToolState;
    actionsDeps: LooperActionsDeps;
  };
  tasks: {
    client: ChatIpcClient | null;
    nextCorrelationId: () => string;
  };
}

export async function dispatchWorkspaceToolClick(
  target: HTMLElement,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): Promise<boolean> {
  if (await handleFilesClick(target, state as any, deps.files)) {
    return true;
  }
  if (await handleNotepadClick(target, state as any, deps.notepad)) {
    return true;
  }
  if (await handleSheetsClick(target, (state as any).sheetsState, deps.sheets)) {
    return true;
  }
  if (await handleTasksClick(target, state as any, deps.tasks)) {
    return true;
  }
  if (await handleChartClick(target, state as any)) {
    return true;
  }
  if (await handleWebClick(target, state as any, deps.web as any)) {
    return true;
  }
  if (handleOpenCodeClick(target, deps.opencode.state, deps.opencode.actionsDeps)) {
    return true;
  }
  if (handleLooperClick(target, deps.looper.state, deps.looper.actionsDeps)) {
    return true;
  }
  if (await handleDocsClick(target, state as any, deps.docs)) {
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
  const tasksHandled = handleTasksChange(target, state as any);
  return webHandled || tasksHandled;
}

export function dispatchWorkspaceToolInput(
  target: HTMLElement,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): { handled: boolean; rerender: boolean } {
  const filesResult = handleFilesInput(target, state as any);
  const docsResult = handleDocsInput(target, state as any);
  const notepadResult = handleNotepadInput(target, state as any);
  const tasksHandled = handleTasksInput(target, state as any);
  const webHandled = handleWebInput(target, state as any, { withActiveWebTab: deps.web.withActiveWebTab as any });
  const chartResult = handleChartInput(target, state as any);
  const looperResult = handleLooperInput(target, deps.looper.state);
  return {
    handled:
      filesResult.handled ||
      docsResult.handled ||
      notepadResult.handled ||
      tasksHandled ||
      webHandled ||
      chartResult.handled ||
      looperResult.handled,
    rerender:
      filesResult.rerender ||
      docsResult.rerender ||
      notepadResult.rerender ||
      tasksHandled ||
      chartResult.rerender ||
      looperResult.rerender
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
      updateFilesBuffer: deps.files.updateFilesBuffer,
      pasteFilesClipboard: deps.files.pasteFilesClipboard,
      undoLastFilesDelete: deps.files.undoLastFilesDelete
    })
  ) {
    return true;
  }
  if (
    await handleNotepadKeyDown(event, state as any, {
      ensureNotepadReady: deps.notepad.ensureNotepadReady,
      createUntitledNotepadTab: deps.notepad.createUntitledNotepadTab,
      openNotepadFile: deps.notepad.openNotepadFile,
      saveActiveNotepadTab: deps.notepad.saveActiveNotepadTab,
      saveActiveNotepadTabAs: deps.notepad.saveActiveNotepadTabAs,
      saveAllNotepadTabs: deps.notepad.saveAllNotepadTabs,
      updateNotepadBuffer: deps.notepad.updateNotepadBuffer,
      closeNotepadTab: deps.notepad.closeNotepadTab
    })
  ) {
    return true;
  }
  if (await handleDocsKeyDown(event, state as any, deps.docs)) {
    return true;
  }
  return handleWebKeyDown(event, {
    runWebSearch: deps.web.runWebSearch,
    withActiveWebTab: deps.web.withActiveWebTab as any
  });
}

export function dispatchWorkspaceToolContextMenu(
  event: MouseEvent,
  target: HTMLElement,
  state: WorkspaceToolState
): boolean {
  return handleFilesContextMenu(event, target, state as any);
}

export function dispatchWorkspaceToolMouseMove(
  target: HTMLElement,
  state: WorkspaceToolState
): boolean {
  return handleFilesMouseMove(target, state as any);
}

export async function dispatchWorkspaceToolDoubleClick(
  target: HTMLElement,
  state: WorkspaceToolState,
  deps: WorkspaceToolDispatchDeps
): Promise<boolean> {
  return handleFilesDoubleClick(target, state as any, {
    selectFilesPath: deps.files.selectFilesPath,
    openFilesFile: deps.files.openFilesFile
  });
}

export function dispatchWorkspaceToolPointerDown(
  event: MouseEvent,
  target: HTMLElement,
  state: WorkspaceToolState
): boolean {
  if (handleFilesPointerDown(event, target, state as any)) {
    return true;
  }
  if (handleDocsPointerDown(event, target, state as any)) {
    return true;
  }
  return false;
}
