import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

export function renderHistoryActions(): string {
  return `<button type="button" class="topbar-icon-btn" id="newConversationBtn" aria-label="New conversation">${iconHtml(APP_ICON.action.chatNew, { size: 16, tone: "dark" })}</button>`;
}

export function renderHistoryBody(state: PrimaryPanelRenderState): string {
  const body =
    state.conversations
      .map((c) => {
        const active = c.conversationId === state.conversationId ? " is-active" : "";
        const updated = c.updatedAtMs > 0 ? new Date(c.updatedAtMs).toLocaleString() : "";
        return `<button type="button" class="history-item${active}" data-conversation-id="${escapeHtml(c.conversationId)}">
          <div class="history-id">${escapeHtml(c.conversationId)}</div>
          <div class="history-preview">${escapeHtml(c.lastMessagePreview || "No preview")}</div>
          <div class="history-meta">${c.messageCount} msgs ${updated ? `• ${escapeHtml(updated)}` : ""}</div>
        </button>`;
      })
      .join("") || '<div class="history-empty">No conversations</div>';

  return `<div class="history-list primary-pane-body">${body}</div>`;
}

export function bindHistoryPanel(
  onCreateConversation: () => Promise<void>,
  onSelectConversation: (conversationId: string) => Promise<void>
): void {
  const newConversationBtn = document.querySelector<HTMLButtonElement>("#newConversationBtn");
  const historyItems = document.querySelectorAll<HTMLButtonElement>("[data-conversation-id]");

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
  });
}
