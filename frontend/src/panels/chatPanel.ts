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
    </div>
  `;
}

export function renderChatBody(state: PrimaryPanelRenderState): string {
  const isListening = state.stt?.isListening ?? false;
  const isSpeaking = state.stt?.isSpeaking ?? false;
  const attachedFileName = state.chatAttachedFileName?.trim() ?? "";
  const hasAttachedFile = attachedFileName.length > 0;
  return `
    <div class="messages">${renderChatMessages(state)}</div>
    <form class="composer" id="composer">
      <div class="composer-attachment-meta" id="chatAttachmentMeta" ${hasAttachedFile ? "" : "hidden"}>
        <span class="composer-attachment-icon" aria-hidden="true">${iconHtml("file-badge", { size: 16, tone: "dark" })}</span>
        <span class="composer-attachment-name" id="chatAttachmentName">${hasAttachedFile ? escapeHtml(attachedFileName) : ""}</span>
      </div>
      <textarea id="msg" rows="3" placeholder="Send a message">${escapeHtml(state.chatDraft)}</textarea>
      <div class="composer-actions">
        <button
          type="button"
          class="thinking-toggle-btn ${state.chatThinkingEnabled ? "is-active" : ""}"
          id="chatThinkingToggleBtn"
          aria-label="${state.chatThinkingEnabled ? "Disable Thinking" : "Enable Thinking"}"
          title="${state.chatThinkingEnabled ? "Disable Thinking" : "Enable Thinking"}"
        >
          <span class="thinking-toggle-glyph" aria-hidden="true">${iconHtml(APP_ICON.action.chatThinking, { size: 16, tone: "dark" })}</span>
          <span class="thinking-toggle-label">${state.chatThinkingEnabled ? "Thinking" : "No Thinking"}</span>
        </button>
        <button type="button" class="attach-icon-btn" id="chatAttachBtn" aria-label="Attach document" title="Attach document">
          <span class="attach-icon-glyph" aria-hidden="true">${iconHtml("file-plus", { size: 16, tone: "dark" })}</span>
          <span class="attach-icon-label">+attach</span>
        </button>
        <button type="button" class="mic-icon-btn ${isListening ? "is-active" : ""}" id="chatMicBtn" aria-label="${isListening ? "Stop voice input" : "Start voice input"}" title="${isListening ? "Stop voice input" : "Start voice input"}">
          <span class="mic-icon-glyph" aria-hidden="true">${iconHtml(isSpeaking ? APP_ICON.sidebar.sttSpeaking : APP_ICON.sidebar.stt, { size: 16, tone: "dark" })}</span>
          <span class="mic-icon-label">voice</span>
        </button>
        <button type="button" class="send-icon-btn" id="chatSubmitBtn" aria-label="${state.chatStreaming ? "Stop response" : "Send message"}" title="${state.chatStreaming ? "Stop response" : "Send message"}">
          <span class="send-icon-glyph ${state.chatStreaming ? "is-stop" : "is-play"}" aria-hidden="true">${state.chatStreaming ? "◼" : "▶"}</span>
        </button>
      </div>
      <input type="file" id="chatAttachInput" hidden />
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
        const toolRows = correlationId
          ? (state.chatToolRowsByCorrelation[correlationId] ?? [])
          : [];
        const streamComplete = correlationId
          ? state.chatStreamCompleteByCorrelation[correlationId] === true
          : true;
        const hasToolRows = toolRows.length > 0;
        const showAssistantText = !(hasToolRows && !streamComplete);
        const toolRowsHtml = hasToolRows
          ? `<section class="message-tool-rows">
              ${toolRows
                .map((row) => {
                  const expanded = state.chatToolRowExpandedById[row.rowId] === true;
                  const chevron = expanded ? "▾" : "▸";
                  return `<article class="message-tool-row ${expanded ? "is-open" : ""}">
                    <button type="button" class="message-tool-row-toggle" data-tool-row-toggle-id="${escapeHtml(row.rowId)}" aria-expanded="${expanded ? "true" : "false"}" title="${expanded ? "Collapse details" : "Expand details"}">
                      <span class="message-tool-row-left">
                        <span class="message-tool-row-icon">${iconHtml(row.icon, { size: 16, tone: "dark" })}</span>
                        <span class="message-tool-row-title">${escapeHtml(row.title)}</span>
                      </span>
                      <span class="message-tool-row-chevron" aria-hidden="true">${chevron}</span>
                    </button>
                    ${expanded ? `<div class="message-tool-row-details">${escapeHtml(row.details)}</div>` : ""}
                  </article>`;
                })
                .join("")}
            </section>`
          : "";
        const textHtml = showAssistantText
          ? `<div class="message-text">${escapeHtml(m.text)}</div>`
          : `<div class="message-text message-text-pending">Running tools...</div>`;
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
            ? `${toolRowsHtml}${thinkingHtml}${textHtml}`
            : `${toolRowsHtml}${textHtml}${thinkingHtml}`;
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
  onSetChatAttachment: (fileName: string, content: string) => void,
  onClearChatAttachment: () => void,
  onStopCurrentResponse: () => Promise<void>,
  onToggleStt: () => Promise<void>,
  chatStreaming: boolean,
  initialAttachment: { name: string; content: string } | null
): void {
  const form = document.querySelector<HTMLFormElement>("#composer");
  const input = document.querySelector<HTMLTextAreaElement>("#msg");
  const attachBtn = document.querySelector<HTMLButtonElement>("#chatAttachBtn");
  const attachInput = document.querySelector<HTMLInputElement>("#chatAttachInput");
  const attachmentMeta = document.querySelector<HTMLDivElement>("#chatAttachmentMeta");
  const attachmentName = document.querySelector<HTMLSpanElement>("#chatAttachmentName");
  if (!form || !input) return;
  const MAX_ATTACHMENT_CHARS = 12000;
  let attachedFile: { name: string; content: string } | null = initialAttachment;

  const updateAttachmentUi = () => {
    if (!attachmentMeta || !attachmentName) return;
    if (!attachedFile) {
      attachmentMeta.hidden = true;
      attachmentName.textContent = "";
      return;
    }
    attachmentMeta.hidden = false;
    attachmentName.textContent = attachedFile.name;
  };

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
    const promptText = input.value.trim();
    if (!promptText && !attachedFile) return;
    const text = attachedFile
      ? [
          promptText,
          `[Attached file: ${attachedFile.name}]`,
          attachedFile.content
        ]
          .filter((part) => part.trim().length > 0)
          .join("\n\n")
      : promptText;
    input.value = "";
    onUpdateChatDraft("");
    await onSendMessage(text);
    attachedFile = null;
    onClearChatAttachment();
    if (attachInput) attachInput.value = "";
    updateAttachmentUi();
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

  if (attachBtn && attachInput) {
    attachBtn.onclick = () => {
      attachInput.click();
    };
    attachInput.onchange = async () => {
      const file = attachInput.files?.[0];
      if (!file) return;
      const lowerName = file.name.toLowerCase();
      const isTextLike =
        file.type.startsWith("text/") ||
        /\.(txt|md|markdown|json|csv|xml|yaml|yml|toml|ini|log|js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|hpp|css|html)$/i.test(
          lowerName
        );
      if (!isTextLike) {
        attachedFile = {
          name: file.name,
          content: `[Non-text attachment selected. Filename: ${file.name}]`
        };
        onSetChatAttachment(attachedFile.name, attachedFile.content);
        updateAttachmentUi();
        return;
      }
      let text = await file.text();
      if (text.length > MAX_ATTACHMENT_CHARS) {
        text = `${text.slice(0, MAX_ATTACHMENT_CHARS)}\n\n[Attachment truncated to ${MAX_ATTACHMENT_CHARS} characters.]`;
      }
      attachedFile = { name: file.name, content: text };
      onSetChatAttachment(attachedFile.name, attachedFile.content);
      updateAttachmentUi();
    };
  }

  updateAttachmentUi();

}
