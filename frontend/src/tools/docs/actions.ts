import type { ChatIpcClient } from "../../ipcClient";
import type { DocsToolState } from "./state";
import {
  activateFilesTab,
  closeFilesTab,
  createNewFilesFile,
  ensureFilesExplorerLoaded,
  listFilesDirectory,
  openFilesFile,
  selectFilesPath,
  saveActiveFilesTab,
  saveAllFilesTabs,
  saveActiveFilesTabAs,
  toggleFilesNode,
  updateFilesBuffer
} from "../files/actions";

interface DocsDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
}

function adaptDocsSlice(state: DocsToolState) {
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
    get filesLoadingFileByPath() { return state.docsLoadingFileByPath; },
    set filesLoadingFileByPath(value) { state.docsLoadingFileByPath = value; },
    get filesSavingFileByPath() { return state.docsSavingFileByPath; },
    set filesSavingFileByPath(value) { state.docsSavingFileByPath = value; },
    get filesReadOnlyByPath() { return state.docsReadOnlyByPath; },
    set filesReadOnlyByPath(value) { state.docsReadOnlyByPath = value; },
    get filesSizeByPath() { return state.docsSizeByPath; },
    set filesSizeByPath(value) { state.docsSizeByPath = value; },
    get filesError() { return state.docsError; },
    set filesError(value) { state.docsError = value; },
    get filesLineWrap() { return state.docsLineWrap; },
    set filesLineWrap(value) { state.docsLineWrap = value; }
  };
}

export async function ensureDocsLoaded(state: DocsToolState, deps: DocsDeps): Promise<void> {
  const slice = adaptDocsSlice(state);
  if (!slice.filesRootPath) {
    await listFilesDirectory(slice as never, deps, "docs");
    return;
  }
  await ensureFilesExplorerLoaded(slice as never, deps);
}

export async function listDocsDirectory(state: DocsToolState, deps: DocsDeps, path?: string): Promise<void> {
  await listFilesDirectory(adaptDocsSlice(state) as never, deps, path);
}

export async function toggleDocsNode(state: DocsToolState, deps: DocsDeps, path: string): Promise<void> {
  await toggleFilesNode(adaptDocsSlice(state) as never, deps, path);
}

export async function selectDocsPath(state: DocsToolState, deps: DocsDeps, path: string): Promise<void> {
  await selectFilesPath(adaptDocsSlice(state) as never, deps, path);
}

export async function openDocsFile(state: DocsToolState, deps: DocsDeps, path: string): Promise<void> {
  await openFilesFile(adaptDocsSlice(state) as never, deps, path);
}

export function activateDocsTab(state: DocsToolState, path: string): void {
  activateFilesTab(adaptDocsSlice(state) as never, path);
}

export function closeDocsTab(state: DocsToolState, path: string): void {
  closeFilesTab(adaptDocsSlice(state) as never, path);
}

export function updateDocsBuffer(state: DocsToolState, path: string, content: string): void {
  updateFilesBuffer(adaptDocsSlice(state) as never, path, content);
}

export async function saveActiveDocsTab(state: DocsToolState, deps: DocsDeps): Promise<void> {
  await saveActiveFilesTab(adaptDocsSlice(state) as never, deps);
}

export async function saveActiveDocsTabAs(state: DocsToolState, deps: DocsDeps, path: string): Promise<void> {
  await saveActiveFilesTabAs(adaptDocsSlice(state) as never, deps, path);
}

export async function saveAllDocsTabs(state: DocsToolState, deps: DocsDeps): Promise<void> {
  await saveAllFilesTabs(adaptDocsSlice(state) as never, deps);
}

export async function createNewDocsFile(state: DocsToolState, deps: DocsDeps, path: string): Promise<void> {
  await createNewFilesFile(adaptDocsSlice(state) as never, deps, path);
}
