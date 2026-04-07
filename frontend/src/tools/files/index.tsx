import type { FilesListDirectoryEntry } from "../../contracts";
import { iconHtml } from "../../icons";
import { escapeHtml } from "../../panels/utils";
import { renderHighlightedHtml } from "./highlight";
import { FILES_DATA_ATTR, FILES_UI_ID } from "../ui/constants";
import { renderToolToolbar } from "../ui/toolbar";
import "./styles.css";

export type FilesColumnKey = "name" | "type" | "size" | "modified";

export interface FilesColumnWidths {
  name: number;
  type: number;
  size: number;
  modified: number;
}

export const FILES_SIDEBAR_DEFAULT_WIDTH = 320;
export const FILES_SIDEBAR_MIN_WIDTH = 180;

export const FILES_COLUMN_DEFAULT_WIDTHS: FilesColumnWidths = {
  name: 260,
  type: 120,
  size: 96,
  modified: 132
};

export const FILES_COLUMN_MIN_WIDTHS: FilesColumnWidths = {
  name: 160,
  type: 84,
  size: 72,
  modified: 108
};

export interface FilesExplorerViewState {
  rootPath: string | null;
  scopeRootPath?: string | null;
  rootSelectorOpen?: boolean;
  selectedPath: string | null;
  selectedEntryPath?: string | null;
  openTabs: string[];
  activeTabPath: string | null;
  contentByPath: Record<string, string>;
  dirtyByPath: Record<string, boolean>;
  loadingFileByPath: Record<string, boolean>;
  savingFileByPath: Record<string, boolean>;
  readOnlyByPath: Record<string, boolean>;
  sizeByPath: Record<string, number>;
  expandedByPath: Record<string, boolean>;
  entriesByPath: Record<string, FilesListDirectoryEntry[]>;
  loadingByPath: Record<string, boolean>;
  columnWidths?: Partial<FilesColumnWidths>;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  findOpen?: boolean;
  findQuery?: string;
  replaceQuery?: string;
  findCaseSensitive?: boolean;
  lineWrap?: boolean;
  error: string | null;
}

export function renderFilesToolActions(view: FilesExplorerViewState): string {
  const tabs = view.openTabs.map((path) => {
    const dirty = view.dirtyByPath[path] ? " *" : "";
    const loading = view.loadingFileByPath[path] ? " (loading)" : "";
    return {
      id: path,
      label: `${basename(path)}${dirty}${loading}`,
      active: view.activeTabPath === path,
      buttonAttrs: {
        [FILES_DATA_ATTR.action]: "activate-tab",
        [FILES_DATA_ATTR.path]: path
      },
      closeAttrs: {
        [FILES_DATA_ATTR.action]: "close-tab",
        [FILES_DATA_ATTR.path]: path
      }
    };
  });
  const active = view.activeTabPath;
  const activeDirty = active ? view.dirtyByPath[active] === true : false;
  const activeSaving = active ? view.savingFileByPath[active] === true : false;
  const activeReadOnly = active ? view.readOnlyByPath[active] === true : false;
  const lineWrap = view.lineWrap === true;
  return renderToolToolbar({
    tabsMode: "dynamic",
    tabs,
    actions: [
      {
        id: "files-save",
        title: activeSaving ? "Saving..." : activeReadOnly ? "Read-only file" : "Save file",
        icon: "save",
        disabled: !active || activeReadOnly || activeSaving || !activeDirty,
        buttonAttrs: {
          [FILES_DATA_ATTR.action]: "save-file"
        }
      },
      {
        id: "files-save-as",
        title: "Save As",
        icon: "file-output",
        disabled: !active || activeSaving,
        buttonAttrs: {
          [FILES_DATA_ATTR.action]: "save-file-as"
        }
      },
      {
        id: "files-save-all",
        title: "Save All",
        icon: "save-all",
        disabled: activeSaving || !view.openTabs.some((path) => view.dirtyByPath[path]),
        buttonAttrs: {
          [FILES_DATA_ATTR.action]: "save-all-files"
        }
      },
      {
        id: "files-open",
        title: "Open File",
        icon: "folder-open",
        buttonAttrs: {
          [FILES_DATA_ATTR.action]: "open-file"
        }
      },
      {
        id: "files-duplicate",
        title: "Duplicate File",
        icon: "copy-plus",
        disabled: !active,
        buttonAttrs: {
          [FILES_DATA_ATTR.action]: "duplicate-file"
        }
      },
      {
        id: "files-new",
        title: "New File",
        icon: "file-plus",
        buttonAttrs: {
          [FILES_DATA_ATTR.action]: "new-file"
        }
      },
      {
        id: "files-search",
        title: "Find / Replace",
        icon: "search",
        disabled: !active,
        buttonAttrs: {
          [FILES_DATA_ATTR.action]: "search-in-file"
        }
      },
      {
        id: "files-wrap",
        title: lineWrap ? "Disable line wrap (Alt+Z)" : "Enable line wrap (Alt+Z)",
        icon: "list",
        disabled: !active,
        buttonAttrs: {
          [FILES_DATA_ATTR.action]: "toggle-wrap"
        }
      },
      {
        id: "files-refresh",
        title: "Refresh folder",
        icon: "history",
        buttonAttrs: {
          id: FILES_UI_ID.refreshButton,
          [FILES_DATA_ATTR.action]: "refresh"
        }
      }
    ]
  });
}

export function renderFilesToolBody(view: FilesExplorerViewState): string {
  const activeRoot = view.scopeRootPath ?? view.rootPath;
  const selected = view.selectedPath ?? activeRoot ?? "";
  const activePath = view.activeTabPath;
  const selectedEntryPath = view.selectedEntryPath ?? null;
  const rightEntries = selected ? view.entriesByPath[selected] ?? [] : [];
  const leftTree = renderTree(view, activeRoot);
  const selectedLabel = activePath || selected || "No folder selected";
  const widths = normalizeColumnWidths(view.columnWidths);
  const sidebarCollapsed = view.sidebarCollapsed === true;
  const sidebarWidth = sidebarCollapsed ? 36 : normalizeSidebarWidth(view.sidebarWidth);
  const rootSelectorHtml = renderRootSelector(view);
  const rootStyle = `--files-sidebar-width:${sidebarWidth}px;`;
  const gridStyle = `--files-col-name:${widths.name}px;--files-col-type:${widths.type}px;--files-col-size:${widths.size}px;--files-col-modified:${widths.modified}px;`;
  const activeContent = activePath ? view.contentByPath[activePath] ?? "" : "";
  const activeLoading = activePath ? view.loadingFileByPath[activePath] === true : false;
  const activeSaving = activePath ? view.savingFileByPath[activePath] === true : false;
  const activeReadOnly = activePath ? view.readOnlyByPath[activePath] === true : false;
  const lineWrap = view.lineWrap === true;
  const activeLineCount = Math.max(1, activeContent.split("\n").length);
  const findOpen = view.findOpen === true;
  const findQuery = view.findQuery ?? "";
  const replaceQuery = view.replaceQuery ?? "";
  const findStats = activePath ? computeFindStats(activeContent, findQuery, view.findCaseSensitive === true) : { count: 0 };

  return `<div class="files-tool primary-pane-body ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}" style="${rootStyle}">
    <section class="files-tool-left ${view.rootSelectorOpen ? "is-root-selector-open" : ""}">
      <div class="files-tool-pane-title files-tool-left-title">
        <span class="files-tool-left-title-text">${sidebarCollapsed ? "" : "Folders"}</span>
        <button type="button" class="files-tool-sidebar-toggle" ${FILES_DATA_ATTR.action}="toggle-sidebar-collapse" aria-label="${sidebarCollapsed ? "Expand folders sidebar" : "Collapse folders sidebar"}">${sidebarCollapsed ? "▸" : "◂"}</button>
      </div>
      ${sidebarCollapsed ? "" : `<div class="files-tool-root-row">${rootSelectorHtml}</div>`}
      <div class="files-tool-tree">${leftTree}</div>
    </section>
    <button type="button" class="files-tool-pane-resizer" aria-label="Resize folders pane" ${FILES_DATA_ATTR.action}="resize-sidebar"></button>
    <section class="files-tool-right">
      <div class="files-tool-pane-title files-tool-right-title">
        <span class="files-tool-path-cluster">
          <span class="files-tool-breadcrumb">${escapeHtml(selectedLabel)}</span>
          ${
            activePath
              ? `<button type="button" class="files-tool-path-copy-btn" ${FILES_DATA_ATTR.action}="copy-file-path" title="Copy active file path">${iconHtml("copy", { size: 16, tone: "dark" })}</button>`
              : ""
          }
        </span>
        ${
          activePath
            ? `<span class="files-tool-editor-right"><span class="files-tool-editor-meta">${activeReadOnly ? "read-only" : activeSaving ? "saving..." : view.dirtyByPath[activePath] ? "modified" : "saved"}</span></span>`
            : ""
        }
      </div>
      ${
        activePath
          ? renderEditorPane({
              activePath,
              activeContent,
              lineCount: activeLineCount,
              wrap: lineWrap,
              readOnly: activeReadOnly,
              loading: activeLoading,
              sizeBytes: view.sizeByPath[activePath] ?? 0
            })
          : ""
      }
      ${
        activePath && findOpen
          ? renderFindBar({
              query: findQuery,
              replace: replaceQuery,
              caseSensitive: view.findCaseSensitive === true,
              matchCount: findStats.count
            })
          : ""
      }
      <div class="files-tool-grid ${activePath ? "is-collapsed" : ""}" style="${gridStyle}">
        <div class="files-tool-grid-header">
          <span class="files-tool-header-cell">Name<button type="button" class="files-tool-col-resizer" aria-label="Resize Name column" ${FILES_DATA_ATTR.action}="resize-column" ${FILES_DATA_ATTR.column}="name"></button></span>
          <span class="files-tool-header-cell">Type<button type="button" class="files-tool-col-resizer" aria-label="Resize Type column" ${FILES_DATA_ATTR.action}="resize-column" ${FILES_DATA_ATTR.column}="type"></button></span>
          <span class="files-tool-header-cell">Size<button type="button" class="files-tool-col-resizer" aria-label="Resize Size column" ${FILES_DATA_ATTR.action}="resize-column" ${FILES_DATA_ATTR.column}="size"></button></span>
          <span class="files-tool-header-cell">Modified<button type="button" class="files-tool-col-resizer" aria-label="Resize Modified column" ${FILES_DATA_ATTR.action}="resize-column" ${FILES_DATA_ATTR.column}="modified"></button></span>
        </div>
        ${
          rightEntries.length
            ? rightEntries
                .map((entry) => {
                  const type = formatType(entry);
                  const icon = entry.isDir ? "folder" : "file-badge";
                  const selectedClass =
                    !entry.isDir && selectedEntryPath === entry.path
                      ? " is-selected-file"
                      : "";
                  return `<button type="button" class="files-tool-grid-row ${entry.isDir ? "is-dir" : ""}${selectedClass}" ${FILES_DATA_ATTR.action}="select-entry" ${FILES_DATA_ATTR.path}="${escapeHtml(entry.path)}" ${FILES_DATA_ATTR.isDir}="${entry.isDir ? "true" : "false"}" title="${escapeHtml(entry.path)}">
                    <span class="files-tool-name-cell">${iconHtml(icon, { size: 16, tone: "dark" })}<span>${escapeHtml(entry.name)}</span></span>
                    <span>${type}</span>
                    <span>${entry.isDir ? "" : formatSize(entry.sizeBytes)}</span>
                    <span>${formatModified(entry.modifiedMs)}</span>
                  </button>`;
                })
                .join("")
            : '<div class="files-tool-grid-empty">No files in this folder.</div>'
        }
      </div>
      ${view.error ? `<div class="files-tool-error">${escapeHtml(view.error)}</div>` : ""}
    </section>
  </div>`;
}

function renderRootSelector(view: FilesExplorerViewState): string {
  const workspaceRoot = view.rootPath?.trim() ?? "";
  const scopeRoot = view.scopeRootPath?.trim() || workspaceRoot;
  const selectorOpen = view.rootSelectorOpen === true;
  const triggerLabel = formatScopeLabel(workspaceRoot, scopeRoot);
  const triggerTitle = scopeRoot || "Select root directory";
  const treeHtml = renderRootPickerTree(view, workspaceRoot, scopeRoot);

  return `<div class="files-root-selector ${selectorOpen ? "is-open" : ""}">
    <button type="button" class="files-root-selector-trigger" ${FILES_DATA_ATTR.action}="toggle-root-selector" title="${escapeHtml(triggerTitle)}" aria-label="Select root directory">
      <span class="files-root-selector-icon">${iconHtml("folder", { size: 16, tone: "dark" })}</span>
      <span class="files-root-selector-label">${escapeHtml(triggerLabel)}</span>
      <span class="files-root-selector-chevron">▾</span>
    </button>
    ${
      selectorOpen
        ? `<div class="files-root-popover">
      <div class="files-root-popover-tree">${treeHtml}</div>
    </div>`
        : ""
    }
  </div>`;
}

function formatScopeLabel(workspaceRoot: string, scopeRoot: string): string {
  const normalizedRoot = normalizePickerPath(workspaceRoot);
  const normalizedScope = normalizePickerPath(scopeRoot);
  if (!normalizedScope) return "Select Root";
  if (!normalizedRoot) return normalizedScope;
  if (normalizedScope === normalizedRoot) return basename(normalizedRoot);
  if (normalizedScope.startsWith(`${normalizedRoot}/`)) {
    const suffix = normalizedScope.slice(normalizedRoot.length + 1);
    return `${basename(normalizedRoot)}/${suffix}`;
  }
  return normalizedScope;
}

function renderRootPickerTree(
  view: FilesExplorerViewState,
  rootPath: string,
  scopePath: string
): string {
  if (!rootPath) {
    return '<div class="files-root-empty">No workspace folder loaded.</div>';
  }
  return renderRootPickerNode(view, rootPath, basename(rootPath), 0, scopePath, rootPath);
}

function renderRootPickerNode(
  view: FilesExplorerViewState,
  path: string,
  label: string,
  depth: number,
  scopePath: string,
  workspaceRoot: string
): string {
  const expandedState = view.expandedByPath[path];
  const expanded =
    expandedState === true ||
    (expandedState === undefined && shouldAutoExpandRootPickerNode(path, depth, workspaceRoot));
  const entries = view.entriesByPath[path] ?? [];
  const childDirs = entries.filter((entry) => entry.isDir);
  const hasChildren = childDirs.length > 0;
  const loading = view.loadingByPath[path] === true;
  const isActiveScope = normalizePickerPath(path) === normalizePickerPath(scopePath);
  const isLocked = isLockedSystemFolder(path, workspaceRoot);
  const rowClass = `files-root-tree-row${isActiveScope ? " is-active-scope" : ""}${isLocked ? " is-locked" : ""}`;
  const chevron = hasChildren ? (expanded ? "▾" : "▸") : "";
  const childrenHtml =
    expanded && hasChildren
      ? childDirs
          .map((entry) =>
            renderRootPickerNode(view, entry.path, entry.name, depth + 1, scopePath, workspaceRoot)
          )
          .join("")
      : "";
  return `<div class="files-root-tree-node ${expanded ? "is-expanded" : ""}" ${FILES_DATA_ATTR.path}="${escapeHtml(path)}">
    <div class="${rowClass}" style="--depth:${depth}">
      <button type="button" class="files-root-tree-chevron-btn" ${FILES_DATA_ATTR.action}="root-tree-toggle" ${FILES_DATA_ATTR.path}="${escapeHtml(path)}" aria-label="${expanded ? "Collapse folder" : "Expand folder"}"${hasChildren ? "" : ' disabled aria-disabled="true"'}>
        <span class="files-root-tree-chevron">${chevron}</span>
      </button>
      <button type="button" class="files-root-tree-hit" ${FILES_DATA_ATTR.action}="root-tree-select" ${FILES_DATA_ATTR.path}="${escapeHtml(path)}" title="${escapeHtml(path)}"${isLocked ? ' disabled aria-disabled="true"' : ""}>
        <span class="files-root-tree-icon">${iconHtml("folder", { size: 14, tone: "dark" })}</span>
        <span class="files-root-tree-label">${escapeHtml(label)}</span>
      </button>
      ${isLocked ? '<span class="files-root-tree-lock" title="Read-only folder">🔒</span>' : ""}
    </div>
    ${loading ? '<div class="files-root-tree-loading">Loading...</div>' : ""}
    ${childrenHtml}
  </div>`;
}

function shouldAutoExpandRootPickerNode(path: string, depth: number, workspaceRoot: string): boolean {
  if (depth === 0) return true;
  const current = normalizePickerPath(path);
  const root = normalizePickerPath(workspaceRoot);
  const auto = new Set([
    `${root}/frontend`,
    `${root}/frontend/src`,
    `${root}/frontend/src/tools`,
    `${root}/plugins`
  ]);
  return auto.has(current);
}

function isLockedSystemFolder(path: string, workspaceRoot: string): boolean {
  const normalized = normalizePickerPath(path);
  const root = normalizePickerPath(workspaceRoot);
  const leaf = basename(normalized);
  if (leaf === ".git" || leaf === ".github" || leaf === "node_modules" || leaf === "target") {
    return true;
  }
  const lockedPrefixes = [`${root}/src-tauri`, `${root}/.git`, `${root}/.github`];
  return lockedPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function normalizePickerPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) return "";
  if (normalized === "/") return "/";
  return normalized.replace(/\/+$/, "");
}

function renderFindBar(input: {
  query: string;
  replace: string;
  caseSensitive: boolean;
  matchCount: number;
}): string {
  return `<div class="files-findbar">
    <label class="files-findbar-field">
      <span>Find</span>
      <input type="text" class="files-findbar-input" value="${escapeHtml(input.query)}" ${FILES_DATA_ATTR.action}="find-query-input" placeholder="Find text" />
    </label>
    <label class="files-findbar-field">
      <span>Replace</span>
      <input type="text" class="files-findbar-input" value="${escapeHtml(input.replace)}" ${FILES_DATA_ATTR.action}="replace-query-input" placeholder="Replace with" />
    </label>
    <label class="files-findbar-toggle">
      <input type="checkbox" ${FILES_DATA_ATTR.action}="find-case-sensitive" ${input.caseSensitive ? "checked" : ""} />
      <span>Case</span>
    </label>
    <span class="files-findbar-count">${input.matchCount} match${input.matchCount === 1 ? "" : "es"}</span>
    <button type="button" class="files-findbar-btn" ${FILES_DATA_ATTR.action}="find-prev">Prev</button>
    <button type="button" class="files-findbar-btn" ${FILES_DATA_ATTR.action}="find-next">Next</button>
    <button type="button" class="files-findbar-btn" ${FILES_DATA_ATTR.action}="replace-one">Replace</button>
    <button type="button" class="files-findbar-btn" ${FILES_DATA_ATTR.action}="replace-all">Replace All</button>
    <button type="button" class="files-findbar-btn" ${FILES_DATA_ATTR.action}="find-close" aria-label="Close find and replace">Close</button>
  </div>`;
}

function computeFindStats(content: string, query: string, caseSensitive: boolean): { count: number } {
  if (!query) return { count: 0 };
  if (!caseSensitive) {
    const source = content.toLowerCase();
    const needle = query.toLowerCase();
    return { count: countNeedle(source, needle) };
  }
  return { count: countNeedle(content, query) };
}

function countNeedle(source: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const index = source.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function renderEditorPane(input: {
  activePath: string;
  activeContent: string;
  lineCount: number;
  wrap: boolean;
  readOnly: boolean;
  loading: boolean;
  sizeBytes: number;
}): string {
  if (input.loading) {
    return '<div class="files-editor-empty">Loading file...</div>';
  }
  if (input.readOnly && !input.activeContent) {
    return `<div class="files-editor-empty">This file is read-only or binary (${formatSize(
      input.sizeBytes
    )}).</div>`;
  }
  const lineNumbers = createLineNumbers(input.lineCount);
  const highlighted = highlightCode(input.activeContent, input.activePath);
  const editorHeight = Math.max(220, input.lineCount * 20 + 20);
  return `<div class="files-editor-panel ${input.wrap ? "is-wrap" : ""}">
    <div class="files-editor-scroll">
      <pre class="files-editor-lines">${escapeHtml(lineNumbers)}</pre>
      <div class="files-editor-code-wrap">
        <pre class="files-editor-highlight">${highlighted}</pre>
        <textarea class="files-editor-input" ${FILES_DATA_ATTR.action}="editor-input" ${FILES_DATA_ATTR.path}="${escapeHtml(
          input.activePath
        )}" style="height:${editorHeight}px;" spellcheck="false" ${input.readOnly ? "readonly" : ""}>${escapeHtml(
          input.activeContent
        )}</textarea>
      </div>
    </div>
  </div>`;
}

function renderTree(view: FilesExplorerViewState, rootPath: string | null): string {
  if (!rootPath) {
    return '<div class="files-tool-empty">Loading workspace files...</div>';
  }
  const rootName = basename(rootPath);
  return renderTreeNode(view, rootPath, rootName, 0);
}

function renderTreeNode(
  view: FilesExplorerViewState,
  path: string,
  label: string,
  depth: number
): string {
  const expanded = view.expandedByPath[path] === true || depth === 0;
  const selected = view.selectedPath === path;
  const entries = sortTreeEntries(view.entriesByPath[path] ?? []);
  const loading = view.loadingByPath[path] === true;
  const childHtml =
    expanded && (entries.length || loading)
      ? `<div class="files-tool-tree-children">
          ${entries
            .map((entry) =>
              entry.isDir
                ? renderTreeNode(view, entry.path, entry.name, depth + 1)
                : renderTreeFileNode(entry, depth + 1)
            )
            .join("")}
          ${loading ? '<div class="files-tool-tree-loading">Loading...</div>' : ""}
        </div>`
      : "";
  const chevron = expanded ? "▾" : "▸";
  return `<div class="files-tool-tree-node ${selected ? "is-selected" : ""}">
    <button type="button" class="files-tool-tree-row" ${FILES_DATA_ATTR.action}="select-node" ${FILES_DATA_ATTR.path}="${escapeHtml(path)}" style="--depth:${depth};">
      <span class="files-tool-tree-chevron" ${FILES_DATA_ATTR.action}="toggle-node" ${FILES_DATA_ATTR.path}="${escapeHtml(path)}">${chevron}</span>
      <span class="files-tool-tree-icon">${iconHtml("folder", { size: 16, tone: "dark" })}</span>
      <span class="files-tool-tree-label">${escapeHtml(label)}</span>
    </button>
    ${childHtml}
  </div>`;
}

function renderTreeFileNode(entry: FilesListDirectoryEntry, depth: number): string {
  return `<div class="files-tool-tree-node is-file">
    <button type="button" class="files-tool-tree-row files-tool-tree-file-row" ${FILES_DATA_ATTR.action}="select-entry" ${FILES_DATA_ATTR.path}="${escapeHtml(entry.path)}" ${FILES_DATA_ATTR.isDir}="false" style="--depth:${depth};" title="${escapeHtml(entry.path)}">
      <span class="files-tool-tree-spacer" aria-hidden="true"></span>
      <span class="files-tool-tree-label">${escapeHtml(entry.name)}</span>
    </button>
  </div>`;
}

function sortTreeEntries(entries: FilesListDirectoryEntry[]): FilesListDirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized || "/";
}

function normalizeColumnWidths(widths: Partial<FilesColumnWidths> | undefined): FilesColumnWidths {
  return {
    name: clampColumnWidth(widths?.name, "name"),
    type: clampColumnWidth(widths?.type, "type"),
    size: clampColumnWidth(widths?.size, "size"),
    modified: clampColumnWidth(widths?.modified, "modified")
  };
}

function clampColumnWidth(value: number | undefined, key: FilesColumnKey): number {
  const min = FILES_COLUMN_MIN_WIDTHS[key];
  const fallback = FILES_COLUMN_DEFAULT_WIDTHS[key];
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.round(value as number));
}

function normalizeSidebarWidth(value: number | undefined): number {
  if (!Number.isFinite(value)) return FILES_SIDEBAR_DEFAULT_WIDTH;
  return Math.max(FILES_SIDEBAR_MIN_WIDTH, Math.round(value as number));
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatModified(value: number | null): string {
  if (typeof value !== "number") return "";
  return new Date(value).toLocaleString();
}

function formatType(entry: FilesListDirectoryEntry): string {
  if (entry.isDir) return "Folder";
  const name = entry.name.trim();
  if (!name) return "File";
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "Dockerfile";
  if (lower === "makefile") return "Makefile";
  if (lower === ".gitignore") return "Git ignore";
  if (lower.startsWith(".env")) return "Environment";
  const dot = lower.lastIndexOf(".");
  if (dot <= 0 || dot >= lower.length - 1) return "File";
  const ext = lower.slice(dot + 1);
  const known = KNOWN_FILE_TYPES[ext];
  if (known) return known;
  return `${ext.toUpperCase()} file`;
}

const KNOWN_FILE_TYPES: Record<string, string> = {
  c: "C source",
  cc: "C++ source",
  cpp: "C++ source",
  cs: "C# source",
  css: "CSS stylesheet",
  csv: "CSV data",
  go: "Go source",
  h: "C header",
  htm: "HTML document",
  html: "HTML document",
  java: "Java source",
  js: "JavaScript",
  json: "JSON document",
  jsx: "React JSX",
  md: "Markdown",
  php: "PHP source",
  py: "Python source",
  rb: "Ruby source",
  rs: "Rust source",
  sh: "Shell script",
  sql: "SQL script",
  svg: "SVG image",
  toml: "TOML config",
  ts: "TypeScript",
  tsx: "React TSX",
  txt: "Text document",
  xml: "XML document",
  yaml: "YAML config",
  yml: "YAML config"
};

function createLineNumbers(lineCount: number): string {
  let value = "";
  for (let i = 1; i <= lineCount; i += 1) {
    value += `${i}${i === lineCount ? "" : "\n"}`;
  }
  return value;
}

function highlightCode(input: string, filePath: string): string {
  const MAX_HIGHLIGHT_CHARS = 200_000;
  if (input.length > MAX_HIGHLIGHT_CHARS) {
    return escapeHtml(input);
  }
  return renderHighlightedHtml(input, filePath);
}
