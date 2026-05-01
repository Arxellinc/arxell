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
import type { ChatIpcClient } from "../../ipcClient";

type TasksSlice = TasksRuntimeSlice & {
  tasksError?: string | null;
};

interface TasksDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
}

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

export async function handleTasksClick(target: HTMLElement, slice: TasksSlice, deps?: TasksDeps): Promise<boolean> {
  const actionTarget = target.closest<HTMLElement>(`[${TASKS_DATA_ATTR.action}]`);
  const action = actionTarget?.getAttribute(TASKS_DATA_ATTR.action);
  if (!action) return false;
  const taskId = actionTarget?.getAttribute(TASKS_DATA_ATTR.taskId);

  if (action === "new-task") {
    const id = createTask(slice);
    await syncTaskToBackend(slice, deps, id);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "archive-selected") {
    const selectedId = slice.tasksSelectedId;
    archiveSelectedTask(slice);
    if (selectedId) await syncTaskToBackend(slice, deps, selectedId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "unarchive-selected") {
    const selectedId = slice.tasksSelectedId;
    unarchiveSelectedTask(slice);
    if (selectedId) await syncTaskToBackend(slice, deps, selectedId);
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
    if (deps?.client) {
      await deleteTaskFromBackend(deps, selected);
    }
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
    if ((slice as any).autoSafeEnabled && task.riskLevel !== "low") {
      slice.tasksError = "Auto Safe allows low-risk tasks only. Approve manually or lower risk.";
      persistToastMessage(slice.tasksError);
      return true;
    }
    task.updatedAtMs = Date.now();
    await runTaskNow(deps, task.id);
    await loadTaskRuns(slice, deps, task.id);
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
      if (slice.tasksSelectedId) await syncTaskToBackend(slice, deps, slice.tasksSelectedId);
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
    if (slice.tasksSelectedId) await syncTaskToBackend(slice, deps, slice.tasksSelectedId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "set-type") {
    const value = actionTarget?.getAttribute(TASKS_DATA_ATTR.value);
    if (!value) return true;
    updateSelectedTaskField(slice, "type", value);
    if (slice.tasksSelectedId) await syncTaskToBackend(slice, deps, slice.tasksSelectedId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "approve-task") {
    updateSelectedTaskField(slice, "state", "approved");
    if (slice.tasksSelectedId) await syncTaskToBackend(slice, deps, slice.tasksSelectedId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "reject-task") {
    updateSelectedTaskField(slice, "state", "rejected");
    if (slice.tasksSelectedId) await syncTaskToBackend(slice, deps, slice.tasksSelectedId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "set-model") {
    const value = actionTarget?.getAttribute(TASKS_DATA_ATTR.value);
    if (!value) return true;
    updateSelectedTaskField(slice, "agentOwner", value);
    if (slice.tasksSelectedId) await syncTaskToBackend(slice, deps, slice.tasksSelectedId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "select-task" && taskId) {
    selectTask(slice, taskId);
    await loadTaskRuns(slice, deps, taskId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "toggle-task-done" && taskId) {
    toggleTaskDone(slice, taskId);
    await syncTaskToBackend(slice, deps, taskId);
    syncJsonDraftFromSelected(slice);
    slice.tasksError = null;
    return true;
  }
  if (action === "toggle-task-star" && taskId) {
    toggleTaskStar(slice, taskId);
    await syncTaskToBackend(slice, deps, taskId);
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
    field === "agentOwner" ||
    field === "state" ||
    field === "riskLevel" ||
    field === "estimatedCostUsd"
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

export async function syncAllTasksFromBackend(slice: TasksSlice, deps?: TasksDeps): Promise<void> {
  if (!deps?.client) return;
  try {
    const correlationId = deps.nextCorrelationId();
    const invokeResponse = await deps.client.toolInvoke({
      correlationId,
      toolId: "tasks",
      action: "list",
      mode: "sandbox",
      payload: { correlationId }
    });
    if (!invokeResponse.ok) return;
    const rows = (invokeResponse.data as any)?.tasks;
    if (!Array.isArray(rows)) return;
    const next: Record<string, any> = {};
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof row.id !== "string") continue;
      next[row.id] = {
        id: row.id,
        type: typeof row.taskType === "string" ? row.taskType : "code",
        projectId: typeof row.projectId === "string" ? row.projectId : "",
        name: typeof row.name === "string" ? row.name : "Untitled task",
        description: typeof row.description === "string" ? row.description : "",
        state: row.state === "approved" || row.state === "complete" || row.state === "rejected" ? row.state : "draft",
        riskLevel: row.riskLevel === "medium" || row.riskLevel === "high" ? row.riskLevel : "low",
        estimatedCostUsd:
          Number.isFinite(row.estimatedCostUsd)
            ? Number(row.estimatedCostUsd)
            : Number.isFinite(row.estimateJson?.estimatedCostUsd)
              ? Number(row.estimateJson.estimatedCostUsd)
              : 0,
        createdAtMs: Number.isFinite(row.createdAtMs) ? row.createdAtMs : Date.now(),
        updatedAtMs: Number.isFinite(row.updatedAtMs) ? row.updatedAtMs : Date.now(),
        archived: row.state === "complete" || row.state === "rejected",
        starred: false,
        agentOwner: typeof row.agentOwner === "string" ? row.agentOwner : "agent"
      };
    }
    slice.tasksById = next;
    const selected = slice.tasksSelectedId;
    if (selected) {
      await loadTaskRuns(slice, deps, selected);
    }
  } catch {
    // no-op fallback to local state
  }
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

async function syncTaskToBackend(slice: TasksSlice, deps: TasksDeps | undefined, taskId: string): Promise<void> {
  if (!deps?.client) return;
  const task = slice.tasksById[taskId];
  if (!task) return;
  const correlationId = deps.nextCorrelationId();
  const state = task.state || (task.archived ? "complete" : task.projectId.trim() ? "approved" : "draft");
  const projectRootPath =
    task.projectId && (slice as any).projectsById?.[task.projectId]?.rootPath
      ? String((slice as any).projectsById[task.projectId].rootPath)
      : "";
  await deps.client.toolInvoke({
    correlationId,
    toolId: "tasks",
    action: "upsert",
    mode: "sandbox",
    payload: {
      correlationId,
      task: {
        id: task.id,
        projectId: projectRootPath || task.projectId,
        name: task.name,
        description: task.description,
        taskType: task.type,
        agentOwner: task.agentOwner,
        state,
        riskLevel: task.riskLevel,
        payloadKind: "agent_prompt",
        payloadJson: { prompt: task.description || task.name },
        estimateJson: { estimatedCostUsd: task.estimatedCostUsd },
        estimatedCostUsd: task.estimatedCostUsd,
        createdAtMs: task.createdAtMs,
        updatedAtMs: task.updatedAtMs
      }
    }
  });
}

async function deleteTaskFromBackend(deps: TasksDeps, taskId: string): Promise<void> {
  if (!deps.client) return;
  const correlationId = deps.nextCorrelationId();
  await deps.client.toolInvoke({
    correlationId,
    toolId: "tasks",
    action: "delete",
    mode: "sandbox",
    payload: { correlationId, taskId }
  });
}

async function runTaskNow(deps: TasksDeps | undefined, taskId: string): Promise<void> {
  if (!deps?.client) return;
  const correlationId = deps.nextCorrelationId();
  await deps.client.toolInvoke({
    correlationId,
    toolId: "tasks",
    action: "run-now",
    mode: "sandbox",
    payload: { correlationId, taskId }
  });
}

async function loadTaskRuns(slice: TasksSlice, deps: TasksDeps | undefined, taskId: string): Promise<void> {
  if (!deps?.client) return;
  const correlationId = deps.nextCorrelationId();
  const resp = await deps.client.toolInvoke({
    correlationId,
    toolId: "tasks",
    action: "list-runs",
    mode: "sandbox",
    payload: { correlationId, taskId }
  });
  if (!resp.ok) return;
  const runs = Array.isArray((resp.data as any)?.runs) ? (resp.data as any).runs : [];
  (slice as any).tasksRunsByTaskId = {
    ...((slice as any).tasksRunsByTaskId || {}),
    [taskId]: runs.map((run: any) => ({
      id: String(run.id || ""),
      taskId: String(run.taskId || taskId),
      status: String(run.status || ""),
      triggerReason: String(run.triggerReason || ""),
      policyDecision: String(run.policyDecision || ""),
      policyReason: String(run.policyReason || ""),
      createdAtMs: Number.isFinite(run.createdAtMs) ? Number(run.createdAtMs) : Date.now(),
      startedAtMs: Number.isFinite(run.startedAtMs) ? Number(run.startedAtMs) : null,
      completedAtMs: Number.isFinite(run.completedAtMs) ? Number(run.completedAtMs) : null,
      error: String(run.error || "")
    }))
  };
}
