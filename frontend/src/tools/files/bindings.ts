import { FILES_DATA_ATTR, FILES_UI_ID } from "../ui/constants";
import type { FilesListDirectoryEntry } from "../../contracts";
import { renderHighlightedHtml } from "./highlight";

type FilesColumnKey = "name" | "type" | "size" | "modified";

interface FilesColumnWidths {
  name: number;
  type: number;
  size: number;
  modified: number;
}

const FILES_COLUMN_DEFAULT_WIDTHS: FilesColumnWidths = {
  name: 260,
  type: 120,
  size: 96,
  modified: 132
};

const FILES_COLUMN_MIN_WIDTHS: FilesColumnWidths = {
  name: 160,
  type: 84,
  size: 72,
  modified: 108
};

interface FilesSlice {
  filesRootPath: string | null;
  filesScopeRootPath?: string | null;
  filesRootSelectorOpen?: boolean;
  filesSelectedPath: string | null;
  filesSelectedEntryPath?: string | null;
  filesExpandedByPath: Record<string, boolean>;
  filesEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  filesOpenTabs: string[];
  filesActiveTabPath: string | null;
  filesContentByPath: Record<string, string>;
  filesSavedContentByPath: Record<string, string>;
  filesDirtyByPath: Record<string, boolean>;
  filesReadOnlyByPath: Record<string, boolean>;
  filesError?: string | null;
  filesColumnWidths?: Partial<FilesColumnWidths>;
  filesSidebarWidth?: number;
  filesSidebarCollapsed?: boolean;
  filesFindOpen?: boolean;
  filesFindQuery?: string;
  filesReplaceQuery?: string;
  filesFindCaseSensitive?: boolean;
  filesLineWrap?: boolean;
}

interface FilesDeps {
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
  duplicateActiveFilesTab: (path: string) => Promise<void>;
}

export async function handleFilesClick(
  target: HTMLElement,
  slice: FilesSlice,
  deps: FilesDeps
): Promise<boolean> {
  if (
    slice.filesRootSelectorOpen &&
    !target.closest(".files-root-selector") &&
    target.closest(".files-tool")
  ) {
    slice.filesRootSelectorOpen = false;
  }

  if (target.id === FILES_UI_ID.refreshButton) {
    const selected = slice.filesSelectedPath || slice.filesRootPath || undefined;
    await deps.listFilesDirectory(selected);
    return true;
  }

  const filesAction = target.getAttribute(FILES_DATA_ATTR.action);
  const filesPath = target.getAttribute(FILES_DATA_ATTR.path);
  if (filesAction === "toggle-node" && filesPath) {
    await deps.toggleFilesNode(filesPath);
    return true;
  }
  if (filesAction === "select-node" && filesPath) {
    slice.filesSelectedEntryPath = null;
    await deps.toggleFilesNode(filesPath);
    await deps.selectFilesPath(filesPath);
    return true;
  }
  if (filesAction === "select-entry" && filesPath) {
    const isDir = target.getAttribute(FILES_DATA_ATTR.isDir) === "true";
    if (isDir) {
      slice.filesSelectedEntryPath = null;
      await deps.selectFilesPath(filesPath);
    } else {
      const parent = parentDir(filesPath);
      slice.filesSelectedEntryPath = filesPath;
      if (parent && slice.filesSelectedPath !== parent) {
        await deps.selectFilesPath(parent);
      }
      await deps.openFilesFile(filesPath);
    }
    return true;
  }
  if (filesAction === "activate-tab" && filesPath) {
    deps.activateFilesTab(filesPath);
    return true;
  }
  if (filesAction === "close-tab" && filesPath) {
    if (slice.filesDirtyByPath[filesPath]) {
      const confirmed = window.confirm(
        "This file has unsaved changes. Close this tab and discard changes?"
      );
      if (!confirmed) return true;
    }
    deps.closeFilesTab(filesPath);
    return true;
  }
  if (filesAction === "save-file") {
    await deps.saveActiveFilesTab();
    return true;
  }
  if (filesAction === "save-file-as") {
    const active = slice.filesActiveTabPath;
    if (!active) return true;
    const requested = await pickSaveFilePath(active);
    if (!requested) return true;
    await deps.saveActiveFilesTabAs(requested);
    return true;
  }
  if (filesAction === "save-all-files") {
    await deps.saveAllFilesTabs();
    return true;
  }
  if (filesAction === "close-active-file") {
    const active = slice.filesActiveTabPath;
    if (!active) return true;
    if (slice.filesDirtyByPath[active]) {
      const confirmed = window.confirm(
        "This file has unsaved changes. Close this tab and discard changes?"
      );
      if (!confirmed) return true;
    }
    deps.closeFilesTab(active);
    return true;
  }
  if (filesAction === "open-file") {
    const seed = slice.filesSelectedPath || slice.filesRootPath || undefined;
    const requested = await pickOpenFilePath(seed);
    if (!requested) return true;
    await deps.openFilesFile(requested);
    return true;
  }
  if (filesAction === "copy-file-path") {
    const active = slice.filesActiveTabPath;
    if (!active) return true;
    await copyText(active);
    return true;
  }
  if (filesAction === "duplicate-file") {
    const active = slice.filesActiveTabPath;
    if (!active) return true;
    const requested = window
      .prompt("Duplicate file to", duplicatePathWithCopySuffix(active))
      ?.trim();
    if (!requested) return true;
    await deps.duplicateActiveFilesTab(requested);
    return true;
  }
  if (filesAction === "new-file") {
    const folder = slice.filesSelectedPath || slice.filesRootPath || "";
    const requested = await pickSaveFilePath(
      folder ? `${folder}/untitled.txt` : "untitled.txt",
      "Create New File"
    );
    if (!requested) return true;
    await deps.createNewFilesFile(requested);
    return true;
  }
  if (filesAction === "search-in-file") {
    openFindBar(slice, false);
    return true;
  }
  if (filesAction === "replace-in-file") {
    openFindBar(slice, true);
    return true;
  }
  if (filesAction === "find-next") {
    runFindStep(slice, false);
    return true;
  }
  if (filesAction === "find-prev") {
    runFindStep(slice, true);
    return true;
  }
  if (filesAction === "replace-one") {
    runReplaceOne(slice, deps.updateFilesBuffer);
    return true;
  }
  if (filesAction === "replace-all") {
    runReplaceAll(slice, deps.updateFilesBuffer);
    return true;
  }
  if (filesAction === "find-close") {
    slice.filesFindOpen = false;
    return true;
  }
  if (filesAction === "toggle-sidebar-collapse") {
    slice.filesSidebarCollapsed = slice.filesSidebarCollapsed !== true;
    return true;
  }
  if (filesAction === "toggle-wrap") {
    slice.filesLineWrap = slice.filesLineWrap !== true;
    return true;
  }
  if (filesAction === "toggle-root-selector") {
    slice.filesRootSelectorOpen = slice.filesRootSelectorOpen !== true;
    if (slice.filesRootSelectorOpen) {
      await preloadRootPickerTree(slice, deps);
    }
    return true;
  }
  if (filesAction === "root-tree-toggle" && filesPath) {
    await deps.toggleFilesNode(filesPath);
    return true;
  }
  if (filesAction === "root-tree-select" && filesPath) {
    const requested = filesPath.trim();
    if (!requested) return true;
    if (hasUnsavedTabs(slice)) {
      const confirmed = window.confirm(
        "You have unsaved file changes. Switch root directory anyway?"
      );
      if (!confirmed) return true;
    }
    slice.filesScopeRootPath = requested;
    slice.filesRootSelectorOpen = false;
    slice.filesSelectedEntryPath = null;
    await deps.selectFilesPath(requested);
    return true;
  }
  if (filesAction === "refresh") {
    const selected = slice.filesSelectedPath || slice.filesRootPath || undefined;
    await deps.listFilesDirectory(selected);
    return true;
  }

  return false;
}

export async function handleFilesDoubleClick(
  target: HTMLElement,
  slice: FilesSlice,
  deps: Pick<FilesDeps, "selectFilesPath">
): Promise<boolean> {
  const node = target.closest<HTMLElement>(
    `[${FILES_DATA_ATTR.action}="${"select-entry"}"][${FILES_DATA_ATTR.path}]`
  );
  if (!node) return false;
  const path = node.getAttribute(FILES_DATA_ATTR.path);
  const isDir = node.getAttribute(FILES_DATA_ATTR.isDir) === "true";
  if (!path || !isDir) return false;
  slice.filesExpandedByPath[path] = true;
  await deps.selectFilesPath(path);
  return true;
}

export function handleFilesInput(
  target: HTMLElement,
  slice: FilesSlice
): { handled: boolean; rerender: boolean } {
  const editorInput = target.closest<HTMLTextAreaElement>(
    `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}]`
  );
  if (editorInput) {
    const path = editorInput.getAttribute(FILES_DATA_ATTR.path);
    if (!path) return { handled: true, rerender: false };
    const content = editorInput.value;
    slice.filesContentByPath[path] = content;
    const saved = slice.filesSavedContentByPath[path] ?? "";
    slice.filesDirtyByPath[path] = saved !== content;
    refreshEditorDecorations(editorInput, content);
    return { handled: true, rerender: false };
  }

  const findQuery = target.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="find-query-input"]`
  );
  if (findQuery) {
    slice.filesFindQuery = findQuery.value;
    slice.filesFindOpen = true;
    return { handled: true, rerender: true };
  }
  const replaceQuery = target.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="replace-query-input"]`
  );
  if (replaceQuery) {
    slice.filesReplaceQuery = replaceQuery.value;
    slice.filesFindOpen = true;
    return { handled: true, rerender: true };
  }
  const caseSensitive = target.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="find-case-sensitive"]`
  );
  if (caseSensitive) {
    slice.filesFindCaseSensitive = caseSensitive.checked;
    slice.filesFindOpen = true;
    return { handled: true, rerender: true };
  }
  return { handled: false, rerender: false };
}

export async function handleFilesKeyDown(
  event: KeyboardEvent,
  slice: FilesSlice,
  deps: Pick<
    FilesDeps,
    | "saveActiveFilesTab"
    | "saveActiveFilesTabAs"
    | "saveAllFilesTabs"
    | "openFilesFile"
    | "updateFilesBuffer"
    | "closeFilesTab"
  >
): Promise<boolean> {
  const target = event.target as HTMLElement | null;
  const withinFilesTool =
    Boolean(target?.closest(".files-tool")) ||
    Boolean(document.activeElement?.closest?.(".files-tool"));
  if (!withinFilesTool) return false;

  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (event.shiftKey) {
        const active = slice.filesActiveTabPath;
        if (!active) return true;
        const requested = await pickSaveFilePath(active);
        if (!requested) return true;
        await deps.saveActiveFilesTabAs(requested);
      } else {
        await deps.saveActiveFilesTab();
      }
      return true;
    }
    if (key === "o") {
      event.preventDefault();
      const seed = slice.filesSelectedPath || slice.filesRootPath || undefined;
      const requested = await pickOpenFilePath(seed);
      if (!requested) return true;
      await deps.openFilesFile(requested);
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
      const active = slice.filesActiveTabPath;
      if (!active) return true;
      if (slice.filesDirtyByPath[active]) {
        const confirmed = window.confirm(
          "This file has unsaved changes. Close this tab and discard changes?"
        );
        if (!confirmed) return true;
      }
      deps.closeFilesTab(active);
      return true;
    }
  }

  if (!event.metaKey && !event.ctrlKey && event.altKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    slice.filesLineWrap = slice.filesLineWrap !== true;
    return true;
  }

  if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await deps.saveAllFilesTabs();
    return true;
  }

  const editorInput = (event.target as HTMLElement | null)?.closest<HTMLTextAreaElement>(
    `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}]`
  );
  const findInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="find-query-input"]`
  );
  const replaceInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
    `[${FILES_DATA_ATTR.action}="replace-query-input"]`
  );
  if (!editorInput) {
    if (slice.filesFindOpen && event.key === "Escape") {
      slice.filesFindOpen = false;
      return true;
    }
    if (findInput && event.key === "Enter") {
      runFindStep(slice, event.shiftKey);
      return true;
    }
    if (replaceInput && event.key === "Enter") {
      runReplaceOne(slice, deps.updateFilesBuffer);
      return true;
    }
    return false;
  }
  const path = editorInput.getAttribute(FILES_DATA_ATTR.path);
  if (!path) return true;
  if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const start = editorInput.selectionStart;
    const end = editorInput.selectionEnd;
    const value = editorInput.value;
    const next = `${value.slice(0, start)}\t${value.slice(end)}`;
    editorInput.value = next;
    editorInput.selectionStart = editorInput.selectionEnd = start + 1;
    deps.updateFilesBuffer(path, next);
    refreshEditorDecorations(editorInput, next);
    return true;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await deps.saveActiveFilesTab();
    const latest = slice.filesContentByPath[path] ?? editorInput.value;
    deps.updateFilesBuffer(path, latest);
    return true;
  }
  return false;
}

function openFindBar(slice: FilesSlice, preferReplace: boolean): void {
  const active = slice.filesActiveTabPath;
  if (!active) return;
  slice.filesFindOpen = true;
  if (!slice.filesFindQuery) {
    const selectedText = getSelectedEditorText(active);
    if (selectedText) {
      slice.filesFindQuery = selectedText;
    }
  }
  if (preferReplace && !slice.filesReplaceQuery) {
    slice.filesReplaceQuery = "";
  }
  if (slice.filesFindQuery) {
    runFindStep(slice, false, true);
  }
}

function runFindStep(slice: FilesSlice, backwards: boolean, selectFromStart = false): void {
  const active = slice.filesActiveTabPath;
  const query = slice.filesFindQuery ?? "";
  if (!active || !query) return;
  const matched = focusEditorMatch(active, query, backwards, selectFromStart, slice.filesFindCaseSensitive === true);
  slice.filesError = matched ? null : `No matches for "${query}"`;
}

function runReplaceOne(
  slice: FilesSlice,
  updateFilesBuffer: (path: string, content: string) => void
): void {
  const active = slice.filesActiveTabPath;
  if (!active) return;
  const find = slice.filesFindQuery ?? "";
  if (!find) return;
  const replaceWith = slice.filesReplaceQuery ?? "";
  const selector = `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}="${escapeAttr(
    active
  )}"]`;
  const textarea = document.querySelector<HTMLTextAreaElement>(selector);
  const source = textarea ? textarea.value : slice.filesContentByPath[active] ?? "";
  const haystack = slice.filesFindCaseSensitive ? source : source.toLowerCase();
  const needle = slice.filesFindCaseSensitive ? find : find.toLowerCase();
  if (!haystack.includes(needle)) {
    slice.filesError = `No matches for "${find}"`;
    return;
  }
  const selected = textarea
    ? source.slice(textarea.selectionStart, textarea.selectionEnd)
    : "";
  const selectedNorm = slice.filesFindCaseSensitive ? selected : selected.toLowerCase();
  let index = -1;
  if (selectedNorm === needle && textarea) {
    index = textarea.selectionStart;
  } else if (textarea) {
    index = findMatchIndex(source, find, textarea.selectionEnd, false, false, slice.filesFindCaseSensitive === true);
  } else {
    index = findMatchIndex(source, find, 0, false, true, slice.filesFindCaseSensitive === true);
  }
  if (index < 0) {
    slice.filesError = `No matches for "${find}"`;
    return;
  }
  const next = `${source.slice(0, index)}${replaceWith}${source.slice(index + find.length)}`;

  if (textarea) {
    textarea.value = next;
    refreshEditorDecorations(textarea, next);
    const cursor = index + replaceWith.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
  }
  updateFilesBuffer(active, next);
  slice.filesError = null;
  runFindStep(slice, false, true);
}

function runReplaceAll(
  slice: FilesSlice,
  updateFilesBuffer: (path: string, content: string) => void
): void {
  const active = slice.filesActiveTabPath;
  if (!active) return;
  const find = slice.filesFindQuery ?? "";
  if (!find) return;
  const replaceWith = slice.filesReplaceQuery ?? "";
  const selector = `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}="${escapeAttr(
    active
  )}"]`;
  const textarea = document.querySelector<HTMLTextAreaElement>(selector);
  const source = textarea ? textarea.value : slice.filesContentByPath[active] ?? "";
  const matches = findAllMatchRanges(source, find, slice.filesFindCaseSensitive === true);
  if (!matches.length) {
    slice.filesError = `No matches for "${find}"`;
    return;
  }
  let next = "";
  let cursor = 0;
  for (const index of matches) {
    next += source.slice(cursor, index);
    next += replaceWith;
    cursor = index + find.length;
  }
  next += source.slice(cursor);
  if (textarea) {
    textarea.value = next;
    refreshEditorDecorations(textarea, next);
    textarea.selectionStart = textarea.selectionEnd = 0;
  }
  updateFilesBuffer(active, next);
  slice.filesError = null;
  runFindStep(slice, false, true);
}

export function handleFilesPointerDown(
  event: MouseEvent,
  target: HTMLElement,
  slice: FilesSlice
): boolean {
  if (event.button !== 0) return false;
  const sidebarHandle = target.closest<HTMLElement>(
    `[${FILES_DATA_ATTR.action}="resize-sidebar"]`
  );
  if (sidebarHandle) {
    if (slice.filesSidebarCollapsed) return true;
    const root = sidebarHandle.closest<HTMLElement>(".files-tool");
    const leftPane = sidebarHandle.previousElementSibling as HTMLElement | null;
    if (!root || !leftPane) return true;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = Math.max(180, Math.round(leftPane.getBoundingClientRect().width));
    const minWidth = 180;
    const minRightPaneWidth = 260;
    root.classList.add("is-resizing");
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const maxWidth = Math.max(
        minWidth,
        Math.round(root.getBoundingClientRect().width - 12 - minRightPaneWidth)
      );
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(startWidth + delta)));
      slice.filesSidebarWidth = nextWidth;
      root.style.setProperty("--files-sidebar-width", `${nextWidth}px`);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      root.classList.remove("is-resizing");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return true;
  }

  const resizeHandle = target.closest<HTMLElement>(
    `[${FILES_DATA_ATTR.action}="resize-column"][${FILES_DATA_ATTR.column}]`
  );
  if (!resizeHandle) return false;
  const key = resizeHandle.getAttribute(FILES_DATA_ATTR.column);
  if (!isFilesColumnKey(key)) return true;
  const grid = resizeHandle.closest<HTMLElement>(".files-tool-grid");
  const headerCell = resizeHandle.closest<HTMLElement>(".files-tool-header-cell");
  if (!grid || !headerCell) return true;

  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startWidth = Math.max(1, Math.round(headerCell.getBoundingClientRect().width));

  const onMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX;
    const nextWidth = Math.max(
      FILES_COLUMN_MIN_WIDTHS[key],
      Math.round(startWidth + delta)
    );
    if (!slice.filesColumnWidths) {
      slice.filesColumnWidths = { ...FILES_COLUMN_DEFAULT_WIDTHS };
    }
    slice.filesColumnWidths[key] = nextWidth;
    applyColumnWidth(grid, key, nextWidth);
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    const root = grid.closest<HTMLElement>(".files-tool");
    root?.classList.remove("is-resizing");
  };

  const root = grid.closest<HTMLElement>(".files-tool");
  root?.classList.add("is-resizing");
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp, { once: true });
  return true;
}

function isFilesColumnKey(value: string | null): value is FilesColumnKey {
  return value === "name" || value === "type" || value === "size" || value === "modified";
}

function applyColumnWidth(grid: HTMLElement, key: FilesColumnKey, width: number): void {
  if (key === "name") {
    grid.style.setProperty("--files-col-name", `${width}px`);
    return;
  }
  if (key === "type") {
    grid.style.setProperty("--files-col-type", `${width}px`);
    return;
  }
  if (key === "size") {
    grid.style.setProperty("--files-col-size", `${width}px`);
    return;
  }
  grid.style.setProperty("--files-col-modified", `${width}px`);
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

function duplicatePathWithCopySuffix(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  const dir = slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "";
  const name = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0) {
    const stem = name.slice(0, dotIndex);
    const ext = name.slice(dotIndex);
    return `${dir}${stem}(copy)${ext}`;
  }
  return `${dir}${name}(copy)`;
}

function refreshEditorDecorations(textarea: HTMLTextAreaElement, content: string): void {
  const panel = textarea.closest<HTMLElement>(".files-editor-panel");
  if (!panel) return;
  const lineNumbers = panel.querySelector<HTMLElement>(".files-editor-lines");
  const highlight = panel.querySelector<HTMLElement>(".files-editor-highlight");
  const lineCount = Math.max(1, content.split("\n").length);
  if (lineNumbers) {
    lineNumbers.textContent = createLineNumbers(lineCount);
  }
  if (highlight) {
    const path = textarea.getAttribute(FILES_DATA_ATTR.path) || undefined;
    highlight.innerHTML = highlightCode(content, path);
  }
  textarea.style.height = "0px";
  const measuredHeight = textarea.scrollHeight;
  const fallback = lineCount * 20 + 20;
  const height = Math.max(220, measuredHeight || fallback);
  textarea.style.height = `${height}px`;
}

function createLineNumbers(lineCount: number): string {
  let value = "";
  for (let i = 1; i <= lineCount; i += 1) {
    value += `${i}${i === lineCount ? "" : "\n"}`;
  }
  return value;
}

function highlightCode(input: string, filePath?: string): string {
  const MAX_HIGHLIGHT_CHARS = 200_000;
  if (input.length > MAX_HIGHLIGHT_CHARS) {
    return escapeHtml(input);
  }
  return renderHighlightedHtml(input, filePath);
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }
}

function getSelectedEditorText(path: string): string {
  const selector = `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}="${escapeAttr(
    path
  )}"]`;
  const textarea = document.querySelector<HTMLTextAreaElement>(selector);
  if (!textarea) return "";
  const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
  const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
  if (end <= start) return "";
  return textarea.value.slice(start, end);
}

function focusEditorMatch(
  path: string,
  query: string,
  backwards = false,
  selectFromStart = false,
  caseSensitive = false
): boolean {
  const selector = `[${FILES_DATA_ATTR.action}="editor-input"][${FILES_DATA_ATTR.path}="${escapeAttr(
    path
  )}"]`;
  const textarea = document.querySelector<HTMLTextAreaElement>(selector);
  if (!textarea) return false;
  const source = textarea.value;
  const from = backwards
    ? Math.max(0, textarea.selectionStart - 1)
    : Math.max(0, textarea.selectionEnd);
  const index = findMatchIndex(source, query, from, backwards, selectFromStart, caseSensitive);
  if (index < 0) return false;
  textarea.focus();
  textarea.selectionStart = index;
  textarea.selectionEnd = index + query.length;
  return true;
}

function findMatchIndex(
  source: string,
  query: string,
  from: number,
  backwards: boolean,
  selectFromStart: boolean,
  caseSensitive: boolean
): number {
  if (!query) return -1;
  const haystack = caseSensitive ? source : source.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  if (backwards) {
    if (selectFromStart) {
      return haystack.lastIndexOf(needle, haystack.length - 1);
    }
    const at = Math.min(from, haystack.length - 1);
    let index = haystack.lastIndexOf(needle, at);
    if (index < 0) {
      index = haystack.lastIndexOf(needle, haystack.length - 1);
    }
    return index;
  }
  if (selectFromStart) {
    return haystack.indexOf(needle, 0);
  }
  let index = haystack.indexOf(needle, from);
  if (index < 0 && from > 0) {
    index = haystack.indexOf(needle, 0);
  }
  return index;
}

function findAllMatchRanges(source: string, query: string, caseSensitive: boolean): number[] {
  if (!query) return [];
  const haystack = caseSensitive ? source : source.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const indices: number[] = [];
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    indices.push(index);
    offset = index + needle.length;
  }
  return indices;
}

function escapeAttr(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function pickOpenFilePath(defaultPath?: string): Promise<string | null> {
  if ((window as any).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
          title: "Open File",
          directory: false,
          multiple: false,
          defaultPath
        }
      });
      if (Array.isArray(selected)) {
        return selected[0] ?? null;
      }
      return selected;
    } catch {
      // Fall through to manual prompt.
    }
  }
  const entered = window.prompt("Open file path", defaultPath ?? "")?.trim();
  return entered || null;
}

async function pickSaveFilePath(defaultPath: string, title = "Save File As"): Promise<string | null> {
  if ((window as any).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | null>("plugin:dialog|save", {
        options: {
          title,
          defaultPath
        }
      });
      return selected;
    } catch {
      // Fall through to manual prompt.
    }
  }
  const entered = window.prompt(title, defaultPath)?.trim();
  return entered || null;
}

function hasUnsavedTabs(slice: FilesSlice): boolean {
  return slice.filesOpenTabs.some((path) => slice.filesDirtyByPath[path] === true);
}

async function preloadRootPickerTree(slice: FilesSlice, deps: FilesDeps): Promise<void> {
  const root = slice.filesRootPath?.trim();
  if (!root) return;
  await ensurePathListed(root, slice, deps);
  const plugins = findChildDirPath(slice, root, "plugins");
  const frontend = findChildDirPath(slice, root, "frontend");
  if (plugins) {
    await ensurePathListed(plugins, slice, deps);
  }
  if (frontend) {
    await ensurePathListed(frontend, slice, deps);
    const src = findChildDirPath(slice, frontend, "src");
    if (src) {
      await ensurePathListed(src, slice, deps);
      const tools = findChildDirPath(slice, src, "tools");
      if (tools) {
        await ensurePathListed(tools, slice, deps);
      }
    }
  }
}

async function ensurePathListed(path: string, slice: FilesSlice, deps: FilesDeps): Promise<void> {
  if (slice.filesEntriesByPath[path]) return;
  await deps.listFilesDirectory(path);
}

function findChildDirPath(slice: FilesSlice, parentPath: string, name: string): string | null {
  const entries = slice.filesEntriesByPath[parentPath] ?? [];
  const match = entries.find((entry) => entry.isDir && entry.name.toLowerCase() === name.toLowerCase());
  return match?.path ?? null;
}
