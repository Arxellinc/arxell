import {
  handleFilesClick,
  handleFilesInput,
  handleFilesKeyDown,
  handleFilesPointerDown
} from "../files/bindings";
import type { SkillsToolViewState } from "./index";

export interface SkillsDeps {
  listSkillsDirectory: (path?: string) => Promise<void>;
  selectSkillsPath: (path: string) => Promise<void>;
  toggleSkillsNode: (path: string) => Promise<void>;
  openSkillsFile: (path: string) => Promise<void>;
  createNewSkillsFile: (path: string) => Promise<void>;
  activateSkillsTab: (path: string) => void;
  closeSkillsTab: (path: string) => void;
  updateSkillsBuffer: (path: string, content: string) => void;
  saveActiveSkillsTab: () => Promise<void>;
  saveActiveSkillsTabAs: (path: string) => Promise<void>;
  saveAllSkillsTabs: () => Promise<void>;
}

function adaptSlice(state: SkillsToolViewState) {
  return {
    get filesRootPath() { return state.skillsRootPath; },
    set filesRootPath(value) { state.skillsRootPath = value; },
    get filesSelectedPath() { return state.skillsSelectedPath; },
    set filesSelectedPath(value) { state.skillsSelectedPath = value; },
    get filesSelectedEntryPath() { return state.skillsSelectedEntryPath; },
    set filesSelectedEntryPath(value) { state.skillsSelectedEntryPath = value; },
    get filesExpandedByPath() { return state.skillsExpandedByPath; },
    set filesExpandedByPath(value) { state.skillsExpandedByPath = value; },
    get filesEntriesByPath() { return state.skillsEntriesByPath; },
    set filesEntriesByPath(value) { state.skillsEntriesByPath = value; },
    get filesLoadingByPath() { return state.skillsLoadingByPath; },
    set filesLoadingByPath(value) { state.skillsLoadingByPath = value; },
    get filesOpenTabs() { return state.skillsOpenTabs; },
    set filesOpenTabs(value) { state.skillsOpenTabs = value; },
    get filesActiveTabPath() { return state.skillsActiveTabPath; },
    set filesActiveTabPath(value) { state.skillsActiveTabPath = value; },
    get filesContentByPath() { return state.skillsContentByPath; },
    set filesContentByPath(value) { state.skillsContentByPath = value; },
    get filesSavedContentByPath() { return state.skillsSavedContentByPath; },
    set filesSavedContentByPath(value) { state.skillsSavedContentByPath = value; },
    get filesDirtyByPath() { return state.skillsDirtyByPath; },
    set filesDirtyByPath(value) { state.skillsDirtyByPath = value; },
    get filesReadOnlyByPath() { return state.skillsReadOnlyByPath; },
    set filesReadOnlyByPath(value) { state.skillsReadOnlyByPath = value; },
    get filesLoadingFileByPath() { return state.skillsLoadingFileByPath; },
    set filesLoadingFileByPath(value) { state.skillsLoadingFileByPath = value; },
    get filesSavingFileByPath() { return state.skillsSavingFileByPath; },
    set filesSavingFileByPath(value) { state.skillsSavingFileByPath = value; },
    get filesSizeByPath() { return state.skillsSizeByPath; },
    set filesSizeByPath(value) { state.skillsSizeByPath = value; },
    get filesError() { return state.skillsError; },
    set filesError(value) { state.skillsError = value; },
    get filesSidebarWidth() { return state.skillsSidebarWidth; },
    set filesSidebarWidth(value) { state.skillsSidebarWidth = value; },
    get filesSidebarCollapsed() { return state.skillsSidebarCollapsed; },
    set filesSidebarCollapsed(value) { state.skillsSidebarCollapsed = value; },
    get filesFindOpen() { return state.skillsFindOpen; },
    set filesFindOpen(value) { state.skillsFindOpen = value; },
    get filesFindQuery() { return state.skillsFindQuery; },
    set filesFindQuery(value) { state.skillsFindQuery = value; },
    get filesReplaceQuery() { return state.skillsReplaceQuery; },
    set filesReplaceQuery(value) { state.skillsReplaceQuery = value; },
    get filesFindCaseSensitive() { return state.skillsFindCaseSensitive; },
    set filesFindCaseSensitive(value) { state.skillsFindCaseSensitive = value; },
    get filesLineWrap() { return state.skillsLineWrap; },
    set filesLineWrap(value) { state.skillsLineWrap = value; }
  };
}

export async function handleSkillsClick(target: HTMLElement, state: SkillsToolViewState, deps: SkillsDeps): Promise<boolean> {
  return handleFilesClick(target, adaptSlice(state) as never, {
    listFilesDirectory: deps.listSkillsDirectory,
    selectFilesPath: deps.selectSkillsPath,
    toggleFilesNode: deps.toggleSkillsNode,
    openFilesFile: deps.openSkillsFile,
    activateFilesTab: deps.activateSkillsTab,
    closeFilesTab: deps.closeSkillsTab,
    updateFilesBuffer: deps.updateSkillsBuffer,
    saveActiveFilesTab: deps.saveActiveSkillsTab,
    saveActiveFilesTabAs: deps.saveActiveSkillsTabAs,
    saveAllFilesTabs: deps.saveAllSkillsTabs,
    createNewFilesFile: deps.createNewSkillsFile,
    createNewFilesFolder: async () => undefined,
    duplicateActiveFilesTab: async () => undefined,
    deleteFilesPath: async () => undefined,
    renameFilesPath: async () => undefined,
    pasteFilesClipboard: async () => undefined,
    undoLastFilesDelete: async () => undefined,
    openPathInTerminal: async () => undefined
  });
}

export function handleSkillsInput(target: HTMLElement, state: SkillsToolViewState): { handled: boolean; rerender: boolean } {
  return handleFilesInput(target, adaptSlice(state) as never);
}

export async function handleSkillsKeyDown(event: KeyboardEvent, state: SkillsToolViewState, deps: SkillsDeps): Promise<boolean> {
  return handleFilesKeyDown(event, adaptSlice(state) as never, {
    saveActiveFilesTab: deps.saveActiveSkillsTab,
    saveActiveFilesTabAs: deps.saveActiveSkillsTabAs,
    saveAllFilesTabs: deps.saveAllSkillsTabs,
    openFilesFile: deps.openSkillsFile,
    closeFilesTab: deps.closeSkillsTab,
    updateFilesBuffer: deps.updateSkillsBuffer,
    pasteFilesClipboard: async () => undefined,
    undoLastFilesDelete: async () => undefined
  });
}

export function handleSkillsPointerDown(event: MouseEvent, target: HTMLElement, state: SkillsToolViewState): boolean {
  return handleFilesPointerDown(event, target, adaptSlice(state) as never);
}
