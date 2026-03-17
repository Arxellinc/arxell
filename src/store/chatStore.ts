import { create } from "zustand";
import type { Conversation, Message, Project } from "../types";
import { type ModeId, DEFAULT_MODE } from "../lib/modes";

/** @deprecated use DelegationState */
export interface DelegationRequest {
  messageId: string;
  modelName: string;
  modelId: string;
  baseUrl: string;
  prompt: string;
}

export interface DelegationState {
  messageId: string;
  modelName: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  prompt: string;
  status: "pending" | "running" | "done" | "error";
  response: string;
  error?: string;
}

interface StreamingMessage {
  id: string;
  content: string;
  conversation_id: string;
}

export interface ToolActivity {
  id: string;
  tool: string;
  summary: string;
  status: "running" | "done" | "error";
  details?: string;
}

export interface MessagePerfStats {
  messageId: string;
  startedAt: number;
  firstTokenAt: number | null;
  completedAt: number | null;
  estimatedTokens: number | null;
}

/// Maps skill ID to its content
type SkillContents = Record<string, string>;

interface ChatStore {
  projects: Project[];
  conversations: Conversation[];
  messages: Message[];
  activeProjectId: string | null;
  activeConversationId: string | null;
  streamingMessage: StreamingMessage | null;
  isStreaming: boolean;
  messagePerfById: Record<string, MessagePerfStats>;
  lastCompletedPerfMessageId: string | null;

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;

  setConversations: (convs: Conversation[]) => void;
  addConversation: (conv: Conversation) => void;
  removeConversation: (id: string) => void;
  updateConversationTitle: (id: string, title: string) => void;

  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;

  /// Multiple active skills - user can toggle multiple user-selectable skills
  activeSkillIds: string[];
  /// Contents of all loaded skills (both always-active and user-selected)
  skillContents: SkillContents;
  /// Toggle a skill on/off
  toggleSkill: (skillId: string) => void;
  /// Set a skill active/inactive explicitly (idempotent)
  setSkillActive: (skillId: string, active: boolean) => void;
  /// Replace active skills with backend-resolved IDs.
  setActiveSkillIds: (skillIds: string[]) => void;
  /// Set the content for a skill
  setSkillContent: (skillId: string, content: string) => void;
  /// Clear a skill's content
  clearSkillContent: (skillId: string) => void;
  /// Get combined content of all active skills
  getActiveSkillsContent: () => string;
  /// Compact tool execution timeline grouped by assistant message id.
  toolActivitiesByMessageId: Record<string, ToolActivity[]>;
  addToolActivity: (messageId: string, activity: ToolActivity) => void;
  updateToolActivity: (
    messageId: string,
    activityId: string,
    patch: Partial<Pick<ToolActivity, "status" | "summary" | "details">>
  ) => void;
  clearToolActivities: (messageId: string) => void;

  /// Thinking mode toggle - when disabled, models use No_Think mode
  thinkingEnabled: boolean;
  toggleThinking: () => void;
  
  /// Complex reasoning mode - enables extended reasoning for difficult problems
  complexReasoningEnabled: boolean;
  toggleComplexReasoning: () => void;

  activeMode: ModeId;
  setActiveMode: (mode: ModeId) => void;

  delegations: Record<string, DelegationState>;
  addDelegation: (d: DelegationState) => void;
  appendDelegationChunk: (messageId: string, delta: string) => void;
  completeDelegation: (messageId: string, error?: string) => void;
  removeDelegation: (messageId: string) => void;

  setActiveProject: (id: string | null) => void;
  setActiveConversation: (id: string | null) => void;

  startStreaming: (id: string, conversationId: string) => void;
  appendChunk: (id: string, delta: string) => void;
  finishStreaming: () => void;
  startMessagePerf: (messageId: string, startedAt?: number) => void;
  noteFirstToken: (messageId: string, firstTokenAt?: number) => void;
  completeMessagePerf: (
    messageId: string,
    params: { completedAt?: number; estimatedTokens?: number }
  ) => void;
}

function stripToolCallBlocks(content: string): string {
  // Remove XML-like tool calls (e.g., <create_task>...</create_task>) and self-closing variants
  return content
    .replace(/<([a-z][a-z0-9]*_[a-z0-9_]+)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<([a-z][a-z0-9]*_[a-z0-9_]+)\b[^/>]*\/>/gi, "");
}

export const useChatStore = create<ChatStore>((set, get) => ({
  projects: [],
  conversations: [],
  messages: [],
  activeProjectId: null,
  activeConversationId: null,
  streamingMessage: null,
  isStreaming: false,
  messagePerfById: {},
  lastCompletedPerfMessageId: null,

  delegations: {},
  addDelegation: (d) =>
    set((s) => ({ delegations: { ...s.delegations, [d.messageId]: d } })),
  appendDelegationChunk: (messageId, delta) =>
    set((s) => {
      const existing = s.delegations[messageId];
      if (!existing) return s;
      return {
        delegations: {
          ...s.delegations,
          [messageId]: {
            ...existing,
            status: "running" as const,
            response: existing.response + delta,
          },
        },
      };
    }),
  completeDelegation: (messageId, error) =>
    set((s) => {
      const existing = s.delegations[messageId];
      if (!existing) return s;
      return {
        delegations: {
          ...s.delegations,
          [messageId]: {
            ...existing,
            status: error ? ("error" as const) : ("done" as const),
            error,
          },
        },
      };
    }),
  removeDelegation: (messageId) =>
    set((s) => {
      const { [messageId]: _, ...rest } = s.delegations;
      return { delegations: rest };
    }),

  activeSkillIds: [],
  skillContents: {},
  toolActivitiesByMessageId: {},
  toggleSkill: (skillId) =>
    set((s) => {
      const isActive = s.activeSkillIds.includes(skillId);
      return {
        activeSkillIds: isActive
          ? s.activeSkillIds.filter((id) => id !== skillId)
          : [...s.activeSkillIds, skillId],
      };
    }),
  setSkillActive: (skillId, active) =>
    set((s) => {
      const isActive = s.activeSkillIds.includes(skillId);
      if (active && !isActive) {
        return { activeSkillIds: [...s.activeSkillIds, skillId] };
      }
      if (!active && isActive) {
        return { activeSkillIds: s.activeSkillIds.filter((id) => id !== skillId) };
      }
      return s;
    }),
  setActiveSkillIds: (skillIds) =>
    set((s) => {
      const next = Array.from(new Set(skillIds.filter((id) => id.trim().length > 0)));
      const prev = s.activeSkillIds;
      if (prev.length === next.length && prev.every((id, idx) => id === next[idx])) {
        return s;
      }
      return { activeSkillIds: next };
    }),
  setSkillContent: (skillId, content) =>
    set((s) => {
      if (s.skillContents[skillId] === content) return s;
      return {
        skillContents: { ...s.skillContents, [skillId]: content },
      };
    }),
  clearSkillContent: (skillId) =>
    set((s) => {
      if (!(skillId in s.skillContents)) return s;
      const { [skillId]: _, ...rest } = s.skillContents;
      return { skillContents: rest };
    }),
  getActiveSkillsContent: () => {
    const { activeSkillIds, skillContents } = get();
    return activeSkillIds
      .map((id) => skillContents[id])
      .filter(Boolean)
      .join("\n\n");
  },
  addToolActivity: (messageId, activity) =>
    set((s) => {
      const current = s.toolActivitiesByMessageId[messageId] ?? [];
      const next = [...current, activity].slice(-24);
      return {
        toolActivitiesByMessageId: {
          ...s.toolActivitiesByMessageId,
          [messageId]: next,
        },
      };
    }),
  updateToolActivity: (messageId, activityId, patch) =>
    set((s) => {
      const current = s.toolActivitiesByMessageId[messageId];
      if (!current || current.length === 0) return s;
      return {
        toolActivitiesByMessageId: {
          ...s.toolActivitiesByMessageId,
          [messageId]: current.map((entry) =>
            entry.id === activityId ? { ...entry, ...patch } : entry
          ),
        },
      };
    }),
  clearToolActivities: (messageId) =>
    set((s) => {
      if (!s.toolActivitiesByMessageId[messageId]) return s;
      const { [messageId]: _, ...rest } = s.toolActivitiesByMessageId;
      return { toolActivitiesByMessageId: rest };
    }),

  thinkingEnabled: true,
  toggleThinking: () =>
    set((s) => {
      if (s.activeMode === "voice") {
        return { thinkingEnabled: false };
      }
      return { thinkingEnabled: !s.thinkingEnabled };
    }),

  complexReasoningEnabled: false,
  toggleComplexReasoning: () => set((s) => ({ complexReasoningEnabled: !s.complexReasoningEnabled })),

  activeMode: DEFAULT_MODE.id,
  setActiveMode: (activeMode) =>
    set((s) => ({
      activeMode,
      thinkingEnabled: activeMode === "voice" ? false : s.thinkingEnabled,
    })),

  setProjects: (projects) => set({ projects }),
  addProject: (project) =>
    set((s) => ({ projects: [project, ...s.projects] })),
  removeProject: (id) =>
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

  setConversations: (conversations) => set({ conversations }),
  addConversation: (conv) =>
    set((s) => ({ conversations: [conv, ...s.conversations] })),
  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
    })),
  updateConversationTitle: (id, title) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title } : c
      ),
    })),

  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),

  setActiveProject: (id) =>
    set((s) => {
      if (s.activeProjectId === id) {
        return { activeProjectId: id };
      }
      return { activeProjectId: id, messages: [], activeConversationId: null };
    }),
  setActiveConversation: (id) =>
    set({ activeConversationId: id, messages: [] }),

  startStreaming: (id, conversationId) =>
    set({
      isStreaming: true,
      streamingMessage: { id, content: "", conversation_id: conversationId },
    }),
  appendChunk: (id: string, delta: string) =>
    set((s) => {
      if (!s.streamingMessage) return s;
      if (s.streamingMessage.id !== id) return s;
      return {
        streamingMessage: {
          ...s.streamingMessage,
          content: s.streamingMessage.content + delta,
        },
      };
    }),
  finishStreaming: () =>
    set((s) => {
      if (!s.streamingMessage) return { isStreaming: false };
      const content = s.streamingMessage.content.trim();
      if (!content) {
        return {
          isStreaming: false,
          streamingMessage: null,
        };
      }
      const visibleContent = stripToolCallBlocks(content).trim();
      if (!visibleContent) {
        return {
          isStreaming: false,
          streamingMessage: null,
        };
      }
      const msg: Message = {
        id: s.streamingMessage.id,
        conversation_id: s.streamingMessage.conversation_id,
        role: "assistant",
        content: s.streamingMessage.content,
        created_at: Date.now(),
      };
      return {
        isStreaming: false,
        streamingMessage: null,
        messages: [...s.messages, msg],
      };
    }),

  startMessagePerf: (messageId, startedAt = Date.now()) =>
    set((s) => ({
      messagePerfById: {
        ...s.messagePerfById,
        [messageId]: {
          messageId,
          startedAt,
          firstTokenAt: null,
          completedAt: null,
          estimatedTokens: null,
        },
      },
    })),

  noteFirstToken: (messageId, firstTokenAt = Date.now()) =>
    set((s) => {
      const existing = s.messagePerfById[messageId];
      if (!existing || existing.firstTokenAt !== null) return s;
      return {
        messagePerfById: {
          ...s.messagePerfById,
          [messageId]: {
            ...existing,
            firstTokenAt,
          },
        },
      };
    }),

  completeMessagePerf: (messageId, params) =>
    set((s) => {
      const existing = s.messagePerfById[messageId];
      if (!existing) return s;
      return {
        messagePerfById: {
          ...s.messagePerfById,
          [messageId]: {
            ...existing,
            completedAt: params.completedAt ?? Date.now(),
            estimatedTokens:
              typeof params.estimatedTokens === "number"
                ? params.estimatedTokens
                : existing.estimatedTokens,
          },
        },
        lastCompletedPerfMessageId: messageId,
      };
    }),
}));
