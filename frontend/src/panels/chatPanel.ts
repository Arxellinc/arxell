import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

export function renderChatActions(state: PrimaryPanelRenderState): string {
  return `
    <div class="chat-actions">
      <button type="button" class="topbar-icon-btn" id="chatNewBtn" aria-label="New chat" data-title="New Chat" title="New Chat">${iconHtml(APP_ICON.action.chatNew, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn" id="chatClearBtn" aria-label="Clear chat" data-title="Clear Chat" title="Clear Chat">${iconHtml(APP_ICON.action.chatClear, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn chat-thinking-btn ${state.chatThinkingEnabled ? "is-active" : ""}" id="chatThinkingToggleBtn" aria-label="Toggle thinking mode" data-title="${state.chatThinkingEnabled ? "Disable Thinking" : "Enable Thinking"}" title="${state.chatThinkingEnabled ? "Disable Thinking" : "Enable Thinking"}">${iconHtml(APP_ICON.action.chatThinking, { size: 16, tone: "dark" })}</button>
    </div>
  `;
}

export function renderChatBody(state: PrimaryPanelRenderState): string {
  const messagesHtml = state.messages
    .map(
      (m) => {
        const correlationId = m.role === "assistant" ? m.correlationId : undefined;
        const thinkingText = correlationId
          ? (state.chatReasoningByCorrelation[correlationId] ?? "").trim()
          : "";
        const expanded = correlationId
          ? state.chatThinkingExpandedByCorrelation[correlationId] === true
          : false;
        const placement = correlationId
          ? state.chatThinkingPlacementByCorrelation[correlationId] ?? "after"
          : "after";
        const thinkingHtml =
          correlationId && thinkingText
            ? `<section class="message-thinking ${expanded ? "is-open" : ""}" data-thinking-corr="${escapeHtml(correlationId)}">
                <button type="button" class="message-thinking-toggle" data-thinking-toggle-corr="${escapeHtml(correlationId)}" aria-expanded="${expanded ? "true" : "false"}" title="${expanded ? "Collapse thinking" : "Expand thinking"}">
                  <span class="message-thinking-label">Thinking...</span>
                  <span class="message-thinking-icon" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
                </button>
                ${expanded ? `<div class="message-thinking-body">${escapeHtml(thinkingText)}</div>` : ""}
              </section>`
            : "";
        const contentHtml =
          placement === "before"
            ? `${thinkingHtml}<div class="message-text">${escapeHtml(m.text)}</div>`
            : `<div class="message-text">${escapeHtml(m.text)}</div>${thinkingHtml}`;
        return `<div class="message ${m.role}">
          ${contentHtml}
        </div>`;
      }
    )
    .join("");

  return `
    <div class="messages">${messagesHtml || '<div class="message assistant is-placeholder"><div class="message-text">Ready.</div></div>'}</div>
    <form class="composer" id="composer">
      <textarea id="msg" rows="3" placeholder="Send a message"></textarea>
      <button type="button" class="send-icon-btn" id="chatSubmitBtn" aria-label="${state.chatStreaming ? "Stop response" : "Send message"}" title="${state.chatStreaming ? "Stop response" : "Send message"}">
        ${state.chatStreaming ? "◼" : "▶"}
      </button>
    </form>
  `;
}

export function bindChatPanel(
  onSendMessage: (text: string) => Promise<void>,
  onToggleThinkingPanel: (correlationId: string) => Promise<void>,
  onStopCurrentResponse: () => Promise<void>,
  chatStreaming: boolean
): void {
  const form = document.querySelector<HTMLFormElement>("#composer");
  const input = document.querySelector<HTMLTextAreaElement>("#msg");
  if (!form || !input) return;

  const submitCurrentInput = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await onSendMessage(text);
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (chatStreaming) {
      await onStopCurrentResponse();
      return;
    }
    await submitCurrentInput();
  };

  input.onkeydown = async (ev) => {
    if (ev.key !== "Enter" || ev.shiftKey) return;
    ev.preventDefault();
    if (chatStreaming) {
      await onStopCurrentResponse();
      return;
    }
    await submitCurrentInput();
  };

  const submitBtn = document.querySelector<HTMLButtonElement>("#chatSubmitBtn");
  if (submitBtn) {
    submitBtn.onclick = async () => {
      if (chatStreaming) {
        await onStopCurrentResponse();
        return;
      }
      await submitCurrentInput();
    };
  }

  const thinkingToggles = document.querySelectorAll<HTMLButtonElement>("[data-thinking-toggle-corr]");
  thinkingToggles.forEach((button) => {
    button.onclick = async () => {
      const correlationId = button.dataset.thinkingToggleCorr;
      if (!correlationId) return;
      await onToggleThinkingPanel(correlationId);
    };
  });
}
