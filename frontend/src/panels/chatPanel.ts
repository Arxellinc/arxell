import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type {
  ChatAttachment,
  ChatStructuredPayload,
  ClarificationQuestion,
  DelegationStatusCard,
  PlanArtifact,
  PlanDelta
} from "../contracts";
import type { PrimaryPanelRenderState } from "./types";
import type { ChatModelCapabilities } from "../modelCapabilities";
import { escapeHtml } from "./utils";
import { renderAvatarPreview } from "./avatarPanel";

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

function renderStructuredPayload(payload: ChatStructuredPayload | null | undefined): string {
  if (!payload) return "";
  switch (payload.kind) {
    case "planner_offer":
      return renderPlannerOfferPayload(payload.title, payload.prompt, payload.reasons);
    case "clarification":
      return renderClarificationPayload(payload.title, payload.questions);
    case "plan_approval":
      return renderPlanApprovalPayload(payload.plan);
    case "delegation_status":
      return renderDelegationStatusPayload(payload.status);
    case "plan_delta":
      return renderPlanDeltaPayload(payload.delta);
    default:
      return "";
  }
}

function renderImageAttachments(attachments: ChatAttachment[] | undefined): string {
  const images = (attachments || []).filter((item) => item.kind === "image" && item.dataBase64);
  if (!images.length) return "";
  return `<div class="message-image-list">
    ${images
      .map((item, index) => {
        const mime = item.mimeType || "image/png";
        const src = `data:${mime};base64,${item.dataBase64}`;
        const name = item.fileName || `image-${index + 1}.png`;
        return `<figure class="message-image-card">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy" />
          <figcaption class="message-image-actions">
            <a href="${escapeHtml(src)}" download="${escapeHtml(name)}">Save</a>
            <button type="button" data-copy-image-src="${escapeHtml(src)}">Copy</button>
          </figcaption>
        </figure>`;
      })
      .join("")}
  </div>`;
}

function renderPlannerOfferPayload(title: string, prompt: string, reasons: string[]): string {
  const reasonText = reasons.length ? `<div class="chat-plan-inline-note">${escapeHtml(reasons.join("; "))}</div>` : "";
  return `<section class="chat-plan-inline" aria-label="${escapeHtml(title || "Use Planned Workflow?")}">
    <div class="chat-plan-inline-prompt">${escapeHtml(prompt)}</div>
    ${reasonText}
    <div class="chat-plan-inline-actions">
      <button type="button" class="tool-action-btn" data-chat-plan-action="use-planner">Use Planner</button>
      <button type="button" class="tool-action-btn" data-chat-plan-action="quick-answer">Quick Answer</button>
      <button type="button" class="tool-action-btn" data-chat-plan-action="stop-plan">Cancel</button>
    </div>
  </section>`;
}

function renderClarificationPayload(title: string, questions: ClarificationQuestion[]): string {
  const questionHtml = questions.map((question) => {
    const optionsHtml = question.options.map((option) => {
      return `<button type="button" class="chat-plan-option" data-chat-plan-action="select-clarification-option" data-question-id="${escapeHtml(question.id)}" data-option-id="${escapeHtml(option.id)}">
        <span class="chat-plan-option-label">${escapeHtml(option.label)}</span>
        ${option.summary ? `<span class="chat-plan-option-summary">${escapeHtml(option.summary)}</span>` : ""}
      </button>`;
    }).join("");
    return `<section class="chat-plan-question" data-question-id="${escapeHtml(question.id)}">
      <div class="chat-plan-question-prompt">${escapeHtml(question.prompt)}</div>
      <div class="chat-plan-options">${optionsHtml}</div>
      ${question.allowCustom ? `<textarea class="chat-plan-custom" data-chat-plan-action="custom-clarification" data-question-id="${escapeHtml(question.id)}" placeholder="Custom answer"></textarea>` : ""}
    </section>`;
  }).join("");

  return `<section class="chat-plan-inline is-clarification" aria-label="${escapeHtml(title || "Clarify Scope")}">
    <div class="chat-plan-inline-body">${questionHtml}</div>
    <div class="chat-plan-inline-actions">
      <button type="button" class="tool-action-btn" data-chat-plan-action="submit-clarification">Submit Custom Answer</button>
    </div>
  </section>`;
}

function renderPlanApprovalPayload(plan: PlanArtifact): string {
  const hasMinimumApprovalData =
    plan.projectFolder.trim().length > 0 &&
    plan.deliverables.length > 0 &&
    plan.acceptanceChecks.length > 0;
  return `<section class="chat-plan-inline is-plan" aria-label="Plan Approval">
    <div class="chat-plan-inline-note">Project folder: ${escapeHtml(plan.projectFolder || "Missing")}</div>
    <div class="chat-plan-inline-actions">
      <button type="button" class="tool-action-btn" data-chat-plan-action="approve-plan" data-plan-id="${escapeHtml(plan.id)}" ${hasMinimumApprovalData ? "" : "disabled"}>Approve Plan</button>
      <button type="button" class="tool-action-btn" data-chat-plan-action="revise-plan" data-plan-id="${escapeHtml(plan.id)}">Revise Plan</button>
      <button type="button" class="tool-action-btn" data-chat-plan-action="stop-plan" data-plan-id="${escapeHtml(plan.id)}">Stop</button>
    </div>
  </section>`;
}

function renderDelegationStatusPayload(status: DelegationStatusCard): string {
  return `<article class="chat-plan-card is-delegation">
    <div class="chat-plan-card-header">
      <span class="chat-plan-card-icon">${iconHtml("play", { size: 16, tone: "dark" })}</span>
      <span class="chat-plan-card-title">Delegated Run</span>
      <span class="chat-plan-badge">${escapeHtml(status.status)}</span>
    </div>
    <div class="chat-plan-summary">
      <div class="chat-plan-field"><span>Plan</span><code>${escapeHtml(status.planId)}</code></div>
      <div class="chat-plan-field"><span>Loop</span><code>${escapeHtml(status.loopId || "Pending")}</code></div>
      <div class="chat-plan-field"><span>Phase</span><strong>${escapeHtml(status.phase || status.status)}</strong></div>
    </div>
    ${status.checkpointSummary ? `<div class="chat-plan-checkpoint">${escapeHtml(status.checkpointSummary)}</div>` : ""}
    <div class="chat-plan-card-actions">
      <button type="button" class="tool-action-btn" data-chat-plan-action="open-looper" ${status.loopId ? "" : "disabled"}>Open Looper</button>
      <button type="button" class="tool-action-btn" data-chat-plan-action="stop-delegation" ${status.loopId ? "" : "disabled"}>Stop</button>
    </div>
  </article>`;
}

function renderPlanDeltaPayload(delta: PlanDelta): string {
  return `<article class="chat-plan-card is-delta">
    <div class="chat-plan-card-header">
      <span class="chat-plan-card-icon">${iconHtml("edit", { size: 16, tone: "dark" })}</span>
      <span class="chat-plan-card-title">Plan Delta</span>
      <span class="chat-plan-badge">${escapeHtml(delta.status)}</span>
    </div>
    <div class="chat-plan-field"><span>Reason</span><strong>${escapeHtml(delta.reason)}</strong></div>
    ${renderPlanList("Requested Changes", delta.requestedChanges)}
    ${renderPlanList("Acceptance Check Changes", delta.acceptanceCheckChanges)}
  </article>`;
}

function renderPlanList(label: string, values: string[]): string {
  if (!values.length) return "";
  return `<div class="chat-plan-list">
    <div class="chat-plan-list-label">${escapeHtml(label)}</div>
    <ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>
  </div>`;
}

export function renderChatActions(state: PrimaryPanelRenderState, scopeId = ""): string {
  const sttRunning = state.stt?.status === "running" || state.stt?.status === "starting";
  const ttsActive = state.chat.chatTtsEnabled;
  const voiceModeActive = sttRunning && ttsActive;
  const showVoiceControls = state.chat.panelId === "chat-0";
  return `
    <div class="chat-actions">
      <button type="button" class="topbar-icon-btn" id="chatNewBtn${scopeId}" aria-label="New chat" data-title="New Chat" title="New Chat">${iconHtml(APP_ICON.action.chatNew, { size: 16, tone: "dark" })}</button>
      <button type="button" class="topbar-icon-btn" id="chatClearBtn${scopeId}" aria-label="Clear chat" data-title="Clear Chat" title="Clear Chat">${iconHtml(APP_ICON.action.chatClear, { size: 16, tone: "dark" })}</button>
      ${showVoiceControls ? `<button type="button" class="topbar-icon-btn chat-speech-btn ${voiceModeActive ? "is-active" : ""}" id="chatSpeechBtn${scopeId}" aria-label="${voiceModeActive ? "Disable voice mode" : "Enable voice mode"}" data-title="${voiceModeActive ? "Voice Mode On" : "Voice Mode Off"}" title="${voiceModeActive ? "Disable voice mode (STT + TTS)" : "Enable voice mode (STT + TTS)"}">${iconHtml("speech", { size: 16, tone: "dark" })}</button>` : ""}
      ${showVoiceControls ? `<button type="button" class="topbar-icon-btn chat-avatar-btn ${state.avatar.active ? "is-active" : ""}" id="chatAvatarBtn${scopeId}" aria-label="${state.avatar.active ? "Hide AI avatar" : "Show AI avatar"}" data-title="AI Avatar" title="${state.avatar.active ? "Hide AI avatar" : "Show AI avatar"}">${iconHtml(APP_ICON.sidebar.avatar, { size: 16, tone: "dark" })}</button>` : ""}
      ${showVoiceControls ? `<button type="button" class="topbar-icon-btn chat-auto-btn ${state.autoSafeEnabled ? "is-active" : ""}" id="chatAutoModeBtn${scopeId}" aria-label="${state.autoSafeEnabled ? "Stop Auto Safe automation" : "Enable Auto Safe automation"}" data-title="${state.autoSafeEnabled ? "Auto Safe On" : "Auto Safe Off"}" title="${state.autoSafeEnabled ? "Stop Auto Safe automation" : "Enable Auto Safe automation for approved low-risk scheduled tasks"}">${iconHtml("rocket", { size: 16, tone: "dark" })}</button>` : ""}
    </div>
  `;
}

export function renderChatBody(state: PrimaryPanelRenderState, scopeId = ""): string {
  const isListening = state.stt?.isListening ?? false;
  const isSpeaking = state.stt?.isSpeaking ?? false;
  const attachedFileName = state.chat.chatAttachedFileName?.trim() ?? "";
  const hasAttachedFile = attachedFileName.length > 0;
  const caps = state.chat.chatActiveModelCapabilities;
  const canStopActiveOutput = state.chat.chatStreaming || state.chat.chatTtsPlaying;
  const showVoiceControls = state.chat.panelId === "chat-0";
  const avatarPreviewHtml =
    state.chat.panelId === "chat-0" && state.avatar.active && state.avatar.placement === "chat"
      ? renderAvatarPreview(state.avatar, { context: "chat" })
      : "";
  const maximizedAvatarPreviewHtml = state.avatar.maximized ? avatarPreviewHtml : "";
  const minimizedAvatarPreviewHtml = state.avatar.maximized ? "" : avatarPreviewHtml;
  const capabilitySummary = [
    caps.text ? "text" : null,
    caps.imageUnderstanding ? "image" : null,
    caps.audioUnderstanding ? "audio" : null,
    caps.toolUse ? "tools" : null,
    caps.reasoningControl ? "reasoning" : null
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const modelMetaText = capabilitySummary || "text";
  return `
    ${maximizedAvatarPreviewHtml}
    <div class="messages" data-chat-pane-id="${escapeHtml(state.chat.panelId)}">${renderChatMessages(state)}</div>
    ${minimizedAvatarPreviewHtml}
    <form class="composer" id="composer${scopeId}">
      <div class="composer-model-meta" id="chatModelMeta${scopeId}">
        <span class="composer-model-caps">${escapeHtml(modelMetaText)}</span>
      </div>
      <div class="composer-attachment-meta" id="chatAttachmentMeta${scopeId}" ${hasAttachedFile ? "" : "hidden"}>
        <span class="composer-attachment-icon" aria-hidden="true">${iconHtml("file-badge", { size: 16, tone: "dark" })}</span>
        <span class="composer-attachment-name" id="chatAttachmentName${scopeId}">${hasAttachedFile ? escapeHtml(attachedFileName) : ""}</span>
      </div>
      <textarea id="msg${scopeId}" rows="3" placeholder="Send a message">${escapeHtml(state.chat.chatDraft)}</textarea>
      <div class="composer-actions">
        <button
          type="button"
          class="thinking-toggle-btn ${state.chat.chatThinkingEnabled ? "is-active" : ""}"
          id="chatThinkingToggleBtn${scopeId}"
          aria-label="${state.chat.chatThinkingEnabled ? "Disable Thinking" : "Enable Thinking"}"
          title="${state.chat.chatThinkingEnabled ? "Disable Thinking" : "Enable Thinking"}"
        >
          <span class="thinking-toggle-glyph" aria-hidden="true">${iconHtml(APP_ICON.action.chatThinking, { size: 16, tone: "dark" })}</span>
          <span class="thinking-toggle-label">${state.chat.chatThinkingEnabled ? "Thinking" : "No Thinking"}</span>
        </button>
        <button type="button" class="attach-icon-btn" id="chatAttachBtn${scopeId}" aria-label="Attach document" title="Attach document">
          <span class="attach-icon-glyph" aria-hidden="true">${iconHtml("file-plus", { size: 16, tone: "dark" })}</span>
          <span class="attach-icon-label">attach</span>
        </button>
        ${showVoiceControls ? `<button type="button" class="mic-icon-btn ${isListening ? "is-active" : ""}" id="chatMicBtn${scopeId}" aria-label="${isListening ? "Stop voice input" : "Start voice input"}" title="${isListening ? "Stop voice input" : "Start voice input"}">
          <span class="mic-icon-glyph" aria-hidden="true">${iconHtml(isSpeaking ? APP_ICON.sidebar.sttSpeaking : APP_ICON.sidebar.stt, { size: 16, tone: "dark" })}</span>
          <span class="mic-icon-label">STT</span>
        </button>
        <button type="button" class="mic-icon-btn ${state.chat.chatTtsEnabled ? "is-active" : ""}" id="chatSpeakBtn${scopeId}" aria-label="${state.chat.chatTtsEnabled ? "Disable auto-speak" : "Enable auto-speak"}" title="${state.chat.chatTtsEnabled ? "Disable auto-speak" : "Enable auto-speak"}">
          <span class="mic-icon-glyph" aria-hidden="true">${iconHtml(APP_ICON.sidebar.tts, { size: 16, tone: "dark" })}</span>
          <span class="mic-icon-label">TTS</span>
        </button>` : ""}
        <button type="button" class="send-icon-btn" id="chatSubmitBtn${scopeId}" aria-label="${canStopActiveOutput ? "Stop response" : "Send message"}" title="${canStopActiveOutput ? "Stop response" : "Send message"}">
          <span class="send-icon-glyph ${canStopActiveOutput ? "is-stop" : "is-play"}" aria-hidden="true">${canStopActiveOutput ? "◼" : "▶"}</span>
        </button>
      </div>
      <input type="file" id="chatAttachInput${scopeId}" hidden />
    </form>
  `;
}

export function renderChatMessages(state: Pick<PrimaryPanelRenderState, "chat">): string {
  const runtimeState = state as Pick<PrimaryPanelRenderState, "chat"> & Partial<PrimaryPanelRenderState>;
  const messagesHtml = state.chat.messages
    .map(
      (m, messageIndex) => {
        const correlationId = m.role === "assistant" ? m.correlationId : undefined;
        const parsed = m.role === "user" ? parseAttachmentMessage(m.text) : { displayText: m.text, attachment: null };
        const thinkingText = correlationId
          ? (state.chat.chatReasoningByCorrelation[correlationId] ?? "").trim()
          : "";
        const thinkingRowId = correlationId ? `thinking-row-${correlationId}` : "";
        const thinkingExpanded = thinkingRowId
          ? state.chat.chatToolRowExpandedById[thinkingRowId] === true
          : false;
        const placement = correlationId
          ? state.chat.chatThinkingPlacementByCorrelation[correlationId] ?? "after"
          : "after";
        const toolRows = correlationId
          ? (state.chat.chatToolRowsByCorrelation[correlationId] ?? [])
          : [];
        const streamComplete = correlationId
          ? state.chat.chatStreamCompleteByCorrelation[correlationId] === true
          : true;
        const hasToolRows = toolRows.length > 0;
        const showAssistantText = !(hasToolRows && !streamComplete);
        const assistantToolRowsHtml = hasToolRows
          ? `<section class="message-tool-rows">
              ${toolRows
                .map((row) => {
                  const expanded = state.chat.chatToolRowExpandedById[row.rowId] === true;
                  const chevron = expanded ? "▾" : "▸";
                  return `<article class="message-tool-row ${expanded ? "is-open" : ""}">
                    <button type="button" class="message-tool-row-toggle" data-tool-row-toggle-id="${escapeHtml(row.rowId)}" data-chat-pane-id="${escapeHtml(state.chat.panelId)}" aria-expanded="${expanded ? "true" : "false"}" title="${expanded ? "Collapse details" : "Expand details"}">
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
        const structuredPayloadHtml =
          m.role === "assistant" ? renderStructuredPayload(m.structuredPayload) : "";
        const imageAttachmentsHtml = renderImageAttachments(m.attachments);
        const attachmentRowId = parsed.attachment
          ? `attachment-row-${messageIndex}-${parsed.attachment.fileName}`
          : "";
        const attachmentExpanded = parsed.attachment
          ? state.chat.chatToolRowExpandedById[attachmentRowId] === true
          : false;
        const attachmentRowsHtml = parsed.attachment
          ? `<section class="message-tool-rows">
              <article class="message-tool-row ${attachmentExpanded ? "is-open" : ""}">
                <button type="button" class="message-tool-row-toggle" data-tool-row-toggle-id="${escapeHtml(attachmentRowId)}" data-chat-pane-id="${escapeHtml(state.chat.panelId)}" aria-expanded="${attachmentExpanded ? "true" : "false"}" title="${attachmentExpanded ? "Collapse attachment" : "Expand attachment"}">
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
                  <button type="button" class="message-tool-row-toggle" data-tool-row-toggle-id="${escapeHtml(thinkingRowId)}" data-chat-pane-id="${escapeHtml(state.chat.panelId)}" aria-expanded="${thinkingExpanded ? "true" : "false"}" title="${thinkingExpanded ? "Collapse thinking" : "Expand thinking"}">
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
            ? `${attachmentRowsHtml}${imageAttachmentsHtml}${assistantToolRowsHtml}${thinkingHtml}${textHtml}${structuredPayloadHtml}`
            : `${attachmentRowsHtml}${imageAttachmentsHtml}${assistantToolRowsHtml}${textHtml}${structuredPayloadHtml}${thinkingHtml}`;
        return `<div class="message ${m.role}">
          ${contentHtml}
        </div>`;
      }
    )
    .join("");

  const loadingMsg = state.chat.chatModelStatusMessage?.trim() || (state.chat.llamaRuntimeBusy ? "Loading model..." : null);
  if (messagesHtml) return messagesHtml;
  if (loadingMsg) {
    return `<div class="message assistant is-model-loading"><div class="message-text">${escapeHtml(loadingMsg)}</div></div>`;
  }
  const isLocalModel = state.chat.chatActiveModelId.startsWith("local:");
  const runtimeHealthy = runtimeState.llamaRuntime?.state === "healthy" && Boolean(runtimeState.llamaRuntimeActiveModelPath?.trim());
  if (isLocalModel && !runtimeHealthy) {
    const hasConfiguredModel = Boolean(runtimeState.llamaRuntimeModelPath?.trim());
    return `<div class="message assistant is-placeholder"><div class="message-text">${hasConfiguredModel ? "No model loaded." : "No model selected."}</div></div>`;
  }
  return '<div class="message assistant is-placeholder"><div class="message-text">Ready.</div></div>';
}

export function bindChatPanel(
  scopeId: string,
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
  const s = scopeId;
  const form = document.querySelector<HTMLFormElement>(`#composer${s}`);
  const input = document.querySelector<HTMLTextAreaElement>(`#msg${s}`);
  const attachBtn = document.querySelector<HTMLButtonElement>(`#chatAttachBtn${s}`);
  const attachInput = document.querySelector<HTMLInputElement>(`#chatAttachInput${s}`);
  const attachmentMeta = document.querySelector<HTMLDivElement>(`#chatAttachmentMeta${s}`);
  const attachmentName = document.querySelector<HTMLSpanElement>(`#chatAttachmentName${s}`);
  if (!form || !input) return;
  const chatPaneRoot = form.closest<HTMLElement>(".chat-pane");
  const messagesRoot = chatPaneRoot?.querySelector<HTMLElement>(".messages");
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
      const nextInput = document.querySelector<HTMLTextAreaElement>(`#msg${s}`);
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

  const handlePlanAction = (actionEl: HTMLElement) => {
    if (!actionEl) return;
    const action = actionEl.dataset.chatPlanAction || "";

    if (action === "select-clarification-option") {
      const question = actionEl.closest<HTMLElement>(".chat-plan-question");
      if (!question) return;
      const prompt =
        question.querySelector(".chat-plan-question-prompt")?.textContent?.trim() ||
        "Clarification";
      const label = actionEl.querySelector(".chat-plan-option-label")?.textContent?.trim() || "";
      if (!label) return;
      void onSendMessage(`Clarification answer:\n- ${prompt}: ${label}`);
      return;
    }

    if (action === "submit-clarification") {
      const card = actionEl.closest<HTMLElement>(".chat-plan-inline, .chat-plan-card");
      if (!card) return;
      const answers = Array.from(card.querySelectorAll<HTMLElement>(".chat-plan-question"))
        .map((question, index) => {
          const title =
            question.querySelector(".chat-plan-question-prompt")?.textContent?.trim() ||
            `Question ${index + 1}`;
          const selected = question.dataset.selectedOptionLabel || "";
          const custom =
            question.querySelector<HTMLTextAreaElement>(".chat-plan-custom")?.value.trim() || "";
          if (!selected && !custom) return "";
          return `- ${title}: ${[selected, custom].filter(Boolean).join(" - ")}`;
        })
        .filter(Boolean);
      if (!answers.length) return;
      void onSendMessage(`Clarification answers:\n${answers.join("\n")}`);
      return;
    }

    if (action === "use-planner") {
      void onSendMessage("Use Planner");
      return;
    }
    if (action === "quick-answer") {
      void onSendMessage("Quick Answer");
      return;
    }
    if (action === "approve-plan") {
      void onSendMessage("Approve Plan");
      return;
    }
    if (action === "revise-plan") {
      void onSendMessage("Revise Plan");
      return;
    }
    if (action === "stop-plan" || action === "stop-delegation") {
      void onSendMessage("Stop Plan");
    }
  };

  const actionRoot: ParentNode = messagesRoot ?? chatPaneRoot ?? document;
  actionRoot.querySelectorAll<HTMLElement>("[data-chat-plan-action]").forEach((actionEl) => {
    actionEl.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlePlanAction(actionEl);
    };
  });

  actionRoot.querySelectorAll<HTMLButtonElement>("[data-copy-image-src]").forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const src = button.dataset.copyImageSrc || "";
      if (!src) return;
      try {
        await navigator.clipboard.writeText(src);
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1200);
      } catch {
        button.textContent = "Copy failed";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1200);
      }
    };
  });

  const submitBtn = document.querySelector<HTMLButtonElement>(`#chatSubmitBtn${s}`);
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

  const micBtn = document.querySelector<HTMLButtonElement>(`#chatMicBtn${s}`);
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
