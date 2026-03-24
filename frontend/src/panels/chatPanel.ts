import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

export function renderChatActions(): string {
  return `<button type="button" class="topbar-icon-btn" aria-label="New chat">${iconHtml(APP_ICON.action.chatNew, { size: 16, tone: "dark" })}</button>`;
}

export function renderChatBody(state: PrimaryPanelRenderState): string {
  const messagesHtml = state.messages
    .map(
      (m) =>
        `<div class="message ${m.role}"><strong>${m.role}</strong><div>${escapeHtml(m.text)}</div></div>`
    )
    .join("");

  return `
    <div class="messages">${messagesHtml || '<div class="message assistant">Ready.</div>'}</div>
    <form class="composer" id="composer">
      <textarea id="msg" rows="3" placeholder="Send a message"></textarea>
      <button type="submit" class="send-icon-btn" aria-label="Send message">
        ${iconHtml(APP_ICON.action.chatSend, { size: 16, tone: "light" })}
      </button>
    </form>
  `;
}

export function bindChatPanel(onSendMessage: (text: string) => Promise<void>): void {
  const form = document.querySelector<HTMLFormElement>("#composer");
  const input = document.querySelector<HTMLTextAreaElement>("#msg");
  if (!form || !input) return;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await onSendMessage(text);
  };
}
