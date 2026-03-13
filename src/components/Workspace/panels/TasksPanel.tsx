import {
  ListTodo,
  Plus,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../store/chatStore";
import { ensureDefaultProjectId } from "../../../hooks/useChat";
import {
  useTaskStore,
  type AgentTask,
  type TaskLatitude,
  type TaskStatus,
  computeTaskScore,
  areDependenciesComplete,
  TASK_DESCRIPTION_TEMPLATE,
} from "../../../store/taskStore";
import { PanelWrapper } from "./shared";
import { SplitPaneLayout, SidebarItem, SidebarSearch, SidebarSection } from "./SplitPaneLayout";

export function TasksPanel() {
  const { projects } = useChatStore();
  const { tasks, addTask, updateTask, removeTask, streamingTask } = useTaskStore();
  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const scoreDiff = computeTaskScore(b, tasks) - computeTaskScore(a, tasks);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }),
    [tasks]
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(sortedTasks[0]?.id ?? null);
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createProjectId, setCreateProjectId] = useState<string>("");
  const [createPriority, setCreatePriority] = useState("50");
  const [createLatitude, setCreateLatitude] = useState<TaskLatitude>("med");
  const [createEffortHours, setCreateEffortHours] = useState("");
  const [createDetails, setCreateDetails] = useState(TASK_DESCRIPTION_TEMPLATE);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  const selectedTask = sortedTasks.find((task) => task.id === selectedTaskId) ?? null;

  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects]
  );

  // Filter tasks by search
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return sortedTasks;
    const query = searchQuery.toLowerCase();
    return sortedTasks.filter(
      (task) =>
        task.title.toLowerCase().includes(query) ||
        task.description.toLowerCase().includes(query) ||
        task.project_name.toLowerCase().includes(query)
    );
  }, [sortedTasks, searchQuery]);

  // Group tasks by project
  const groupedTasks = useMemo(() => {
    const groups: Record<string, typeof filteredTasks> = {};
    for (const task of filteredTasks) {
      const projectName = task.project_name || "Uncategorized";
      if (!groups[projectName]) {
        groups[projectName] = [];
      }
      groups[projectName].push(task);
    }
    // Sort projects alphabetically
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTasks]);

  const toggleProject = (projectName: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!selectedTaskId && sortedTasks.length > 0) {
      setSelectedTaskId(sortedTasks[0].id);
    }
  }, [selectedTaskId, sortedTasks]);

  useEffect(() => {
    if (!createProjectId && projectOptions.length > 0) {
      const fallback =
        projectOptions.find((p) => p.name.trim().toLowerCase() === "general") ?? projectOptions[0];
      setCreateProjectId(fallback?.id ?? "");
    }
  }, [createProjectId, projectOptions]);

  useEffect(() => {
    let cancelled = false;
    const normalizeLegacyTaskProjectIds = async () => {
      if (tasks.every((task) => task.project_id && task.project_id !== "general")) return;
      const defaultProjectId = await ensureDefaultProjectId();
      const defaultProject =
        useChatStore.getState().projects.find((p) => p.id === defaultProjectId) ?? null;
      if (cancelled) return;
      tasks.forEach((task) => {
        if (!task.project_id || task.project_id === "general") {
          updateTask(task.id, {
            project_id: defaultProjectId,
            project_name: defaultProject?.name ?? "General",
          });
        }
      });
    };
    void normalizeLegacyTaskProjectIds();
    return () => {
      cancelled = true;
    };
  }, [tasks, updateTask]);

  const createTask = () => {
    const title = createTitle.trim();
    if (!title) return;
    const project = projectOptions.find((p) => p.id === createProjectId) ?? projectOptions[0] ?? null;
    const priority = Math.min(100, Math.max(0, Number(createPriority) || 0));
    const effort = createEffortHours.trim() ? Number(createEffortHours) : null;
    if (!project) return;
    const created = addTask({
      title,
      description: createDetails.trim() || TASK_DESCRIPTION_TEMPLATE,
      status: "pending",
      priority,
      latitude: createLatitude,
      project_id: project.id,
      project_name: project.name,
      dependencies: [],
      due_at: null,
      estimated_effort_hours: Number.isFinite(effort) ? effort : null,
      created_by: "user",
      acceptance_criteria: [],
      constraints: [],
      attempt_count: 0,
      last_error: null,
      next_review_at: null,
    });
    setSelectedTaskId(created.id);
    setCreateTitle("");
    setCreateProjectId(project.id);
    setCreatePriority("50");
    setCreateLatitude("med");
    setCreateEffortHours("");
    setCreateDetails(TASK_DESCRIPTION_TEMPLATE);
    setShowCreate(false);
  };

  const statusIcon = (status: TaskStatus) => {
    switch (status) {
      case "pending": return <Clock size={12} className="text-accent-gold" />;
      case "running": return <Loader2 size={12} className="text-accent-primary animate-spin" />;
      case "completed": return <CheckCircle2 size={12} className="text-accent-green" />;
      case "failed": return <AlertCircle size={12} className="text-accent-red" />;
    }
  };

  // Build JSON data for the collapsible section
  const jsonData = useMemo(() => {
    if (!selectedTask) return null;
    return {
      selected: {
        id: selectedTask.id,
        title: selectedTask.title,
        status: selectedTask.status,
        priority: selectedTask.priority ?? 50,
        latitude: selectedTask.latitude ?? "med",
        dependencies: Array.isArray(selectedTask.dependencies) ? selectedTask.dependencies : [],
        project: {
          id: selectedTask.project_id,
          name: selectedTask.project_name,
        },
        due_at: selectedTask.due_at,
        estimated_effort_hours: selectedTask.estimated_effort_hours,
        score: computeTaskScore(selectedTask, tasks),
      },
      all_tasks: sortedTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority ?? 50,
        project_name: task.project_name,
      })),
    };
  }, [selectedTask, sortedTasks, tasks]);

  // Sidebar content
  const sidebar = (
    <>
      <SidebarSearch
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search tasks..."
      />

      {/* Streaming task indicator */}
      {streamingTask && (
        <div className="px-3 py-2 border-b border-accent-primary/20 bg-accent-primary/[0.07]">
          <div className="flex items-center gap-1.5 mb-1">
            <Loader2 size={11} className="text-accent-primary animate-spin flex-shrink-0" />
            <span className="text-[10px] text-accent-primary font-medium">Agent creating task…</span>
          </div>
          {streamingTask.title && (
            <div className="text-xs text-text-med truncate">{streamingTask.title}</div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {groupedTasks.map(([projectName, projectTasks]) => (
          <SidebarSection
            key={projectName}
            title={projectName}
            count={projectTasks.length}
            collapsed={collapsedProjects.has(projectName)}
            onToggle={() => toggleProject(projectName)}
          >
            {projectTasks.map((task) => (
              <SidebarItem
                key={task.id}
                id={task.id}
                title={task.title}
                subtitle={`p${task.priority ?? 50} · score ${computeTaskScore(task, tasks)}`}
                icon={statusIcon(task.status)}
                selected={selectedTaskId === task.id}
                onClick={() => setSelectedTaskId(task.id)}
                actions={
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTask(task.id);
                      if (selectedTaskId === task.id) {
                        const fallback = filteredTasks.find((t) => t.id !== task.id) ?? null;
                        setSelectedTaskId(fallback?.id ?? null);
                      }
                    }}
                    className="p-1 rounded hover:bg-accent-red/20 text-text-dark hover:text-accent-red transition-colors"
                    title="Delete task"
                  >
                    <Trash2 size={10} />
                  </button>
                }
              />
            ))}
          </SidebarSection>
        ))}
      </div>
    </>
  );

  // Main content
  const content = selectedTask ? (
    <TaskDetailsPane
      task={selectedTask}
      allTasks={tasks}
      onTaskChange={(patch) => updateTask(selectedTask.id, patch)}
    />
  ) : (
    <div className="flex-1 flex items-center justify-center text-xs text-text-dark">
      Select a task
    </div>
  );

  return (
    <PanelWrapper
      title={(
        <span className="inline-flex items-center gap-2">
          <span>Tasks</span>
          <span className="text-[10px] text-text-dark bg-line-med px-1.5 py-0.5 rounded">
            {tasks.length}
          </span>
        </span>
      )}
      icon={<ListTodo size={16} className="text-accent-primary" />}
      actions={
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          >
            <Plus size={12} />
            {showCreate ? "Close" : "Add"}
          </button>
        </div>
      }
      fill
    >
      {/* Create form overlay */}
      {showCreate && (
        <div className="absolute inset-0 z-10 bg-bg-dark/80 flex items-start justify-center pt-8 p-4">
          <div className="w-full max-w-md rounded border border-line-med bg-bg-norm p-4 space-y-3 shadow-lg">
            <div className="text-sm font-medium text-text-norm">Create New Task</div>
            <input
              type="text"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="Task title"
              className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
            />
            <select
              value={createProjectId}
              onChange={(e) => setCreateProjectId(e.target.value)}
              className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
            >
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <textarea
              value={createDetails}
              onChange={(e) => setCreateDetails(e.target.value)}
              placeholder="Task details (markdown or text)"
              className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50 min-h-20 resize-y"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={createPriority}
                onChange={(e) => setCreatePriority(e.target.value)}
                placeholder="Priority 0-100"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
              <input
                type="number"
                min={0}
                step={0.5}
                value={createEffortHours}
                onChange={(e) => setCreateEffortHours(e.target.value)}
                placeholder="Effort (hours)"
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
              />
              <select
                value={createLatitude}
                onChange={(e) => setCreateLatitude(e.target.value as TaskLatitude)}
                className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                title="Latitude"
              >
                <option value="low">Lat: low</option>
                <option value="med">Lat: med</option>
                <option value="high">Lat: high</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={createTask}
                className="px-3 py-1.5 rounded text-[11px] bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 transition-colors"
              >
                Create Task
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <SplitPaneLayout
        sidebar={sidebar}
        content={content}
        jsonData={jsonData}
        jsonLabel="Tasks Data"
        storageKey="arx-tasks-sidebar-width"
      />
    </PanelWrapper>
  );
}

function TaskDetailsPane({
  task,
  allTasks,
  onTaskChange,
}: {
  task: AgentTask;
  allTasks: AgentTask[];
  onTaskChange: (
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
}) {
  const controlClass =
    "h-8 px-2 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50";
  const safeDependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
  const dependencies = safeDependencies.join(", ");
  const dependencyReady = areDependenciesComplete(task, allTasks);
  const shortId = task.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full">
      <div className="px-3 py-2 border-b border-line-light grid grid-cols-[minmax(0,1fr)_7rem_5rem] gap-2 text-[10px]">
        <label className="space-y-1">
          <span className="text-text-dark">Title</span>
          <input
            type="text"
            value={task.title}
            onChange={(e) => onTaskChange({ title: e.target.value })}
            className={`w-full min-w-0 ${controlClass}`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-text-dark">Status</span>
          <select
            value={task.status}
            onChange={(e) => onTaskChange({ status: e.target.value as TaskStatus })}
            className={`w-full ${controlClass}`}
          >
            <option value="pending">pending</option>
            <option value="running">running</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-text-dark">Priority</span>
          <input
            type="number"
            min={0}
            max={100}
            value={task.priority ?? 50}
            onChange={(e) =>
              onTaskChange({ priority: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })
            }
            className={`w-full ${controlClass}`}
            title="Priority (0-100)"
          />
        </label>
      </div>
      <div className="px-3 py-2 border-b border-line-light grid grid-cols-3 gap-2 text-[10px]">
        <label className="space-y-1">
          <span className="text-text-dark">Latitude</span>
          <select
            value={task.latitude ?? "med"}
            onChange={(e) => onTaskChange({ latitude: e.target.value as TaskLatitude })}
            className={`w-full ${controlClass}`}
            title="Latitude"
          >
            <option value="low">low</option>
            <option value="med">med</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-text-dark">Estimated Hours</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={task.estimated_effort_hours ?? ""}
            onChange={(e) =>
              onTaskChange({
                estimated_effort_hours: e.target.value.trim() ? Number(e.target.value) : null,
              })
            }
            placeholder="e.g. 2.5"
            className={`w-full ${controlClass}`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-text-dark">Dependencies</span>
          <input
            type="text"
            value={dependencies}
            onChange={(e) =>
              onTaskChange({
                dependencies: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
            placeholder="id1,id2"
            className={`w-full ${controlClass}`}
          />
        </label>
      </div>
      <div className="px-3 py-2 border-b border-line-light flex items-center justify-between">
        <div className="text-[10px] text-text-dark">
          <span className="font-mono text-text-med">ID: {shortId}</span> · Project: {task.project_name} ·{" "}
          <span className={dependencyReady ? "" : "text-accent-red"}>{dependencyReady ? "deps ready" : "blockers"}</span>
          {" "}· updated{" "}
          {new Date(task.updated_at).toLocaleString()}
        </div>
      </div>
      {task.status === "completed" && (
        <div className="mx-3 mt-2 rounded border border-accent-green/30 bg-accent-green/10 px-2 py-1.5 text-[10px] text-accent-green/90">
          Action complete. Confirmed in this task.
        </div>
      )}

      <textarea
        value={task.description}
        onChange={(e) => onTaskChange({ description: e.target.value })}
        className="flex-1 p-3 bg-transparent text-xs text-text-med outline-none resize-none"
        placeholder={TASK_DESCRIPTION_TEMPLATE}
      />
    </div>
  );
}
