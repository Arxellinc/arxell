/**
 * Memory Tool
 *
 * Persistent context and memory references
 */
import { iconHtml } from "../../icons";
import { escapeHtml } from "../../panels/utils";
import "./styles.css";

export interface MemoryContextItem {
  key: string;
  value: string;
  category: string;
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
}

export interface MemoryToolState {
  contextItems: MemoryContextItem[];
  chatHistory: MemoryChatHistoryItem[];
  persistentItems: MemoryPersistentItem[];
  loading: boolean;
  error: string | null;
}

export function renderMemoryToolActions(): string {
  return `
    <div class="llama-actions">
      <button type="button" class="tool-action-btn" id="memoryRefreshBtn" title="Refresh memory">
        <span class="memory-action-icon">${iconHtml("replace", { size: 16, tone: "dark" })}</span>
        Refresh
      </button>
      <button type="button" class="tool-action-btn" id="memoryAddDirectiveBtn" title="Add directive">
        <span class="memory-action-icon">${iconHtml("plus", { size: 16, tone: "dark" })}</span>
        Add Directive
      </button>
    </div>
  `;
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
    default:
      return type;
  }
}

export function renderMemoryToolBody(state: MemoryToolState): string {
  // Default Context Table
  const contextRows = state.contextItems.length
    ? state.contextItems
        .map((item) => {
          return `
            <div class="memory-row">
              <div class="memory-col memory-col-type" title="${escapeHtml(item.category)}">
                <span class="memory-type-icon">${iconHtml(getTypeIcon(item.category), { size: 16, tone: "dark" })}</span>
                <span class="memory-type-label">${escapeHtml(getTypeLabel(item.category))}</span>
              </div>
              <div class="memory-col memory-col-key" title="${escapeHtml(item.key)}">
                ${escapeHtml(item.key)}
              </div>
              <div class="memory-col memory-col-value" title="${escapeHtml(item.value)}">
                ${escapeHtml(item.value.length > 100 ? item.value.slice(0, 100) + "..." : item.value)}
              </div>
            </div>
          `;
        })
        .join("")
    : '<div class="memory-empty">No context items loaded</div>';

  // Chat History Table (10 most recent)
  const chatHistoryRows = state.chatHistory.length
    ? state.chatHistory
        .slice(0, 10)
        .map((chat) => {
          const updated = formatMemoryTimestamp(chat.updatedAtMs);
          const title = chat.title?.trim() || chat.lastMessagePreview || chat.conversationId;
          return `
            <div class="memory-row memory-row-chat" data-conversation-id="${escapeHtml(chat.conversationId)}" role="button" tabindex="0">
              <div class="memory-col memory-col-time">${escapeHtml(updated)}</div>
              <div class="memory-col memory-col-title" title="${escapeHtml(title)}">
                ${escapeHtml(title.length > 80 ? title.slice(0, 80) + "..." : title)}
              </div>
              <div class="memory-col memory-col-messages">${escapeHtml(String(chat.messageCount))} msgs</div>
              <div class="memory-col memory-col-actions">
                <button type="button" class="tool-action-btn memory-open-btn" data-memory-open-id="${escapeHtml(chat.conversationId)}" title="Open chat">Open</button>
              </div>
            </div>
          `;
        })
        .join("")
    : '<div class="memory-empty">No chat history</div>';

  // Persistent Memory Table
  const persistentRows = state.persistentItems.length
    ? state.persistentItems
        .map((item) => {
          return `
            <div class="memory-row memory-row-persistent" data-memory-key="${escapeHtml(item.key)}">
              <div class="memory-col memory-col-type" title="${escapeHtml(item.type)}">
                <span class="memory-type-icon">${iconHtml(getTypeIcon(item.type), { size: 16, tone: "dark" })}</span>
                <span class="memory-type-label">${escapeHtml(getTypeLabel(item.type))}</span>
              </div>
              <div class="memory-col memory-col-key" title="${escapeHtml(item.key)}">
                ${escapeHtml(item.key)}
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

  return `
    <div class="memory-tool-body">
      ${loadingOverlay}
      ${errorMessage}

      <!-- Section 1: Default Context -->
      <section class="memory-section">
        <h3 class="memory-section-title">Default Context</h3>
        <p class="memory-section-desc">System prompt, tool awareness, and other context fed to the AI by default</p>
        <div class="memory-table">
          <div class="memory-header">
            <span>Type</span>
            <span>Key</span>
            <span>Value</span>
          </div>
          ${contextRows}
        </div>
      </section>

      <!-- Section 2: Chat History -->
      <section class="memory-section">
        <h3 class="memory-section-title">Chat History</h3>
        <p class="memory-section-desc">10 most recent conversations with summaries</p>
        <div class="memory-table">
          <div class="memory-header memory-header-chat">
            <span>Date</span>
            <span>Title</span>
            <span>Messages</span>
            <span class="memory-header-actions">Actions</span>
          </div>
          ${chatHistoryRows}
        </div>
      </section>

      <!-- Section 3: Persistent Memory -->
      <section class="memory-section">
        <h3 class="memory-section-title">Persistent Memory</h3>
        <p class="memory-section-desc">User facts, personality traits, prime directives, and other stored information</p>
        <div class="memory-table">
          <div class="memory-header memory-header-persistent">
            <span>Type</span>
            <span>Key</span>
            <span>Value</span>
            <span class="memory-header-actions">Actions</span>
          </div>
          ${persistentRows}
        </div>
      </section>
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
