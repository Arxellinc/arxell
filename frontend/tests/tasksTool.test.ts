import test from "node:test";
import assert from "node:assert/strict";

import {
  applySelectedTaskJson,
  createTask,
  getTasksForFolder,
  toggleTaskDone,
  updateSelectedTaskField
} from "../src/tools/tasks/actions.js";
import type { TasksRuntimeSlice } from "../src/tools/tasks/state.js";

function createSlice(): TasksRuntimeSlice {
  return {
    tasksById: {},
    tasksRunsByTaskId: {},
    tasksSelectedId: null,
    tasksFolder: "inbox",
    tasksSortKey: "createdAt",
    tasksSortDirection: "desc",
    tasksDetailsCollapsed: false,
    tasksJsonDraft: ""
  };
}

test("new task defaults to draft/low/zero-cost", () => {
  const slice = createSlice();
  const id = createTask(slice);
  const row = slice.tasksById[id];
  assert.ok(row);
  assert.equal(row.state, "draft");
  assert.equal(row.riskLevel, "low");
  assert.equal(row.estimatedCostUsd, 0);
});

test("folder mapping uses simplified task states", () => {
  const slice = createSlice();
  const d = createTask(slice);
  const a = createTask(slice);
  const c = createTask(slice);
  const r = createTask(slice);

  updateSelectedTaskField(slice, "state", "draft");
  slice.tasksSelectedId = a;
  updateSelectedTaskField(slice, "state", "approved");
  slice.tasksSelectedId = c;
  updateSelectedTaskField(slice, "state", "complete");
  slice.tasksSelectedId = r;
  updateSelectedTaskField(slice, "state", "rejected");
  slice.tasksSelectedId = d;

  const drafts = getTasksForFolder(slice, "drafts").map((t) => t.id);
  const inbox = getTasksForFolder(slice, "inbox").map((t) => t.id);
  const archive = getTasksForFolder(slice, "archive").map((t) => t.id);

  assert.deepEqual(drafts, [d]);
  assert.ok(inbox.includes(a));
  assert.ok(archive.includes(c));
  assert.ok(archive.includes(r));
});

test("toggle done moves approved task to complete", () => {
  const slice = createSlice();
  const id = createTask(slice);
  slice.tasksSelectedId = id;
  updateSelectedTaskField(slice, "projectId", "P123456");
  updateSelectedTaskField(slice, "state", "approved");

  toggleTaskDone(slice, id);
  assert.equal(slice.tasksById[id]?.state, "complete");

  toggleTaskDone(slice, id);
  assert.equal(slice.tasksById[id]?.state, "approved");
});

test("json apply keeps allowed state/risk and cost normalization", () => {
  const slice = createSlice();
  const id = createTask(slice);
  slice.tasksSelectedId = id;
  const err = applySelectedTaskJson(
    slice,
    JSON.stringify({ state: "approved", riskLevel: "medium", estimatedCostUsd: 1.234567 })
  );
  assert.equal(err, null);
  const row = slice.tasksById[id];
  assert.equal(row?.state, "approved");
  assert.equal(row?.riskLevel, "medium");
  assert.equal(row?.estimatedCostUsd, 1.2346);
});
