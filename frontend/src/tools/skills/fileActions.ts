import type { ChatIpcClient } from "../../ipcClient";
import type { FilesListDirectoryEntry } from "../../contracts";
import {
  activateFilesTab,
  closeFilesTab,
  createNewFilesFile,
  ensureFilesExplorerLoaded,
  listFilesDirectory,
  openFilesFile,
  saveActiveFilesTab,
  saveActiveFilesTabAs,
  saveAllFilesTabs,
  selectFilesPath,
  toggleFilesNode,
  updateFilesBuffer
} from "../files/actions";
import { SKILLS_FOLDER } from "./state";

export interface SkillsFileToolState {
  skillsRootPath: string | null;
  skillsSelectedPath: string | null;
  skillsSelectedEntryPath: string | null;
  skillsExpandedByPath: Record<string, boolean>;
  skillsEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  skillsLoadingByPath: Record<string, boolean>;
  skillsOpenTabs: string[];
  skillsActiveTabPath: string | null;
  skillsContentByPath: Record<string, string>;
  skillsSavedContentByPath: Record<string, string>;
  skillsDirtyByPath: Record<string, boolean>;
  skillsLoadingFileByPath: Record<string, boolean>;
  skillsSavingFileByPath: Record<string, boolean>;
  skillsReadOnlyByPath: Record<string, boolean>;
  skillsSizeByPath: Record<string, number>;
  skillsLineWrap: boolean;
  skillsError: string | null;
}

interface SkillsDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
}

function adaptSkillsSlice(state: SkillsFileToolState) {
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
    get filesLoadingFileByPath() { return state.skillsLoadingFileByPath; },
    set filesLoadingFileByPath(value) { state.skillsLoadingFileByPath = value; },
    get filesSavingFileByPath() { return state.skillsSavingFileByPath; },
    set filesSavingFileByPath(value) { state.skillsSavingFileByPath = value; },
    get filesReadOnlyByPath() { return state.skillsReadOnlyByPath; },
    set filesReadOnlyByPath(value) { state.skillsReadOnlyByPath = value; },
    get filesSizeByPath() { return state.skillsSizeByPath; },
    set filesSizeByPath(value) { state.skillsSizeByPath = value; },
    get filesError() { return state.skillsError; },
    set filesError(value) { state.skillsError = value; },
    get filesLineWrap() { return state.skillsLineWrap; },
    set filesLineWrap(value) { state.skillsLineWrap = value; }
  };
}

export async function ensureSkillsLoaded(state: SkillsFileToolState, deps: SkillsDeps): Promise<void> {
  const slice = adaptSkillsSlice(state);
  if (!slice.filesRootPath) {
    await listFilesDirectory(slice as never, deps, SKILLS_FOLDER);
    return;
  }
  await ensureFilesExplorerLoaded(slice as never, deps);
}

export async function listSkillsDirectory(state: SkillsFileToolState, deps: SkillsDeps, path?: string): Promise<void> {
  await listFilesDirectory(adaptSkillsSlice(state) as never, deps, path);
}

export async function selectSkillsPath(state: SkillsFileToolState, deps: SkillsDeps, path: string): Promise<void> {
  await selectFilesPath(adaptSkillsSlice(state) as never, deps, path);
}

export async function toggleSkillsNode(state: SkillsFileToolState, deps: SkillsDeps, path: string): Promise<void> {
  await toggleFilesNode(adaptSkillsSlice(state) as never, deps, path);
}

export async function openSkillsFile(state: SkillsFileToolState, deps: SkillsDeps, path: string): Promise<void> {
  await openFilesFile(adaptSkillsSlice(state) as never, deps, path);
}

export function activateSkillsTab(state: SkillsFileToolState, path: string): void {
  activateFilesTab(adaptSkillsSlice(state) as never, path);
}

export function closeSkillsTab(state: SkillsFileToolState, path: string): void {
  closeFilesTab(adaptSkillsSlice(state) as never, path);
}

export function updateSkillsBuffer(state: SkillsFileToolState, path: string, content: string): void {
  updateFilesBuffer(adaptSkillsSlice(state) as never, path, content);
}

export async function saveActiveSkillsTab(state: SkillsFileToolState, deps: SkillsDeps): Promise<void> {
  await saveActiveFilesTab(adaptSkillsSlice(state) as never, deps);
}

export async function saveActiveSkillsTabAs(state: SkillsFileToolState, deps: SkillsDeps, path: string): Promise<void> {
  await saveActiveFilesTabAs(adaptSkillsSlice(state) as never, deps, path);
}

export async function saveAllSkillsTabs(state: SkillsFileToolState, deps: SkillsDeps): Promise<void> {
  await saveAllFilesTabs(adaptSkillsSlice(state) as never, deps);
}

export async function createNewSkillsFile(state: SkillsFileToolState, deps: SkillsDeps, path: string): Promise<void> {
  await createNewFilesFile(adaptSkillsSlice(state) as never, deps, path);
}
