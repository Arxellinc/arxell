/**
 * Memory Tool
 *
 * Persistent context and memory references
 */
import { iconHtml } from "../../icons";
import { escapeHtml } from "../../panels/utils";
import { renderNotepadEditorPane } from "../notepad/shared";
import { renderToolToolbar } from "../ui/toolbar";
import "./styles.css";

export type MemoryTabId = "context" | "history" | "memory" | "skills" | "tools";

export interface MemoryContextItem {
  key: string;
  value: string;
  category: string;
  sourcePath?: string | null;
  loadMethod: string;
  loadReason: string;
  tokenEstimate: number;
  charCount: number;
  wordCount: number;
}

export interface MemoryChatHistoryItem {
  conversationId: string;
  title: string;
  messageCount: number;
  lastMessagePreview: string;
  updatedAtMs: number;
}

export interface MemoryPersistentItem {
  key: string;
  value: string;
  type: "fact" | "personality" | "directive" | "other";
  loadMethod: string;
  loadReason: string;
  tokenEstimate: number;
  charCount: number;
  wordCount: number;
}

export interface MemoryToolState {
  contextItems: MemoryContextItem[];
  chatHistory: MemoryChatHistoryItem[];
  persistentItems: MemoryPersistentItem[];
  skillsItems: MemoryContextItem[];
  toolsItems: MemoryContextItem[];
  alwaysLoadToolKeys: string[];
  alwaysLoadSkillKeys: string[];
  modalOpen: boolean;
  modalMode: "edit" | "create";
  modalSection: MemoryTabId | null;
  modalTitle: string;
  modalValue: string;
  modalEditable: boolean;
  modalTarget: "memory" | "system-prompt" | "custom-item" | null;
  modalNamespace: string | null;
  modalKey: string | null;
  modalSourcePath: string | null;
  modalConversationId: string | null;
  modalDraftKey: string;
  modalDraftCategory: string;
  modalDraftDescription: string;
  activeTab: MemoryTabId;
  routeMode: string;
  totalTokenEstimate: number;
  loading: boolean;
  error: string | null;
}

export function renderMemoryToolActions(activeTab: MemoryTabId): string {
  return renderToolToolbar({
    tabsMode: "static",
    tabs: [
      {
        id: "context",
        label: "Context",
        active: activeTab === "context",
        buttonAttrs: {
          "data-memory-action": "tab",
          "data-memory-tab": "context"
        }
      },
      {
        id: "memory",
        label: "Memory",
        active: activeTab === "memory",
        buttonAttrs: {
          "data-memory-action": "tab",
          "data-memory-tab": "memory"
        }
      },
      {
        id: "skills",
        label: "Skills",
        active: activeTab === "skills",
        buttonAttrs: {
          "data-memory-action": "tab",
          "data-memory-tab": "skills"
        }
      },
      {
        id: "tools",
        label: "Tools",
        active: activeTab === "tools",
        buttonAttrs: {
          "data-memory-action": "tab",
          "data-memory-tab": "tools"
        }
      },
      {
        id: "history",
        label: "History",
        active: activeTab === "history",
        buttonAttrs: {
          "data-memory-action": "tab",
          "data-memory-tab": "history"
        }
      }
    ],
    actions: [
      {
        id: "memory-refresh",
        title: "Refresh memory",
        icon: "replace",
        label: "Refresh",
        className: "is-text is-compact",
        buttonAttrs: {
          id: "memoryRefreshBtn"
        }
      },
      {
        id: "memory-add-directive",
        title: "Add directive",
        icon: "plus",
        label: "Add Directive",
        className: "is-text is-compact",
        buttonAttrs: {
          id: "memoryAddDirectiveBtn"
        }
      }
    ]
  });
}

function formatMemoryTimestamp(timestampMs: number): string {
  if (!timestampMs || timestampMs <= 0) return "--";
  const date = new Date(timestampMs);
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yy}/${mm}/${dd} ${hh}:${min}`;
}

function getTypeIcon(type: string): "cpu" | "wrench" | "circle-check-big" | "bot" | "triangle-alert" | "database-zap" {
  switch (type) {
    case "system":
      return "cpu";
    case "tool":
      return "wrench";
    case "fact":
      return "circle-check-big";
    case "personality":
      return "bot";
    case "directive":
      return "triangle-alert";
    case "history-user":
    case "history-assistant":
      return "database-zap";
    case "skill-index":
    case "skill-detail":
      return "bot";
    case "project-instructions":
      return "bot";
    case "custom-context":
      return "cpu";
    case "tool-note":
      return "wrench";
    case "tool-index":
    case "tool-detail":
      return "wrench";
    default:
      return "database-zap";
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case "system":
      return "System";
    case "tool":
      return "Tool";
    case "fact":
      return "Fact";
    case "personality":
      return "Personality";
    case "directive":
      return "Directive";
    case "history-user":
      return "User Msg";
    case "history-assistant":
      return "Assistant Msg";
    case "skill-index":
      return "Skill Index";
    case "skill-detail":
      return "Skill Detail";
    case "project-instructions":
      return "Project";
    case "custom-context":
      return "Context";
    case "tool-note":
      return "Tool Note";
    case "tool-index":
      return "Tool Index";
    case "tool-detail":
      return "Tool Detail";
    default:
      return type;
  }
}

function getLoadMethodLabel(loadMethod: string): string {
  if (loadMethod === "default") return "Default";
  if (loadMethod === "dynamic") return "Dynamic";
  return loadMethod;
}

function getLoadReasonLabel(loadReason: string): string {
  if (loadReason === "always") return "Always";
  if (loadReason === "keyword_match") return "Keyword";
  if (loadReason === "history_match") return "History";
  if (loadReason === "index") return "Index";
  if (loadReason === "on_demand") return "On Demand";
  if (loadReason === "runtime") return "Runtime";
  return loadReason;
}

function isMemoryRowEditable(section: MemoryTabId, category: string, key: string): boolean {
  if (section === "memory") return true;
  if (section === "context" && category === "system" && key === "Base system prompt") return true;
  if (section === "context" && category === "custom-context") return true;
  if (section === "skills") return true;
  if (section === "tools" && category === "tool-note") return true;
  return false;
}

function renderAddNewButton(section: MemoryTabId): string {
  if (section === "history") return "";
  const extras = section === "memory" || section === "skills"
    ? `<button type="button" class="memory-modal-btn is-primary memory-table-add-btn" data-memory-action="import-markdown" data-memory-section="${section}">Import</button>
       <button type="button" class="memory-modal-btn is-primary memory-table-add-btn" data-memory-action="export-markdown" data-memory-section="${section}">Export</button>`
    : "";
  return `<div class="memory-table-add-wrap"><button type="button" class="memory-modal-btn is-primary memory-table-add-btn" data-memory-action="open-create-modal" data-memory-section="${section}">+Add New</button>${extras}</div>`;
}

function renderMemoryModalFields(state: MemoryToolState): string {
  if (state.modalMode !== "create" || !state.modalSection) return "";
  const keyLabel = state.modalSection === "history" ? "Title" : state.modalSection === "skills" ? "Name" : "Key";
  const descriptionField = state.modalSection === "skills"
    ? `<label class="field">
        <span>Description</span>
        <input class="field-input-soft" type="text" data-memory-action="modal-draft-description" value="${escapeHtml(state.modalDraftDescription)}" />
      </label>`
    : "";
  const categoryField = state.modalSection === "memory"
    ? `<label class="field">
        <span>Type</span>
        <select class="field-select" data-memory-action="modal-draft-category">
          <option value="fact" ${state.modalDraftCategory === "fact" ? "selected" : ""}>Fact</option>
          <option value="personality" ${state.modalDraftCategory === "personality" ? "selected" : ""}>Personality</option>
          <option value="directive" ${state.modalDraftCategory === "directive" ? "selected" : ""}>Directive</option>
          <option value="other" ${state.modalDraftCategory === "other" ? "selected" : ""}>Other</option>
        </select>
      </label>`
    : "";
  return `<div class="memory-modal-fields">
    <label class="field">
      <span>${keyLabel}</span>
      <input class="field-input-soft" type="text" data-memory-action="modal-draft-key" value="${escapeHtml(state.modalDraftKey)}" />
    </label>
    ${descriptionField}
    ${categoryField}
  </div>`;
}

function renderBreakdownRows(items: MemoryContextItem[], emptyText: string): string {
  return items.length
    ? items
        .map((item) => {
          const editable = isMemoryRowEditable("context", item.category, item.key);
          return `
            <div class="memory-row" data-memory-action="open-row" data-memory-section="context" data-memory-index="${items.indexOf(item)}" role="button" tabindex="0">
              <div class="memory-col memory-col-type" title="${escapeHtml(item.category)}">
                <span class="memory-type-icon">${iconHtml(getTypeIcon(item.category), { size: 16, tone: "dark" })}</span>
                <span class="memory-type-label">${escapeHtml(getTypeLabel(item.category))}</span>
              </div>
              <div class="memory-col memory-col-key" title="${escapeHtml(item.key)}">
                ${escapeHtml(item.key)}
              </div>
              <div class="memory-col memory-col-load" title="${escapeHtml(item.loadMethod)}">
                ${escapeHtml(getLoadMethodLabel(item.loadMethod))}
              </div>
              <div class="memory-col memory-col-edit">
                ${editable ? iconHtml("edit", { size: 16, tone: "inactive" }) : ""}
              </div>
              <div class="memory-col memory-col-tokens" title="${escapeHtml(`${item.tokenEstimate} tokens / ${item.charCount} chars / ${item.wordCount} words`)}">
                ${escapeHtml(formatCompactNumber(item.tokenEstimate))}
              </div>
              <div class="memory-col memory-col-value" title="${escapeHtml(item.value)}">
                ${escapeHtml(item.value.length > 100 ? item.value.slice(0, 100) + "..." : item.value)}
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="memory-empty">${escapeHtml(emptyText)}</div>`;
}

function renderToolsRows(items: MemoryContextItem[], alwaysLoadToolKeys: string[]): string {
  const alwaysLoad = new Set(alwaysLoadToolKeys);
  return items.length
    ? items
        .map((item) => {
          const toolName = item.key.replace(/^Tool (?:index|schema):\s*/, "");
          const checked = alwaysLoad.has(toolName);
          const canToggle = item.category === "tool-index" || item.category === "tool-detail";
          const editable = isMemoryRowEditable("tools", item.category, item.key);
          return `
            <div class="memory-row memory-row-tools" data-memory-action="open-row" data-memory-section="tools" data-memory-index="${items.indexOf(item)}" role="button" tabindex="0">
              <div class="memory-col memory-col-checkbox">
                <input
                  type="checkbox"
                  class="memory-always-load-checkbox"
                  data-memory-action="toggle-always-load-tool"
                  data-memory-tool-key="${escapeHtml(toolName)}"
                  ${checked ? "checked" : ""}
                  ${canToggle ? "" : "disabled"}
                  title="Always Load"
                  aria-label="Always Load ${escapeHtml(toolName)}"
                />
              </div>
              <div class="memory-col memory-col-type" title="${escapeHtml(item.category)}">
                <span class="memory-type-icon">${iconHtml(getTypeIcon(item.category), { size: 16, tone: "dark" })}</span>
                <span class="memory-type-label">${escapeHtml(getTypeLabel(item.category))}</span>
              </div>
              <div class="memory-col memory-col-key" title="${escapeHtml(item.key)}">
                ${escapeHtml(item.key)}
              </div>
              <div class="memory-col memory-col-load" title="${escapeHtml(item.loadMethod)}">
                ${escapeHtml(getLoadMethodLabel(item.loadMethod))}
              </div>
              <div class="memory-col memory-col-edit">
                ${editable ? iconHtml("edit", { size: 16, tone: "inactive" }) : ""}
              </div>
              <div class="memory-col memory-col-tokens" title="${escapeHtml(`${item.tokenEstimate} tokens / ${item.charCount} chars / ${item.wordCount} words`)}">
                ${escapeHtml(formatCompactNumber(item.tokenEstimate))}
              </div>
              <div class="memory-col memory-col-value" title="${escapeHtml(item.value)}">
                ${escapeHtml(item.value.length > 100 ? item.value.slice(0, 100) + "..." : item.value)}
              </div>
            </div>
          `;
        })
        .join("")
    : '<div class="memory-empty">No tools loaded</div>';
}

function renderSkillsRows(items: MemoryContextItem[], alwaysLoadSkillKeys: string[]): string {
  const alwaysLoad = new Set(alwaysLoadSkillKeys);
  return items.length
    ? items
        .map((item) => {
          const isToggleable = item.category === "skill-detail";
          const skillName = item.key.replace(/^Skill (?:index|detail):\s*/, "");
          const checked = item.category === "skill-index" ? true : alwaysLoad.has(skillName);
          const editable = isMemoryRowEditable("skills", item.category, item.key);
          return `
            <div class="memory-row memory-row-tools" data-memory-action="open-row" data-memory-section="skills" data-memory-index="${items.indexOf(item)}" role="button" tabindex="0">
              <div class="memory-col memory-col-checkbox">
                <input
                  type="checkbox"
                  class="memory-always-load-checkbox"
                  data-memory-action="toggle-always-load-skill"
                  data-memory-skill-key="${escapeHtml(skillName)}"
                  ${checked ? "checked" : ""}
                  ${isToggleable ? "" : "disabled"}
                  title="Always Load"
                  aria-label="Always Load ${escapeHtml(skillName)}"
                />
              </div>
              <div class="memory-col memory-col-type" title="${escapeHtml(item.category)}">
                <span class="memory-type-icon">${iconHtml(getTypeIcon(item.category), { size: 16, tone: "dark" })}</span>
                <span class="memory-type-label">${escapeHtml(getTypeLabel(item.category))}</span>
              </div>
              <div class="memory-col memory-col-key" title="${escapeHtml(item.key)}">
                ${escapeHtml(item.key)}
              </div>
              <div class="memory-col memory-col-load" title="${escapeHtml(item.loadMethod)}">
                ${escapeHtml(getLoadMethodLabel(item.loadMethod))}
              </div>
              <div class="memory-col memory-col-edit">
                ${editable ? iconHtml("edit", { size: 16, tone: "inactive" }) : ""}
              </div>
              <div class="memory-col memory-col-tokens" title="${escapeHtml(`${item.tokenEstimate} tokens / ${item.charCount} chars / ${item.wordCount} words`)}">
                ${escapeHtml(formatCompactNumber(item.tokenEstimate))}
              </div>
              <div class="memory-col memory-col-value" title="${escapeHtml(item.value)}">
                ${escapeHtml(item.value.length > 100 ? item.value.slice(0, 100) + "..." : item.value)}
              </div>
            </div>
          `;
        })
        .join("")
    : '<div class="memory-empty">No skills loaded</div>';
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}

function renderHistoryIndexRow(items: MemoryChatHistoryItem[]): string {
  if (!items.length) return "";
  const value = items
    .slice(0, 10)
    .map((chat) => {
      const updated = formatMemoryTimestamp(chat.updatedAtMs);
      const title = chat.title?.trim() || chat.lastMessagePreview || chat.conversationId;
      const preview = chat.lastMessagePreview || title;
      return `- ${updated} | ${title} | ${chat.messageCount} msgs | ${preview}`;
    })
    .join("\n");
  return `
    <div class="memory-row" data-memory-action="open-history-index" role="button" tabindex="0">
      <div class="memory-col memory-col-type" title="history-index">
        <span class="memory-type-icon">${iconHtml(getTypeIcon("history-assistant"), { size: 16, tone: "dark" })}</span>
        <span class="memory-type-label">History Index</span>
      </div>
      <div class="memory-col memory-col-key" title="History Index">History Index</div>
      <div class="memory-col memory-col-load" title="default">Default</div>
      <div class="memory-col memory-col-edit"></div>
      <div class="memory-col memory-col-tokens" title="${escapeHtml(`${value.length} chars`)}">${escapeHtml(formatCompactNumber(Math.round(value.length / 4)))}</div>
      <div class="memory-col memory-col-value" title="${escapeHtml(value)}">${escapeHtml(value.length > 100 ? value.slice(0, 100) + "..." : value)}</div>
    </div>
  `;
}

function renderMemoryModalEditor(content: string, editable: boolean): string {
  return renderNotepadEditorPane({
    documentId: "memory-modal-editor",
    content,
    lineCount: Math.max(1, content.split("\n").length),
    wrap: false,
    readOnly: !editable,
    loading: false,
    sizeBytes: content.length,
    dataAttrs: {
      action: "data-memory-action",
      document: "data-memory-document"
    }
  }).replace('class="notepad-editor-input"', 'class="notepad-editor-input memory-modal-editor-input" id="memoryModalEditor" wrap="off"');
}

function formatMemoryEditorMeta(value: string): string {
  const lines = value.split("\n").length;
  const chars = value.length;
  return `${lines} line${lines !== 1 ? "s" : ""} · ${formatCompactNumber(chars)} chars`;
}

export function renderMemoryToolBody(state: MemoryToolState): string {
  // Default Context Table
  const contextRows = renderBreakdownRows(state.contextItems, "No context items loaded");
  const skillsRows = renderSkillsRows(state.skillsItems, state.alwaysLoadSkillKeys);
  const toolsRows = renderToolsRows(state.toolsItems, state.alwaysLoadToolKeys);

  // Chat History Table (10 most recent)
  const chatHistoryRows = state.chatHistory.length
    ? state.chatHistory
        .slice(0, 10)
        .map((chat, index) => {
          const updated = formatMemoryTimestamp(chat.updatedAtMs);
          const title = chat.title?.trim() || chat.lastMessagePreview || chat.conversationId;
          const canOpen = !chat.conversationId.startsWith("custom-history:");
          return `
            <div class="memory-row memory-row-chat" data-memory-action="open-row" data-memory-section="history" data-memory-index="${escapeHtml(String(index))}" data-conversation-id="${escapeHtml(chat.conversationId)}" role="button" tabindex="0">
              <div class="memory-col memory-col-time">${escapeHtml(updated)}</div>
              <div class="memory-col memory-col-title" title="${escapeHtml(title)}">
                ${escapeHtml(title.length > 80 ? title.slice(0, 80) + "..." : title)}
              </div>
              <div class="memory-col memory-col-messages">${escapeHtml(String(chat.messageCount))} msgs</div>
              <div class="memory-col memory-col-actions">
                ${canOpen ? `<button type="button" class="tool-action-btn memory-open-btn" data-memory-open-id="${escapeHtml(chat.conversationId)}" title="Open chat">Open</button>` : ""}
              </div>
            </div>
          `;
        })
        .join("")
    : '<div class="memory-empty">No chat history</div>';
  const historyIndexRow = renderHistoryIndexRow(state.chatHistory);

  // Persistent Memory Table
  const persistentRows = state.persistentItems.length
    ? state.persistentItems
        .map((item, index) => {
          return `
            <div class="memory-row memory-row-persistent" data-memory-action="open-row" data-memory-section="memory" data-memory-index="${escapeHtml(String(index))}" data-memory-key="${escapeHtml(item.key)}" role="button" tabindex="0">
              <div class="memory-col memory-col-type" title="${escapeHtml(item.type)}">
                <span class="memory-type-icon">${iconHtml(getTypeIcon(item.type), { size: 16, tone: "dark" })}</span>
                <span class="memory-type-label">${escapeHtml(getTypeLabel(item.type))}</span>
              </div>
              <div class="memory-col memory-col-key" title="${escapeHtml(item.key)}">
                ${escapeHtml(item.key)}
              </div>
              <div class="memory-col memory-col-load" title="${escapeHtml(item.loadMethod)}">
                ${escapeHtml(getLoadMethodLabel(item.loadMethod))}
              </div>
              <div class="memory-col memory-col-why" title="${escapeHtml(item.loadReason)}">
                ${escapeHtml(getLoadReasonLabel(item.loadReason))}
              </div>
              <div class="memory-col memory-col-tokens" title="${escapeHtml(`${item.tokenEstimate} tokens / ${item.charCount} chars / ${item.wordCount} words`)}">
                ${escapeHtml(formatCompactNumber(item.tokenEstimate))}
              </div>
              <div class="memory-col memory-col-value" title="${escapeHtml(item.value)}">
                ${escapeHtml(item.value.length > 100 ? item.value.slice(0, 100) + "..." : item.value)}
              </div>
              <div class="memory-col memory-col-actions">
                <button type="button" class="tool-action-btn memory-edit-btn" data-memory-edit-key="${escapeHtml(item.key)}" title="Edit">
                  ${iconHtml("edit", { size: 16, tone: "dark" })}
                </button>
                <button type="button" class="tool-action-btn memory-delete-btn" data-memory-delete-key="${escapeHtml(item.key)}" title="Delete">
                  ${iconHtml("trash-2", { size: 16, tone: "dark" })}
                </button>
              </div>
            </div>
          `;
        })
        .join("")
    : '<div class="memory-empty">No persistent memory items</div>';

  const loadingOverlay = state.loading
    ? `<div class="memory-loading">Loading memory data...</div>`
    : "";

  const errorMessage = state.error
    ? `<div class="memory-error">${escapeHtml(state.error)}</div>`
    : "";

  const contextSection = `
      <section class="memory-section">
        <h3 class="memory-section-title">Context Breakdown</h3>
        <p class="memory-section-desc">Every prompt component currently assembled for chat, with rough token estimates</p>
        <div class="memory-table">
          <div class="memory-header">
            <span>Type</span>
            <span>Key</span>
            <span>Load</span>
            <span class="memory-col-header-edit">Edit</span>
            <span>Tokens</span>
            <span>Value</span>
          </div>
          ${contextRows}
        </div>
        ${renderAddNewButton("context")}
      </section>`;

  const historySection = `
      <section class="memory-section">
        <h3 class="memory-section-title">Recent Conversations</h3>
        <p class="memory-section-desc">Recent saved conversations for reference and quick inspection</p>
        <div class="memory-table">
          <div class="memory-header">
            <span>Type</span>
            <span>Key</span>
            <span>Load</span>
            <span class="memory-col-header-edit">Edit</span>
            <span>Tokens</span>
            <span>Value</span>
          </div>
          ${historyIndexRow}
        </div>
        <div class="memory-table">
          <div class="memory-header memory-header-chat">
            <span>Date</span>
            <span>Title</span>
            <span>Messages</span>
            <span class="memory-header-actions">Actions</span>
          </div>
          ${chatHistoryRows}
        </div>
        ${renderAddNewButton("history")}
      </section>`;

  const memorySection = `
      <section class="memory-section">
        <h3 class="memory-section-title">Memory Store</h3>
        <p class="memory-section-desc">Stored memory namespaces currently available to the app</p>
        <div class="memory-table">
          <div class="memory-header memory-header-persistent">
            <span>Type</span>
            <span>Key</span>
            <span>Load</span>
            <span class="memory-col-header-edit">Edit</span>
            <span>Tokens</span>
            <span>Value</span>
            <span class="memory-header-actions">Actions</span>
          </div>
          ${persistentRows}
        </div>
        ${renderAddNewButton("memory")}
      </section>`;

  const skillsSection = `
      <section class="memory-section">
        <h3 class="memory-section-title">Skills</h3>
        <p class="memory-section-desc">Default skill index plus dynamic full skill content estimates</p>
        <div class="memory-table">
          <div class="memory-header memory-header-tools">
            <span>Always</span>
            <span>Type</span>
            <span>Key</span>
            <span>Load</span>
            <span class="memory-col-header-edit">Edit</span>
            <span>Tokens</span>
            <span>Value</span>
          </div>
          ${skillsRows}
        </div>
        ${renderAddNewButton("skills")}
      </section>`;

  const toolsSection = `
      <section class="memory-section">
        <h3 class="memory-section-title">Tools</h3>
        <p class="memory-section-desc">Compact tool index plus full tool schema payload currently sent to the model</p>
        <div class="memory-table">
          <div class="memory-header memory-header-tools">
            <span>Always</span>
            <span>Type</span>
            <span>Key</span>
            <span>Load</span>
            <span class="memory-col-header-edit">Edit</span>
            <span>Tokens</span>
            <span>Value</span>
          </div>
          ${toolsRows}
        </div>
        ${renderAddNewButton("tools")}
      </section>`;

  const activeSection =
    state.activeTab === "history"
      ? historySection
      : state.activeTab === "memory"
        ? memorySection
        : state.activeTab === "skills"
          ? skillsSection
          : state.activeTab === "tools"
            ? toolsSection
        : contextSection;

  const modal = state.modalOpen
    ? `<div class="memory-modal-backdrop">
        <div class="memory-modal-box">
          <div class="memory-modal-header">
            <div class="memory-modal-header-info">
              <h3 class="memory-modal-heading">${escapeHtml(state.modalTitle)}</h3>
              <span class="memory-modal-meta">${formatMemoryEditorMeta(state.modalValue)}</span>
            </div>
            <button type="button" class="memory-modal-close-btn" data-memory-action="close-modal" title="Close">${iconHtml("circle-x", { size: 16, tone: "inactive" })}</button>
          </div>
          ${renderMemoryModalFields(state)}
          ${renderMemoryModalEditor(state.modalValue, state.modalEditable)}
          <div class="memory-modal-footer">
            ${state.modalConversationId ? `<button type="button" class="memory-modal-btn" data-memory-action="open-conversation" data-memory-conversation-id="${escapeHtml(state.modalConversationId)}">Open Chat</button>` : ""}
            ${state.modalEditable && (state.modalTarget === "memory" || state.modalTarget === "custom-item") && state.modalNamespace ? `<button type="button" class="memory-modal-btn is-danger" data-memory-action="delete-modal-memory">Delete</button>` : ""}
            <span class="memory-modal-spacer"></span>
            <button type="button" class="memory-modal-btn" data-memory-action="close-modal">${state.modalEditable ? "Cancel" : "Close"}</button>
            ${state.modalEditable ? `<button type="button" class="memory-modal-btn is-primary" data-memory-action="save-modal-memory">Save and Close</button>` : ""}
          </div>
        </div>
      </div>`
    : "";

  return `
    <div class="memory-tool-body">
      ${loadingOverlay}
      ${errorMessage}

      <section class="memory-summary">
        <div class="memory-summary-card">
          <span class="memory-summary-label">Route</span>
          <strong class="memory-summary-value">${escapeHtml(state.routeMode || "--")}</strong>
        </div>
        <div class="memory-summary-card">
          <span class="memory-summary-label">Estimated Input Tokens</span>
          <strong class="memory-summary-value">${escapeHtml(formatCompactNumber(state.totalTokenEstimate))}</strong>
        </div>
        <div class="memory-summary-card">
          <span class="memory-summary-label">Visible Context Items</span>
          <strong class="memory-summary-value">${escapeHtml(
            formatCompactNumber(
              state.activeTab === "history"
                ? state.chatHistory.length
                : state.activeTab === "memory"
                  ? state.persistentItems.length
                  : state.activeTab === "skills"
                    ? state.skillsItems.length
                    : state.activeTab === "tools"
                      ? state.toolsItems.length
                      : state.contextItems.length
            )
          )}</strong>
        </div>
      </section>

      ${activeSection}
      ${modal}
    </div>
  `;
}

export function MemoryTool() {
  return (
    <div className="tool-placeholder">
      <h2>Memory</h2>
      <p>Persistent context and memory references</p>
      <div className="tool-placeholder-message">This tool is not yet implemented.</div>
    </div>
  );
}
