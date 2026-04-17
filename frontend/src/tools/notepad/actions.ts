import type { ChatIpcClient } from "../../ipcClient";

interface NotepadSlice {
  notepadOpenTabs: string[];
  notepadActiveTabId: string | null;
  notepadPathByTabId: Record<string, string | null>;
  notepadTitleByTabId: Record<string, string>;
  notepadContentByTabId: Record<string, string>;
  notepadSavedContentByTabId: Record<string, string>;
  notepadDirtyByTabId: Record<string, boolean>;
  notepadLoadingByTabId: Record<string, boolean>;
  notepadSavingByTabId: Record<string, boolean>;
  notepadReadOnlyByTabId: Record<string, boolean>;
  notepadSizeByTabId: Record<string, number>;
  notepadNextUntitledIndex: number;
  notepadError: string | null;
}

interface NotepadDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
}

export async function ensureNotepadReady(slice: NotepadSlice): Promise<void> {
  if (slice.notepadOpenTabs.length) return;
  createUntitledNotepadTab(slice);
}

export function createUntitledNotepadTab(slice: NotepadSlice): string {
  const nextIndex = Math.max(1, Math.round(slice.notepadNextUntitledIndex || 1));
  const tabId = `untitled-${nextIndex}`;
  slice.notepadNextUntitledIndex = nextIndex + 1;
  slice.notepadOpenTabs = [...slice.notepadOpenTabs, tabId];
  slice.notepadActiveTabId = tabId;
  slice.notepadPathByTabId[tabId] = null;
  slice.notepadTitleByTabId[tabId] = `Untitled ${nextIndex}`;
  slice.notepadContentByTabId[tabId] = "";
  slice.notepadSavedContentByTabId[tabId] = "";
  slice.notepadDirtyByTabId[tabId] = false;
  slice.notepadLoadingByTabId[tabId] = false;
  slice.notepadSavingByTabId[tabId] = false;
  slice.notepadReadOnlyByTabId[tabId] = false;
  slice.notepadSizeByTabId[tabId] = 0;
  slice.notepadError = null;
  return tabId;
}

export async function openNotepadFile(
  slice: NotepadSlice,
  deps: NotepadDeps,
  path: string
): Promise<void> {
  const requested = path.trim();
  if (!requested || !deps.client) return;
  const existingId = findTabIdByPath(slice, requested);
  if (existingId) {
    slice.notepadActiveTabId = existingId;
    slice.notepadError = null;
    return;
  }
  slice.notepadError = null;
  if (!slice.notepadOpenTabs.includes(requested)) {
    slice.notepadOpenTabs = [...slice.notepadOpenTabs, requested];
  }
  slice.notepadActiveTabId = requested;
  slice.notepadPathByTabId[requested] = requested;
  slice.notepadTitleByTabId[requested] = basename(requested);
  slice.notepadLoadingByTabId[requested] = true;
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
    const response = invokeResponse.data as {
      path?: string;
      content?: string;
      sizeBytes?: number;
      readOnly?: boolean;
      isBinary?: boolean;
    };
    const canonical = response.path?.trim() || requested;
    const content = response.content ?? "";
    const targetId = requested === canonical ? requested : replaceNotepadTabId(slice, requested, canonical);
    slice.notepadPathByTabId[targetId] = canonical;
    slice.notepadTitleByTabId[targetId] = basename(canonical);
    slice.notepadContentByTabId[targetId] = content;
    slice.notepadSavedContentByTabId[targetId] = content;
    slice.notepadDirtyByTabId[targetId] = false;
    slice.notepadReadOnlyByTabId[targetId] = Boolean(response.readOnly || response.isBinary);
    slice.notepadSizeByTabId[targetId] = Number.isFinite(response.sizeBytes)
      ? (response.sizeBytes as number)
      : content.length;
    slice.notepadLoadingByTabId[targetId] = false;
    if (targetId !== requested) {
      delete slice.notepadLoadingByTabId[requested];
    }
  } catch (error) {
    slice.notepadLoadingByTabId[requested] = false;
    slice.notepadError = error instanceof Error ? error.message : String(error);
  }
}

export function activateNotepadTab(slice: NotepadSlice, tabId: string): void {
  if (!tabId.trim()) return;
  slice.notepadActiveTabId = tabId;
}

export function closeNotepadTab(slice: NotepadSlice, tabId: string): void {
  const tabs = slice.notepadOpenTabs.filter((item) => item !== tabId);
  slice.notepadOpenTabs = tabs;
  if (slice.notepadActiveTabId === tabId) {
    slice.notepadActiveTabId = tabs[tabs.length - 1] ?? null;
  }
}

export function updateNotepadBuffer(slice: NotepadSlice, tabId: string, content: string): void {
  if (!tabId.trim()) return;
  slice.notepadContentByTabId[tabId] = content;
  const saved = slice.notepadSavedContentByTabId[tabId] ?? "";
  slice.notepadDirtyByTabId[tabId] = saved !== content;
}

export async function saveActiveNotepadTab(slice: NotepadSlice, deps: NotepadDeps): Promise<void> {
  const tabId = slice.notepadActiveTabId;
  if (!tabId) return;
  const path = slice.notepadPathByTabId[tabId];
  if (!path) return;
  if (slice.notepadReadOnlyByTabId[tabId]) {
    slice.notepadError = "This file is read-only.";
    return;
  }
  await saveNotepadTabToPath(slice, deps, tabId, path, false);
}

export async function saveActiveNotepadTabAs(
  slice: NotepadSlice,
  deps: NotepadDeps,
  nextPath: string
): Promise<void> {
  const tabId = slice.notepadActiveTabId;
  if (!tabId) return;
  await saveNotepadTabToPath(slice, deps, tabId, nextPath, true);
}

export async function saveAllNotepadTabs(slice: NotepadSlice, deps: NotepadDeps): Promise<void> {
  for (const tabId of slice.notepadOpenTabs) {
    const path = slice.notepadPathByTabId[tabId];
    if (!path || !slice.notepadDirtyByTabId[tabId] || slice.notepadReadOnlyByTabId[tabId]) continue;
    await saveNotepadTabToPath(slice, deps, tabId, path, false);
    if (slice.notepadError) return;
  }
}

export async function duplicateActiveNotepadTab(
  slice: NotepadSlice,
  deps: NotepadDeps,
  targetPath: string
): Promise<void> {
  const activeTabId = slice.notepadActiveTabId;
  if (!activeTabId) return;
  const requested = targetPath.trim();
  if (!requested) return;
  const content = slice.notepadContentByTabId[activeTabId] ?? "";
  slice.notepadError = null;
  try {
    const canonical = await writeNotepadPath(slice, deps, requested, content);
    await openNotepadFile(slice, deps, canonical);
  } catch (error) {
    slice.notepadError = error instanceof Error ? error.message : String(error);
  }
}

export async function deleteActiveNotepadFile(slice: NotepadSlice, deps: NotepadDeps): Promise<void> {
  const activeTabId = slice.notepadActiveTabId;
  if (!activeTabId || !deps.client) return;
  const path = slice.notepadPathByTabId[activeTabId]?.trim();
  if (!path) return;
  slice.notepadError = null;
  try {
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "files",
      action: "delete-path",
      mode: "sandbox",
      payload: {
        correlationId,
        path,
        recursive: false
      }
    });
    if (!invokeResponse.ok) {
      throw new Error(invokeResponse.error || "Failed deleting file.");
    }
    closeNotepadTab(slice, activeTabId);
  } catch (error) {
    slice.notepadError = error instanceof Error ? error.message : String(error);
  }
}

function findTabIdByPath(slice: NotepadSlice, path: string): string | null {
  for (const tabId of slice.notepadOpenTabs) {
    if (slice.notepadPathByTabId[tabId] === path) return tabId;
  }
  return null;
}

function replaceNotepadTabId(slice: NotepadSlice, fromId: string, toId: string): string {
  if (fromId === toId) return toId;
  const existing = findTabIdByPath(slice, toId);
  if (existing) {
    closeNotepadTab(slice, fromId);
    slice.notepadActiveTabId = existing;
    return existing;
  }
  slice.notepadOpenTabs = slice.notepadOpenTabs.map((tabId) => (tabId === fromId ? toId : tabId));
  if (slice.notepadActiveTabId === fromId) {
    slice.notepadActiveTabId = toId;
  }
  moveRecord(slice.notepadPathByTabId, fromId, toId, toId);
  moveRecord(slice.notepadTitleByTabId, fromId, toId, basename(toId));
  moveRecord(slice.notepadContentByTabId, fromId, toId, "");
  moveRecord(slice.notepadSavedContentByTabId, fromId, toId, "");
  moveRecord(slice.notepadDirtyByTabId, fromId, toId, false);
  moveRecord(slice.notepadLoadingByTabId, fromId, toId, false);
  moveRecord(slice.notepadSavingByTabId, fromId, toId, false);
  moveRecord(slice.notepadReadOnlyByTabId, fromId, toId, false);
  moveRecord(slice.notepadSizeByTabId, fromId, toId, 0);
  return toId;
}

function moveRecord<T>(record: Record<string, T>, fromId: string, toId: string, fallback: T): void {
  const value = fromId in record ? record[fromId] : fallback;
  record[toId] = value;
  if (fromId !== toId) {
    delete record[fromId];
  }
}

async function saveNotepadTabToPath(
  slice: NotepadSlice,
  deps: NotepadDeps,
  tabId: string,
  path: string,
  allowReplaceId: boolean
): Promise<void> {
  if (!deps.client) return;
  const requested = path.trim();
  if (!requested) return;
  const content = slice.notepadContentByTabId[tabId] ?? "";
  slice.notepadError = null;
  slice.notepadSavingByTabId[tabId] = true;
  try {
    const canonical = await writeNotepadPath(slice, deps, requested, content);
    const targetId = allowReplaceId ? replaceNotepadTabId(slice, tabId, canonical) : tabId;
    slice.notepadPathByTabId[targetId] = canonical;
    slice.notepadTitleByTabId[targetId] = basename(canonical);
    slice.notepadContentByTabId[targetId] = content;
    slice.notepadSavedContentByTabId[targetId] = content;
    slice.notepadDirtyByTabId[targetId] = false;
    slice.notepadReadOnlyByTabId[targetId] = false;
    slice.notepadSavingByTabId[targetId] = false;
  } catch (error) {
    slice.notepadSavingByTabId[tabId] = false;
    slice.notepadError = error instanceof Error ? error.message : String(error);
  }
}

async function writeNotepadPath(
  slice: NotepadSlice,
  deps: NotepadDeps,
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
  const response = invokeResponse.data as { path?: string; sizeBytes?: number };
  const canonical = response.path?.trim() ? response.path.trim() : path;
  const active = slice.notepadActiveTabId;
  if (active) {
    slice.notepadSizeByTabId[active] = Number.isFinite(response.sizeBytes)
      ? (response.sizeBytes as number)
      : content.length;
  }
  return canonical;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return normalized;
  return normalized.slice(idx + 1);
}
