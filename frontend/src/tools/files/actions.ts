import type { ChatIpcClient } from "../../ipcClient";
import type { FilesListDirectoryEntry } from "../../contracts";

interface FilesSlice {
  filesRootPath: string | null;
  filesSelectedPath: string | null;
  filesSelectedEntryPath?: string | null;
  filesExpandedByPath: Record<string, boolean>;
  filesEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  filesLoadingByPath: Record<string, boolean>;
  filesOpenTabs: string[];
  filesActiveTabPath: string | null;
  filesContentByPath: Record<string, string>;
  filesSavedContentByPath: Record<string, string>;
  filesDirtyByPath: Record<string, boolean>;
  filesLoadingFileByPath: Record<string, boolean>;
  filesSavingFileByPath: Record<string, boolean>;
  filesReadOnlyByPath: Record<string, boolean>;
  filesSizeByPath: Record<string, number>;
  filesError: string | null;
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
