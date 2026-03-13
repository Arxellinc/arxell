import { create } from "zustand";

export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type TaskCreator = "user" | "agent";
export type TaskLatitude = "low" | "med" | "high";

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  project_id: string | null;
  project_name: string;
  priority: number; // 0-100
  latitude: TaskLatitude;
  status: TaskStatus;
  dependencies: string[];
  due_at: string | null;
  estimated_effort_hours: number | null;
  created_by: TaskCreator;
  acceptance_criteria: string[];
  constraints: string[];
  attempt_count: number;
  last_error: string | null;
  next_review_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StreamingTask {
  title: string;
  description: string;
}

interface TaskState {
  tasks: AgentTask[];
  streamingTask: StreamingTask | null;
  setStreamingTask: (task: StreamingTask | null) => void;
  addTask: (
    task: Omit<AgentTask, "id" | "created_at" | "updated_at" | "latitude"> & {
      latitude?: TaskLatitude;
    }
  ) => AgentTask;
  updateTask: (
    id: string,
    patch: Partial<
      Pick<
        AgentTask,
        | "title"
        | "description"
        | "project_id"
        | "project_name"
        | "priority"
        | "latitude"
        | "status"
        | "dependencies"
        | "due_at"
        | "estimated_effort_hours"
        | "acceptance_criteria"
        | "constraints"
        | "attempt_count"
        | "last_error"
        | "next_review_at"
      >
    >
  ) => void;
  removeTask: (id: string) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "T";
  for (let i = 0; i < 5; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export const TASK_DESCRIPTION_TEMPLATE = `## Background
- Why this task exists.

## Objective
- What success looks like.

## Inputs
- Relevant files, data, APIs, or context.

## Skills
- Required capabilities (coding, research, testing, etc.).

## Expected Outputs
- Concrete deliverables.
`;

export function areDependenciesComplete(task: AgentTask, allTasks: AgentTask[]): boolean {
  const dependencies = Array.isArray((task as Partial<AgentTask>).dependencies)
    ? (task as Partial<AgentTask>).dependencies!
    : [];
  if (dependencies.length === 0) return true;
  const completed = new Set(allTasks.filter((t) => t.status === "completed").map((t) => t.id));
  return dependencies.every((dep) => completed.has(dep));
}

export function computeTaskScore(task: AgentTask, allTasks: AgentTask[], now = new Date()): number {
  const priority = Number.isFinite((task as Partial<AgentTask>).priority)
    ? (task as Partial<AgentTask>).priority!
    : 50;
  let score = priority;

  if (task.status !== "pending") {
    return -10_000;
  }

  const depsReady = areDependenciesComplete(task, allTasks);
  score += depsReady ? 10 : -40;

  const latitude = (task as Partial<AgentTask>).latitude ?? "med";
  score += latitude === "high" ? 12 : latitude === "med" ? 5 : 0;

  const effort = (task as Partial<AgentTask>).estimated_effort_hours ?? null;
  if (effort !== null) {
    score -= Math.min(20, effort * 2);
  }

  const attempts = Number.isFinite((task as Partial<AgentTask>).attempt_count)
    ? (task as Partial<AgentTask>).attempt_count!
    : 0;
  score -= Math.min(20, attempts * 4);

  const nextReviewAt = (task as Partial<AgentTask>).next_review_at ?? null;
  if (nextReviewAt) {
    const reviewAt = new Date(nextReviewAt).getTime();
    if (reviewAt > now.getTime()) {
      score -= 50;
    }
  }

  return score;
}

const INITIAL_TASKS: AgentTask[] = [
  {
    id: "TA1B2C",
    title: "Audit API panel verification flow",
    description: `## Background
The API panel verification behavior has changed and needs regression checks.

## Objective
Confirm verification works for all configured endpoints and models.

## Inputs
- Existing API account entries in the API panel.
- Verification status messages and latency indicators.

## Skills
- UI validation
- API troubleshooting
- Log inspection

## Expected Outputs
- Verified pass/fail status for each API account.
- A short list of failing accounts with reasons.
`,
    project_id: null,
    project_name: "General",
    priority: 75,
    latitude: "med",
    status: "pending",
    dependencies: [],
    due_at: null,
    estimated_effort_hours: 1,
    created_by: "user",
    acceptance_criteria: [
      "All testable API accounts were verified at least once.",
      "Any failure includes endpoint/model/error detail.",
    ],
    constraints: [],
    attempt_count: 0,
    last_error: null,
    next_review_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  },
  {
    id: "TD4E5F",
    title: "Document task automation behavior",
    description: `## Background
Auto mode should process tasks from the queue in a predictable order.

## Objective
Define and validate expected task lifecycle behavior.

## Inputs
- Task queue in the Tasks panel.
- Auto mode behavior in the chat header mode dropdown.

## Skills
- Product documentation
- Behavioral testing

## Expected Outputs
- A concise behavior note describing task creation, execution, and completion.
`,
    project_id: null,
    project_name: "General",
    priority: 65,
    latitude: "med",
    status: "pending",
    dependencies: ["TA1B2C"],
    due_at: null,
    estimated_effort_hours: 1,
    created_by: "user",
    acceptance_criteria: [
      "Document explains ordering and status transitions.",
      "Includes how blocked/dependent tasks are handled.",
    ],
    constraints: [],
    attempt_count: 0,
    last_error: null,
    next_review_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  },
];

export const useTaskStore = create<TaskState>((set) => ({
  tasks: INITIAL_TASKS,
  streamingTask: null,
  setStreamingTask: (task) => set({ streamingTask: task }),

  addTask: (task) => {
    const created: AgentTask = {
      ...task,
      latitude: task.latitude ?? "med",
      id: makeId(),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    set((state) => ({ tasks: [created, ...state.tasks] }));
    return created;
  },

  updateTask: (id, patch) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              ...patch,
              updated_at: nowIso(),
            }
          : task
      ),
    })),

  removeTask: (id) =>
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
}));
