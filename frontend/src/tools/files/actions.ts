import type { ChatIpcClient } from "../../ipcClient";
import type { FilesListDirectoryEntry } from "../../contracts";
import type {
  FilesDeleteUndoDirSnapshot,
  FilesDeleteUndoEntry,
  FilesDeleteUndoFileSnapshot,
  FilesDeleteUndoSnapshot,
  FilesToolStateSlice
} from "./state";

type FilesSlice = FilesToolStateSlice;

export type FilesConflictChoice = "replace" | "copy" | "cancel";
export interface FilesConflictResolution {
  choice: FilesConflictChoice;
  applyToAll: boolean;
}

interface FilesDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
}

export async function listFilesDirectory(
  slice: FilesSlice,
  deps: FilesDeps,
  path?: string
): Promise<void> {
  if (!deps.client) return;
  const requested = path?.trim();
  const key = requested || slice.filesRootPath || "";
  if (key) {
    slice.filesLoadingByPath[key] = true;
  }
  slice.filesError = null;
  try {
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "files",
      action: "list-directory",
      mode: "sandbox",
      payload: {
        correlationId,
        ...(requested ? { path: requested } : {})
      }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Files tool invocation failed.");
    }
    const response = invokeResponse.data as unknown as {
      rootPath: string;
      listedPath: string;
      entries: FilesListDirectoryEntry[];
    };
    slice.filesRootPath = response.rootPath;
    slice.filesEntriesByPath[response.listedPath] = response.entries;
    slice.filesLoadingByPath[response.listedPath] = false;
    if (slice.filesExpandedByPath[response.rootPath] === undefined) {
      slice.filesExpandedByPath[response.rootPath] = true;
    }
    if (!slice.filesSelectedPath) {
      slice.filesSelectedPath = response.listedPath;
    }
  } catch (error) {
    if (key) {
      slice.filesLoadingByPath[key] = false;
    }
    slice.filesError = error instanceof Error ? error.message : String(error);
  }
}

export async function ensureFilesExplorerLoaded(slice: FilesSlice, deps: FilesDeps): Promise<void> {
  if (!slice.filesRootPath) {
    await listFilesDirectory(slice, deps);
    return;
  }
  const selected = slice.filesSelectedPath || slice.filesRootPath;
  if (selected && !slice.filesEntriesByPath[selected]) {
    await listFilesDirectory(slice, deps, selected);
  }
}

export async function selectFilesPath(
  slice: FilesSlice,
  deps: FilesDeps,
  path: string
): Promise<void> {
  slice.filesSelectedPath = path;
  slice.filesSelectedEntryPath = null;
  slice.filesSelectedPaths = [];
  if (!slice.filesEntriesByPath[path]) {
    await listFilesDirectory(slice, deps, path);
  }
}

export async function toggleFilesNode(
  slice: FilesSlice,
  deps: FilesDeps,
  path: string
): Promise<void> {
  const expanded = slice.filesExpandedByPath[path] === true;
  slice.filesExpandedByPath[path] = !expanded;
  if (!expanded && !slice.filesEntriesByPath[path]) {
    await listFilesDirectory(slice, deps, path);
  }
}

export async function openFilesFile(
  slice: FilesSlice,
  deps: FilesDeps,
  path: string
): Promise<void> {
  const requested = path.trim();
  if (!requested || !deps.client) return;
  slice.filesError = null;
  if (!slice.filesOpenTabs.includes(requested)) {
    slice.filesOpenTabs = [...slice.filesOpenTabs, requested];
  }
  slice.filesActiveTabPath = requested;
  slice.filesSelectedEntryPath = requested;
  slice.filesSelectedPaths = [requested];
  slice.filesLoadingFileByPath[requested] = true;
  try {
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "files",
      action: "read-file",
      mode: "sandbox",
      payload: {
        correlationId,
        path: requested
      }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed reading file.");
    }
    const response = invokeResponse.data as unknown as {
      path: string;
      content: string;
      sizeBytes: number;
      readOnly: boolean;
      isBinary: boolean;
    };
    const canonicalPath = response.path || requested;
    const content = response.content ?? "";
    if (canonicalPath !== requested) {
      slice.filesOpenTabs = slice.filesOpenTabs.map((tab) =>
        tab === requested ? canonicalPath : tab
      );
      if (slice.filesActiveTabPath === requested) {
        slice.filesActiveTabPath = canonicalPath;
      }
      if (slice.filesSelectedEntryPath === requested) {
        slice.filesSelectedEntryPath = canonicalPath;
      }
      slice.filesSelectedPaths = (slice.filesSelectedPaths ?? []).map((row) =>
        row === requested ? canonicalPath : row
      );
    }
    slice.filesContentByPath[canonicalPath] = content;
    slice.filesSavedContentByPath[canonicalPath] = content;
    slice.filesDirtyByPath[canonicalPath] = false;
    slice.filesReadOnlyByPath[canonicalPath] = Boolean(response.readOnly || response.isBinary);
    slice.filesSizeByPath[canonicalPath] = Number.isFinite(response.sizeBytes)
      ? response.sizeBytes
      : content.length;
    slice.filesLoadingFileByPath[canonicalPath] = false;
    if (canonicalPath !== requested) {
      delete slice.filesLoadingFileByPath[requested];
    }
  } catch (error) {
    slice.filesLoadingFileByPath[requested] = false;
    slice.filesError = error instanceof Error ? error.message : String(error);
  }
}

export function activateFilesTab(slice: FilesSlice, path: string): void {
  if (!path.trim()) return;
  slice.filesActiveTabPath = path;
  slice.filesSelectedEntryPath = path;
}

export function closeFilesTab(slice: FilesSlice, path: string): void {
  const tabs = slice.filesOpenTabs.filter((item) => item !== path);
  slice.filesOpenTabs = tabs;
  if (slice.filesActiveTabPath === path) {
    slice.filesActiveTabPath = tabs[tabs.length - 1] ?? null;
  }
  if (slice.filesSelectedEntryPath === path) {
    slice.filesSelectedEntryPath = null;
  }
  if (slice.filesSelectedPaths?.includes(path)) {
    slice.filesSelectedPaths = slice.filesSelectedPaths.filter((row) => row !== path);
  }
}

export function updateFilesBuffer(slice: FilesSlice, path: string, content: string): void {
  if (!path.trim()) return;
  slice.filesContentByPath[path] = content;
  const saved = slice.filesSavedContentByPath[path] ?? "";
  slice.filesDirtyByPath[path] = saved !== content;
}

export async function saveActiveFilesTab(slice: FilesSlice, deps: FilesDeps): Promise<void> {
  if (!deps.client) return;
  const path = slice.filesActiveTabPath;
  if (!path) return;
  if (slice.filesReadOnlyByPath[path]) {
    slice.filesError = "This file is read-only.";
    return;
  }
  const content = slice.filesContentByPath[path] ?? "";
  slice.filesError = null;
  slice.filesSavingFileByPath[path] = true;
  try {
    await writeFilesPath(slice, deps, path, content);
    slice.filesSavedContentByPath[path] = content;
    slice.filesDirtyByPath[path] = false;
    slice.filesSavingFileByPath[path] = false;
  } catch (error) {
    slice.filesSavingFileByPath[path] = false;
    slice.filesError = error instanceof Error ? error.message : String(error);
  }
}

export async function saveActiveFilesTabAs(
  slice: FilesSlice,
  deps: FilesDeps,
  nextPath: string
): Promise<void> {
  if (!deps.client) return;
  const activePath = slice.filesActiveTabPath;
  if (!activePath) return;
  const requested = nextPath.trim();
  if (!requested) return;
  const content = slice.filesContentByPath[activePath] ?? "";
  slice.filesError = null;
  try {
    const canonical = await writeFilesPath(slice, deps, requested, content);
    if (!slice.filesOpenTabs.includes(canonical)) {
      slice.filesOpenTabs = [...slice.filesOpenTabs, canonical];
    }
    slice.filesActiveTabPath = canonical;
    slice.filesSelectedEntryPath = canonical;
    slice.filesContentByPath[canonical] = content;
    slice.filesSavedContentByPath[canonical] = content;
    slice.filesDirtyByPath[canonical] = false;
    slice.filesReadOnlyByPath[canonical] = false;
    await refreshParentDirectoryIfLoaded(slice, deps, canonical);
  } catch (error) {
    slice.filesError = error instanceof Error ? error.message : String(error);
  }
}

export async function saveAllFilesTabs(slice: FilesSlice, deps: FilesDeps): Promise<void> {
  if (!deps.client) return;
  const dirtyTabs = slice.filesOpenTabs.filter(
    (path) => slice.filesDirtyByPath[path] && !slice.filesReadOnlyByPath[path]
  );
  for (const path of dirtyTabs) {
    slice.filesSavingFileByPath[path] = true;
    try {
      const content = slice.filesContentByPath[path] ?? "";
      await writeFilesPath(slice, deps, path, content);
      slice.filesSavedContentByPath[path] = content;
      slice.filesDirtyByPath[path] = false;
      slice.filesSavingFileByPath[path] = false;
    } catch (error) {
      slice.filesSavingFileByPath[path] = false;
      slice.filesError = error instanceof Error ? error.message : String(error);
      return;
    }
  }
}

export async function createNewFilesFile(
  slice: FilesSlice,
  deps: FilesDeps,
  path: string
): Promise<void> {
  if (!deps.client) return;
  const requested = path.trim();
  if (!requested) return;
  slice.filesError = null;
  try {
    const canonical = await writeFilesPath(slice, deps, requested, "");
    await refreshParentDirectoryIfLoaded(slice, deps, canonical);
    await openFilesFile(slice, deps, canonical);
  } catch (error) {
    slice.filesError = error instanceof Error ? error.message : String(error);
  }
}

export async function createNewFilesFolder(
  slice: FilesSlice,
  deps: FilesDeps,
  path: string
): Promise<void> {
  if (!deps.client) return;
  const requested = path.trim();
  if (!requested) return;
  slice.filesError = null;
  try {
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "files",
      action: "create-directory",
      mode: "sandbox",
      payload: {
        correlationId,
        path: requested,
        recursive: true
      }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed creating directory.");
    }
    const response = invokeResponse.data as unknown as {
      path?: string;
    };
    const canonical = response.path?.trim() ? response.path.trim() : requested;
    const parent = parentDir(canonical);
    if (parent && slice.filesEntriesByPath[parent]) {
      await listFilesDirectory(slice, deps, parent);
    }
    await selectFilesPath(slice, deps, canonical);
    slice.filesExpandedByPath[canonical] = true;
  } catch (error) {
    slice.filesError = error instanceof Error ? error.message : String(error);
  }
}

export function openFilesContextMenu(
  slice: FilesSlice,
  x: number,
  y: number,
  path: string | null,
  isDir: boolean
): void {
  slice.filesContextMenuOpen = true;
  slice.filesContextMenuX = Math.round(x);
  slice.filesContextMenuY = Math.round(y);
  slice.filesContextMenuTargetPath = path?.trim() || null;
  slice.filesContextMenuTargetIsDir = isDir;
  slice.filesContextMenuPointerInside = false;
}

export function closeFilesContextMenu(slice: FilesSlice): void {
  slice.filesContextMenuOpen = false;
}

export function selectAllFilesInDirectory(slice: FilesSlice): void {
  const selected = slice.filesSelectedPath || slice.filesRootPath;
  if (!selected) {
    slice.filesSelectedPaths = [];
    return;
  }
  const entries = slice.filesEntriesByPath[selected] ?? [];
  slice.filesSelectedPaths = entries.filter((entry) => !entry.isDir).map((entry) => entry.path);
}

export function setFilesClipboard(
  slice: FilesSlice,
  mode: "copy" | "cut",
  paths: string[]
): void {
  const clean = paths.map((row) => row.trim()).filter(Boolean);
  slice.filesClipboardMode = clean.length ? mode : null;
  slice.filesClipboardPaths = clean;
}

export async function deleteFilesPath(
  slice: FilesSlice,
  deps: FilesDeps,
  path: string,
  recursive = false,
  recordUndo = true
): Promise<void> {
  if (!deps.client) return;
  const requested = path.trim();
  if (!requested) return;
  slice.filesError = null;
  if (recordUndo) {
    const undoEntry = await snapshotPathForUndo(deps, requested);
    if (undoEntry.snapshots.length) {
      const stack = slice.filesDeleteUndoStack ?? [];
      slice.filesDeleteUndoStack = [undoEntry, ...stack].slice(0, 30);
    }
  }
  const correlationId = deps.nextCorrelationId();
  const invokeResponse = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "delete-path",
    mode: "sandbox",
    payload: {
      correlationId,
      path: requested,
      recursive
    }
  });
  if (!invokeResponse.ok) {
    throw new Error(invokeResponse.error || "Failed deleting path.");
  }
  const parent = parentDir(requested);
  if (parent && slice.filesEntriesByPath[parent]) {
    await listFilesDirectory(slice, deps, parent);
  }
  closeFilesTab(slice, requested);
  if (slice.filesSelectedEntryPath === requested) {
    slice.filesSelectedEntryPath = null;
  }
  if (slice.filesSelectedPaths?.includes(requested)) {
    slice.filesSelectedPaths = slice.filesSelectedPaths.filter((row) => row !== requested);
  }
}

export async function undoLastFilesDelete(slice: FilesSlice, deps: FilesDeps): Promise<void> {
  if (!deps.client) return;
  const stack = slice.filesDeleteUndoStack ?? [];
  const entry = stack[0];
  if (!entry) {
    slice.filesError = "Nothing to undo.";
    return;
  }
  slice.filesError = null;
  const dirs = entry.snapshots
    .filter((row): row is FilesDeleteUndoDirSnapshot => row.kind === "dir")
    .map((row) => row.path)
    .sort((a, b) => a.length - b.length);
  const files = entry.snapshots
    .filter((row): row is FilesDeleteUndoFileSnapshot => row.kind === "file")
    .sort((a, b) => a.path.length - b.path.length);

  for (const dirPath of dirs) {
    await createDirectoryPath(deps, dirPath, true);
  }
  for (const fileRow of files) {
    await writeFilesPath(slice, deps, fileRow.path, fileRow.content);
  }

  const touchedParents = new Set<string>();
  for (const row of entry.snapshots) {
    const parent = parentDir(row.path);
    if (parent) touchedParents.add(parent);
  }
  for (const parent of touchedParents) {
    if (slice.filesEntriesByPath[parent]) {
      await listFilesDirectory(slice, deps, parent);
    }
  }
  slice.filesDeleteUndoStack = stack.slice(1);
}

export async function renameFilesPath(
  slice: FilesSlice,
  deps: FilesDeps,
  oldPath: string,
  newPath: string
): Promise<void> {
  if (!deps.client) return;
  const from = oldPath.trim();
  const to = newPath.trim();
  if (!from || !to || from === to) return;

  if (await isDirectoryPath(deps, from)) {
    await createDirectoryPath(deps, to, true);
    await copyDirectoryRecursive(slice, deps, from, to);
    await deleteFilesPath(slice, deps, from, true, false);
    const fromParent = parentDir(from);
    const toParent = parentDir(to);
    if (fromParent && slice.filesEntriesByPath[fromParent]) {
      await listFilesDirectory(slice, deps, fromParent);
    }
    if (toParent && slice.filesEntriesByPath[toParent]) {
      await listFilesDirectory(slice, deps, toParent);
    }
    slice.filesSelectedPath = to;
    return;
  }

  const correlationRead = deps.nextCorrelationId();
  const readResponse = await deps.client.toolInvoke({
    correlationId: correlationRead,
    toolId: "files",
    action: "read-file",
    mode: "sandbox",
    payload: {
      correlationId: correlationRead,
      path: from
    }
  });
  if (!readResponse.ok) {
    throw new Error(readResponse.error || "Failed reading source file for rename.");
  }
  const readData = readResponse.data as { content?: string };
  const content = readData.content ?? "";
  const canonical = await writeFilesPath(slice, deps, to, content);
  await deleteFilesPath(slice, deps, from, false, false);

  if (!slice.filesOpenTabs.includes(canonical)) {
    slice.filesOpenTabs = [...slice.filesOpenTabs, canonical];
  }
  slice.filesActiveTabPath = canonical;
  slice.filesSelectedEntryPath = canonical;
  slice.filesContentByPath[canonical] = content;
  slice.filesSavedContentByPath[canonical] = content;
  slice.filesDirtyByPath[canonical] = false;
  slice.filesReadOnlyByPath[canonical] = false;
}

export async function pasteFilesClipboard(
  slice: FilesSlice,
  deps: FilesDeps,
  targetDirectory: string,
  resolveConflictChoice?: (name: string) => Promise<FilesConflictResolution>
): Promise<void> {
  if (!deps.client) return;
  const mode = slice.filesClipboardMode;
  const paths = (slice.filesClipboardPaths ?? []).filter(Boolean);
  if (!mode || !paths.length) return;

  const listingCorrelation = deps.nextCorrelationId();
  const listingResponse = await deps.client.toolInvoke({
    correlationId: listingCorrelation,
    toolId: "files",
    action: "list-directory",
    mode: "sandbox",
    payload: {
      correlationId: listingCorrelation,
      path: targetDirectory
    }
  });
  const existingNames = new Set<string>();
  if (listingResponse.ok) {
    const data = listingResponse.data as { entries?: Array<{ name?: string }> };
    for (const entry of data.entries ?? []) {
      const name = (entry.name || "").trim();
      if (name) existingNames.add(name);
    }
  }

  let applyAllDecision: FilesConflictChoice | null = null;
  for (const sourcePath of paths) {
    const sourceName = basename(sourcePath);
    if (!sourceName) continue;
    const sourceIsDir = await isDirectoryPath(deps, sourcePath);
    let finalName = sourceName;
    const sourceCanonical = sourcePath.replace(/\\/g, "/");
    const defaultTargetPath = joinPath(targetDirectory, sourceName).replace(/\\/g, "/");

    if (existingNames.has(sourceName)) {
      if (mode === "cut" && sourceCanonical === defaultTargetPath) {
        // Moving to the same path is a no-op.
        continue;
      }
      let choice: "replace" | "copy" | "cancel" = "cancel";
      if (applyAllDecision) {
        choice = applyAllDecision;
      } else if (resolveConflictChoice) {
        const decision = await resolveConflictChoice(sourceName);
        choice = decision.choice;
        if (decision.applyToAll && (choice === "replace" || choice === "copy")) {
          applyAllDecision = choice;
        }
      } else {
        const choiceRaw = window
          .prompt(
            `'${sourceName}' already exists. Type one option: replace, copy, or cancel.`,
            "copy"
          )
          ?.trim()
          .toLowerCase();
        choice =
          choiceRaw === "replace" || choiceRaw === "copy" || choiceRaw === "cancel"
            ? choiceRaw
            : "cancel";
      }
      if (choice === "cancel") {
        slice.filesError = "Paste cancelled.";
        return;
      }
      if (choice === "copy") {
        finalName = nextAvailableName(sourceName, existingNames);
      }
    }

    existingNames.add(finalName);
    const targetPath = joinPath(targetDirectory, finalName);
    if (mode === "cut" && sourceCanonical === targetPath.replace(/\\/g, "/")) {
      continue;
    }
    if (mode === "cut" && sourceIsDir && isPathInside(sourceCanonical, targetPath)) {
      slice.filesError = `Cannot move '${sourceName}' into itself.`;
      return;
    }

    if (await pathExists(deps, targetPath)) {
      await deleteFilesPath(slice, deps, targetPath, true, false);
    }

    if (sourceIsDir) {
      await createDirectoryPath(deps, targetPath, true);
      await copyDirectoryRecursive(slice, deps, sourcePath, targetPath);
      if (mode === "cut") {
        await deleteFilesPath(slice, deps, sourcePath, true, false);
      }
      continue;
    }

    const readCorrelation = deps.nextCorrelationId();
    const readResponse = await deps.client.toolInvoke({
      correlationId: readCorrelation,
      toolId: "files",
      action: "read-file",
      mode: "sandbox",
      payload: {
        correlationId: readCorrelation,
        path: sourcePath
      }
    });
    if (!readResponse.ok) {
      throw new Error(readResponse.error || `Failed reading ${sourcePath}`);
    }
    const readData = readResponse.data as { content?: string };
    await writeFilesPath(slice, deps, targetPath, readData.content ?? "");
    if (mode === "cut") {
      await deleteFilesPath(slice, deps, sourcePath, false, false);
    }
  }

  if (mode === "cut") {
    slice.filesClipboardMode = null;
    slice.filesClipboardPaths = [];
  }
  await listFilesDirectory(slice, deps, targetDirectory);
}

export async function duplicateActiveFilesTab(
  slice: FilesSlice,
  deps: FilesDeps,
  targetPath: string
): Promise<void> {
  if (!deps.client) return;
  const activePath = slice.filesActiveTabPath;
  if (!activePath) return;
  const requested = targetPath.trim();
  if (!requested) return;
  const content = slice.filesContentByPath[activePath] ?? "";
  slice.filesError = null;
  try {
    const canonical = await writeFilesPath(slice, deps, requested, content);
    await refreshParentDirectoryIfLoaded(slice, deps, canonical);
    await openFilesFile(slice, deps, canonical);
  } catch (error) {
    slice.filesError = error instanceof Error ? error.message : String(error);
  }
}

async function writeFilesPath(
  slice: FilesSlice,
  deps: FilesDeps,
  path: string,
  content: string
): Promise<string> {
  if (!deps.client) return path;
  const correlationId = deps.nextCorrelationId();
  const invokeResponse = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "write-file",
    mode: "sandbox",
    payload: {
      correlationId,
      path,
      content
    }
  });
  if (!invokeResponse.ok) {
    throw new Error(invokeResponse.error || "Failed saving file.");
  }
  const response = invokeResponse.data as unknown as {
    path?: string;
    sizeBytes?: number;
  };
  const canonical = response.path?.trim() ? response.path.trim() : path;
  slice.filesSizeByPath[canonical] = Number.isFinite(response.sizeBytes)
    ? (response.sizeBytes as number)
    : content.length;
  return canonical;
}

async function refreshParentDirectoryIfLoaded(
  slice: FilesSlice,
  deps: FilesDeps,
  path: string
): Promise<void> {
  const parent = parentDir(path);
  if (!parent) return;
  if (slice.filesEntriesByPath[parent]) {
    await listFilesDirectory(slice, deps, parent);
  }
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "";
  return normalized.slice(0, idx);
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return normalized;
  return normalized.slice(idx + 1);
}

function joinPath(dir: string, name: string): string {
  const normalized = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${normalized}/${name}`;
}

function nextAvailableName(baseName: string, existing: Set<string>): string {
  if (!existing.has(baseName)) return baseName;
  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : "";
  let index = 1;
  while (true) {
    const candidate = `${stem}(${index})${ext}`;
    if (!existing.has(candidate)) return candidate;
    index += 1;
  }
}

async function createDirectoryPath(
  deps: FilesDeps,
  path: string,
  recursive: boolean
): Promise<void> {
  if (!deps.client) return;
  const correlationId = deps.nextCorrelationId();
  const response = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "create-directory",
    mode: "sandbox",
    payload: {
      correlationId,
      path,
      recursive
    }
  });
  if (!response.ok) {
    throw new Error(response.error || `Failed creating directory ${path}`);
  }
}

async function isDirectoryPath(deps: FilesDeps, path: string): Promise<boolean> {
  if (!deps.client) return false;
  const correlationId = deps.nextCorrelationId();
  const response = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "list-directory",
    mode: "sandbox",
    payload: { correlationId, path }
  });
  return response.ok;
}

async function pathExists(deps: FilesDeps, path: string): Promise<boolean> {
  if (await isDirectoryPath(deps, path)) return true;
  if (!deps.client) return false;
  const correlationId = deps.nextCorrelationId();
  const response = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "read-file",
    mode: "sandbox",
    payload: { correlationId, path }
  });
  return response.ok;
}

async function copyDirectoryRecursive(
  slice: FilesSlice,
  deps: FilesDeps,
  sourceDir: string,
  targetDir: string
): Promise<void> {
  if (!deps.client) return;
  const correlationId = deps.nextCorrelationId();
  const response = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "list-directory",
    mode: "sandbox",
    payload: { correlationId, path: sourceDir }
  });
  if (!response.ok) {
    throw new Error(response.error || `Failed listing ${sourceDir}`);
  }
  const data = response.data as { entries?: FilesListDirectoryEntry[] };
  for (const entry of data.entries ?? []) {
    const relName = basename(entry.path);
    const nextTarget = joinPath(targetDir, relName);
    if (entry.isDir) {
      await createDirectoryPath(deps, nextTarget, true);
      await copyDirectoryRecursive(slice, deps, entry.path, nextTarget);
      continue;
    }
    const readCorrelation = deps.nextCorrelationId();
    const readResponse = await deps.client.toolInvoke({
      correlationId: readCorrelation,
      toolId: "files",
      action: "read-file",
      mode: "sandbox",
      payload: {
        correlationId: readCorrelation,
        path: entry.path
      }
    });
    if (!readResponse.ok) {
      throw new Error(readResponse.error || `Failed reading ${entry.path}`);
    }
    const readData = readResponse.data as { content?: string };
    await writeFilesPath(slice, deps, nextTarget, readData.content ?? "");
  }
}

async function snapshotPathForUndo(
  deps: FilesDeps,
  path: string
): Promise<FilesDeleteUndoEntry> {
  const snapshots: FilesDeleteUndoSnapshot[] = [];
  if (await isDirectoryPath(deps, path)) {
    await snapshotDirectoryRecursive(deps, path, snapshots);
  } else {
    const content = await readFileContent(deps, path);
    snapshots.push({ kind: "file", path, content });
  }
  return {
    deletedAtMs: Date.now(),
    snapshots
  };
}

async function snapshotDirectoryRecursive(
  deps: FilesDeps,
  dirPath: string,
  snapshots: FilesDeleteUndoSnapshot[]
): Promise<void> {
  if (!deps.client) return;
  snapshots.push({ kind: "dir", path: dirPath });
  const correlationId = deps.nextCorrelationId();
  const response = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "list-directory",
    mode: "sandbox",
    payload: { correlationId, path: dirPath }
  });
  if (!response.ok) {
    throw new Error(response.error || `Failed listing ${dirPath}`);
  }
  const data = response.data as { entries?: FilesListDirectoryEntry[] };
  for (const entry of data.entries ?? []) {
    if (entry.isDir) {
      await snapshotDirectoryRecursive(deps, entry.path, snapshots);
      continue;
    }
    const content = await readFileContent(deps, entry.path);
    snapshots.push({ kind: "file", path: entry.path, content });
  }
}

async function readFileContent(deps: FilesDeps, path: string): Promise<string> {
  if (!deps.client) return "";
  const correlationId = deps.nextCorrelationId();
  const response = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "read-file",
    mode: "sandbox",
    payload: { correlationId, path }
  });
  if (!response.ok) {
    throw new Error(response.error || `Failed reading ${path}`);
  }
  const data = response.data as { content?: string };
  return data.content ?? "";
}

function isPathInside(parent: string, child: string): boolean {
  const p = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  const c = child.replace(/\\/g, "/").replace(/\/+$/, "");
  return c === p || c.startsWith(`${p}/`);
}
