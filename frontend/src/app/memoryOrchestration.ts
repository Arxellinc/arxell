import type { ChatContextBreakdownItem } from "../contracts";

type MemorySection = "context" | "history" | "memory" | "skills" | "tools";
type AnyState = Record<string, any>;

export async function loadMemoryContextState(args: {
  state: AnyState;
  clientRef: {
    inspectChatContext: (request: {
      conversationId: string;
      correlationId: string;
      chatMode: string;
      alwaysLoadToolKeys: string[];
      alwaysLoadSkillKeys: string[];
    }) => Promise<{
      items: ChatContextBreakdownItem[];
      conversations: Array<{
        conversationId: string;
        title?: string;
        lastMessagePreview?: string;
        messageCount: number;
        updatedAtMs: number;
      }>;
      memoryItems: ChatContextBreakdownItem[];
      skillsItems: ChatContextBreakdownItem[];
      toolsItems: ChatContextBreakdownItem[];
      routeMode: string;
      totalTokenEstimate: number;
    }>;
    getMessages: (request: { conversationId: string; correlationId: string }) => Promise<{
      messages: Array<{ content: string }>;
    }>;
  };
  nextCorrelationId: () => string;
  mapMemoryContextItem: (item: ChatContextBreakdownItem) => ChatContextBreakdownItem;
}): Promise<void> {
  const { state, clientRef, nextCorrelationId, mapMemoryContextItem } = args;
  state.memoryLoading = true;
  state.memoryError = null;
  try {
    const response = await clientRef.inspectChatContext({
      conversationId: state.conversationId,
      correlationId: nextCorrelationId(),
      chatMode: state.chatRoutePreference,
      alwaysLoadToolKeys: state.memoryAlwaysLoadToolKeys,
      alwaysLoadSkillKeys: state.memoryAlwaysLoadSkillKeys
    });
    state.memoryContextItems = response.items.map(mapMemoryContextItem);
    const conversations = response.conversations.slice(0, 10);
    const historyBodies = await Promise.all(
      conversations.map(async (conv) => {
        try {
          const msgResponse = await clientRef.getMessages({
            conversationId: conv.conversationId,
            correlationId: nextCorrelationId()
          });
          const body = msgResponse.messages.map((m) => m.content).join("\n");
          return { conversationId: conv.conversationId, body };
        } catch {
          const fallback = conv.lastMessagePreview || "";
          return { conversationId: conv.conversationId, body: fallback };
        }
      })
    );
    const bodyMap = new Map(historyBodies.map((b) => [b.conversationId, b.body]));
    state.memoryChatHistory = conversations.map((conv) => {
      const fullBody = bodyMap.get(conv.conversationId) || conv.lastMessagePreview || "";
      const chars = fullBody.length;
      const words = fullBody.split(/\s+/).filter(Boolean).length;
      const tokenEstimate = Math.round(((chars * 0.25) + (words * 1.3)) * 0.5);
      return { ...conv, fullBody, charCount: chars, wordCount: words, tokenEstimate };
    });
    state.memoryPersistentItems = response.memoryItems.map(mapMemoryContextItem);
    state.memorySkillsItems = response.skillsItems.map(mapMemoryContextItem);
    state.memoryToolsItems = response.toolsItems.map(mapMemoryContextItem);
    state.memoryRouteMode = response.routeMode;
    state.memoryTotalTokenEstimate = response.totalTokenEstimate;
  } catch (error) {
    state.memoryError = error instanceof Error ? error.message : String(error);
  } finally {
    state.memoryLoading = false;
  }
}

export function closeMemoryModalState(state: AnyState): void {
  state.memoryModalOpen = false;
  state.memoryModalMode = "edit";
  state.memoryModalSection = null;
  state.memoryModalTitle = "";
  state.memoryModalValue = "";
  state.memoryModalEditable = false;
  state.memoryModalTarget = null;
  state.memoryModalNamespace = null;
  state.memoryModalKey = null;
  state.memoryModalSourcePath = null;
  state.memoryModalConversationId = null;
  state.memoryModalDraftKey = "";
  state.memoryModalDraftCategory = "fact";
  state.memoryModalDraftDescription = "";
}

export function openMemoryCreateModalState(state: AnyState, section: MemorySection): void {
  state.memoryModalOpen = true;
  state.memoryModalMode = "create";
  state.memoryModalSection = section;
  state.memoryModalTitle = `Add New ${section.charAt(0).toUpperCase()}${section.slice(1)} Item`;
  state.memoryModalValue = "";
  state.memoryModalEditable = true;
  state.memoryModalTarget = null;
  state.memoryModalNamespace = null;
  state.memoryModalKey = null;
  state.memoryModalSourcePath = null;
  state.memoryModalConversationId = null;
  state.memoryModalDraftKey = "";
  state.memoryModalDraftCategory = section === "memory" ? "fact" : "";
  state.memoryModalDraftDescription = "";
}

export function openHistoryIndexModalState(
  state: AnyState,
  formatMemoryTimestamp: (timestampMs: number) => string
): void {
  const value = state.memoryChatHistory
    .slice(0, 10)
    .map((chat: { updatedAtMs: number; title?: string; lastMessagePreview?: string; conversationId: string; messageCount: number }) => {
      const date = formatMemoryTimestamp(chat.updatedAtMs);
      const title = chat.title?.trim() || chat.lastMessagePreview || chat.conversationId;
      const preview = chat.lastMessagePreview || title;
      return `- ${date} | ${title} | ${chat.messageCount} msgs | ${preview}`;
    })
    .join("\n");
  state.memoryModalOpen = true;
  state.memoryModalMode = "edit";
  state.memoryModalSection = "history";
  state.memoryModalTitle = "History Index";
  state.memoryModalValue = `# History\n\n${value}`;
  state.memoryModalEditable = false;
  state.memoryModalTarget = null;
  state.memoryModalNamespace = null;
  state.memoryModalKey = null;
  state.memoryModalSourcePath = null;
  state.memoryModalConversationId = null;
}

export function openMemoryModalState(state: AnyState, section: MemorySection, index: number): void {
  if (section === "history") {
    const item = state.memoryChatHistory.slice(0, 10)[index];
    if (!item) return;
    const title = item.title?.trim() || item.lastMessagePreview || item.conversationId;
    const isCustomHistory = item.conversationId.startsWith("custom-history:");
    state.memoryModalOpen = true;
    state.memoryModalMode = "edit";
    state.memoryModalSection = section;
    state.memoryModalTitle = title;
    state.memoryModalValue = item.fullBody || item.lastMessagePreview || "";
    state.memoryModalEditable = isCustomHistory;
    state.memoryModalTarget = isCustomHistory ? "custom-item" : null;
    state.memoryModalNamespace = isCustomHistory ? "history" : null;
    state.memoryModalKey = isCustomHistory ? item.title : null;
    state.memoryModalConversationId = isCustomHistory ? null : item.conversationId;
    return;
  }

  const source =
    section === "memory"
      ? state.memoryPersistentItems
      : section === "skills"
        ? state.memorySkillsItems
        : section === "tools"
          ? state.memoryToolsItems
          : state.memoryContextItems;
  const item = source[index];
  if (!item) return;
  const namespaceKey = section === "memory" ? item.key.split(":") : [];
  const isIndex = item.category === "skill-index" || item.category === "tool-index";
  const isReadOnlyKey = item.key === "Skill Index" || item.key === "Tool Index" || item.key === "Runtime metadata" || item.key === "Verified API registry context";
  const isSystemPrompt = section === "context" && item.key === "Base system prompt";
  const isCustomContext = section === "context" && item.category === "custom-context";
  const isCustomTool = section === "tools" && item.category === "tool-note";
  const isSkillFile = section === "skills" && !!item.sourcePath;
  const editable = isSystemPrompt || isCustomContext || isCustomTool || isSkillFile || (section === "memory" && !isIndex && !isReadOnlyKey);
  state.memoryModalOpen = true;
  state.memoryModalMode = "edit";
  state.memoryModalSection = section;
  state.memoryModalTitle = item.key;
  state.memoryModalValue = item.value;
  state.memoryModalEditable = editable;
  state.memoryModalTarget = section === "memory" ? "memory" : isSystemPrompt ? "system-prompt" : isCustomContext || isCustomTool ? "custom-item" : null;
  state.memoryModalNamespace = section === "memory" ? namespaceKey[0] || null : isCustomContext || isCustomTool ? section : null;
  state.memoryModalKey = section === "memory" ? namespaceKey.slice(1).join(":") || item.key : isCustomContext || isCustomTool ? item.key : null;
  state.memoryModalSourcePath = item.sourcePath || null;
  state.memoryModalConversationId = null;
}

export function handleMemoryModalInputEvent(
  state: AnyState,
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): { handled: boolean; refreshEditor: boolean } {
  const action = input.getAttribute?.("data-memory-action");
  if (action === "editor-input" && input instanceof HTMLTextAreaElement) {
    state.memoryModalValue = input.value;
    return { handled: true, refreshEditor: true };
  }
  if (action === "modal-draft-key") {
    state.memoryModalDraftKey = input.value;
    return { handled: true, refreshEditor: false };
  }
  if (action === "modal-draft-category") {
    state.memoryModalDraftCategory = input.value;
    return { handled: true, refreshEditor: false };
  }
  if (action === "modal-draft-description") {
    state.memoryModalDraftDescription = input.value;
    return { handled: true, refreshEditor: false };
  }
  return { handled: false, refreshEditor: false };
}

export function handleMemoryModalChangeEvent(
  state: AnyState,
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): boolean {
  const action = input.getAttribute?.("data-memory-action");
  if (action === "modal-draft-category") {
    state.memoryModalDraftCategory = input.value;
    return true;
  }
  return false;
}

export function handleMemoryModalEditorKeyDown(
  event: KeyboardEvent,
  textarea: HTMLTextAreaElement
): { handled: boolean; refreshEditor: boolean; closeModal: boolean } {
  if (textarea.getAttribute?.("data-memory-action") !== "editor-input") {
    return { handled: false, refreshEditor: false, closeModal: false };
  }
  if (event.key === "Tab") {
    event.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.substring(0, start) + "\t" + textarea.value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + 1;
    return { handled: true, refreshEditor: true, closeModal: false };
  }
  if (event.key === "Escape") {
    return { handled: true, refreshEditor: false, closeModal: true };
  }
  return { handled: false, refreshEditor: false, closeModal: false };
}
