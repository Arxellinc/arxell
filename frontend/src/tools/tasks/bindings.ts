import {
  applySelectedTaskJson,
  archiveSelectedTask,
  createTask,
  deleteSelectedTask,
  saveSelectedTask,
  selectTask,
  setSelectedTaskStarred,
  setTaskFolder,
  setTaskSort,
  toggleTaskDone,
  toggleTaskStar,
  unarchiveSelectedTask,
  updateSelectedTaskField
} from "./actions";
import type { TaskFolder, TaskSortKey, TasksRuntimeSlice } from "./state";
import { TASKS_DATA_ATTR } from "../ui/constants";

type TasksSlice = TasksRuntimeSlice & {
  tasksError?: string | null;
};

function asSortKey(value: string | null): TaskSortKey | null {
  if (
    value === "done" ||
    value === "starred" ||
    value === "type" ||
    value === "projectId" ||
    value === "name" ||
    value === "createdAt"
  ) {
    return value;
  }
  return null;
}

function asFolder(value: string | null): TaskFolder | null {
  if (value === "inbox" || value === "archive" || value === "drafts") return value;
  return null;
}

export async function handleTasksClick(target: HTMLElement, slice: TasksSlice): Promise<boolean> {
  const actionTarget = target.closest<HTMLElement>(`[${TASKS_DATA_ATTR.action}]`);
  const action = actionTarget?.getAttribute(TASKS_DATA_ATTR.action);
  if (!action) return false;
  const taskId = actionTarget?.getAttribute(TASKS_DATA_ATTR.taskId);

  if (action === "new-task") {
    createTask(slice);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "archive-selected") {
    archiveSelectedTask(slice);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "unarchive-selected") {
    unarchiveSelectedTask(slice);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "delete-selected") {
    const selected = slice.tasksSelectedId;
    if (!selected) return true;
    const confirmed = window.confirm("Delete selected task?");
    if (!confirmed) return true;
    deleteSelectedTask(slice);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "toggle-details-collapse") {
    slice.tasksDetailsCollapsed = !slice.tasksDetailsCollapsed;
    return true;
  }
  if (action === "run-selected") {
    const selected = slice.tasksSelectedId;
    if (!selected) return true;
    const task = slice.tasksById[selected];
    if (!task) return true;
    task.updatedAtMs = Date.now();
    syncJsonDraftFromSelected(slice);
    slice.tasksError = `Run requested for ${task.id}`;
    persistToastMessage(slice.tasksError);
    return true;
  }
  if (action === "copy-json") {
    const selected = slice.tasksSelectedId;
    if (!selected) return true;
    const task = slice.tasksById[selected];
    if (!task) return true;
    void copyText(JSON.stringify(task, null, 2));
    slice.tasksError = null;
    return true;
  }
  if (action === "save-selected") {
    if (saveSelectedTask(slice)) {
      syncJsonDraftFromSelected(slice);
      slice.tasksError = null;
    }
    return true;
  }
  if (action === "apply-json") {
    const raw = getJsonDraftValue(target, slice);
    const error = applySelectedTaskJson(slice, raw);
    if (error) {
      slice.tasksError = error;
      persistToastMessage(error);
      return true;
    }
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "set-type") {
    const value = actionTarget?.getAttribute(TASKS_DATA_ATTR.value);
    if (!value) return true;
    updateSelectedTaskField(slice, "type", value);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "set-model") {
    const value = actionTarget?.getAttribute(TASKS_DATA_ATTR.value);
    if (!value) return true;
    updateSelectedTaskField(slice, "agentOwner", value);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "select-task" && taskId) {
    selectTask(slice, taskId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "toggle-task-done" && taskId) {
    toggleTaskDone(slice, taskId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "toggle-task-star" && taskId) {
    toggleTaskStar(slice, taskId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "set-folder") {
    const folder = asFolder(actionTarget?.getAttribute(TASKS_DATA_ATTR.folder) ?? null);
    if (!folder) return true;
    setTaskFolder(slice, folder);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "sort-column") {
    const sort = asSortKey(actionTarget?.getAttribute(TASKS_DATA_ATTR.sort) ?? null);
    if (!sort) return true;
    setTaskSort(slice, sort);
    slice.tasksError = null;
    return true;
  }
  return false;
}

export function handleTasksInput(target: HTMLElement, slice: TasksSlice): boolean {
  const field = target.getAttribute(TASKS_DATA_ATTR.field);
  if (!field) return false;
  const input = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (field === "jsonDraft") {
    slice.tasksJsonDraft = input.value;
    return false;
  }
  if (
    field === "name" ||
    field === "description" ||
    field === "type" ||
    field === "projectId" ||
    field === "agentOwner"
  ) {
    updateSelectedTaskField(slice, field, input.value);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (field === "starred" && input instanceof HTMLInputElement) {
    setSelectedTaskStarred(slice, input.checked);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  return false;
}

export function handleTasksChange(target: HTMLElement, slice: TasksSlice): boolean {
  if (!(target instanceof HTMLSelectElement)) return false;
  return handleTasksInput(target, slice);
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }
}

function persistToastMessage(_value: string): void {
  // Placeholder for future status banner integration.
}

function getJsonDraftValue(target: HTMLElement, slice: TasksSlice): string {
  if (slice.tasksJsonDraft) return slice.tasksJsonDraft;
  const root = target.closest(".tasks-tool");
  if (!root) return "";
  const input = root.querySelector(
    `textarea[${TASKS_DATA_ATTR.field}="jsonDraft"]`
  ) as HTMLTextAreaElement | null;
  return input?.value ?? "";
}

function syncJsonDraftFromSelected(slice: TasksSlice): void {
  const selected = slice.tasksSelectedId ? slice.tasksById[slice.tasksSelectedId] : null;
  slice.tasksJsonDraft = selected ? JSON.stringify(selected, null, 2) : "";
}
