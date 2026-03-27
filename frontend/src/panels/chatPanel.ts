import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

export function renderChatActions(state: PrimaryPanelRenderState): string {
  const sttRunning = state.stt?.status === "running" || state.stt?.status === "starting";
  return `
    <div class="chat-actions">
      <button type="button" class="topbar-icon-btn" id="chatNewBtn" aria-label="New chat" data-title="New Chat" title="New Chat">${iconHtml(APP_ICON.action.chatNew, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn" id="chatClearBtn" aria-label="Clear chat" data-title="Clear Chat" title="Clear Chat">${iconHtml(APP_ICON.action.chatClear, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn chat-stt-btn ${sttRunning ? "is-active" : ""}" id="chatSttBtn" aria-label="${sttRunning ? "Stop Speech-to-Text" : "Start Speech-to-Text"}" data-title="${sttRunning ? "Stop STT" : "Start STT"}" title="${sttRunning ? "Stop Speech-to-Text" : "Start Speech-to-Text"}">${iconHtml(APP_ICON.sidebar.stt, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn chat-tts-btn" id="chatTtsBtn" aria-label="Text-to-Speech (not available)" data-title="TTS (coming soon)" title="Text-to-Speech (coming soon)">${iconHtml(APP_ICON.sidebar.tts, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn chat-thinking-btn ${state.chatThinkingEnabled ? "is-active" : ""}" id="chatThinkingToggleBtn" aria-label="Toggle thinking mode" data-title="${state.chatThinkingEnabled ? "Disable Thinking" : "Enable Thinking"}" title="${state.chatThinkingEnabled ? "Disable Thinking" : "Enable Thinking"}">${iconHtml(APP_ICON.action.chatThinking, { size: 16, tone: "dark" })}</button>
    </div>
  `;
}

export function renderChatBody(state: PrimaryPanelRenderState): string {
  const isListening = state.stt?.isListening ?? false;
  const isSpeaking = state.stt?.isSpeaking ?? false;
  return `
    <div class="messages">${renderChatMessages(state)}</div>
    <form class="composer" id="composer">
      <textarea id="msg" rows="3" placeholder="Send a message">${escapeHtml(state.chatDraft)}</textarea>
      <div class="composer-actions">
        <button type="button" class="mic-icon-btn ${isListening ? "is-active" : ""}" id="chatMicBtn" aria-label="${isListening ? "Stop voice input" : "Start voice input"}" title="${isListening ? "Stop voice input" : "Start voice input"}">
          <span class="mic-icon-glyph" aria-hidden="true">${iconHtml(isSpeaking ? APP_ICON.sidebar.sttSpeaking : APP_ICON.sidebar.stt, { size: 16, tone: "dark" })}</span>
        </button>
        <button type="button" class="send-icon-btn" id="chatSubmitBtn" aria-label="${state.chatStreaming ? "Stop response" : "Send message"}" title="${state.chatStreaming ? "Stop response" : "Send message"}">
          <span class="send-icon-glyph ${state.chatStreaming ? "is-stop" : "is-play"}" aria-hidden="true">${state.chatStreaming ? "◼" : "▶"}</span>
        </button>
      </div>
    </form>
  `;
}

export function renderChatMessages(state: PrimaryPanelRenderState): string {
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

  return messagesHtml || '<div class="message assistant is-placeholder"><div class="message-text">Ready.</div></div>';
}

export function bindChatPanel(
  onSendMessage: (text: string) => Promise<void>,
  onUpdateChatDraft: (text: string) => void,
  onStopCurrentResponse: () => Promise<void>,
  onToggleStt: () => Promise<void>,
  chatStreaming: boolean
): void {
  const form = document.querySelector<HTMLFormElement>("#composer");
  const input = document.querySelector<HTMLTextAreaElement>("#msg");
  if (!form || !input) return;

  const refocusInput = () => {
    requestAnimationFrame(() => {
      const nextInput = document.querySelector<HTMLTextAreaElement>("#msg");
      if (!nextInput) return;
      nextInput.focus();
      const caret = nextInput.value.length;
      nextInput.setSelectionRange(caret, caret);
    });
  };

  const submitCurrentInput = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    onUpdateChatDraft("");
    await onSendMessage(text);
    refocusInput();
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (chatStreaming) {
      await onStopCurrentResponse();
      refocusInput();
      return;
    }
    await submitCurrentInput();
  };

  input.oninput = () => {
    onUpdateChatDraft(input.value);
  };

  input.onkeydown = async (ev) => {
    if (ev.key !== "Enter" || ev.shiftKey) return;
    ev.preventDefault();
    if (chatStreaming) {
      await onStopCurrentResponse();
      refocusInput();
      return;
    }
    await submitCurrentInput();
  };

  const submitBtn = document.querySelector<HTMLButtonElement>("#chatSubmitBtn");
  if (submitBtn) {
    submitBtn.onclick = async () => {
      if (chatStreaming) {
        await onStopCurrentResponse();
        refocusInput();
        return;
      }
      await submitCurrentInput();
    };
  }

  const micBtn = document.querySelector<HTMLButtonElement>("#chatMicBtn");
  if (micBtn) {
    micBtn.onclick = async () => {
      await onToggleStt();
    };
  }

}
