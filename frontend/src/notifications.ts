import type { TaskNotificationRecord } from "./tools/tasks/state";

export type NotificationTone = "info" | "success" | "warn" | "error";

export interface NotificationInput {
  title: string;
  description: string;
  tone?: NotificationTone;
  actions?: Array<{ id: string; label: string; href?: string }>;
}

export function createNotificationRecord(input: NotificationInput): TaskNotificationRecord {
  return {
    id: `N${Date.now()}${Math.floor(Math.random() * 1000)}`,
    title: input.title,
    description: input.description,
    createdAtMs: Date.now(),
    read: false,
    tone: input.tone || "info",
    actions: input.actions || []
  };
}
