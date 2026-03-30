import { escapeHtml } from "../../panels/utils";
import { renderToolToolbar } from "../ui/toolbar";
import { WEB_DATA_ATTR, WEB_UI_ID } from "../ui/constants";
import "./styles.css";

export interface WebToolViewState {
  tabId: string;
  title: string;
  query: string;
  mode: string;
  viewMode: "markdown" | "json";
  num: number;
  busy: boolean;
  message: string | null;
  result: Record<string, unknown> | null;
  historyOpen: boolean;
  historyClearConfirmOpen: boolean;
  historyItems: Array<{
    id: string;
    query: string;
    mode: string;
    num: number;
    timestampMs: number;
  }>;
  setupModalOpen: boolean;
  setupAccount: string;
  setupApiKey: string;
  setupMessage: string | null;
  setupBusy: boolean;
}

export function renderWebToolActions(
  tabs: Array<{ id: string; label: string; active: boolean }>,
  _viewMode: "markdown" | "json",
  historyOpen: boolean,
  _busy: boolean
): string {
  return renderToolToolbar({
    tabsMode: "dynamic",
    tabs: [
      ...tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        active: tab.active,
        buttonAttrs: {
          [WEB_DATA_ATTR.tabId]: tab.id
        },
        closeAttrs: {
          [WEB_DATA_ATTR.action]: "close-tab",
          [WEB_DATA_ATTR.tabId]: tab.id
        }
      })),
      {
        id: "web-new",
        label: "+New",
        active: false,
        closable: false,
        buttonAttrs: {
          [WEB_DATA_ATTR.action]: "new-tab"
        }
      }
    ],
    actions: [
      {
        id: "web-history",
        title: historyOpen ? "Hide History" : "Show History",
        icon: "history",
        active: historyOpen,
        buttonAttrs: {
          [WEB_DATA_ATTR.action]: "toggle-history"
        }
      }
    ]
  });
}

export function renderWebToolBody(view: WebToolViewState): string {
  const renderedResult = renderWebResult(view);
  const setupOverlay = view.setupModalOpen
    ? `<div class="web-tool-setup-overlay">
      <div class="web-tool-setup-modal">
        <h3 class="web-tool-setup-title">Set Up Web Search</h3>
        <p class="web-tool-setup-copy">This tool uses Serper. Add your account name and API key to create a verified Search connection.</p>
        <p class="web-tool-setup-copy">You can get a key at <a href="https://serper.dev" target="_blank" rel="noreferrer">serper.dev</a>.</p>
        <form id="${WEB_UI_ID.setupForm}" class="web-tool-setup-form">
          <label class="web-tool-field web-tool-field-block">
            <span class="web-tool-label">Account Name</span>
            <input
              id="${WEB_UI_ID.setupAccountInput}"
              class="web-tool-input"
              type="text"
              value="${escapeHtml(view.setupAccount)}"
              placeholder="My Serper Account"
              ${view.setupBusy ? "disabled" : ""}
            />
          </label>
          <label class="web-tool-field web-tool-field-block">
            <span class="web-tool-label">Serper API Key</span>
            <input
              id="${WEB_UI_ID.setupApiKeyInput}"
              class="web-tool-input"
              type="password"
              value="${escapeHtml(view.setupApiKey)}"
              placeholder="xxxxxxxxxxxxxxxx"
              ${view.setupBusy ? "disabled" : ""}
            />
          </label>
          <div class="web-tool-setup-note">Connection defaults: <code>https://google.serper.dev</code> with standard Serper endpoints.</div>
          ${view.setupMessage ? `<div class="web-tool-setup-message">${escapeHtml(view.setupMessage)}</div>` : ""}
          <div class="web-tool-setup-actions">
            <button type="button" class="tool-action-btn" ${WEB_DATA_ATTR.action}="setup-open-apis" ${
              view.setupBusy ? "disabled" : ""
            }>Open APIs Panel</button>
            <button type="button" class="tool-action-btn" ${WEB_DATA_ATTR.action}="setup-cancel" ${
              view.setupBusy ? "disabled" : ""
            }>Cancel</button>
            <button type="submit" class="tool-action-btn" ${view.setupBusy ? "disabled" : ""}>Save + Verify</button>
          </div>
        </form>
      </div>
    </div>`
    : "";

  const historyPanel = view.historyOpen
    ? `<aside class="web-tool-history-panel">
      <div class="web-tool-history-header">
        <div class="web-tool-history-title">Search History</div>
        <button type="button" class="tool-action-btn web-tool-history-clear" ${WEB_DATA_ATTR.action}="clear-history">Clear History</button>
      </div>
      <div class="web-tool-history-list">
        ${
          view.historyItems.length
            ? view.historyItems
                .map((item) => {
                  const when = new Date(item.timestampMs).toLocaleString();
                  return `<button type="button" class="web-tool-history-item" ${WEB_DATA_ATTR.action}="run-history-item" ${WEB_DATA_ATTR.historyId}="${escapeHtml(item.id)}" title="${escapeHtml(when)}">
                    <span class="web-tool-history-query">${escapeHtml(item.query)}</span>
                    <span class="web-tool-history-meta">${escapeHtml(item.mode)} • ${item.num} results • ${escapeHtml(when)}</span>
                  </button>`;
                })
                .join("")
            : '<div class="web-tool-history-empty">No prior searches.</div>'
        }
      </div>
    </aside>`
    : "";
  const historyConfirmModal = view.historyClearConfirmOpen
    ? `<div class="web-tool-history-confirm-overlay">
      <div class="web-tool-history-confirm-modal">
        <h3 class="web-tool-history-confirm-title">Clear Search History?</h3>
        <p class="web-tool-history-confirm-copy">This will permanently remove all saved search history.</p>
        <div class="web-tool-history-confirm-actions">
          <button type="button" class="tool-action-btn" ${WEB_DATA_ATTR.action}="clear-history-cancel">Cancel</button>
          <button type="button" class="tool-action-btn" ${WEB_DATA_ATTR.action}="clear-history-confirm">Clear History</button>
        </div>
      </div>
    </div>`
    : "";

  return `<div class="web-tool-panel primary-pane-body ${view.historyOpen ? "has-history" : ""}">
    <form class="web-tool-form" id="${WEB_UI_ID.searchForm}">
      <label class="web-tool-field web-tool-field-query">
        <span class="web-tool-label">Query</span>
        <div class="web-tool-query-row">
          <input
            id="${WEB_UI_ID.queryInput}"
            class="web-tool-input web-tool-query"
            type="text"
            value="${escapeHtml(view.query)}"
            placeholder="Search query"
            ${view.busy ? "disabled" : ""}
          />
          <button type="submit" class="tool-action-btn web-tool-submit" ${view.busy ? "disabled" : ""}>Search</button>
        </div>
      </label>
      <label class="web-tool-field">
        <span class="web-tool-label">Mode</span>
        <select id="${WEB_UI_ID.modeSelect}" class="web-tool-input web-tool-mode" ${
          view.busy ? "disabled" : ""
        }>
          <option value="search" ${view.mode === "search" ? "selected" : ""}>Search</option>
          <option value="images" ${view.mode === "images" ? "selected" : ""}>Images</option>
          <option value="news" ${view.mode === "news" ? "selected" : ""}>News</option>
          <option value="maps" ${view.mode === "maps" ? "selected" : ""}>Maps</option>
          <option value="places" ${view.mode === "places" ? "selected" : ""}>Places</option>
          <option value="videos" ${view.mode === "videos" ? "selected" : ""}>Videos</option>
          <option value="shopping" ${view.mode === "shopping" ? "selected" : ""}>Shopping</option>
          <option value="scholar" ${view.mode === "scholar" ? "selected" : ""}>Scholar</option>
        </select>
      </label>
      <label class="web-tool-field">
        <span class="web-tool-label">Results</span>
        <input
          id="${WEB_UI_ID.numInput}"
          class="web-tool-input web-tool-num"
          type="number"
          min="1"
          max="20"
          value="${view.num}"
          title="Number of results to return (1-20)"
          ${view.busy ? "disabled" : ""}
        />
      </label>
      <label class="web-tool-field">
        <span class="web-tool-label">View</span>
        <button
          type="button"
          class="tool-action-btn web-tool-view-toggle"
          ${WEB_DATA_ATTR.action}="toggle-view-mode"
          title="${view.viewMode === "markdown" ? "View .json" : "View Markdown"}"
          ${view.busy ? "disabled" : ""}
        >${view.viewMode === "markdown" ? "Markdown" : ".json"}</button>
      </label>
    </form>
    <pre class="web-tool-result">${renderWebResultText(view.viewMode, renderedResult)}</pre>
    ${historyPanel}
    ${historyConfirmModal}
    ${setupOverlay}
  </div>`;
}

function renderWebResult(view: WebToolViewState): string {
  if (view.busy) return "Searching...";
  if (view.viewMode === "json") {
    if (view.result) return JSON.stringify(view.result, null, 2);
    return view.message || "{}";
  }
  if (!view.result) return view.message || "";
  return formatWebResultMarkdown(view.result);
}

function renderWebResultText(viewMode: "markdown" | "json", text: string): string {
  if (viewMode !== "markdown") return escapeHtml(text);
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (/^https?:\/\/\S+$/i.test(trimmed)) {
        const href = escapeAttr(trimmed);
        const label = escapeHtml(trimmed);
        const leading = line.slice(0, line.indexOf(trimmed));
        return `${escapeHtml(leading)}<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
      }
      return escapeHtml(line);
    })
    .join("\n");
}

function formatWebResultMarkdown(result: Record<string, unknown>): string {
  const lines: string[] = [];
  const query = valueAsString(result.query);
  if (query) {
    lines.push(`# ${query}`);
    lines.push("");
  }

  const answerBox = asRecord(result.answer_box ?? result.answerBox);
  const answerText = valueAsString(answerBox?.answer) || valueAsString(answerBox?.snippet);
  if (answerText) {
    lines.push(`> ${answerText}`);
    lines.push("");
  }

  const lists = [
    asArray(result.items),
    asArray(result.organic),
    asArray(result.news),
    asArray(result.images),
    asArray(result.videos),
    asArray(result.shopping),
    asArray(result.places)
  ];
  const entries = lists.find((list) => list.length > 0) ?? [];
  entries.slice(0, 20).forEach((entry, index) => {
    const item = asRecord(entry);
    const title = valueAsString(item?.title) || `Result ${index + 1}`;
    const link =
      valueAsString(item?.link) || valueAsString(item?.url) || valueAsString(item?.sourceUrl);
    const snippet =
      valueAsString(item?.snippet) ||
      valueAsString(item?.description) ||
      valueAsString(item?.content);
    lines.push(`${index + 1}. ${title}`);
    if (link) lines.push(`   ${link}`);
    if (snippet) lines.push(`   ${snippet}`);
    lines.push("");
  });

  if (!lines.length) {
    return "No results.";
  }

  while (lines.length && !lines[lines.length - 1]?.trim()) {
    lines.pop();
  }
  return lines.join("\n");
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function valueAsString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeAttr(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
