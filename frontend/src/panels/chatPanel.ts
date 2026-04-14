import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { ChatAttachment } from "../contracts";
import type { PrimaryPanelRenderState } from "./types";
import type { ChatModelCapabilities } from "../modelCapabilities";
import { escapeHtml } from "./utils";

interface ParsedAttachmentMessage {
  displayText: string;
  attachment: {
    fileName: string;
    content: string;
  } | null;
}

function parseAttachmentMessage(raw: string): ParsedAttachmentMessage {
  const pattern = /(?:^|\n\n)\[Attached file:\s*([^\]\n]+)\]\n\n([\s\S]*)$/;
  const match = raw.match(pattern);
  if (!match) {
    return { displayText: raw, attachment: null };
  }
  const fullMatch = match[0] ?? "";
  const fileName = (match[1] ?? "").trim();
  const content = (match[2] ?? "").trim();
  const before = raw.slice(0, raw.length - fullMatch.length).trim();
  return {
    displayText: before,
    attachment: fileName
      ? {
          fileName,
          content
        }
      : null
  };
}

export function renderChatActions(state: PrimaryPanelRenderState): string {
  const sttRunning = state.stt?.status === "running" || state.stt?.status === "starting";
  const ttsActive = state.chatTtsEnabled;
  const voiceModeActive = sttRunning && ttsActive;
  return `
    <div class="chat-actions">
      <button type="button" class="topbar-icon-btn" id="chatNewBtn" aria-label="New chat" data-title="New Chat" title="New Chat">${iconHtml(APP_ICON.action.chatNew, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn" id="chatClearBtn" aria-label="Clear chat" data-title="Clear Chat" title="Clear Chat">${iconHtml(APP_ICON.action.chatClear, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn chat-speech-btn ${voiceModeActive ? "is-active" : ""}" id="chatSpeechBtn" aria-label="${voiceModeActive ? "Disable voice mode" : "Enable voice mode"}" data-title="${voiceModeActive ? "Voice Mode On" : "Voice Mode Off"}" title="${voiceModeActive ? "Disable voice mode (STT + TTS)" : "Enable voice mode (STT + TTS)"}">${iconHtml("speech", { size: 16, tone: "dark" })}</button>
    </div>
  `;
}

export function renderChatBody(state: PrimaryPanelRenderState): string {
  const isListening = state.stt?.isListening ?? false;
  const isSpeaking = state.stt?.isSpeaking ?? false;
  const attachedFileName = state.chatAttachedFileName?.trim() ?? "";
  const hasAttachedFile = attachedFileName.length > 0;
  const caps = state.chatActiveModelCapabilities;
  const canStopActiveOutput = state.chatStreaming || state.chatTtsPlaying;
  const capabilitySummary = [
    caps.text ? "text" : null,
    caps.imageUnderstanding ? "image" : null,
    caps.audioUnderstanding ? "audio" : null,
    caps.toolUse ? "tools" : null,
    caps.reasoningControl ? "reasoning" : null
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return `
    <div class="messages">${renderChatMessages(state)}</div>
    <form class="composer" id="composer">
      <div class="composer-model-meta" id="chatModelMeta">
        <span class="composer-model-caps">${escapeHtml(capabilitySummary || "text")}</span>
      </div>
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
          <span class="attach-icon-label">attach</span>
        </button>
        <button type="button" class="mic-icon-btn ${isListening ? "is-active" : ""}" id="chatMicBtn" aria-label="${isListening ? "Stop voice input" : "Start voice input"}" title="${isListening ? "Stop voice input" : "Start voice input"}">
          <span class="mic-icon-glyph" aria-hidden="true">${iconHtml(isSpeaking ? APP_ICON.sidebar.sttSpeaking : APP_ICON.sidebar.stt, { size: 16, tone: "dark" })}</span>
          <span class="mic-icon-label">STT</span>
        </button>
        <button type="button" class="mic-icon-btn ${state.chatTtsEnabled ? "is-active" : ""}" id="chatSpeakBtn" aria-label="${state.chatTtsEnabled ? "Disable auto-speak" : "Enable auto-speak"}" title="${state.chatTtsEnabled ? "Disable auto-speak" : "Enable auto-speak"}">
          <span class="mic-icon-glyph" aria-hidden="true">${iconHtml(APP_ICON.sidebar.tts, { size: 16, tone: "dark" })}</span>
          <span class="mic-icon-label">TTS</span>
        </button>
        <button type="button" class="send-icon-btn" id="chatSubmitBtn" aria-label="${canStopActiveOutput ? "Stop response" : "Send message"}" title="${canStopActiveOutput ? "Stop response" : "Send message"}">
          <span class="send-icon-glyph ${canStopActiveOutput ? "is-stop" : "is-play"}" aria-hidden="true">${canStopActiveOutput ? "◼" : "▶"}</span>
        </button>
      </div>
      <input type="file" id="chatAttachInput" hidden />
    </form>
  `;
}

export function renderChatMessages(state: PrimaryPanelRenderState): string {
  const messagesHtml = state.messages
    .map(
      (m, messageIndex) => {
        const correlationId = m.role === "assistant" ? m.correlationId : undefined;
        const parsed = m.role === "user" ? parseAttachmentMessage(m.text) : { displayText: m.text, attachment: null };
        const thinkingText = correlationId
          ? (state.chatReasoningByCorrelation[correlationId] ?? "").trim()
          : "";
        const thinkingRowId = correlationId ? `thinking-row-${correlationId}` : "";
        const thinkingExpanded = thinkingRowId
          ? state.chatToolRowExpandedById[thinkingRowId] === true
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
        const assistantToolRowsHtml = hasToolRows
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
        const attachmentRowId = parsed.attachment
          ? `attachment-row-${messageIndex}-${parsed.attachment.fileName}`
          : "";
        const attachmentExpanded = parsed.attachment
          ? state.chatToolRowExpandedById[attachmentRowId] === true
          : false;
        const attachmentRowsHtml = parsed.attachment
          ? `<section class="message-tool-rows">
              <article class="message-tool-row ${attachmentExpanded ? "is-open" : ""}">
                <button type="button" class="message-tool-row-toggle" data-tool-row-toggle-id="${escapeHtml(attachmentRowId)}" aria-expanded="${attachmentExpanded ? "true" : "false"}" title="${attachmentExpanded ? "Collapse attachment" : "Expand attachment"}">
                  <span class="message-tool-row-left">
                    <span class="message-tool-row-icon">${iconHtml("file-badge", { size: 16, tone: "dark" })}</span>
                    <span class="message-tool-row-title">${escapeHtml(parsed.attachment.fileName)}</span>
                  </span>
                  <span class="message-tool-row-chevron" aria-hidden="true">${attachmentExpanded ? "▾" : "▸"}</span>
                </button>
                ${attachmentExpanded ? `<div class="message-tool-row-details">${escapeHtml(parsed.attachment.content)}</div>` : ""}
              </article>
            </section>`
          : "";
        const textHtml = showAssistantText
          ? parsed.displayText
            ? `<div class="message-text">${escapeHtml(parsed.displayText)}</div>`
            : ""
          : `<div class="message-text message-text-pending">Running tools...</div>`;
        const thinkingHtml =
          correlationId && thinkingText
            ? `<section class="message-tool-rows">
                <article class="message-tool-row ${thinkingExpanded ? "is-open" : ""}">
                  <button type="button" class="message-tool-row-toggle" data-tool-row-toggle-id="${escapeHtml(thinkingRowId)}" aria-expanded="${thinkingExpanded ? "true" : "false"}" title="${thinkingExpanded ? "Collapse thinking" : "Expand thinking"}">
                    <span class="message-tool-row-left">
                      <span class="message-tool-row-icon">${iconHtml(APP_ICON.action.chatThinking, { size: 16, tone: "dark" })}</span>
                      <span class="message-tool-row-title">Thinking</span>
                    </span>
                    <span class="message-tool-row-chevron" aria-hidden="true">${thinkingExpanded ? "▾" : "▸"}</span>
                  </button>
                  ${thinkingExpanded ? `<div class="message-tool-row-details">${escapeHtml(thinkingText)}</div>` : ""}
                </article>
              </section>`
            : "";
        const contentHtml =
          placement === "before"
            ? `${attachmentRowsHtml}${assistantToolRowsHtml}${thinkingHtml}${textHtml}`
            : `${attachmentRowsHtml}${assistantToolRowsHtml}${textHtml}${thinkingHtml}`;
        return `<div class="message ${m.role}">
          ${contentHtml}
        </div>`;
      }
    )
    .join("");

  return messagesHtml || '<div class="message assistant is-placeholder"><div class="message-text">Ready.</div></div>';
}

export function bindChatPanel(
  onSendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>,
  onUpdateChatDraft: (text: string) => void,
  onSetChatAttachment: (fileName: string, content: string) => void,
  onClearChatAttachment: () => void,
  onStopCurrentResponse: () => Promise<void>,
  onToggleStt: () => Promise<void>,
  chatStreaming: boolean,
  initialAttachment: { name: string; content: string } | null,
  activeModelLabel: string,
  modelCapabilities: ChatModelCapabilities
): void {
  const form = document.querySelector<HTMLFormElement>("#composer");
  const input = document.querySelector<HTMLTextAreaElement>("#msg");
  const attachBtn = document.querySelector<HTMLButtonElement>("#chatAttachBtn");
  const attachInput = document.querySelector<HTMLInputElement>("#chatAttachInput");
  const attachmentMeta = document.querySelector<HTMLDivElement>("#chatAttachmentMeta");
  const attachmentName = document.querySelector<HTMLSpanElement>("#chatAttachmentName");
  if (!form || !input) return;
  const MAX_ATTACHMENT_CHARS = 12000;
  const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
  let attachedFile: { name: string; content: string } | null = initialAttachment;
  let attachmentPayloads: ChatAttachment[] | null = null;

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
          `[Attachment context: active model "${activeModelLabel}" capabilities -> text=${modelCapabilities.text ? "yes" : "no"}, inlineTextAttachments=${modelCapabilities.inlineTextAttachments ? "yes" : "no"}, imageUnderstanding=${modelCapabilities.imageUnderstanding ? "yes" : "no"}, imageAttachmentsEnabled=${modelCapabilities.imageAttachmentsEnabled ? "yes" : "no"}, audioUnderstanding=${modelCapabilities.audioUnderstanding ? "yes" : "no"}, toolUse=${modelCapabilities.toolUse ? "yes" : "no"}, reasoningControl=${modelCapabilities.reasoningControl ? "yes" : "no"}]`,
          "[Attachment note: Uploaded files are included as inline content and may not exist in the workspace filesystem. Use the inline content directly and do not call Files/Terminal to open a path unless the user explicitly provided one.]",
          `[Attached file: ${attachedFile.name}]`,
          attachedFile.content
        ]
          .filter((part) => part.trim().length > 0)
          .join("\n\n")
      : promptText;
    input.value = "";
    onUpdateChatDraft("");
    await onSendMessage(text, attachmentPayloads || undefined);
    attachedFile = null;
    attachmentPayloads = null;
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
      const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowerName);
      const isTextLike =
        file.type.startsWith("text/") ||
        /\.(txt|md|markdown|json|csv|xml|yaml|yml|toml|ini|log|js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|hpp|css|html)$/i.test(
          lowerName
        );
      if (isImage) {
        if (!modelCapabilities.imageUnderstanding) {
          attachedFile = {
            name: file.name,
            content:
              "[Image attachment selected. Current model does not advertise image understanding; image pixels were not sent.]"
          };
          attachmentPayloads = null;
        } else if (!modelCapabilities.imageAttachmentsEnabled) {
          attachedFile = {
            name: file.name,
            content:
              "[Image attachment selected. Model appears image-capable, but image attachment transport is not enabled yet in this build.]"
          };
          attachmentPayloads = null;
        } else {
          if (file.size > MAX_IMAGE_BYTES) {
            attachedFile = {
              name: file.name,
              content: `[Image attachment too large: ${Math.round(file.size / 1024 / 1024)}MB. Maximum supported size is ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB.]`
            };
            attachmentPayloads = null;
            onSetChatAttachment(attachedFile.name, attachedFile.content);
            updateAttachmentUi();
            return;
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const base64 = bytesToBase64(bytes);
          attachedFile = {
            name: file.name,
            content: `[Image attachment sent: ${file.name} (${file.type || "application/octet-stream"})]`
          };
          attachmentPayloads = [
            {
              kind: "image",
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              dataBase64: base64
            }
          ];
        }
        onSetChatAttachment(attachedFile.name, attachedFile.content);
        updateAttachmentUi();
        return;
      }
      if (!isTextLike) {
        attachedFile = {
          name: file.name,
          content:
            "[Non-text attachment selected. This build supports inline text attachments only; binary content was not inlined.]"
        };
        attachmentPayloads = null;
        onSetChatAttachment(attachedFile.name, attachedFile.content);
        updateAttachmentUi();
        return;
      }
      let text = await file.text();
      if (text.length > MAX_ATTACHMENT_CHARS) {
        text = `${text.slice(0, MAX_ATTACHMENT_CHARS)}\n\n[Attachment truncated to ${MAX_ATTACHMENT_CHARS} characters.]`;
      }
      attachedFile = { name: file.name, content: text };
      attachmentPayloads = null;
      onSetChatAttachment(attachedFile.name, attachedFile.content);
      updateAttachmentUi();
    };
  }

  updateAttachmentUi();

}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
