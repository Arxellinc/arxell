import { renderHighlightedHtml } from "../files/highlight";

export interface NotepadDataAttrs {
  action: string;
  document: string;
  path?: string;
}

export interface NotepadEditorRenderInput {
  documentId: string;
  filePath?: string | null;
  content: string;
  lineCount: number;
  wrap: boolean;
  readOnly: boolean;
  loading: boolean;
  sizeBytes: number;
  dataAttrs: NotepadDataAttrs;
}

export interface NotepadFindRenderInput {
  query: string;
  replace: string;
  caseSensitive: boolean;
  matchCount: number;
  dataAttrs: NotepadDataAttrs;
}

const MAX_HIGHLIGHT_CHARS = 200_000;
const MAX_LIVE_HIGHLIGHT_CHARS = 20_000;

export function renderNotepadEditorPane(input: NotepadEditorRenderInput): string {
  if (input.loading) {
    return '<div class="notepad-editor-empty">Loading file...</div>';
  }
  if (input.readOnly && !input.content) {
    return `<div class="notepad-editor-empty">This file is read-only or binary (${formatSize(
      input.sizeBytes
    )}).</div>`;
  }
  const displayLines = Math.max(99, input.lineCount);
  const lineNumbers = createLineNumbers(displayLines);
  const plainTextMode = shouldUsePlainTextMode(input.content);
  const highlighted = plainTextMode ? "" : renderHighlightedCode(input.content, input.filePath);
  const editorHeight = Math.max(220, displayLines * 20 + 20);
  const pathAttr =
    input.dataAttrs.path && input.filePath
      ? ` ${input.dataAttrs.path}="${escapeHtml(input.filePath)}"`
      : "";
  return `<div class="notepad-editor-panel ${input.wrap ? "is-wrap" : ""}${plainTextMode ? " is-plain-text" : ""}">
    <div class="notepad-editor-scroll">
      <pre class="notepad-editor-lines" data-notepad-line-count="${input.lineCount}">${escapeHtml(lineNumbers)}</pre>
      <div class="notepad-editor-code-wrap" style="--notepad-editor-height:${editorHeight}px;">
        <pre class="notepad-editor-highlight">${highlighted}</pre>
        <textarea class="notepad-editor-input" ${input.dataAttrs.action}="editor-input" ${input.dataAttrs.document}="${escapeHtml(
          input.documentId
        )}"${pathAttr} style="height:${editorHeight}px;" spellcheck="false" ${input.readOnly ? "readonly" : ""}>${escapeHtml(
          input.content
        )}</textarea>
      </div>
    </div>
  </div>`;
}

export function renderNotepadFindBar(input: NotepadFindRenderInput): string {
  return `<div class="notepad-findbar">
    <label class="notepad-findbar-field">
      <span>Find</span>
      <input type="text" class="notepad-findbar-input" value="${escapeHtml(input.query)}" ${input.dataAttrs.action}="find-query-input" placeholder="Find text" />
    </label>
    <label class="notepad-findbar-field">
      <span>Replace</span>
      <input type="text" class="notepad-findbar-input" value="${escapeHtml(input.replace)}" ${input.dataAttrs.action}="replace-query-input" placeholder="Replace with" />
    </label>
    <label class="notepad-findbar-toggle">
      <input type="checkbox" ${input.dataAttrs.action}="find-case-sensitive" ${input.caseSensitive ? "checked" : ""} />
      <span>Match case</span>
    </label>
    <span class="notepad-findbar-count">${input.matchCount} match${input.matchCount === 1 ? "" : "es"}</span>
    <button type="button" class="notepad-findbar-btn" ${input.dataAttrs.action}="find-prev">Prev</button>
    <button type="button" class="notepad-findbar-btn" ${input.dataAttrs.action}="find-next">Next</button>
    <button type="button" class="notepad-findbar-btn" ${input.dataAttrs.action}="replace-one">Replace</button>
    <button type="button" class="notepad-findbar-btn" ${input.dataAttrs.action}="replace-all">Replace All</button>
    <button type="button" class="notepad-findbar-btn" ${input.dataAttrs.action}="find-close" aria-label="Close find and replace">Close</button>
  </div>`;
}

export function computeNotepadFindStats(
  content: string,
  query: string,
  caseSensitive: boolean
): { count: number } {
  if (!query) return { count: 0 };
  const haystack = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return { count };
}

export function refreshNotepadEditorDecorations(
  textarea: HTMLTextAreaElement,
  content: string,
  dataAttrs: NotepadDataAttrs
): void {
  const panel = textarea.closest<HTMLElement>(".notepad-editor-panel");
  if (!panel) return;
  const lineNumbers = panel.querySelector<HTMLElement>(".notepad-editor-lines");
  const highlight = panel.querySelector<HTMLElement>(".notepad-editor-highlight");
  const lineCount = Math.max(1, content.split("\n").length);
  const plainTextMode = shouldUsePlainTextMode(content);
  const previousLineCount = Number(lineNumbers?.dataset.notepadLineCount || "0");
  const lineCountChanged = previousLineCount !== lineCount;
  panel.classList.toggle("is-plain-text", plainTextMode);
  if (lineNumbers) {
    if (lineCountChanged) {
      lineNumbers.textContent = createLineNumbers(Math.max(99, lineCount));
      lineNumbers.dataset.notepadLineCount = String(lineCount);
    }
  }
  if (highlight) {
    const filePath = dataAttrs.path ? textarea.getAttribute(dataAttrs.path) || undefined : undefined;
    if (plainTextMode) {
      highlight.textContent = "";
    } else {
      highlight.innerHTML = renderHighlightedCode(content, filePath);
    }
  }
  const fallback = lineCount * 20 + 20;
  let height = Math.max(220, fallback);
  if (panel.classList.contains("is-wrap")) {
    textarea.style.height = "0px";
    const measuredHeight = textarea.scrollHeight;
    height = Math.max(220, measuredHeight || fallback);
  }
  textarea.style.height = `${height}px`;
  textarea.closest<HTMLElement>(".notepad-editor-code-wrap")?.style.setProperty(
    "--notepad-editor-height",
    `${height}px`
  );
}

export function scheduleNotepadEditorRefresh(
  textarea: HTMLTextAreaElement,
  content: string,
  dataAttrs: NotepadDataAttrs
): void {
  textarea.dataset.notepadRefreshContent = content;
  if (textarea.dataset.notepadRefreshScheduled === "true") return;
  textarea.dataset.notepadRefreshScheduled = "true";
  requestAnimationFrame(() => {
    textarea.dataset.notepadRefreshScheduled = "false";
    refreshNotepadEditorDecorations(textarea, textarea.dataset.notepadRefreshContent ?? textarea.value, dataAttrs);
  });
}

export function getSelectedNotepadText(documentId: string, dataAttrs: NotepadDataAttrs): string {
  const selector = `[${dataAttrs.action}="editor-input"][${dataAttrs.document}="${escapeAttr(documentId)}"]`;
  const textarea = document.querySelector<HTMLTextAreaElement>(selector);
  if (!textarea) return "";
  const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
  const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
  if (end <= start) return "";
  return textarea.value.slice(start, end);
}

export function focusNotepadMatch(
  documentId: string,
  query: string,
  dataAttrs: NotepadDataAttrs,
  backwards = false,
  selectFromStart = false,
  caseSensitive = false
): boolean {
  const selector = `[${dataAttrs.action}="editor-input"][${dataAttrs.document}="${escapeAttr(documentId)}"]`;
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

export function replaceOneInNotepad(
  documentId: string,
  source: string,
  find: string,
  replaceWith: string,
  dataAttrs: NotepadDataAttrs,
  caseSensitive: boolean
): { content: string; replaced: boolean } {
  if (!find) return { content: source, replaced: false };
  const selector = `[${dataAttrs.action}="editor-input"][${dataAttrs.document}="${escapeAttr(documentId)}"]`;
  const textarea = document.querySelector<HTMLTextAreaElement>(selector);
  const selected = textarea ? source.slice(textarea.selectionStart, textarea.selectionEnd) : "";
  const selectedNorm = caseSensitive ? selected : selected.toLowerCase();
  const needle = caseSensitive ? find : find.toLowerCase();
  let index = -1;
  if (selectedNorm === needle && textarea) {
    index = textarea.selectionStart;
  } else if (textarea) {
    index = findMatchIndex(source, find, textarea.selectionEnd, false, false, caseSensitive);
  } else {
    index = findMatchIndex(source, find, 0, false, true, caseSensitive);
  }
  if (index < 0) return { content: source, replaced: false };
  const next = `${source.slice(0, index)}${replaceWith}${source.slice(index + find.length)}`;
  if (textarea) {
    textarea.value = next;
    refreshNotepadEditorDecorations(textarea, next, dataAttrs);
    const cursor = index + replaceWith.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
  }
  return { content: next, replaced: true };
}

export function replaceAllInNotepad(
  documentId: string,
  source: string,
  find: string,
  replaceWith: string,
  dataAttrs: NotepadDataAttrs,
  caseSensitive: boolean
): { content: string; replaced: boolean } {
  if (!find) return { content: source, replaced: false };
  const matches = findAllMatchRanges(source, find, caseSensitive);
  if (!matches.length) return { content: source, replaced: false };
  let next = "";
  let cursor = 0;
  for (const index of matches) {
    next += source.slice(cursor, index);
    next += replaceWith;
    cursor = index + find.length;
  }
  next += source.slice(cursor);
  const selector = `[${dataAttrs.action}="editor-input"][${dataAttrs.document}="${escapeAttr(documentId)}"]`;
  const textarea = document.querySelector<HTMLTextAreaElement>(selector);
  if (textarea) {
    textarea.value = next;
    refreshNotepadEditorDecorations(textarea, next, dataAttrs);
    textarea.selectionStart = textarea.selectionEnd = 0;
  }
  return { content: next, replaced: true };
}

export function findAllMatchRanges(source: string, query: string, caseSensitive: boolean): number[] {
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

export async function pickOpenFilePath(defaultPath?: string): Promise<string | null> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
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
      if (Array.isArray(selected)) return selected[0] ?? null;
      return selected;
    } catch {
      // Fall through to manual prompt.
    }
  }
  const entered = window.prompt("Open file path", defaultPath ?? "")?.trim();
  return entered || null;
}

export async function pickSaveFilePath(defaultPath: string, title = "Save File As"): Promise<string | null> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
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

export function duplicatePathWithCopySuffix(path: string): string {
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

export async function copyText(value: string): Promise<void> {
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

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttr(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createLineNumbers(lineCount: number): string {
  let value = "";
  for (let i = 1; i <= lineCount; i += 1) {
    value += `${i}${i === lineCount ? "" : "\n"}`;
  }
  return value;
}

export function renderHighlightedCode(input: string, filePath?: string | null): string {
  if (input.length > MAX_HIGHLIGHT_CHARS) {
    return escapeHtml(input);
  }
  return renderHighlightedHtml(input, filePath);
}

function shouldUsePlainTextMode(input: string): boolean {
  return input.length > MAX_LIVE_HIGHLIGHT_CHARS;
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

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
