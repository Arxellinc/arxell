import type { TerminalManager } from "../tools/terminal/index";
import type { TerminalShellProfile } from "../tools/terminal/types";
import {
  CONSOLE_DATA_ATTR,
  MANAGER_DATA_ATTR,
  MANAGER_UI_ID,
  TERMINAL_DATA_ATTR,
  TERMINAL_UI_ID
} from "../tools/ui/constants";
import {
  buildConsoleCopyText,
  buildConsoleFilename,
  getVisibleConsoleEntries,
  type ConsoleEntry,
  type ConsoleView
} from "./render";

interface TerminalMountState {
  workspaceTab: string;
  flowBottomPanel: "terminal" | "validate" | "events";
  flowActiveTerminalPhase: string;
  flowPhaseSessionByName: Record<string, string>;
  activeTerminalSessionId: string | null;
}

export function mountWorkspaceTerminalHosts(
  state: TerminalMountState,
  terminalManager: TerminalManager,
  persistFlowPhaseSessionMap: (map: Record<string, string>) => void
): void {
  if (state.workspaceTab === "terminal") {
    const host = document.querySelector<HTMLElement>("#terminalHost");
    if (host && state.activeTerminalSessionId) {
      terminalManager.mountSession(state.activeTerminalSessionId, host);
    }
  }

  if (state.workspaceTab === "flow-tool" && state.flowBottomPanel === "terminal") {
    const host = document.querySelector<HTMLElement>("#flowPhaseTerminalHost");
    const phase = state.flowActiveTerminalPhase;
    const sessionId = state.flowPhaseSessionByName[phase];
    if (sessionId && !terminalManager.listSessions().some((item) => item.sessionId === sessionId)) {
      const nextMap = { ...state.flowPhaseSessionByName };
      delete nextMap[phase];
      state.flowPhaseSessionByName = nextMap;
      persistFlowPhaseSessionMap(state.flowPhaseSessionByName);
    }
    const activeSessionId = state.flowPhaseSessionByName[phase];
    if (host && activeSessionId) {
      terminalManager.mountSession(activeSessionId, host);
    }
  }
}

interface ManagerTerminalClickState {
  flowPhaseSessionByName: Record<string, string>;
  activeTerminalSessionId: string | null;
  terminalShellProfile: TerminalShellProfile;
}

interface WorkspaceDelegatedEventsDeps<StateT, ToolDepsT> {
  workspacePane: HTMLElement;
  state: StateT;
  workspaceToolDeps: ToolDepsT;
  managerToggleAttr: string;
  managerToggleIconAttr: string;
  clientRef: {
    setWorkspaceToolEnabled: (request: {
      toolId: string;
      enabled: boolean;
      correlationId: string;
    }) => Promise<unknown>;
    setWorkspaceToolIcon: (request: {
      toolId: string;
      icon: boolean;
      correlationId: string;
    }) => Promise<unknown>;
  } | null;
  nextCorrelationId: () => string;
  refreshTools: () => Promise<void>;
  dispatchWorkspaceToolChange: (target: HTMLElement, state: StateT, deps: ToolDepsT) => void;
  dispatchWorkspaceToolSubmit: (
    target: HTMLElement,
    state: StateT,
    deps: ToolDepsT
  ) => Promise<boolean>;
  dispatchWorkspaceToolInput: (
    target: HTMLElement,
    state: StateT,
    deps: ToolDepsT
  ) => { handled: boolean; rerender: boolean };
  dispatchWorkspaceToolKeyDown: (
    event: KeyboardEvent,
    state: StateT,
    deps: ToolDepsT
  ) => Promise<boolean>;
  dispatchWorkspaceToolDoubleClick: (
    target: HTMLElement,
    state: StateT,
    deps: ToolDepsT
  ) => Promise<boolean>;
  persistFlowWorkspacePrefs: () => void;
  persistWorkspaceTab: (tab: string) => void;
  rerender: () => void;
}

export function bindWorkspaceToolDelegatedEvents<StateT, ToolDepsT>(
  deps: WorkspaceDelegatedEventsDeps<StateT, ToolDepsT>
): void {
  deps.workspacePane.onchange = async (event) => {
    const toggle = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
      `[${deps.managerToggleAttr}]`
    );
    if (toggle) {
      if (!deps.clientRef) return;
      const toolId = toggle.getAttribute(deps.managerToggleAttr);
      if (!toolId) return;
      await deps.clientRef.setWorkspaceToolEnabled({
        toolId,
        enabled: toggle.checked,
        correlationId: deps.nextCorrelationId()
      });
      await deps.refreshTools();
    }

    const iconToggle = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
      `[${deps.managerToggleIconAttr}]`
    );
    if (iconToggle) {
      if (!deps.clientRef) return;
      const toolId = iconToggle.getAttribute(deps.managerToggleIconAttr);
      if (!toolId) return;
      await deps.clientRef.setWorkspaceToolIcon({
        toolId,
        icon: iconToggle.checked,
        correlationId: deps.nextCorrelationId()
      });
      await deps.refreshTools();
    }

    const inputResult = deps.dispatchWorkspaceToolInput(
      event.target as HTMLElement,
      deps.state,
      deps.workspaceToolDeps
    );
    if (inputResult.handled) {
      deps.persistFlowWorkspacePrefs();
    }
    deps.dispatchWorkspaceToolChange(event.target as HTMLElement, deps.state, deps.workspaceToolDeps);
    deps.rerender();
  };

  deps.workspacePane.onsubmit = async (event) => {
    if (await deps.dispatchWorkspaceToolSubmit(event.target as HTMLElement, deps.state, deps.workspaceToolDeps)) {
      event.preventDefault();
      deps.rerender();
    }
  };

  deps.workspacePane.oninput = (event) => {
    const toolInput = deps.dispatchWorkspaceToolInput(
      event.target as HTMLElement,
      deps.state,
      deps.workspaceToolDeps
    );
    if (toolInput.handled) {
      deps.persistFlowWorkspacePrefs();
    }
    if (toolInput.handled && toolInput.rerender) {
      deps.rerender();
    }
  };

  deps.workspacePane.onkeydown = async (event) => {
    if (await deps.dispatchWorkspaceToolKeyDown(event, deps.state, deps.workspaceToolDeps)) {
      event.preventDefault();
      deps.rerender();
    }
  };

  deps.workspacePane.ondblclick = async (event) => {
    if (
      await deps.dispatchWorkspaceToolDoubleClick(
        event.target as HTMLElement,
        deps.state,
        deps.workspaceToolDeps
      )
    ) {
      deps.rerender();
    }
  };
}

interface WorkspacePreClickState {
  filesContextMenuOpen: boolean;
  filesSelectedEntryPath: string | null;
  filesSelectedPaths: string[];
  filesSelectionAnchorPath: string | null;
  filesSelectionGesture: unknown;
  workspaceTab: string;
}

interface WorkspacePreClickDeps {
  state: WorkspacePreClickState;
  event: MouseEvent;
  workspaceToolTargetSelector: string;
  rerender: () => void;
  isWorkspaceTab: (value: string) => boolean;
  ensureTerminalSession: () => Promise<void>;
  refreshTools: () => Promise<void>;
  onWorkspaceTabActivated: (workspaceTab: string) => Promise<void>;
  maybeOpenFlowProjectSetup: () => Promise<void>;
  dispatchWorkspaceToolClick: (target: HTMLElement) => Promise<boolean>;
  persistFlowWorkspacePrefs: () => void;
  persistWorkspaceTab: (tab: string) => void;
}

export async function handleWorkspacePaneClickPrelude(
  deps: WorkspacePreClickDeps
): Promise<{ handled: boolean; target: HTMLElement | null }> {
  const rawTarget = deps.event.target as HTMLElement | null;
  if (
    deps.state.filesContextMenuOpen &&
    rawTarget &&
    !rawTarget.closest(".files-context-menu")
  ) {
    deps.state.filesContextMenuOpen = false;
    deps.rerender();
    return { handled: true, target: null };
  }

  const target = rawTarget?.closest<HTMLElement>(deps.workspaceToolTargetSelector) ?? null;
  if (!target) {
    const clickedInsideFiles = Boolean(rawTarget?.closest(".files-tool"));
    if (clickedInsideFiles) {
      const clickedInteractiveFilesElement = Boolean(
        rawTarget?.closest(
          '[data-files-action], .files-tool-grid-row, .files-tool-tree-row, .files-findbar, .files-editor-panel, .files-editor-input, .notepad-findbar, .notepad-editor-panel, .notepad-editor-input'
        )
      );
      if (!clickedInteractiveFilesElement) {
        deps.state.filesSelectedEntryPath = null;
        deps.state.filesSelectedPaths = [];
        deps.state.filesSelectionAnchorPath = null;
        deps.state.filesSelectionGesture = null;
        deps.rerender();
        return { handled: true, target: null };
      }
    }
    return { handled: true, target: null };
  }

  const nextWorkspaceTab = target.getAttribute("data-workspace-tab");
  if (nextWorkspaceTab && deps.isWorkspaceTab(nextWorkspaceTab)) {
    deps.state.workspaceTab = nextWorkspaceTab;
    deps.persistWorkspaceTab(nextWorkspaceTab);
    if (nextWorkspaceTab === "terminal") {
      await deps.ensureTerminalSession();
    }
    if (nextWorkspaceTab === "manager-tool") {
      await deps.refreshTools();
    }
    await deps.onWorkspaceTabActivated(nextWorkspaceTab);
    if (nextWorkspaceTab === "flow-tool") {
      await deps.maybeOpenFlowProjectSetup();
    }
    deps.rerender();
    return { handled: true, target };
  }

  if (await deps.dispatchWorkspaceToolClick(target)) {
    deps.persistFlowWorkspacePrefs();
    deps.rerender();
    return { handled: true, target };
  }

  return { handled: false, target };
}

interface ManagerTerminalClickDeps {
  state: ManagerTerminalClickState;
  target: HTMLElement;
  event: MouseEvent;
  shellPopover: HTMLElement | null;
  clientRef: {
    exportWorkspaceTools: (request: { correlationId: string }) => Promise<{ payloadJson: string; fileName: string }>;
    importWorkspaceTools: (request: { correlationId: string; payloadJson: string }) => Promise<unknown>;
  } | null;
  nextCorrelationId: () => string;
  refreshTools: () => Promise<void>;
  pushConsoleEntry: (
    level: "log" | "info" | "warn" | "error" | "debug",
    source: "browser" | "app",
    message: string
  ) => void;
  rerender: () => void;
  persistFlowPhaseSessionMap: (map: Record<string, string>) => void;
  terminalManager: TerminalManager;
  closeTerminalSessionAndPickNext: (
    terminalManager: TerminalManager,
    closeSessionId: string
  ) => Promise<string | null>;
  createTerminalSessionForProfile: (
    terminalManager: TerminalManager,
    profile: TerminalShellProfile
  ) => Promise<string>;
  workspaceToolManagerActions: {
    exportSingleTool: (toolId: string) => Promise<void>;
    deleteSingleTool: (toolId: string) => Promise<void>;
  };
}

export async function handleManagerAndTerminalClick(deps: ManagerTerminalClickDeps): Promise<boolean> {
  if (deps.target.id === MANAGER_UI_ID.refreshToolsButton) {
    await deps.refreshTools();
    deps.rerender();
    return true;
  }

  const managerAction = deps.target.getAttribute(MANAGER_DATA_ATTR.action);
  const managerActionToolId = deps.target.getAttribute(MANAGER_DATA_ATTR.actionToolId) ?? "";
  if (managerAction && managerActionToolId) {
    try {
      if (managerAction === "export-tool") {
        await deps.workspaceToolManagerActions.exportSingleTool(managerActionToolId);
      }
      if (managerAction === "delete-tool") {
        await deps.workspaceToolManagerActions.deleteSingleTool(managerActionToolId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.pushConsoleEntry("error", "browser", `Tool manager action failed: ${message}`);
    }
    deps.rerender();
    return true;
  }

  if (deps.target.id === MANAGER_UI_ID.exportToolsButton) {
    if (!deps.clientRef) return true;
    const exported = await deps.clientRef.exportWorkspaceTools({
      correlationId: deps.nextCorrelationId()
    });
    const blob = new Blob([exported.payloadJson], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exported.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    deps.pushConsoleEntry("info", "browser", `Exported tool registry to ${exported.fileName}.`);
    deps.rerender();
    return true;
  }

  if (deps.target.id === MANAGER_UI_ID.importToolsButton) {
    const client = deps.clientRef;
    if (!client) return true;
    const input = document.createElement("input");
    const cleanup = () => {
      if (input.parentElement) {
        document.body.removeChild(input);
      }
    };
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);
    window.setTimeout(cleanup, 60_000);
    input.onchange = () => {
      void (async () => {
        try {
          const file = input.files?.[0];
          if (!file) return;
          const payloadJson = await file.text();
          await client.importWorkspaceTools({
            correlationId: deps.nextCorrelationId(),
            payloadJson
          });
          await deps.refreshTools();
          deps.pushConsoleEntry("info", "browser", `Imported tool registry from ${file.name}.`);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown import failure";
          deps.pushConsoleEntry("error", "browser", `Failed importing tool registry: ${message}`);
        } finally {
          deps.rerender();
          cleanup();
        }
      })();
    };
    input.click();
    return true;
  }

  const closeSessionId = deps.target.getAttribute(TERMINAL_DATA_ATTR.closeSessionId);
  if (closeSessionId) {
    deps.event.preventDefault();
    deps.event.stopPropagation();
    deps.state.activeTerminalSessionId = await deps.closeTerminalSessionAndPickNext(
      deps.terminalManager,
      closeSessionId
    );
    const nextMap = Object.fromEntries(
      Object.entries(deps.state.flowPhaseSessionByName).filter(([, sessionId]) => sessionId !== closeSessionId)
    );
    deps.state.flowPhaseSessionByName = nextMap;
    deps.persistFlowPhaseSessionMap(deps.state.flowPhaseSessionByName);
    deps.rerender();
    return true;
  }

  const shellProfile = deps.target.getAttribute(TERMINAL_DATA_ATTR.shellProfile) as
    | TerminalShellProfile
    | null;
  if (shellProfile) {
    deps.state.terminalShellProfile = shellProfile;
    if (deps.shellPopover) deps.shellPopover.hidden = true;
    deps.rerender();
    return true;
  }

  if (deps.target.id === TERMINAL_UI_ID.shellButton) {
    deps.event.preventDefault();
    deps.event.stopPropagation();
    if (!deps.shellPopover) return true;
    const nextHidden = !deps.shellPopover.hidden;
    deps.shellPopover.hidden = nextHidden;
    if (!nextHidden) return true;
    const closePopover = () => {
      deps.shellPopover!.hidden = true;
    };
    document.addEventListener("click", closePopover, { once: true });
    return true;
  }

  const action = deps.target.getAttribute(TERMINAL_DATA_ATTR.action);
  if (action === "new") {
    deps.state.activeTerminalSessionId = await deps.createTerminalSessionForProfile(
      deps.terminalManager,
      deps.state.terminalShellProfile
    );
    deps.rerender();
    return true;
  }

  const sessionId = deps.target.getAttribute(TERMINAL_DATA_ATTR.sessionId);
  if (sessionId) {
    deps.state.activeTerminalSessionId = sessionId;
    deps.rerender();
    return true;
  }

  return false;
}

export function bindConsoleInteractions(deps: {
  consoleEntries: ConsoleEntry[];
  consoleView: ConsoleView;
  setConsoleView: (view: ConsoleView) => void;
  pushConsoleEntry: (
    level: "log" | "info" | "warn" | "error" | "debug",
    source: "browser" | "app",
    message: string
  ) => void;
  rerender: () => void;
}): void {
  const consoleTabButtons = document.querySelectorAll<HTMLButtonElement>(`[${CONSOLE_DATA_ATTR.view}]`);
  for (const button of consoleTabButtons) {
    button.onclick = () => {
      const view = button.getAttribute(CONSOLE_DATA_ATTR.view);
      if (view !== "all" && view !== "errors-warnings" && view !== "security-events") return;
      if (deps.consoleView === view) return;
      deps.setConsoleView(view);
      deps.rerender();
    };
  }

  const consoleActionButtons = document.querySelectorAll<HTMLButtonElement>(
    `[${CONSOLE_DATA_ATTR.action}]`
  );
  for (const button of consoleActionButtons) {
    button.onclick = async () => {
      const action = button.getAttribute(CONSOLE_DATA_ATTR.action);
      if (!action) return;
      if (action === "copy") {
        const visible = getVisibleConsoleEntries(deps.consoleEntries, deps.consoleView);
        const text = buildConsoleCopyText(visible);
        const visibleCount = visible.length;
        if (!text) {
          deps.pushConsoleEntry("info", "browser", "Console is empty; nothing copied.");
          deps.rerender();
          return;
        }
        try {
          await navigator.clipboard.writeText(text);
          deps.pushConsoleEntry("info", "browser", `Copied ${visibleCount} console lines.`);
        } catch {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.setAttribute("readonly", "true");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(textarea);
          if (!ok) {
            deps.pushConsoleEntry("error", "browser", "Failed to copy console output.");
          } else {
            deps.pushConsoleEntry("info", "browser", `Copied ${visibleCount} console lines.`);
          }
        }
        deps.rerender();
        return;
      }
      if (action === "save") {
        const visible = getVisibleConsoleEntries(deps.consoleEntries, deps.consoleView);
        const text = buildConsoleCopyText(visible);
        const visibleCount = visible.length;
        if (!text) {
          deps.pushConsoleEntry("info", "browser", "Console is empty; nothing to save.");
          deps.rerender();
          return;
        }
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = buildConsoleFilename(new Date());
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        deps.pushConsoleEntry("info", "browser", `Saved ${visibleCount} console lines as .txt.`);
        deps.rerender();
      }
    };
  }
}
