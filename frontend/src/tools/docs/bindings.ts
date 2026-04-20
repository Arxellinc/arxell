import {
  handleFilesClick,
  handleFilesInput,
  handleFilesKeyDown,
  handleFilesPointerDown
} from "../files/bindings";
import type { DocsToolViewState } from "./index";

export interface DocsDeps {
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
}

function adaptSlice(state: DocsToolViewState) {
  return {
    get filesRootPath() { return state.docsRootPath; },
    set filesRootPath(value) { state.docsRootPath = value; },
    get filesSelectedPath() { return state.docsSelectedPath; },
    set filesSelectedPath(value) { state.docsSelectedPath = value; },
    get filesSelectedEntryPath() { return state.docsSelectedEntryPath; },
    set filesSelectedEntryPath(value) { state.docsSelectedEntryPath = value; },
    get filesExpandedByPath() { return state.docsExpandedByPath; },
    set filesExpandedByPath(value) { state.docsExpandedByPath = value; },
    get filesEntriesByPath() { return state.docsEntriesByPath; },
    set filesEntriesByPath(value) { state.docsEntriesByPath = value; },
    get filesLoadingByPath() { return state.docsLoadingByPath; },
    set filesLoadingByPath(value) { state.docsLoadingByPath = value; },
    get filesOpenTabs() { return state.docsOpenTabs; },
    set filesOpenTabs(value) { state.docsOpenTabs = value; },
    get filesActiveTabPath() { return state.docsActiveTabPath; },
    set filesActiveTabPath(value) { state.docsActiveTabPath = value; },
    get filesContentByPath() { return state.docsContentByPath; },
    set filesContentByPath(value) { state.docsContentByPath = value; },
    get filesSavedContentByPath() { return state.docsSavedContentByPath; },
    set filesSavedContentByPath(value) { state.docsSavedContentByPath = value; },
    get filesDirtyByPath() { return state.docsDirtyByPath; },
    set filesDirtyByPath(value) { state.docsDirtyByPath = value; },
    get filesReadOnlyByPath() { return state.docsReadOnlyByPath; },
    set filesReadOnlyByPath(value) { state.docsReadOnlyByPath = value; },
    get filesLoadingFileByPath() { return state.docsLoadingFileByPath; },
    set filesLoadingFileByPath(value) { state.docsLoadingFileByPath = value; },
    get filesSavingFileByPath() { return state.docsSavingFileByPath; },
    set filesSavingFileByPath(value) { state.docsSavingFileByPath = value; },
    get filesSizeByPath() { return state.docsSizeByPath; },
    set filesSizeByPath(value) { state.docsSizeByPath = value; },
    get filesError() { return state.docsError; },
    set filesError(value) { state.docsError = value; },
    get filesSidebarWidth() { return state.docsSidebarWidth; },
    set filesSidebarWidth(value) { state.docsSidebarWidth = value; },
    get filesSidebarCollapsed() { return state.docsSidebarCollapsed; },
    set filesSidebarCollapsed(value) { state.docsSidebarCollapsed = value; },
    get filesFindOpen() { return state.docsFindOpen; },
    set filesFindOpen(value) { state.docsFindOpen = value; },
    get filesFindQuery() { return state.docsFindQuery; },
    set filesFindQuery(value) { state.docsFindQuery = value; },
    get filesReplaceQuery() { return state.docsReplaceQuery; },
    set filesReplaceQuery(value) { state.docsReplaceQuery = value; },
    get filesFindCaseSensitive() { return state.docsFindCaseSensitive; },
    set filesFindCaseSensitive(value) { state.docsFindCaseSensitive = value; },
    get filesLineWrap() { return state.docsLineWrap; },
    set filesLineWrap(value) { state.docsLineWrap = value; }
  };
}

export async function handleDocsClick(
  target: HTMLElement,
  state: DocsToolViewState,
  deps: DocsDeps
): Promise<boolean> {
  return handleFilesClick(target, adaptSlice(state) as never, {
    listFilesDirectory: deps.listDocsDirectory,
    selectFilesPath: deps.selectDocsPath,
    toggleFilesNode: deps.toggleDocsNode,
    openFilesFile: deps.openDocsFile,
    activateFilesTab: deps.activateDocsTab,
    closeFilesTab: deps.closeDocsTab,
    updateFilesBuffer: deps.updateDocsBuffer,
    saveActiveFilesTab: deps.saveActiveDocsTab,
    saveActiveFilesTabAs: deps.saveActiveDocsTabAs,
    saveAllFilesTabs: deps.saveAllDocsTabs,
    createNewFilesFile: deps.createNewDocsFile,
    createNewFilesFolder: async () => undefined,
    duplicateActiveFilesTab: async () => undefined,
    deleteFilesPath: async () => undefined,
    renameFilesPath: async () => undefined,
    pasteFilesClipboard: async () => undefined,
    undoLastFilesDelete: async () => undefined,
    openPathInTerminal: async () => undefined
  });
}

export function handleDocsInput(target: HTMLElement, state: DocsToolViewState): { handled: boolean; rerender: boolean } {
  return handleFilesInput(target, adaptSlice(state) as never);
}

export async function handleDocsKeyDown(
  event: KeyboardEvent,
  state: DocsToolViewState,
  deps: DocsDeps
): Promise<boolean> {
  return handleFilesKeyDown(event, adaptSlice(state) as never, {
    saveActiveFilesTab: deps.saveActiveDocsTab,
    saveActiveFilesTabAs: deps.saveActiveDocsTabAs,
    saveAllFilesTabs: deps.saveAllDocsTabs,
    openFilesFile: deps.openDocsFile,
    closeFilesTab: deps.closeDocsTab,
    updateFilesBuffer: deps.updateDocsBuffer,
    pasteFilesClipboard: async () => undefined,
    undoLastFilesDelete: async () => undefined
  });
}

export function handleDocsPointerDown(event: MouseEvent, target: HTMLElement, state: DocsToolViewState): boolean {
  return handleFilesPointerDown(event, target, adaptSlice(state) as never);
}
