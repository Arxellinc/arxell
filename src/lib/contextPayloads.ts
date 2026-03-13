import type { AgentTask } from "../store/taskStore";
import type { Note } from "../store/notesStore";
import type { McpServer } from "../store/mcpStore";
import type { MemoryEntry } from "./tauri";

export interface RuntimeContextPayload {
  date: string;
  time: string;
  model: string;
  context_length: string;
  cpu: string;
  memory: string;
  gpu: string;
}

export function buildRuntimeContextPayload(params: {
  modelName?: string | null;
  contextLength?: number | null;
  cpuLabel?: string | null;
  memoryLabel?: string | null;
  gpuLabel?: string | null;
  now?: Date;
}): RuntimeContextPayload {
  const now = params.now ?? new Date();
  return {
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    model: params.modelName || "No model loaded",
    context_length: params.contextLength ? params.contextLength.toLocaleString() : "Unknown",
    cpu: params.cpuLabel || "Unknown",
    memory: params.memoryLabel || "Unknown",
    gpu: params.gpuLabel || "None",
  };
}

export interface TaskContextItem {
  id: string;
  title: string;
  priority: number;
  project_id: string | null;
  project_name: string;
  status: AgentTask["status"];
  dependencies: string[];
  due_at: string | null;
  estimated_effort_hours: number | null;
  created_by: AgentTask["created_by"];
  attempt_count: number;
  last_error: string | null;
  next_review_at: string | null;
  updated_at: string;
}

export interface TaskContextPayload {
  total_tasks: number;
  pending_tasks: number;
  tasks: TaskContextItem[];
}

export interface NoteContextItem {
  id: string;
  title: string;
  tags: string[];
  updated_at: string;
}

export interface NotesContextPayload {
  total_notes: number;
  notes: NoteContextItem[];
}

export interface McpServerContextItem {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  transport: string;
  endpoint: string;
  tools: string[];
}

export interface McpContextPayload {
  total_servers: number;
  enabled_servers: number;
  servers: McpServerContextItem[];
}

export interface AgentMemoryPayload {
  user_profile: Array<{ key: string; value: string }>;
  recent_conversations: Array<{ key: string; value: string }>;
  project_context: Array<{ key: string; value: string }>;
}

export function buildTaskContextPayload(tasks: AgentTask[]): TaskContextPayload {
  return {
    total_tasks: tasks.length,
    pending_tasks: tasks.filter((t) => t.status === "pending").length,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      project_id: t.project_id,
      project_name: t.project_name,
      status: t.status,
      dependencies: t.dependencies,
      due_at: t.due_at,
      estimated_effort_hours: t.estimated_effort_hours,
      created_by: t.created_by,
      attempt_count: t.attempt_count,
      last_error: t.last_error,
      next_review_at: t.next_review_at,
      updated_at: t.updated_at,
    })),
  };
}

export function buildNotesContextPayload(notes: Note[]): NotesContextPayload {
  return {
    total_notes: notes.length,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      tags: n.tags,
      updated_at: n.updatedAt,
    })),
  };
}

export function buildMcpContextPayload(servers: McpServer[]): McpContextPayload {
  return {
    total_servers: servers.length,
    enabled_servers: servers.filter((s) => s.enabled).length,
    servers: servers.map((s) => ({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      status: s.status,
      transport: s.transport,
      endpoint: s.endpoint,
      tools: s.tools,
    })),
  };
}

export function buildAgentMemoryPayload(params: {
  userMemory: MemoryEntry[];
  episodicMemory: MemoryEntry[];
  projectMemory: MemoryEntry[];
}): AgentMemoryPayload {
  const { userMemory, episodicMemory, projectMemory } = params;
  return {
    user_profile: [...userMemory]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((e) => ({ key: e.key, value: e.value })),
    recent_conversations: [...episodicMemory]
      .slice(0, 5)
      .reverse()
      .map((e) => ({ key: e.key, value: e.value })),
    project_context: [...projectMemory]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((e) => ({ key: e.key, value: e.value })),
  };
}

export function renderAgentMemoryMarkdown(memory: AgentMemoryPayload): string {
  const memoryParts: string[] = [];

  if (memory.user_profile.length > 0) {
    const lines = memory.user_profile.map((e) => `${e.key}: ${e.value}`).join("\n");
    memoryParts.push(`### User Profile\n${lines}`);
  }

  if (memory.recent_conversations.length > 0) {
    const lines = memory.recent_conversations
      .map((e) => `**${e.key}:** ${e.value}`)
      .join("\n\n");
    memoryParts.push(`### Recent Conversations\n${lines}`);
  }

  if (memory.project_context.length > 0) {
    const lines = memory.project_context
      .map((e) => `**${e.key}:**\n${e.value}`)
      .join("\n\n");
    memoryParts.push(`### Project Context\n${lines}`);
  }

  if (memoryParts.length === 0) return "";
  return `## Agent Memory\n\n${memoryParts.join("\n\n")}`;
}
