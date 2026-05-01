import { renderToolToolbar } from "../ui/toolbar";
import { TASKS_DATA_ATTR } from "../ui/constants";
import type { TaskFolder, TaskRecord, TaskRunRecord, TaskSortDirection, TaskSortKey } from "./state";
import { getSelectedTask, getTasksForFolder } from "./actions";
import type { ProjectRecord } from "../../projectsStore";
import "./styles.css";

export interface TasksToolViewState {
  tasksById: Record<string, TaskRecord>;
  selectedId: string | null;
  folder: TaskFolder;
  sortKey: TaskSortKey;
  sortDirection: TaskSortDirection;
  detailsCollapsed: boolean;
  jsonDraft?: string;
  projectsById: Record<string, ProjectRecord>;
  runsByTaskId?: Record<string, TaskRunRecord[]>;
}

export function renderTasksToolActions(view: TasksToolViewState): string {
  const selected = view.selectedId ? view.tasksById[view.selectedId] ?? null : null;
  const inArchive = view.folder === "archive";
  const inDrafts = view.folder === "drafts";
  return renderToolToolbar({
    tabsMode: "static",
    tabs: [
      {
        id: "inbox",
        label: "Tasks List",
        active: !inArchive && !inDrafts,
        buttonAttrs: {
          [TASKS_DATA_ATTR.action]: "set-folder",
          [TASKS_DATA_ATTR.folder]: "inbox"
        }
      },
      {
        id: "archive",
        label: "Archive",
        active: inArchive,
        buttonAttrs: {
          [TASKS_DATA_ATTR.action]: "set-folder",
          [TASKS_DATA_ATTR.folder]: "archive"
        }
      },
      {
        id: "drafts",
        label: "Drafts",
        active: inDrafts,
        buttonAttrs: {
          [TASKS_DATA_ATTR.action]: "set-folder",
          [TASKS_DATA_ATTR.folder]: "drafts"
        }
      }
    ],
    actions: [
      {
        id: "tasks-new",
        title: "New Task",
        icon: "plus",
        buttonAttrs: {
          [TASKS_DATA_ATTR.action]: "new-task"
        }
      },
      {
        id: "tasks-archive",
        title: "Archive Selected",
        icon: "file-output",
        disabled: !selected || selected.archived,
        buttonAttrs: {
          [TASKS_DATA_ATTR.action]: "archive-selected"
        }
      },
      {
        id: "tasks-unarchive",
        title: "Restore Selected",
        icon: "folder-open",
        disabled: !selected || !selected.archived,
        buttonAttrs: {
          [TASKS_DATA_ATTR.action]: "unarchive-selected"
        }
      },
      {
        id: "tasks-delete",
        title: "Delete Selected",
        icon: "trash-2",
        disabled: !selected,
        buttonAttrs: {
          [TASKS_DATA_ATTR.action]: "delete-selected"
        }
      }
    ]
  });
}

export function renderTasksToolBody(view: TasksToolViewState): string {
  const tasks = getTasksForFolder(
    {
      tasksById: view.tasksById,
      tasksRunsByTaskId: view.runsByTaskId || {},
      tasksSelectedId: view.selectedId,
      tasksFolder: view.folder,
      tasksSortKey: view.sortKey,
      tasksSortDirection: view.sortDirection,
      tasksDetailsCollapsed: view.detailsCollapsed,
      tasksJsonDraft: view.jsonDraft ?? ""
    },
    view.folder
  );
  const selected = getSelectedTask({
    tasksById: view.tasksById,
    tasksRunsByTaskId: view.runsByTaskId || {},
    tasksSelectedId: view.selectedId,
    tasksFolder: view.folder,
    tasksSortKey: view.sortKey,
    tasksSortDirection: view.sortDirection,
    tasksDetailsCollapsed: view.detailsCollapsed,
    tasksJsonDraft: view.jsonDraft ?? ""
  });
  const detailsCollapsed = view.detailsCollapsed === true;

  return `<div class="tasks-tool ${detailsCollapsed ? "is-details-collapsed" : ""}">
    <section class="tasks-list-pane">
      <div class="tasks-list-header">
        ${renderSortHeader("done", "Done", view)}
        ${renderSortHeader("starred", "Star", view)}
        ${renderSortHeader("type", "Type", view)}
        ${renderSortHeader("projectId", "Project", view)}
        ${renderSortHeader("name", "Task", view)}
        ${renderSortHeader("createdAt", "Created", view)}
      </div>
      <div class="tasks-list-rows">
        ${
          tasks.length
            ? tasks.map((task) => renderTaskRow(task, view.selectedId === task.id, view.projectsById)).join("")
            : `<div class="tasks-empty">${
                view.folder === "archive"
                  ? "No archived tasks."
                  : view.folder === "drafts"
                    ? "No draft tasks."
                  : "No tasks yet. Create one from the toolbar."
              }</div>`
        }
      </div>
    </section>
    <section class="tasks-details-pane">
      <div class="tasks-details-pane-top">
        <button
          type="button"
          class="tasks-pane-btn tasks-pane-icon-btn"
          ${TASKS_DATA_ATTR.action}="toggle-details-collapse"
          title="${detailsCollapsed ? "Expand details" : "Collapse details"}"
          aria-label="${detailsCollapsed ? "Expand details" : "Collapse details"}"
        >
          &#9776;
        </button>
        <button type="button" class="tasks-pane-btn" ${TASKS_DATA_ATTR.action}="run-selected" ${selected ? "" : "disabled"}>Run</button>
      </div>
      ${
        detailsCollapsed
          ? `<div class="tasks-details-empty">Details collapsed.</div>`
          : selected
            ? renderTaskDetails(selected, view.projectsById, view.jsonDraft, view.runsByTaskId?.[selected.id] || [])
            : `<div class="tasks-details-empty">Select a task to view details.</div>`
      }
    </section>
  </div>`;
}

function renderSortHeader(key: TaskSortKey, label: string, view: TasksToolViewState): string {
  const active = view.sortKey === key;
  const arrow = active ? (view.sortDirection === "asc" ? "⌃" : "⌄") : "⌄";
  if (key === "done") {
    return `<button type="button" class="tasks-col-head tasks-col-head-check ${active ? "is-active" : ""}" ${TASKS_DATA_ATTR.action}="sort-column" ${TASKS_DATA_ATTR.sort}="${key}" title="Sort by completion">
      <span class="tasks-col-head-checkbox" aria-hidden="true">☑</span><span class="tasks-col-head-arrow">${arrow}</span>
    </button>`;
  }
  if (key === "starred") {
    return `<button type="button" class="tasks-col-head tasks-col-head-star ${active ? "is-active" : ""}" ${TASKS_DATA_ATTR.action}="sort-column" ${TASKS_DATA_ATTR.sort}="${key}" title="Sort by priority">
      <span class="tasks-col-head-star" aria-hidden="true">☆</span><span class="tasks-col-head-arrow">${arrow}</span>
    </button>`;
  }
  return `<button type="button" class="tasks-col-head ${key === "createdAt" ? "tasks-col-head-created " : ""}${active ? "is-active" : ""}" ${TASKS_DATA_ATTR.action}="sort-column" ${TASKS_DATA_ATTR.sort}="${key}">${label}<span class="tasks-col-head-arrow">${arrow}</span></button>`;
}

function renderTaskRow(task: TaskRecord, selected: boolean, projectsById: Record<string, ProjectRecord>): string {
  return `<div class="tasks-row ${selected ? "is-selected" : ""}" role="button" tabindex="0" ${TASKS_DATA_ATTR.action}="select-task" ${TASKS_DATA_ATTR.taskId}="${escapeAttr(task.id)}">
    <span class="tasks-cell tasks-cell-check">
      <button type="button" class="tasks-check-btn ${task.archived ? "is-checked" : ""}" ${TASKS_DATA_ATTR.action}="toggle-task-done" ${TASKS_DATA_ATTR.taskId}="${escapeAttr(task.id)}" title="Toggle done">
        ${task.archived ? "☑" : "☐"}
      </button>
    </span>
    <span class="tasks-cell tasks-cell-star"><button type="button" class="tasks-star-btn ${task.starred ? "is-starred" : ""}" ${TASKS_DATA_ATTR.action}="toggle-task-star" ${TASKS_DATA_ATTR.taskId}="${escapeAttr(task.id)}">${task.starred ? "★" : "☆"}</button></span>
    <span class="tasks-cell">${escapeHtml(task.type || "code")}</span>
    <span class="tasks-cell tasks-mono">${task.projectId ? escapeHtml(projectsById[task.projectId]?.name ?? task.projectId) : "—"}</span>
    <span class="tasks-cell tasks-task-name">${escapeHtml(task.name)} <span class="tasks-current-pill">${escapeHtml(task.state)}</span></span>
    <span class="tasks-cell tasks-cell-created tasks-mono">${escapeHtml(formatDate(task.createdAtMs))}</span>
  </div>`;
}

function renderTaskDetails(task: TaskRecord, projectsById: Record<string, ProjectRecord>, jsonDraft: string | undefined, runs: TaskRunRecord[]): string {
  const taskJson = typeof jsonDraft === "string" ? jsonDraft : JSON.stringify(task, null, 2);
  return `<div class="tasks-details">
    <div class="tasks-details-top">
      <label class="tasks-details-star">
        <input type="checkbox" ${TASKS_DATA_ATTR.field}="starred" ${task.starred ? "checked" : ""} />
        <span>Priority</span>
      </label>
      <span class="tasks-details-meta">${task.archived ? "Archived" : "Active"}</span>
    </div>
    <label class="tasks-field">
      <span>Name</span>
      <input type="text" value="${escapeAttr(task.name)}" ${TASKS_DATA_ATTR.field}="name" />
    </label>
    <label class="tasks-field-grid">
      <span>Type</span>
      <div class="tasks-chip-row">
        ${renderChipButtons(TYPE_OPTIONS, task.type, "set-type")}
      </div>
    </label>
    ${
      TYPE_OPTIONS.includes(task.type)
        ? ""
        : `<div class="tasks-current-pill">Current type: <span class="tasks-mono">${escapeHtml(task.type)}</span></div>`
    }
    <label class="tasks-field-grid">
      <span>Model</span>
      <div class="tasks-chip-row">
        ${renderChipButtons(MODEL_OPTIONS, task.agentOwner, "set-model")}
      </div>
    </label>
    ${
      MODEL_OPTIONS.includes(task.agentOwner)
        ? ""
        : `<div class="tasks-current-pill">Current model: <span class="tasks-mono">${escapeHtml(task.agentOwner)}</span></div>`
    }
    <label class="tasks-field-grid">
      <span>State</span>
      <select ${TASKS_DATA_ATTR.field}="state" class="tasks-field-select">
        <option value="draft" ${task.state === "draft" ? "selected" : ""}>Draft</option>
        <option value="approved" ${task.state === "approved" ? "selected" : ""}>Approved</option>
        <option value="complete" ${task.state === "complete" ? "selected" : ""}>Complete</option>
        <option value="rejected" ${task.state === "rejected" ? "selected" : ""}>Rejected</option>
      </select>
    </label>
    <label class="tasks-field-grid">
      <span>Risk</span>
      <select ${TASKS_DATA_ATTR.field}="riskLevel" class="tasks-field-select">
        <option value="low" ${task.riskLevel === "low" ? "selected" : ""}>Low</option>
        <option value="medium" ${task.riskLevel === "medium" ? "selected" : ""}>Medium</option>
        <option value="high" ${task.riskLevel === "high" ? "selected" : ""}>High</option>
      </select>
    </label>
    <label class="tasks-field">
      <span>Estimated Cost (USD)</span>
      <input type="number" min="0" step="0.0001" value="${escapeAttr(task.estimatedCostUsd.toFixed(4))}" ${TASKS_DATA_ATTR.field}="estimatedCostUsd" />
    </label>
    <label class="tasks-field-grid">
      <span>Project</span>
      <select ${TASKS_DATA_ATTR.field}="projectId" class="tasks-field-select">
        <option value="" ${!task.projectId ? "selected" : ""}>No project</option>
        ${Object.values(projectsById).map((p) =>
          `<option value="${escapeAttr(p.id)}" ${task.projectId === p.id ? "selected" : ""}>${escapeHtml(p.name)} (${p.id})</option>`
        ).join("")}
      </select>
    </label>
    <label class="tasks-field">
      <span>Description</span>
      <textarea ${TASKS_DATA_ATTR.field}="description">${escapeHtml(task.description)}</textarea>
    </label>
    <div class="tasks-field-actions">
      <button type="button" class="tasks-pane-btn" ${TASKS_DATA_ATTR.action}="save-selected">Save</button>
      <button type="button" class="tasks-pane-btn" ${TASKS_DATA_ATTR.action}="approve-task" ${task.state === "approved" ? "disabled" : ""}>Approve</button>
      <button type="button" class="tasks-pane-btn" ${TASKS_DATA_ATTR.action}="reject-task" ${task.state === "rejected" ? "disabled" : ""}>Reject</button>
    </div>
    <div class="tasks-details-meta-block">
      <div>Created: ${escapeHtml(formatDate(task.createdAtMs))}</div>
      <div>Updated: ${escapeHtml(formatDate(task.updatedAtMs))}</div>
      <div>ID: <span class="tasks-mono">${escapeHtml(task.id)}</span></div>
    </div>
    <div class="tasks-details-meta-block">
      <div><strong>Run History</strong></div>
      ${
        runs.length
          ? runs
              .slice(0, 5)
              .map(
                (run) =>
                  `<div>${escapeHtml(formatDate(run.createdAtMs))} - ${escapeHtml(run.status)} (${escapeHtml(
                    run.policyDecision || "allow"
                  )})${run.error ? ` - ${escapeHtml(run.error)}` : ""}</div>`
              )
              .join("")
          : `<div>No runs yet.</div>`
      }
    </div>
    <div class="tasks-json-block">
      <div class="tasks-json-head">
        <span>Task JSON</span>
        <button type="button" class="tasks-pane-btn" ${TASKS_DATA_ATTR.action}="apply-json">Apply JSON</button>
        <button type="button" class="tasks-pane-btn" ${TASKS_DATA_ATTR.action}="copy-json">Copy</button>
      </div>
      <textarea class="tasks-json" ${TASKS_DATA_ATTR.field}="jsonDraft">${escapeHtml(taskJson)}</textarea>
    </div>
  </div>`;
}

const TYPE_OPTIONS = ["code", "review", "research", "search", "think", "write", "read", "collect"];
const MODEL_OPTIONS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "o4-mini", "local"];

function renderChipButtons(options: string[], selected: string, action: "set-type" | "set-model"): string {
  return options
    .map((option) => {
      const active = option === selected;
      return `<button type="button" class="tasks-chip-btn ${active ? "is-active" : ""}" ${TASKS_DATA_ATTR.action}="${action}" ${TASKS_DATA_ATTR.value}="${escapeAttr(option)}">${escapeHtml(option)}</button>`;
    })
    .join("");
}

function formatDate(value: number): string {
  const d = new Date(value);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yy}${mm}${dd}-${hh}:${min}`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
