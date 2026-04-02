export type TaskFolder = "inbox" | "archive" | "drafts";
export type TaskSortKey = "done" | "starred" | "type" | "projectId" | "name" | "createdAt";
export type TaskSortDirection = "asc" | "desc";

export interface TaskRecord {
  id: string;
  type: string;
  projectId: string;
  name: string;
  description: string;
  createdAtMs: number;
  updatedAtMs: number;
  archived: boolean;
  starred: boolean;
  agentOwner: string;
}

export interface TasksRuntimeSlice {
  tasksById: Record<string, TaskRecord>;
  tasksSelectedId: string | null;
  tasksFolder: TaskFolder;
  tasksSortKey: TaskSortKey;
  tasksSortDirection: TaskSortDirection;
  tasksDetailsCollapsed: boolean;
  tasksJsonDraft: string;
}
