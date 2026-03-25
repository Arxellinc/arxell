import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

function formatHistoryTimestamp(timestampMs: number): string {
  if (!timestampMs || timestampMs <= 0) return "--";
  const date = new Date(timestampMs);
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yy}/${mm}/${dd} ${hh}:${min}`;
}

export function renderHistoryActions(): string {
  return `<button type="button" class="topbar-icon-btn" id="newConversationBtn" aria-label="New conversation">${iconHtml(APP_ICON.action.chatNew, { size: 16, tone: "dark" })}</button>`;
}

export function renderHistoryBody(state: PrimaryPanelRenderState): string {
  const body =
    state.conversations
      .map((c) => {
        const active = c.conversationId === state.conversationId ? " is-active" : "";
        const updated = formatHistoryTimestamp(c.updatedAtMs);
        const title = c.title?.trim() || c.lastMessagePreview || c.conversationId;
        return `<div class="history-row${active}" data-conversation-id="${escapeHtml(c.conversationId)}" role="button" tabindex="0">
          <span class="history-row-time">${escapeHtml(updated)}</span>
          <span class="history-row-title">${escapeHtml(title)}</span>
          <span class="history-row-actions">
            <button type="button" class="tool-action-btn history-open-btn" data-history-open-id="${escapeHtml(c.conversationId)}">Open</button>
            <button type="button" class="tool-action-btn history-save-btn" data-history-save-id="${escapeHtml(c.conversationId)}">Save</button>
            <button type="button" class="tool-action-btn history-delete-btn" data-history-delete-id="${escapeHtml(c.conversationId)}">Delete</button>
          </span>
        </div>`;
      })
      .join("") || '<div class="history-empty">No conversations</div>';

  return `<div class="history-list primary-pane-body">${body}</div>`;
}

export function bindHistoryPanel(
  onCreateConversation: () => Promise<void>,
  onSelectConversation: (conversationId: string) => Promise<void>,
  onExportConversation: (conversationId: string) => Promise<void>,
  onDeleteConversation: (conversationId: string) => Promise<void>
): void {
  const newConversationBtn = document.querySelector<HTMLButtonElement>("#newConversationBtn");
  const historyItems = document.querySelectorAll<HTMLElement>("[data-conversation-id]");
  const openButtons = document.querySelectorAll<HTMLButtonElement>("[data-history-open-id]");
  const saveButtons = document.querySelectorAll<HTMLButtonElement>("[data-history-save-id]");
  const deleteButtons = document.querySelectorAll<HTMLButtonElement>("[data-history-delete-id]");

  if (newConversationBtn) {
    newConversationBtn.onclick = async () => {
      await onCreateConversation();
    };
  }

  historyItems.forEach((item) => {
    item.onclick = async () => {
      const id = item.dataset.conversationId;
      if (!id) return;
      await onSelectConversation(id);
    };
    item.onkeydown = async (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const id = item.dataset.conversationId;
      if (!id) return;
      await onSelectConversation(id);
    };
  });

  openButtons.forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.historyOpenId;
      if (!id) return;
      await onSelectConversation(id);
    };
  });

  saveButtons.forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.historySaveId;
      if (!id) return;
      await onExportConversation(id);
    };
  });

  deleteButtons.forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.historyDeleteId;
      if (!id) return;
      await onDeleteConversation(id);
    };
  });
}
