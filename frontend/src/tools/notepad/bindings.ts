import { NOTEPAD_DATA_ATTR } from "../ui/constants";
import {
  computeNotepadFindStats,
  copyText,
  duplicatePathWithCopySuffix,
  escapeAttr,
  focusNotepadMatch,
  getSelectedNotepadText,
  pickOpenFilePath,
  pickSaveFilePath,
  scheduleNotepadEditorRefresh,
  refreshNotepadEditorDecorations,
  replaceAllInNotepad,
  replaceOneInNotepad,
  type NotepadDataAttrs
} from "./shared";

interface NotepadSlice {
  notepadOpenTabs: string[];
  notepadActiveTabId: string | null;
  notepadPathByTabId: Record<string, string | null>;
  notepadTitleByTabId: Record<string, string>;
  notepadContentByTabId: Record<string, string>;
  notepadSavedContentByTabId: Record<string, string>;
  notepadDirtyByTabId: Record<string, boolean>;
  notepadReadOnlyByTabId: Record<string, boolean>;
  notepadFindOpen: boolean;
  notepadFindQuery: string;
  notepadReplaceQuery: string;
  notepadFindCaseSensitive: boolean;
  notepadLineWrap: boolean;
  notepadError: string | null;
}

interface NotepadDeps {
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
}

const DATA_ATTRS: NotepadDataAttrs = {
  action: NOTEPAD_DATA_ATTR.action,
  document: NOTEPAD_DATA_ATTR.tabId,
  path: NOTEPAD_DATA_ATTR.path
};

export async function handleNotepadClick(
  target: HTMLElement,
  slice: NotepadSlice,
  deps: NotepadDeps
): Promise<boolean> {
  const action = target.getAttribute(NOTEPAD_DATA_ATTR.action);
  const tabId = target.getAttribute(NOTEPAD_DATA_ATTR.tabId);
  if (action === "activate-tab" && tabId) {
    deps.activateNotepadTab(tabId);
    return true;
  }
  if (action === "close-tab" && tabId) {
    if (slice.notepadDirtyByTabId[tabId]) {
      const confirmed = window.confirm(
        "This file has unsaved changes. Close this tab and discard changes?"
      );
      if (!confirmed) return true;
    }
    deps.closeNotepadTab(tabId);
    return true;
  }
  if (action === "save-file") {
    const active = slice.notepadActiveTabId;
    if (!active) return true;
    const path = slice.notepadPathByTabId[active];
    if (!path) {
      const requested = await pickSaveFilePath(`${slice.notepadTitleByTabId[active] || "untitled.txt"}`);
      if (!requested) return true;
      await deps.saveActiveNotepadTabAs(requested);
      return true;
    }
    await deps.saveActiveNotepadTab();
    return true;
  }
  if (action === "save-file-as") {
    const active = slice.notepadActiveTabId;
    if (!active) return true;
    const requested = await pickSaveFilePath(
      slice.notepadPathByTabId[active] || `${slice.notepadTitleByTabId[active] || "untitled.txt"}`
    );
    if (!requested) return true;
    await deps.saveActiveNotepadTabAs(requested);
    return true;
  }
  if (action === "save-all-files") {
    await deps.saveAllNotepadTabs();
    return true;
  }
  if (action === "open-file") {
    const requested = await pickOpenFilePath(slice.notepadPathByTabId[slice.notepadActiveTabId || ""] || undefined);
    if (!requested) return true;
    await deps.openNotepadFile(requested);
    return true;
  }
  if (action === "duplicate-file") {
    const active = slice.notepadActiveTabId;
    if (!active) return true;
    const sourcePath = slice.notepadPathByTabId[active] || `${slice.notepadTitleByTabId[active]}.txt`;
    const requested = window.prompt("Duplicate file to", duplicatePathWithCopySuffix(sourcePath))?.trim();
    if (!requested) return true;
    await deps.duplicateActiveNotepadTab(requested);
    return true;
  }
  if (action === "new-file") {
    const requested = await pickSaveFilePath("untitled.txt", "Create File");
    if (!requested) return true;
    deps.createUntitledNotepadTab();
    await deps.saveActiveNotepadTabAs(requested);
    return true;
  }
  if (action === "delete-file") {
    const active = slice.notepadActiveTabId;
    if (!active) return true;
    const path = active ? slice.notepadPathByTabId[active] : null;
    if (!path) return true;
    const confirmed = window.confirm(`Delete file '${slice.notepadTitleByTabId[active] || path}'?`);
    if (!confirmed) return true;
    await deps.deleteActiveNotepadFile();
    return true;
  }
  if (action === "search-in-file") {
    openFindBar(slice, false);
    return true;
  }
  if (action === "replace-in-file") {
    openFindBar(slice, true);
    return true;
  }
  if (action === "find-next") {
    runFindStep(slice, false);
    return true;
  }
  if (action === "find-prev") {
    runFindStep(slice, true);
    return true;
  }
  if (action === "replace-one") {
    runReplaceOne(slice, deps.updateNotepadBuffer);
    return true;
  }
  if (action === "replace-all") {
    runReplaceAll(slice, deps.updateNotepadBuffer);
    return true;
  }
  if (action === "find-close") {
    slice.notepadFindOpen = false;
    return true;
  }
  if (action === "toggle-wrap") {
    slice.notepadLineWrap = !slice.notepadLineWrap;
    return true;
  }
  if (action === "copy-file-path") {
    const active = slice.notepadActiveTabId;
    const path = active ? slice.notepadPathByTabId[active] : null;
    if (!path) return true;
    await copyText(path);
    return true;
  }
  return false;
}

export function handleNotepadInput(
  target: HTMLElement,
  slice: NotepadSlice
): { handled: boolean; rerender: boolean } {
  const editorInput = target.closest<HTMLTextAreaElement>(
    `[${NOTEPAD_DATA_ATTR.action}="editor-input"][${NOTEPAD_DATA_ATTR.tabId}]`
  );
  if (editorInput) {
    const tabId = editorInput.getAttribute(NOTEPAD_DATA_ATTR.tabId);
    if (!tabId) return { handled: true, rerender: false };
    const content = editorInput.value;
    slice.notepadContentByTabId[tabId] = content;
    const saved = slice.notepadSavedContentByTabId[tabId] ?? "";
    slice.notepadDirtyByTabId[tabId] = saved !== content;
    scheduleNotepadEditorRefresh(editorInput, content, DATA_ATTRS);
    return { handled: true, rerender: false };
  }
  const findQuery = target.closest<HTMLInputElement>(`[${NOTEPAD_DATA_ATTR.action}="find-query-input"]`);
  if (findQuery) {
    slice.notepadFindQuery = findQuery.value;
    slice.notepadFindOpen = true;
    return { handled: true, rerender: true };
  }
  const replaceQuery = target.closest<HTMLInputElement>(`[${NOTEPAD_DATA_ATTR.action}="replace-query-input"]`);
  if (replaceQuery) {
    slice.notepadReplaceQuery = replaceQuery.value;
    slice.notepadFindOpen = true;
    return { handled: true, rerender: true };
  }
  const caseSensitive = target.closest<HTMLInputElement>(`[${NOTEPAD_DATA_ATTR.action}="find-case-sensitive"]`);
  if (caseSensitive) {
    slice.notepadFindCaseSensitive = caseSensitive.checked;
    slice.notepadFindOpen = true;
    return { handled: true, rerender: true };
  }
  return { handled: false, rerender: false };
}

export async function handleNotepadKeyDown(
  event: KeyboardEvent,
  slice: NotepadSlice,
  deps: Pick<
    NotepadDeps,
    | "ensureNotepadReady"
    | "createUntitledNotepadTab"
    | "openNotepadFile"
    | "saveActiveNotepadTab"
    | "saveActiveNotepadTabAs"
    | "saveAllNotepadTabs"
    | "updateNotepadBuffer"
    | "closeNotepadTab"
  >
): Promise<boolean> {
  const target = event.target as HTMLElement | null;
  const withinNotepad =
    Boolean(target?.closest(".notepad-tool")) || Boolean(document.activeElement?.closest?.(".notepad-tool"));
  if (!withinNotepad) return false;
  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "n") {
      event.preventDefault();
      const requested = await pickSaveFilePath("untitled.txt", "Create File");
      if (!requested) return true;
      deps.createUntitledNotepadTab();
      await deps.saveActiveNotepadTabAs(requested);
      return true;
    }
    if (key === "o") {
      event.preventDefault();
      const requested = await pickOpenFilePath(slice.notepadPathByTabId[slice.notepadActiveTabId || ""] || undefined);
      if (!requested) return true;
      await deps.openNotepadFile(requested);
      return true;
    }
    if (key === "s") {
      event.preventDefault();
      const active = slice.notepadActiveTabId;
      if (!active) return true;
      const path = slice.notepadPathByTabId[active];
      if (event.shiftKey || !path) {
        const requested = await pickSaveFilePath(path || `${slice.notepadTitleByTabId[active] || "untitled.txt"}`);
        if (!requested) return true;
        await deps.saveActiveNotepadTabAs(requested);
      } else {
        await deps.saveActiveNotepadTab();
      }
      return true;
    }
    if (key === "f") {
      event.preventDefault();
      openFindBar(slice, false);
      return true;
    }
    if (key === "h") {
      event.preventDefault();
      openFindBar(slice, true);
      return true;
    }
    if (key === "w") {
      event.preventDefault();
      const active = slice.notepadActiveTabId;
      if (!active) return true;
      if (slice.notepadDirtyByTabId[active]) {
        const confirmed = window.confirm(
          "This file has unsaved changes. Close this tab and discard changes?"
        );
        if (!confirmed) return true;
      }
      deps.closeNotepadTab(active);
      return true;
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await deps.saveAllNotepadTabs();
    return true;
  }
  if (!event.metaKey && !event.ctrlKey && event.altKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    slice.notepadLineWrap = !slice.notepadLineWrap;
    return true;
  }
  const editorInput = (event.target as HTMLElement | null)?.closest<HTMLTextAreaElement>(
    `[${NOTEPAD_DATA_ATTR.action}="editor-input"][${NOTEPAD_DATA_ATTR.tabId}]`
  );
  const findInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
    `[${NOTEPAD_DATA_ATTR.action}="find-query-input"]`
  );
  const replaceInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
    `[${NOTEPAD_DATA_ATTR.action}="replace-query-input"]`
  );
  if (!editorInput) {
    if (slice.notepadFindOpen && event.key === "Escape") {
      slice.notepadFindOpen = false;
      return true;
    }
    if (findInput && event.key === "Enter") {
      runFindStep(slice, event.shiftKey);
      return true;
    }
    if (replaceInput && event.key === "Enter") {
      runReplaceOne(slice, deps.updateNotepadBuffer);
      return true;
    }
    return false;
  }
  const tabId = editorInput.getAttribute(NOTEPAD_DATA_ATTR.tabId);
  if (!tabId) return true;
  if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const start = editorInput.selectionStart;
    const end = editorInput.selectionEnd;
    const value = editorInput.value;
    const next = `${value.slice(0, start)}\t${value.slice(end)}`;
    editorInput.value = next;
    editorInput.selectionStart = editorInput.selectionEnd = start + 1;
    deps.updateNotepadBuffer(tabId, next);
    scheduleNotepadEditorRefresh(editorInput, next, DATA_ATTRS);
    return true;
  }
  return false;
}

function openFindBar(slice: NotepadSlice, preferReplace: boolean): void {
  const active = slice.notepadActiveTabId;
  if (!active) return;
  slice.notepadFindOpen = true;
  if (!slice.notepadFindQuery) {
    const selectedText = getSelectedNotepadText(active, DATA_ATTRS);
    if (selectedText) {
      slice.notepadFindQuery = selectedText;
    }
  }
  if (preferReplace && !slice.notepadReplaceQuery) {
    slice.notepadReplaceQuery = "";
  }
  if (slice.notepadFindQuery) {
    runFindStep(slice, false, true);
  }
}

function runFindStep(slice: NotepadSlice, backwards: boolean, selectFromStart = false): void {
  const active = slice.notepadActiveTabId;
  const query = slice.notepadFindQuery ?? "";
  if (!active || !query) return;
  const matched = focusNotepadMatch(
    active,
    query,
    DATA_ATTRS,
    backwards,
    selectFromStart,
    slice.notepadFindCaseSensitive === true
  );
  slice.notepadError = matched ? null : `No matches for "${query}"`;
}

function runReplaceOne(
  slice: NotepadSlice,
  updateNotepadBuffer: (tabId: string, content: string) => void
): void {
  const active = slice.notepadActiveTabId;
  if (!active) return;
  const find = slice.notepadFindQuery ?? "";
  if (!find) return;
  const source = slice.notepadContentByTabId[active] ?? "";
  const result = replaceOneInNotepad(
    active,
    source,
    find,
    slice.notepadReplaceQuery ?? "",
    DATA_ATTRS,
    slice.notepadFindCaseSensitive === true
  );
  if (!result.replaced) {
    slice.notepadError = `No matches for "${find}"`;
    return;
  }
  updateNotepadBuffer(active, result.content);
  slice.notepadError = null;
  runFindStep(slice, false, true);
}

function runReplaceAll(
  slice: NotepadSlice,
  updateNotepadBuffer: (tabId: string, content: string) => void
): void {
  const active = slice.notepadActiveTabId;
  if (!active) return;
  const find = slice.notepadFindQuery ?? "";
  if (!find) return;
  const source = slice.notepadContentByTabId[active] ?? "";
  const result = replaceAllInNotepad(
    active,
    source,
    find,
    slice.notepadReplaceQuery ?? "",
    DATA_ATTRS,
    slice.notepadFindCaseSensitive === true
  );
  if (!result.replaced) {
    slice.notepadError = `No matches for "${find}"`;
    return;
  }
  updateNotepadBuffer(active, result.content);
  slice.notepadError = null;
  runFindStep(slice, false, true);
}

export function getNotepadMatchCount(slice: NotepadSlice): number {
  const active = slice.notepadActiveTabId;
  if (!active) return 0;
  return computeNotepadFindStats(
    slice.notepadContentByTabId[active] ?? "",
    slice.notepadFindQuery ?? "",
    slice.notepadFindCaseSensitive === true
  ).count;
}
