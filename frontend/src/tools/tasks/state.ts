export type TaskFolder = "inbox" | "archive" | "drafts" | "notifications";
export type TaskSortKey = "done" | "starred" | "type" | "projectId" | "name" | "createdAt";
export type TaskSortDirection = "asc" | "desc";

export interface TaskRecord {
  id: string;
  type: string;
  projectId: string;
  name: string;
  description: string;
  state: "draft" | "approved" | "complete" | "rejected";
  riskLevel: "low" | "medium" | "high";
  estimatedCostUsd: number;
  createdAtMs: number;
  updatedAtMs: number;
  archived: boolean;
  starred: boolean;
  agentOwner: string;
  source: "user" | "agent";
  scheduledAtMs?: number | null;
  repeat?: "none" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  repeatTimeOfDayMs?: number | null;
  repeatTimezone?: string;
  isScheduleEnabled?: boolean;
  nextRunAtMs?: number | null;
}

export interface TaskRunRecord {
  id: string;
  taskId: string;
  status: string;
  triggerReason: string;
  policyDecision: string;
  policyReason: string;
  createdAtMs: number;
  startedAtMs?: number | null;
  completedAtMs?: number | null;
  error: string;
}

export interface TaskNotificationAction {
  id: string;
  label: string;
  href?: string;
}

export interface TaskNotificationRecord {
  id: string;
  title: string;
  description: string;
  createdAtMs: number;
  read: boolean;
  tone?: "info" | "success" | "warn" | "error";
  actions: TaskNotificationAction[];
}

export interface TasksRuntimeSlice {
  tasksById: Record<string, TaskRecord>;
  tasksRunsByTaskId: Record<string, TaskRunRecord[]>;
  tasksSelectedId: string | null;
  tasksFolder: TaskFolder;
  tasksSortKey: TaskSortKey;
  tasksSortDirection: TaskSortDirection;
  tasksDetailsCollapsed: boolean;
  tasksJsonDraft: string;
  taskNotifications: TaskNotificationRecord[];
  tasksSchedulerStatus?: string;
}
