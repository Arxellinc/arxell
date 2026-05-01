import type {
  TaskFolder,
  TaskRecord,
  TaskSortDirection,
  TaskSortKey,
  TasksRuntimeSlice
} from "./state";

const TASKS_STORAGE_KEY = "arxell.tasks.v1";
const ID_ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

interface PersistedTasksPayload {
  tasksById: Record<string, TaskRecord>;
}

export function loadPersistedTasksById(): Record<string, TaskRecord> {
  try {
    const raw = window.localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedTasksPayload>;
    if (!parsed || typeof parsed !== "object" || !parsed.tasksById) return {};
    const result: Record<string, TaskRecord> = {};
    const usedTaskIds = new Set<string>();
    for (const [rawId, row] of Object.entries(parsed.tasksById)) {
      if (!row || typeof row !== "object") continue;
      if (typeof row.name !== "string" || !row.name.trim()) continue;
      const now = Date.now();
      const id = isValidEntityId(rawId, "T")
        ? rawId
        : generateEntityId("T", usedTaskIds, Object.keys(result));
      usedTaskIds.add(id);
      const projectId = normalizePersistedProjectId(
        typeof row.projectId === "string" ? row.projectId : ""
      );
      result[id] = {
        id,
        type: normalizeTaskType(typeof row.type === "string" ? row.type : ""),
        projectId,
        name: row.name,
        description: typeof row.description === "string" ? row.description : "",
        state: normalizeTaskState((row as any).state),
        riskLevel: normalizeRiskLevel((row as any).riskLevel),
        estimatedCostUsd: normalizeEstimatedCostUsd((row as any).estimatedCostUsd),
        createdAtMs: Number.isFinite(row.createdAtMs) ? row.createdAtMs : now,
        updatedAtMs: Number.isFinite(row.updatedAtMs) ? row.updatedAtMs : now,
        archived: row.archived === true || (row as any).state === "complete" || (row as any).state === "rejected",
        starred: row.starred === true,
        agentOwner: typeof row.agentOwner === "string" ? row.agentOwner : "agent"
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function persistTasksById(slice: Pick<TasksRuntimeSlice, "tasksById">): void {
  try {
    const payload: PersistedTasksPayload = {
      tasksById: slice.tasksById
    };
    window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export function createTask(slice: TasksRuntimeSlice): string {
  const now = Date.now();
  const id = generateEntityId("T", new Set(Object.keys(slice.tasksById)));
  const count = Object.keys(slice.tasksById).length + 1;
  slice.tasksById[id] = {
    id,
    type: "code",
    projectId: "",
    name: `Untitled task ${count}`,
    description: "",
    state: "draft",
    riskLevel: "low",
    estimatedCostUsd: 0,
    createdAtMs: now,
    updatedAtMs: now,
    archived: false,
    starred: false,
    agentOwner: "agent"
  };
  slice.tasksSelectedId = id;
  slice.tasksFolder = "inbox";
  persistTasksById(slice);
  return id;
}

export function selectTask(slice: TasksRuntimeSlice, taskId: string): void {
  if (!slice.tasksById[taskId]) return;
  slice.tasksSelectedId = taskId;
}

export function setTaskFolder(slice: TasksRuntimeSlice, folder: TaskFolder): void {
  slice.tasksFolder = folder;
  const selected = slice.tasksSelectedId ? slice.tasksById[slice.tasksSelectedId] : null;
  if (!selected) return;
  if (folder === "archive" && !selected.archived) {
    slice.tasksSelectedId = null;
    return;
  }
  if (folder === "inbox" && (selected.archived || !selected.projectId.trim())) {
    slice.tasksSelectedId = null;
    return;
  }
  if (folder === "drafts" && (selected.archived || selected.projectId.trim())) {
    slice.tasksSelectedId = null;
  }
}

export function setTaskSort(slice: TasksRuntimeSlice, sortKey: TaskSortKey): void {
  if (slice.tasksSortKey === sortKey) {
    slice.tasksSortDirection = slice.tasksSortDirection === "asc" ? "desc" : "asc";
    return;
  }
  slice.tasksSortKey = sortKey;
  slice.tasksSortDirection = defaultSortDirection(sortKey);
}

export function toggleTaskDone(slice: TasksRuntimeSlice, taskId: string): void {
  const row = slice.tasksById[taskId];
  if (!row) return;
  row.archived = !row.archived;
  row.state = row.archived ? "complete" : row.projectId.trim() ? "approved" : "draft";
  row.updatedAtMs = Date.now();
  if (slice.tasksFolder === "archive" && !row.archived) {
    slice.tasksSelectedId = null;
  }
  if (slice.tasksFolder === "inbox" && row.archived) {
    slice.tasksSelectedId = null;
  }
  persistTasksById(slice);
}

export function toggleTaskStar(slice: TasksRuntimeSlice, taskId: string): void {
  const row = slice.tasksById[taskId];
  if (!row) return;
  row.starred = !row.starred;
  row.updatedAtMs = Date.now();
  persistTasksById(slice);
}

export function archiveSelectedTask(slice: TasksRuntimeSlice): void {
  const selected = getSelectedTask(slice);
  if (!selected) return;
  selected.archived = true;
  selected.state = "complete";
  selected.updatedAtMs = Date.now();
  slice.tasksFolder = "archive";
  persistTasksById(slice);
}

export function unarchiveSelectedTask(slice: TasksRuntimeSlice): void {
  const selected = getSelectedTask(slice);
  if (!selected) return;
  selected.archived = false;
  selected.state = selected.projectId.trim() ? "approved" : "draft";
  selected.updatedAtMs = Date.now();
  slice.tasksFolder = "inbox";
  persistTasksById(slice);
}

export function deleteSelectedTask(slice: TasksRuntimeSlice): void {
  const taskId = slice.tasksSelectedId;
  if (!taskId) return;
  delete slice.tasksById[taskId];
  slice.tasksSelectedId = null;
  persistTasksById(slice);
}

export function updateSelectedTaskField(
  slice: TasksRuntimeSlice,
  field: "name" | "description" | "type" | "projectId" | "agentOwner" | "state" | "riskLevel" | "estimatedCostUsd",
  value: string
): void {
  const selected = getSelectedTask(slice);
  if (!selected) return;
  if (field === "projectId") {
    selected.projectId = normalizeEditableProjectId(value);
  } else if (field === "type") {
    selected.type = normalizeTaskType(value);
  } else if (field === "state") {
    selected.state = normalizeTaskState(value);
    selected.archived = selected.state === "complete" || selected.state === "rejected";
  } else if (field === "riskLevel") {
    selected.riskLevel = normalizeRiskLevel(value);
  } else if (field === "estimatedCostUsd") {
    selected.estimatedCostUsd = normalizeEstimatedCostUsd(value);
  } else {
    selected[field] = value;
  }
  selected.updatedAtMs = Date.now();
  persistTasksById(slice);
}

export function saveSelectedTask(slice: TasksRuntimeSlice): boolean {
  const selected = getSelectedTask(slice);
  if (!selected) return false;
  selected.updatedAtMs = Date.now();
  persistTasksById(slice);
  return true;
}

export function applySelectedTaskJson(slice: TasksRuntimeSlice, rawJson: string): string | null {
  const selected = getSelectedTask(slice);
  if (!selected) return "No task selected.";
  const trimmed = rawJson.trim();
  if (!trimmed) return "JSON is empty.";
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return "Invalid JSON syntax.";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Task JSON must be an object.";
  }
  const payload = parsed as Partial<TaskRecord>;
  selected.name = typeof payload.name === "string" && payload.name.trim() ? payload.name : selected.name;
  selected.description =
    typeof payload.description === "string" ? payload.description : selected.description;
  selected.type = normalizeTaskType(typeof payload.type === "string" ? payload.type : selected.type);
  selected.projectId = normalizeEditableProjectId(
    typeof payload.projectId === "string" ? payload.projectId : selected.projectId
  );
  selected.agentOwner =
    typeof payload.agentOwner === "string" && payload.agentOwner.trim()
      ? payload.agentOwner.trim()
      : selected.agentOwner;
  selected.state = normalizeTaskState((payload as any).state ?? selected.state);
  selected.riskLevel = normalizeRiskLevel((payload as any).riskLevel ?? selected.riskLevel);
  selected.estimatedCostUsd = normalizeEstimatedCostUsd((payload as any).estimatedCostUsd ?? selected.estimatedCostUsd);
  if (typeof payload.archived === "boolean") selected.archived = payload.archived;
  if (typeof payload.starred === "boolean") selected.starred = payload.starred;
  if (Number.isFinite(payload.createdAtMs)) {
    selected.createdAtMs = Number(payload.createdAtMs);
  }
  selected.updatedAtMs = Date.now();
  persistTasksById(slice);
  return null;
}

function normalizeTaskState(value: unknown): TaskRecord["state"] {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "approved" || raw === "complete" || raw === "rejected") return raw;
  return "draft";
}

function normalizeRiskLevel(value: unknown): TaskRecord["riskLevel"] {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "medium" || raw === "high") return raw;
  return "low";
}

function normalizeEstimatedCostUsd(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10000) / 10000;
}

export function setSelectedTaskStarred(slice: TasksRuntimeSlice, starred: boolean): void {
  const selected = getSelectedTask(slice);
  if (!selected) return;
  selected.starred = starred;
  selected.updatedAtMs = Date.now();
  persistTasksById(slice);
}

export function getTasksForFolder(
  slice: TasksRuntimeSlice,
  folder: TaskFolder
): TaskRecord[] {
  const rows = Object.values(slice.tasksById).filter((row) => {
    if (folder === "archive") return row.state === "complete" || row.state === "rejected";
    if (folder === "drafts") return row.state === "draft";
    return row.state === "approved";
  });
  const direction = slice.tasksSortDirection === "asc" ? 1 : -1;
  rows.sort((a, b) => compareTasks(a, b, slice.tasksSortKey) * direction);
  return rows;
}

export function getSelectedTask(slice: TasksRuntimeSlice): TaskRecord | null {
  const id = slice.tasksSelectedId;
  if (!id) return null;
  return slice.tasksById[id] ?? null;
}

function compareTasks(a: TaskRecord, b: TaskRecord, key: TaskSortKey): number {
  if (key === "done") {
    return Number(a.archived) - Number(b.archived) || b.createdAtMs - a.createdAtMs;
  }
  if (key === "starred") {
    return Number(a.starred) - Number(b.starred) || b.createdAtMs - a.createdAtMs;
  }
  if (key === "type") {
    return a.type.localeCompare(b.type, undefined, { sensitivity: "base" });
  }
  if (key === "projectId") {
    return a.projectId.localeCompare(b.projectId, undefined, { sensitivity: "base" });
  }
  if (key === "name") {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  }
  return a.createdAtMs - b.createdAtMs;
}

function defaultSortDirection(sortKey: TaskSortKey): TaskSortDirection {
  return sortKey === "createdAt" ? "desc" : "asc";
}

function isValidEntityId(value: string, prefix: "T" | "P"): boolean {
  return new RegExp(`^${prefix}[A-Za-z0-9]{6}$`).test(value);
}

function generateEntityId(prefix: "T" | "P", used: Set<string>, extraUsed?: string[]): string {
  if (extraUsed) {
    for (const value of extraUsed) used.add(value);
  }
  for (let attempt = 0; attempt < 128; attempt += 1) {
    let suffix = "";
    for (let i = 0; i < 6; i += 1) {
      suffix += ID_ALPHANUM[Math.floor(Math.random() * ID_ALPHANUM.length)] ?? "A";
    }
    const next = `${prefix}${suffix}`;
    if (!used.has(next)) return next;
  }
  return `${prefix}${Date.now().toString(36).slice(-6).padEnd(6, "0").slice(0, 6)}`;
}

function normalizePersistedProjectId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^p[A-Za-z0-9]{6}$/.test(trimmed)) return trimmed;
  return "";
}

function normalizeEditableProjectId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed;
}

function normalizeTaskType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "task") return "code";
  const cleaned = trimmed.replace(/[^a-z0-9_-]+/g, " ");
  const firstWord = cleaned.split(/\s+/).filter(Boolean)[0] ?? "";
  if (!firstWord || firstWord === "task") return "code";
  return firstWord.slice(0, 16);
}
