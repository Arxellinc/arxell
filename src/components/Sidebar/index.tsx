import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Plus, FolderOpen, Trash2, ChevronDown, ChevronRight, Pencil, Search, AlertTriangle, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useChatStore } from "../../store/chatStore";
import { useServeStore } from "../../store/serveStore";
import { useTaskStore, type TaskCreator, type TaskStatus } from "../../store/taskStore";
import { useSystemAlertStore } from "../../store/systemAlertStore";
import {
  projectCreate,
  conversationCreate,
  conversationAssignProject,
  projectDelete,
  conversationDelete,
  conversationList,
  projectList,
  projectUpdate,
  settingsGetAll,
} from "../../lib/tauri";
import { cn, formatDate, truncate } from "../../lib/utils";
import { suppressContextMenuUnlessAllowed } from "../../lib/contextMenu";
import { ensureDefaultProjectId } from "../../hooks/useChat";
import { ModelStatus } from "./ModelStatus";
import { VoiceStatus } from "./VoiceStatus";
import { DevicesSection } from "./DevicesSection";
import { StatusBar } from "./StatusBar";
import { RollingGraph } from "./RollingGraph";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import type { Conversation, Project } from "../../types";
interface GpuUsageSnapshot {
  id: string;
  utilizationPercent: number | null;
  memoryTotalMb: number | null;
  memoryUsedMb: number | null;
}

interface SystemUsageSnapshot {
  cpuUtilizationPercent: number | null;
  memoryUsagePercent: number;
  gpus: GpuUsageSnapshot[];
  npuUtilizationPercent: number | null;
  timestampMs: number;
}

interface DraftTaskPayload {
  title: string;
  project_name: string;
  priority: number;
  status: TaskStatus;
  due_at: string | null;
  estimated_effort_hours: number | null;
  dependencies: string[];
  created_by: TaskCreator;
  background: string;
  objective: string;
  inputs: string;
  skills: string;
  expected_outputs: string;
  acceptance_criteria: string[];
  constraints: string[];
}

const EMPTY_DRAFT_TASK: DraftTaskPayload = {
  title: "",
  project_name: "General",
  priority: 50,
  status: "pending",
  due_at: null,
  estimated_effort_hours: null,
  dependencies: [],
  created_by: "user",
  background: "",
  objective: "",
  inputs: "",
  skills: "",
  expected_outputs: "",
  acceptance_criteria: [],
  constraints: [],
};

export function Sidebar() {
  const {
    projects,
    conversations,
    activeProjectId,
    activeConversationId,
    messages,
    setActiveProject,
    setActiveConversation,
    setProjects,
    setConversations,
    addProject,
    addConversation,
    removeProject,
    removeConversation,
  } = useChatStore();

  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set()
  );
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [usage, setUsage] = useState<SystemUsageSnapshot | null>(null);
  const [graphCpu, setGraphCpu] = useState<number | null>(null);
  const [graphGpu, setGraphGpu] = useState<number | null>(null);
  const [graphNpu, setGraphNpu] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const systemResources = useServeStore((s) => s.systemResources);
  const modelInfo = useServeStore((s) => s.modelInfo);
  const activeContextLength = useServeStore((s) => s.activeContextLength);
  const tokenCount = useServeStore((s) => s.tokenCount);
  const fetchSystemResources = useServeStore((s) => s.fetchSystemResources);
  const serveError = useServeStore((s) => s.error);
  const isLoaded = useServeStore((s) => s.isLoaded);
  const systemAlerts = useSystemAlertStore((s) => s.alerts);
  const { tasks, addTask } = useTaskStore();

  // Fetch static resource info (CPU cores, total RAM, GPU names) once on mount,
  // and again every 30 s to pick up hot-plug changes.
  useEffect(() => {
    fetchSystemResources();
    const id = setInterval(() => fetchSystemResources(), 30_000);
    return () => clearInterval(id);
  }, [fetchSystemResources]);

  // Graph + live metrics: driven by the "system:usage" event emitted by the
  // dedicated Rust background thread every ~1 s.  No JS polling means the
  // graphs keep updating even when the AI is streaming.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<SystemUsageSnapshot>("system:usage", (ev) => {
      const snap = ev.payload;
      setUsage(snap);
      setGraphCpu(snap.cpuUtilizationPercent ?? null);
      const gpuUtil = snap.gpus.reduce<number | null>((best, g) => {
        if (g.utilizationPercent == null) return best;
        return best == null || g.utilizationPercent > best ? g.utilizationPercent : best;
      }, null);
      setGraphGpu(gpuUtil);
      setGraphNpu(snap.npuUtilizationPercent ?? null);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handleNewProject = async () => {
    const name = `Project ${projects.length + 1}`;
    const p = await projectCreate(name, "");
    addProject(p);
    setExpandedProjects((s) => new Set([...s, p.id]));
    setActiveProject(p.id);
    // Auto-create first conversation
    const conv = await conversationCreate(p.id, "New Chat");
    addConversation(conv);
    setActiveConversation(conv.id);
  };

  const handleNewConversation = async (projectId: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    const resolvedProjectId = projectId ?? (await ensureDefaultProjectId());
    const conv = await conversationCreate(resolvedProjectId, "New Chat");
    addConversation(conv);
    setActiveProject(resolvedProjectId);
    setActiveConversation(conv.id);
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this project? Chats will be unassigned but not deleted.")) return;
    await projectDelete(id);
    removeProject(id);
    let updated = await projectList();
    if (updated.length === 0) {
      const general = await projectCreate("General", "");
      updated = [general];
    }
    setProjects(updated);

    const fallback =
      updated.find((p) => p.name.trim().toLowerCase() === "general") ?? updated[0] ?? null;

    if (activeProjectId === id) {
      setActiveProject(fallback?.id ?? null);
    } else if (activeProjectId && !updated.some((p) => p.id === activeProjectId)) {
      setActiveProject(fallback?.id ?? null);
    }
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await conversationDelete(id);
    removeConversation(id);
    if (activeConversationId === id) setActiveConversation(null);
  };

  const handleStartRename = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(project.id);
    setEditingName(project.name);
  };

  const handleRenameSubmit = async (projectId: string) => {
    if (editingName.trim()) {
      await projectUpdate(projectId, { name: editingName.trim() });
      const updated = await projectList();
      setProjects(updated);
    }
    setEditingProjectId(null);
    setEditingName("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, projectId: string) => {
    if (e.key === "Enter") {
      handleRenameSubmit(projectId);
    } else if (e.key === "Escape") {
      setEditingProjectId(null);
      setEditingName("");
    }
  };

  const toggleProject = async (p: Project) => {
    const isExpanded = expandedProjects.has(p.id);
    if (!isExpanded) {
      const convs = await conversationList(p.id);
      setConversations(convs);
      setExpandedProjects((s) => new Set([...s, p.id]));
    } else {
      setExpandedProjects((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    }
    setActiveProject(p.id);
  };

  const handleSelectConversation = async (conv: Conversation) => {
    let projectId = conv.project_id;
    if (!projectId) {
      projectId = await ensureDefaultProjectId();
      try {
        await conversationAssignProject(conv.id, projectId);
        setConversations(
          conversations.map((c) => (c.id === conv.id ? { ...c, project_id: projectId } : c))
        );
      } catch (e) {
        console.error("Failed to auto-assign unassigned conversation:", e);
      }
    }
    setActiveProject(projectId);
    setActiveConversation(conv.id);
  };

  // Sort projects by most recently modified
  const sortedProjects = [...projects].sort((a, b) => {
    const aTime = new Date(a.updated_at).getTime();
    const bTime = new Date(b.updated_at).getTime();
    return bTime - aTime;
  });

  // Separate conversations into project-assigned and unassigned, sorted by most recently modified
  const unassignedConvs = conversations
    .filter((c) => !c.project_id)
    .sort((a, b) => {
      const aTime = new Date(a.updated_at).getTime();
      const bTime = new Date(b.updated_at).getTime();
      return bTime - aTime;
    });
  const q = searchQuery.trim().toLowerCase();
  const filteredUnassignedConvs = q
    ? unassignedConvs.filter((c) => c.title.toLowerCase().includes(q))
    : unassignedConvs;
  const matchingTasks = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : [];

  const primaryGpuUsage = useMemo(() => {
    if (!usage?.gpus?.length) return null;
    const telemetryBacked = usage.gpus.filter(
      (g) => g.memoryTotalMb != null || g.memoryUsedMb != null || g.utilizationPercent != null
    );
    const pool = telemetryBacked.length > 0 ? telemetryBacked : usage.gpus;
    return pool
      .slice()
      .sort((a, b) => {
        const aTotal = a.memoryTotalMb ?? -1;
        const bTotal = b.memoryTotalMb ?? -1;
        if (aTotal !== bTotal) return bTotal - aTotal;
        const aUsed = a.memoryUsedMb ?? -1;
        const bUsed = b.memoryUsedMb ?? -1;
        return bUsed - aUsed;
      })[0];
  }, [usage]);
  const alertMessages = useMemo(() => {
    const alerts: string[] = [...systemAlerts];
    if (serveError) alerts.push(`Model runtime error: ${serveError}`);
    if (!isLoaded) alerts.push("No local model currently loaded.");
    const memUsage = systemResources?.memory?.usagePercent ?? usage?.memoryUsagePercent ?? 0;
    if (memUsage >= 90) alerts.push(`High system memory usage: ${memUsage.toFixed(0)}%`);
    const gpuUsage = primaryGpuUsage?.utilizationPercent ?? 0;
    if (gpuUsage >= 95) alerts.push(`GPU utilization saturated: ${gpuUsage.toFixed(0)}%`);
    const unique = Array.from(new Set(alerts));
    return unique.slice(0, 6);
  }, [
    isLoaded,
    primaryGpuUsage?.utilizationPercent,
    serveError,
    systemAlerts,
    systemResources?.memory?.usagePercent,
    usage?.memoryUsagePercent,
  ]);

  const contextMax = activeContextLength ?? modelInfo?.contextLength ?? null;
  const estimatedTokens = useMemo(() => {
    if (tokenCount?.total != null) return null;
    const convMsgs = messages.filter((m) => m.conversation_id === activeConversationId);
    if (convMsgs.length === 0) return 0;
    const totalChars = convMsgs.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / 4);
  }, [tokenCount?.total, messages, activeConversationId]);
  const contextUsed = tokenCount?.total ?? estimatedTokens ?? 0;
  const contextPercent =
    contextMax && contextMax > 0 ? Math.min(100, (contextUsed / contextMax) * 100) : 0;
  const contextPercentLabel =
    contextMax && contextMax > 0 ? `${contextPercent.toFixed(0)}%` : null;
  const contextLabel =
    contextMax && contextMax > 0
      ? `${contextUsed.toLocaleString()} / ${contextMax.toLocaleString()}`
      : `${contextUsed.toLocaleString()} / ?`;

  return (
    <div
      className="sidebar-container flex flex-col h-full min-h-0 overflow-hidden bg-bg-norm border-r border-line-light"
      onContextMenu={suppressContextMenuUnlessAllowed}
    >
      <ClockDisplay />
      <div className="mx-4 border-t border-line-med" />
      <div className="px-4 space-y-1.5 pb-2">
        <RollingGraph value={graphCpu} capacity={120} height={72} label="CPU" />
        <RollingGraph value={graphGpu} capacity={120} height={72} label="GPU" />
        <div className="pt-0.5">
          <div className="flex items-center justify-between mb-1 pl-1">
            <div className="flex items-baseline gap-1">
              <span className="text-[9px] text-text-dark leading-none">CTX</span>
              {contextPercentLabel && (
                <span className="text-[9px] text-text-med tabular-nums leading-none">
                  {contextPercentLabel}
                </span>
              )}
            </div>
            <span className="text-[9px] text-text-med tabular-nums">{contextLabel}</span>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ backgroundColor: "rgba(167,205,207,0.18)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${contextPercent}%`,
                backgroundColor: "rgba(167,205,207,0.80)",
              }}
            />
          </div>
        </div>
      </div>

      <div className="mx-4 border-t border-line-med" />

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* Always-visible service status indicators: LLM · STT · TTS */}
        <StatusBar />

        {/* Models Section */}
        <div className="border-b border-line-light">
        <div
            className="flex items-center gap-1.5 px-3 py-2 hover:bg-line-light transition-colors cursor-pointer"
            onClick={() => setModelsExpanded((v) => !v)}
          >
            {modelsExpanded ? (
              <ChevronDown size={11} className="text-text-dark flex-shrink-0" />
            ) : (
              <ChevronRight size={11} className="text-text-dark flex-shrink-0" />
            )}
            <span className="sidebar-header-title text-[10px] font-normal uppercase tracking-wider flex-1">
              Models
            </span>
          </div>
        {modelsExpanded && <ModelStatus />}
        </div>
        <DevicesSection />
        <VoiceStatus />

        {/* History Section */}
        <div className="border-t border-line-light">
        <div
          className="flex items-center gap-1.5 px-3 py-2 hover:bg-line-light transition-colors cursor-pointer"
          onClick={() => setHistoryExpanded((v) => !v)}
        >
          {historyExpanded ? (
            <ChevronDown size={11} className="text-text-dark flex-shrink-0" />
          ) : (
            <ChevronRight size={11} className="text-text-dark flex-shrink-0" />
          )}
          <span className="sidebar-header-title text-[10px] font-medium uppercase tracking-wider flex-1">
            History
          </span>
        </div>
        {historyExpanded && (
          <>
            <div className="px-3 pb-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowNewTaskModal(true)}
                className="py-1.5 rounded border border-line-med bg-line-light hover:bg-line-med text-text-med hover:text-text-norm transition-colors text-[11px]"
                title="New task"
              >
                New Task
              </button>
              <button
                onClick={handleNewProject}
                className="py-1.5 rounded border border-line-med bg-line-light hover:bg-line-med text-text-med hover:text-text-norm transition-colors text-[11px]"
                title="New project"
              >
                New Project
              </button>
            </div>
            <div className="px-3 pb-2">
              <div className="flex items-center gap-2 rounded border border-line-med bg-line-light px-2 py-1.5">
                <Search size={12} className="text-text-dark" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Global search: chats, projects, tasks..."
                  className="w-full bg-transparent text-[11px] text-text-norm outline-none placeholder:text-text-dark"
                />
              </div>
              {q && (
                <>
                  <div className="mt-1 text-[10px] text-text-dark">
                    {filteredUnassignedConvs.length +
                      sortedProjects.filter((p) => p.name.toLowerCase().includes(q)).length +
                      matchingTasks.length}{" "}
                    matches
                  </div>
                  {matchingTasks.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {matchingTasks.slice(0, 3).map((task) => (
                        <div key={task.id} className="text-[10px] text-text-med truncate">
                          Task: {task.title}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
        </div>

        {/* Project list */}
        {historyExpanded && (
          <div className="py-1">
        {/* Legacy unassigned chats (auto-reassigned on open) */}
        {filteredUnassignedConvs.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="sidebar-header-title text-[10px] uppercase tracking-wider">Needs Project</span>
            </div>
            {filteredUnassignedConvs.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex items-center gap-2 pl-5 pr-3 py-1.5 cursor-pointer hover:bg-line-light transition-colors",
                  activeConversationId === conv.id &&
                    "bg-accent-primary/10 border-l-2 border-accent-primary"
                )}
                onClick={() => handleSelectConversation(conv)}
              >
                <MessageSquare
                  size={11}
                  className={cn(
                    "flex-shrink-0",
                    activeConversationId === conv.id
                      ? "text-accent-primary"
                      : "text-text-dark"
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-xs truncate",
                      activeConversationId === conv.id
                        ? "text-text-norm"
                        : "text-text-med"
                    )}
                  >
                    {truncate(conv.title, 28)}
                  </p>
                  <p className="text-[10px] text-text-dark">
                    {formatDate(conv.updated_at)}
                  </p>
                </div>
                <button
                  onClick={(e) => handleDeleteConversation(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent-red/20 text-text-dark hover:text-accent-red transition-opacity"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Projects */}
        {projects.length === 0 && filteredUnassignedConvs.length === 0 && (
          <div className="px-4 py-6 text-center">
            <MessageSquare size={24} className="mx-auto mb-2 text-text-dark" />
            <p className="text-xs text-text-dark">No projects yet</p>
            <button
              onClick={handleNewProject}
              className="mt-3 text-xs text-accent-primary hover:text-accent-primary transition-colors"
            >
              Create your first project
            </button>
          </div>
        )}

        {sortedProjects
          .filter((project) => {
            if (!q) return true;
            const projectMatch = project.name.toLowerCase().includes(q);
            const convMatch = conversations.some(
              (c) => c.project_id === project.id && c.title.toLowerCase().includes(q)
            );
            return projectMatch || convMatch;
          })
          .map((project) => {
          const isExpanded = expandedProjects.has(project.id);
          const isActive = activeProjectId === project.id;
          const isEditing = editingProjectId === project.id;
          // Sort project conversations by most recently modified
          const projectConvs = conversations
            .filter((c) => c.project_id === project.id)
            .filter((c) => (!q ? true : c.title.toLowerCase().includes(q) || project.name.toLowerCase().includes(q)))
            .sort((a, b) => {
              const aTime = new Date(a.updated_at).getTime();
              const bTime = new Date(b.updated_at).getTime();
              return bTime - aTime;
            });

          return (
            <div key={project.id}>
              {/* Project row */}
              <div
                className={cn(
                  "group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-line-light transition-colors",
                  isActive && "bg-line-light"
                )}
                onClick={() => !isEditing && toggleProject(project)}
              >
                {isExpanded ? (
                  <ChevronDown size={12} className="text-text-dark flex-shrink-0" />
                ) : (
                  <ChevronRight size={12} className="text-text-dark flex-shrink-0" />
                )}
                <FolderOpen size={13} className="text-accent-primary/70 flex-shrink-0" />
                {isEditing ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => handleRenameKeyDown(e, project.id)}
                    onBlur={() => handleRenameSubmit(project.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 text-xs text-text-norm bg-line-med px-1.5 py-0.5 rounded outline-none border border-accent-primary/50"
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 text-xs text-text-med truncate">
                    {project.name}
                  </span>
                )}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleNewConversation(project.id, e)}
                    className="p-0.5 rounded hover:bg-line-med text-text-dark hover:text-text-med"
                    title="New chat"
                  >
                    <Plus size={11} />
                  </button>
                  <button
                    onClick={(e) => handleStartRename(project, e)}
                    className="p-0.5 rounded hover:bg-line-med text-text-dark hover:text-text-med"
                    title="Rename project"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => handleDeleteProject(project.id, e)}
                    className="p-0.5 rounded hover:bg-accent-red/20 text-text-dark hover:text-accent-red"
                    title="Delete project"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Conversations */}
              {isExpanded && (
                <div>
                  {projectConvs.map((conv) => (
                    <div
                      key={conv.id}
                      className={cn(
                        "group flex items-center gap-2 pl-8 pr-3 py-1.5 cursor-pointer hover:bg-line-light transition-colors",
                        activeConversationId === conv.id &&
                          "bg-accent-primary/10 border-l-2 border-accent-primary"
                      )}
                      onClick={() => handleSelectConversation(conv)}
                    >
                      <MessageSquare
                        size={11}
                        className={cn(
                          "flex-shrink-0",
                          activeConversationId === conv.id
                            ? "text-accent-primary"
                            : "text-text-dark"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-xs truncate",
                            activeConversationId === conv.id
                              ? "text-text-norm"
                              : "text-text-med"
                          )}
                        >
                          {truncate(conv.title, 28)}
                        </p>
                        <p className="text-[10px] text-text-dark">
                          {formatDate(conv.updated_at)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent-red/20 text-text-dark hover:text-accent-red transition-opacity"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                  {projectConvs.length === 0 && (
                    <p className="pl-8 py-1.5 text-[10px] text-text-dark italic">
                      No chats yet
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
          </div>
        )}
      </div>
      <SystemAlerts alerts={alertMessages} />
      <DiagnosticsPanel />
      {showNewTaskModal && (
        <NewTaskModal
          projects={sortedProjects}
          onClose={() => setShowNewTaskModal(false)}
          onCreate={(draft) => {
            const description = [
              "## Background",
              draft.background || "-",
              "",
              "## Objective",
              draft.objective || "-",
              "",
              "## Inputs",
              draft.inputs || "-",
              "",
              "## Skills",
              draft.skills || "-",
              "",
              "## Expected Outputs",
              draft.expected_outputs || "-",
            ].join("\n");

            addTask({
              title: draft.title || "Untitled Task",
              description,
              project_id: null,
              project_name: draft.project_name || "General",
              priority: Math.max(0, Math.min(100, draft.priority || 50)),
              latitude: "med",
              status: draft.status,
              dependencies: draft.dependencies,
              due_at: draft.due_at,
              estimated_effort_hours: draft.estimated_effort_hours,
              created_by: draft.created_by,
              acceptance_criteria: draft.acceptance_criteria,
              constraints: draft.constraints,
              attempt_count: 0,
              last_error: null,
              next_review_at: null,
            });
            setShowNewTaskModal(false);
          }}
        />
      )}

    </div>
  );
}

function ClockDisplay() {
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);
  return (
    <div className="px-4 pt-3 pb-3 text-center">
      <div className="text-3xl font-medium leading-none text-text-norm tracking-tight">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="mt-1 text-xs text-text-med">
        {now.toLocaleDateString([], {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </div>
    </div>
  );
}

function SystemAlerts({ alerts }: { alerts: string[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasAlerts = alerts.length > 0;

  return (
    <div className="border-t border-line-light">
      <div
        className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-line-light transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
      >
        {isExpanded ? (
          <ChevronDown size={11} className="text-text-dark flex-shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-text-dark flex-shrink-0" />
        )}
        <span className="sidebar-header-title text-[10px] font-medium uppercase tracking-wider flex-1">
          System Alerts
        </span>
        <AlertTriangle
          size={11}
          className={cn("flex-shrink-0", hasAlerts ? "text-accent-red/70" : "text-text-dark")}
        />
        {hasAlerts && (
          <span className="text-[9px] px-1 py-0.5 rounded font-mono text-accent-red bg-accent-red/10">
            {alerts.length}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {alerts.length === 0 ? (
            <p className="text-[10px] text-text-dark">No active alerts</p>
          ) : (
            <div className="space-y-1">
              {alerts.map((a) => (
                <p key={a} className="text-[10px] text-accent-gold/80 leading-snug break-words" title={a}>
                  {a}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewTaskModal({
  projects,
  onClose,
  onCreate,
}: {
  projects: Project[];
  onClose: () => void;
  onCreate: (draft: DraftTaskPayload) => void;
}) {
  const [draft, setDraft] = useState<DraftTaskPayload>(EMPTY_DRAFT_TASK);
  const [quickPrompt, setQuickPrompt] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const applyPatch = (patch: Partial<DraftTaskPayload>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const handleAiDraft = async () => {
    const input = quickPrompt.trim();
    if (!input) return;
    setIsDrafting(true);
    setDraftError(null);
    try {
      const settings = await settingsGetAll();
      const model = settings["model"];
      const baseUrlRaw = settings["base_url"] ?? "http://127.0.0.1:1234/v1";
      const apiKey = settings["api_key"] ?? "";
      if (!model) throw new Error("No model selected");
      const baseUrl = baseUrlRaw.trim().replace(/\/+$/, "").endsWith("/v1")
        ? baseUrlRaw.trim().replace(/\/+$/, "")
        : `${baseUrlRaw.trim().replace(/\/+$/, "")}/v1`;
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "Return valid JSON only with keys: title, project_name, priority, status, due_at, estimated_effort_hours, dependencies, created_by, background, objective, inputs, skills, expected_outputs, acceptance_criteria, constraints. Keep status as pending.",
            },
            {
              role: "user",
              content: `Draft a comprehensive task from this short request:\n${input}`,
            },
          ],
        }),
      });
      const json = await resp.json();
      const content = json?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
      applyPatch({
        title: String(parsed.title ?? draft.title),
        project_name: String(parsed.project_name ?? draft.project_name),
        priority: Math.max(0, Math.min(100, Number(parsed.priority ?? draft.priority))),
        status: "pending",
        due_at: parsed.due_at ? String(parsed.due_at) : null,
        estimated_effort_hours:
          parsed.estimated_effort_hours === null || parsed.estimated_effort_hours === undefined
            ? null
            : Number(parsed.estimated_effort_hours),
        dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies.map(String) : draft.dependencies,
        created_by: parsed.created_by === "agent" ? "agent" : "user",
        background: String(parsed.background ?? draft.background),
        objective: String(parsed.objective ?? draft.objective),
        inputs: String(parsed.inputs ?? draft.inputs),
        skills: String(parsed.skills ?? draft.skills),
        expected_outputs: String(parsed.expected_outputs ?? draft.expected_outputs),
        acceptance_criteria: Array.isArray(parsed.acceptance_criteria)
          ? parsed.acceptance_criteria.map(String)
          : draft.acceptance_criteria,
        constraints: Array.isArray(parsed.constraints) ? parsed.constraints.map(String) : draft.constraints,
      });
    } catch (e) {
      setDraftError(String(e));
    } finally {
      setIsDrafting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-bg-light border border-line-med rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line-med">
          <h3 className="text-sm font-medium text-text-norm">Create Task</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-line-med text-text-med">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-[10px] text-text-med uppercase tracking-wide">AI Draft (short input)</label>
            <div className="flex gap-2">
              <input
                value={quickPrompt}
                onChange={(e) => setQuickPrompt(e.target.value)}
                placeholder="Describe task in one sentence..."
                className="flex-1 bg-line-light border border-line-med rounded px-2 py-1.5 text-xs text-text-norm outline-none"
              />
              <button
                onClick={() => void handleAiDraft()}
                disabled={isDrafting || !quickPrompt.trim()}
                className="px-3 py-1.5 text-xs rounded bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 disabled:opacity-50"
              >
                {isDrafting ? "Drafting..." : "Draft with AI"}
              </button>
            </div>
            {draftError && <p className="text-[10px] text-accent-red/70">{draftError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <TextField label="Title" value={draft.title} onChange={(v) => applyPatch({ title: v })} />
            <div className="space-y-1">
              <label className="text-[10px] text-text-med uppercase tracking-wide">Project</label>
              <select
                value={draft.project_name}
                onChange={(e) => applyPatch({ project_name: e.target.value })}
                className="w-full bg-line-light border border-line-med rounded px-2 py-1.5 text-xs text-text-norm"
              >
                <option value="General">General</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <NumberField label="Priority (0-100)" value={draft.priority} onChange={(v) => applyPatch({ priority: v })} />
            <NumberField
              label="Effort (hours)"
              value={draft.estimated_effort_hours ?? 0}
              onChange={(v) => applyPatch({ estimated_effort_hours: v > 0 ? v : null })}
            />
          </div>

          <TextAreaField label="Background" value={draft.background} onChange={(v) => applyPatch({ background: v })} />
          <TextAreaField label="Objective" value={draft.objective} onChange={(v) => applyPatch({ objective: v })} />
          <TextAreaField label="Inputs" value={draft.inputs} onChange={(v) => applyPatch({ inputs: v })} />
          <TextAreaField label="Skills" value={draft.skills} onChange={(v) => applyPatch({ skills: v })} />
          <TextAreaField
            label="Expected Outputs"
            value={draft.expected_outputs}
            onChange={(v) => applyPatch({ expected_outputs: v })}
          />
          <TextAreaField
            label="Acceptance Criteria (one per line)"
            value={draft.acceptance_criteria.join("\n")}
            onChange={(v) =>
              applyPatch({ acceptance_criteria: v.split("\n").map((s) => s.trim()).filter(Boolean) })
            }
          />
          <TextAreaField
            label="Constraints (one per line)"
            value={draft.constraints.join("\n")}
            onChange={(v) => applyPatch({ constraints: v.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
        <div className="px-4 py-3 border-t border-line-med flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-med hover:text-text-norm">
            Cancel
          </button>
          <button
            onClick={() => onCreate(draft)}
            disabled={!draft.title.trim()}
            className="px-3 py-1.5 text-xs rounded bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 disabled:opacity-50"
          >
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-text-med uppercase tracking-wide">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-line-light border border-line-med rounded px-2 py-1.5 text-xs text-text-norm outline-none"
      />
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-text-med uppercase tracking-wide">{label}</label>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full bg-line-light border border-line-med rounded px-2 py-1.5 text-xs text-text-norm outline-none"
      />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-text-med uppercase tracking-wide">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full bg-line-light border border-line-med rounded px-2 py-1.5 text-xs text-text-norm outline-none resize-y"
      />
    </div>
  );
}
