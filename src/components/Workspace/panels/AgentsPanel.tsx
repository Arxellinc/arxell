import { listen } from "@tauri-apps/api/event";
import {
  Folder,
  X,
  FileText,
  Loader2,
  Network,
  Save,
  Send,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  a2aAgentCardsList,
  a2aProcessCreate,
  a2aProcessEvents,
  a2aProcessGet,
  a2aProcessList,
  a2aSeedDemoProcess,
  modelListAll,
  projectCreate,
  projectList,
  type A2AAgentCard,
  type A2AArtifactRecord,
  type A2AProcessDetail,
  type A2AProcessSummary,
  type A2AStoredEvent,
  type ModelConfig,
} from "../../../lib/tauri";
import { codeCreateFile, codeListDir, codeReadFile, codeWriteFile, terminalExec } from "../../../core/tooling/client";
import { useChatStore } from "../../../store/chatStore";
import type { ToolMode } from "../../../core/tooling/types";
import type { FileEntry } from "../../../types";
import { cn } from "../../../lib/utils";
import { PanelWrapper } from "./shared";
import { SplitPaneLayout } from "./SplitPaneLayout";

type A2AChangedEvent = {
  kind: string;
  process_id?: string | null;
  card_id?: string | null;
};

type StageState = "pending" | "running" | "succeeded" | "failed";

const PROCESS_STEPS = ["Goal", "Research", "Plan", "Work", "Validate", "Review", "Deliver"] as const;
const PROCESS_MARKER_FILE = ".arxell-process";

function extractHost(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed;
  }
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function parentPath(value: string): string | null {
  const normalized = normalizePath(value);
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

function commonDirectoryPath(paths: string[]): string {
  const normalized = paths
    .map((p) => normalizePath(parentPath(p) ?? p))
    .filter((p) => p.length > 0);
  if (normalized.length === 0) return "";
  const segments = normalized.map((p) => p.split("/").filter(Boolean));
  const minLen = Math.min(...segments.map((parts) => parts.length));
  const common: string[] = [];
  for (let i = 0; i < minLen; i += 1) {
    const token = segments[0][i];
    if (segments.every((parts) => parts[i] === token)) {
      common.push(token);
    } else {
      break;
    }
  }
  return `/${common.join("/")}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTerminalBlock(label: string, text: string): string {
  const payload = text.trimEnd();
  if (!payload) return "";
  return `[${label}]\n${payload}\n`;
}

function mapTaskStatus(status: string): StageState {
  const normalized = status.toLowerCase();
  if (normalized === "running") return "running";
  if (normalized === "succeeded") return "succeeded";
  if (normalized === "failed" || normalized === "blocked" || normalized === "canceled") return "failed";
  return "pending";
}

function deriveStageStates(detail: A2AProcessDetail | null): StageState[] {
  if (!detail) return PROCESS_STEPS.map(() => "pending");

  const tasks = [...detail.tasks].sort((a, b) => a.created_at_ms - b.created_at_ms);
  const stageStates = PROCESS_STEPS.map((_, idx) => {
    const task = tasks[idx];
    return task ? mapTaskStatus(task.status) : "pending";
  });

  const processStatus = detail.process.status.toLowerCase();
  if (processStatus === "succeeded") {
    return PROCESS_STEPS.map(() => "succeeded");
  }
  if ((processStatus === "running" || processStatus === "queued") && tasks.length === 0) {
    return ["running", ...PROCESS_STEPS.slice(1).map(() => "pending" as StageState)];
  }
  return stageStates;
}

function StageLink({
  label,
  state,
  selected,
  onClick,
}: {
  label: string;
  state: StageState;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-sm transition-colors",
        selected ? "underline underline-offset-4" : "hover:underline hover:underline-offset-4",
        state === "running" && "text-accent-primary",
        state === "succeeded" && "text-accent-green",
        state === "failed" && "text-accent-red",
        state === "pending" && "text-text-med"
      )}
    >
      <span className="font-medium">{label}</span>
    </button>
  );
}

function ArtifactTile({
  entry,
  onOpen,
}: {
  entry: FileEntry;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="w-full border-b border-line-light px-2 py-1.5 text-left transition-colors hover:bg-line-light/50"
    >
      <div className="grid grid-cols-[1fr_100px_72px] items-center gap-2">
        <div className="min-w-0 inline-flex items-center gap-2">
          {entry.is_dir ? <Folder size={13} className="text-accent-primary/70" /> : <FileText size={13} className="text-text-med" />}
          <span className="truncate text-xs text-text-norm">{entry.name}</span>
        </div>
        <span className="text-right text-[10px] text-text-dark">{entry.is_dir ? "-" : formatBytes(entry.size)}</span>
        <span className="text-right text-[10px] text-text-dark">{entry.is_dir ? "Folder" : "File"}</span>
      </div>
    </button>
  );
}

function resolveFileAccess(path: string, workspacePath: string): { rootGuard: string | null; mode: ToolMode } {
  const normalize = (value: string) => value.replace(/\\/g, "/").trim();
  const parentDir = (value: string): string | null => {
    const normalized = normalize(value);
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return null;
    return normalized.slice(0, idx);
  };

  const normalizedPath = normalize(path);
  const normalizedWorkspace = normalize(workspacePath);
  if (
    normalizedWorkspace &&
    (normalizedPath === normalizedWorkspace || normalizedPath.startsWith(`${normalizedWorkspace}/`))
  ) {
    return { rootGuard: normalizedWorkspace, mode: "sandbox" };
  }

  const guard = parentDir(normalizedPath);
  return { rootGuard: guard, mode: guard ? "sandbox" : "shell" };
}

export function AgentsPanel() {
  const { activeProjectId, projects, setProjects, setActiveProject } = useChatStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const workspacePath = activeProject?.workspace_path?.trim() ?? "";

  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cards, setCards] = useState<A2AAgentCard[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [processes, setProcesses] = useState<A2AProcessSummary[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [detail, setDetail] = useState<A2AProcessDetail | null>(null);
  const [events, setEvents] = useState<A2AStoredEvent[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(null);
  const [explorerRootPath, setExplorerRootPath] = useState("");
  const [explorerPath, setExplorerPath] = useState("");
  const [explorerEntries, setExplorerEntries] = useState<FileEntry[]>([]);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerError, setExplorerError] = useState<string | null>(null);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [showDevBanner, setShowDevBanner] = useState(true);

  const loadCardsAndModels = useCallback(async () => {
    const [nextCards, nextModels] = await Promise.all([a2aAgentCardsList(), modelListAll()]);
    setCards(Array.isArray(nextCards) ? nextCards : []);
    setModels(Array.isArray(nextModels) ? nextModels : []);
  }, []);

  const loadProcesses = useCallback(async () => {
    const rows = await a2aProcessList(100, 0);
    const safeRows = Array.isArray(rows) ? rows : [];
    setProcesses(safeRows);
    setSelectedProcessId((prev) => prev ?? safeRows[0]?.process_id ?? null);
  }, []);

  const loadSelected = useCallback(async () => {
    if (!selectedProcessId) {
      setDetail(null);
      setEvents([]);
      return;
    }
    const [nextDetail, nextEvents] = await Promise.all([
      a2aProcessGet(selectedProcessId),
      a2aProcessEvents(selectedProcessId, 120),
    ]);
    setDetail(nextDetail ?? null);
    setEvents(Array.isArray(nextEvents) ? nextEvents : []);
  }, [selectedProcessId]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadCardsAndModels(), loadProcesses()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent state");
    } finally {
      setLoading(false);
    }
  }, [loadCardsAndModels, loadProcesses]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    void loadSelected().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load process detail");
    });
  }, [loadSelected]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      void loadProcesses().catch(() => {});
      void loadSelected().catch(() => {});
    }, 4000);
    return () => window.clearInterval(handle);
  }, [loadProcesses, loadSelected]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen<A2AChangedEvent>("a2a:changed", (event) => {
      if (disposed) return;
      const payload = event.payload;
      void loadProcesses().then(() => {
        if (!payload.process_id || payload.process_id === selectedProcessId) {
          void loadSelected();
        }
      });
      if (payload.card_id || payload.kind.startsWith("card_")) {
        void loadCardsAndModels();
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [loadCardsAndModels, loadProcesses, loadSelected, selectedProcessId]);

  const apiUsedLabel = useMemo(() => {
    const enabledCards = cards.filter((card) => card.enabled);

    for (const card of enabledCards) {
      const host = extractHost(card.url || "");
      if (host) return `${card.name}: ${host}`;
    }

    for (const card of enabledCards) {
      if (!card.preferred_model_id) continue;
      const matchedModel = models.find((m) => m.id === card.preferred_model_id);
      if (!matchedModel) continue;
      const host = extractHost(matchedModel.base_url || "");
      if (host) return `${card.name}: ${host}`;
      return `${card.name}: ${matchedModel.name}`;
    }

    return "Default local runtime";
  }, [cards, models]);

  const selectedSummary = useMemo(
    () => processes.find((p) => p.process_id === selectedProcessId) ?? null,
    [processes, selectedProcessId]
  );

  const stageStates = useMemo(() => deriveStageStates(detail), [detail]);
  const stageTaskIds = useMemo(() => {
    const sortedTasks = [...(detail?.tasks ?? [])].sort((a, b) => a.created_at_ms - b.created_at_ms);
    return PROCESS_STEPS.map((_, idx) => sortedTasks[idx]?.task_id ?? null);
  }, [detail?.tasks]);

  const filteredArtifacts = useMemo(() => {
    const artifacts = [...(detail?.artifacts ?? [])].sort((a, b) => b.created_at_ms - a.created_at_ms);
    if (selectedStageIndex == null) return artifacts;
    const taskId = stageTaskIds[selectedStageIndex];
    if (!taskId) return [];
    return artifacts.filter((artifact) => artifact.producer_task_id === taskId);
  }, [detail?.artifacts, selectedStageIndex, stageTaskIds]);
  const processDirectoryPath = useMemo(() => {
    if (workspacePath && selectedProcessId) {
      return `${normalizePath(workspacePath)}/agent-processes/${selectedProcessId}`;
    }
    return normalizePath(workspacePath);
  }, [selectedProcessId, workspacePath]);

  const visibleEvents = useMemo(
    () => [...events].sort((a, b) => a.sequence - b.sequence).slice(-80),
    [events]
  );

  const ensureProjectWorkspaceContext = useCallback(async () => {
    let nextProjects = projects;
    if (nextProjects.length === 0) {
      nextProjects = await projectList();
    }
    if (nextProjects.length === 0) {
      const general = await projectCreate("General", "");
      nextProjects = [general];
    }
    if (nextProjects !== projects) {
      setProjects(nextProjects);
    }

    let projectId = activeProjectId;
    if (!projectId || !nextProjects.some((project) => project.id === projectId)) {
      const fallback = nextProjects.find((project) => project.name.trim().toLowerCase() === "general") ?? nextProjects[0];
      if (!fallback) {
        throw new Error("Failed to resolve active project.");
      }
      projectId = fallback.id;
      setActiveProject(projectId);
    }

    const project = nextProjects.find((candidate) => candidate.id === projectId);
    const normalizedWorkspacePath = normalizePath(project?.workspace_path?.trim() ?? "");
    if (!normalizedWorkspacePath) {
      throw new Error("No workspace path configured for the selected project.");
    }

    return { projectId, workspacePath: normalizedWorkspacePath };
  }, [activeProjectId, projects, setActiveProject, setProjects]);

  const ensureProcessDirectory = useCallback(async (workspaceRoot: string, processId: string) => {
    const processRoot = `${workspaceRoot}/agent-processes/${processId}`;
    const markerPath = `${processRoot}/${PROCESS_MARKER_FILE}`;
    await codeCreateFile(markerPath, workspaceRoot, "sandbox");
    return processRoot;
  }, []);

  const sendTask = async () => {
    const text = chatInput.trim();
    if (!text) return;

    setSending(true);
    setError(null);
    try {
      const { workspacePath: projectWorkspacePath } = await ensureProjectWorkspaceContext();
      const processId = await a2aProcessCreate(text, "primary-agent", "primary-agent");
      const processRoot = await ensureProcessDirectory(projectWorkspacePath, processId);
      setChatInput("");
      setSelectedProcessId(processId);
      await Promise.all([loadProcesses(), loadExplorer(processRoot, processRoot)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dispatch task");
    } finally {
      setSending(false);
    }
  };

  const runTerminalCommand = async () => {
    const command = terminalCommand.trim();
    if (!command) return;

    const guardRoot = normalizePath(explorerRootPath || processDirectoryPath || workspacePath);
    if (!guardRoot) {
      setTerminalOutput((prev) => `${prev}[error] No process/workspace directory configured.\n`);
      return;
    }

    setTerminalRunning(true);
    const startedAt = new Date().toLocaleTimeString();
    setTerminalOutput((prev) => `${prev}\n$ ${command}\n[started ${startedAt}]\n`);
    try {
      const result = await terminalExec(command, guardRoot, guardRoot, 120000, "sandbox");
      const stdout = formatTerminalBlock("stdout", result.stdout ?? "");
      const stderr = formatTerminalBlock("stderr", result.stderr ?? "");
      const statusLine = `[exit ${result.exitCode}] ${result.durationMs}ms\n`;
      setTerminalOutput((prev) => `${prev}${stdout}${stderr}${statusLine}`);
    } catch (err) {
      setTerminalOutput((prev) => `${prev}[error] ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      setTerminalRunning(false);
      setTerminalCommand("");
    }
  };

  const seedDemo = async () => {
    setSeeding(true);
    setError(null);
    try {
      const { workspacePath: projectWorkspacePath } = await ensureProjectWorkspaceContext();
      const processId = await a2aSeedDemoProcess();
      const processRoot = await ensureProcessDirectory(projectWorkspacePath, processId);
      await loadExplorer(processRoot, processRoot);
      await loadProcesses();
      setSelectedProcessId(processId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed demo process");
    } finally {
      setSeeding(false);
    }
  };

  const openFileEditor = async (path: string) => {
    setOpenFilePath(path);
    setEditorContent("");
    setEditorError(null);
    setLoadingFile(true);
    try {
      const access = resolveFileAccess(path, explorerRootPath || workspacePath);
      const content = await codeReadFile(path, access.rootGuard, access.mode);
      setEditorContent(content);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Failed to open file");
    } finally {
      setLoadingFile(false);
    }
  };

  const saveFileEditor = async () => {
    if (!openFilePath) return;
    setSavingFile(true);
    setEditorError(null);
    try {
      const access = resolveFileAccess(openFilePath, explorerRootPath || workspacePath);
      await codeWriteFile(openFilePath, editorContent, access.rootGuard, access.mode);
      await loadExplorer(explorerPath || workspacePath);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSavingFile(false);
    }
  };

  const loadExplorer = useCallback(async (path: string, rootPathOverride?: string) => {
    const rootPath = normalizePath(rootPathOverride ?? explorerRootPath ?? workspacePath);
    if (!path.trim()) {
      setExplorerEntries([]);
      setExplorerError("No workspace path configured for this project.");
      return;
    }
    const targetPath = normalizePath(path);
    if (rootPath && targetPath !== rootPath && !targetPath.startsWith(`${rootPath}/`)) {
      setExplorerError("Path is outside this process directory.");
      return;
    }
    setExplorerLoading(true);
    setExplorerError(null);
    try {
      const entries = await codeListDir(targetPath, rootPath || null, "sandbox");
      const sorted = [...entries]
        .filter((entry) => entry.name !== PROCESS_MARKER_FILE)
        .sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
      });
      setExplorerPath(targetPath);
      setExplorerEntries(sorted);
    } catch (err) {
      const fallbackWorkspace = normalizePath(workspacePath);
      const expectedProcessDir =
        selectedProcessId && fallbackWorkspace
          ? `${fallbackWorkspace}/agent-processes/${selectedProcessId}`
          : "";
      const canRetry =
        Boolean(expectedProcessDir) &&
        (targetPath === expectedProcessDir || targetPath.startsWith(`${expectedProcessDir}/`));

      if (canRetry && selectedProcessId && fallbackWorkspace) {
        try {
          const ensuredRoot = await ensureProcessDirectory(fallbackWorkspace, selectedProcessId);
          const fallbackEntries = await codeListDir(targetPath, fallbackWorkspace, "sandbox");
          const fallbackSorted = [...fallbackEntries]
            .filter((entry) => entry.name !== PROCESS_MARKER_FILE)
            .sort((a, b) => {
              if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
          setExplorerRootPath(ensuredRoot);
          setExplorerPath(targetPath);
          setExplorerEntries(fallbackSorted);
          setExplorerError(null);
          return;
        } catch (retryErr) {
          setExplorerError(retryErr instanceof Error ? retryErr.message : "Failed to load directory");
          return;
        }
      }
      setExplorerError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setExplorerLoading(false);
    }
  }, [ensureProcessDirectory, explorerRootPath, selectedProcessId, workspacePath]);

  useEffect(() => {
    const nextRoot = normalizePath(processDirectoryPath);
    setExplorerRootPath(nextRoot);
    if (!nextRoot) {
      setExplorerPath("");
      setExplorerEntries([]);
      setExplorerError("No workspace path configured for this project.");
      return;
    }
    if (selectedProcessId && workspacePath) {
      void ensureProcessDirectory(normalizePath(workspacePath), selectedProcessId)
        .then((ensuredRoot) => loadExplorer(ensuredRoot, ensuredRoot))
        .catch((err) => {
          setExplorerError(err instanceof Error ? err.message : "Failed to load directory");
        });
      return;
    }
    void loadExplorer(nextRoot, nextRoot);
  }, [ensureProcessDirectory, loadExplorer, processDirectoryPath, selectedProcessId, workspacePath]);

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-dark pb-7">
      <div className="border-b border-line-light p-3">
        <p className="text-[10px] uppercase tracking-wider text-text-dark">API Used</p>
        <p className="mt-1 truncate text-xs text-text-med" title={apiUsedLabel}>{apiUsedLabel}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2" />

      <div className="sticky bottom-7 z-10 border-t border-line-light bg-bg-dark px-2 pt-2 pb-1">
        <div className="space-y-2">
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void sendTask();
              }
            }}
            placeholder="Assign task to subagents..."
            className="w-full rounded border border-line-med bg-line-light px-2 py-1.5 text-[11px] text-text-norm outline-none focus:border-accent-primary/50 resize-none min-h-20"
          />
          <div className="flex justify-end">
            <button
              onClick={() => void sendTask()}
              disabled={sending || !chatInput.trim()}
              className="inline-flex h-7 items-center justify-center gap-1 rounded border border-line-med bg-line-light px-2 text-[11px] text-text-med transition-colors hover:bg-line-med hover:text-text-norm disabled:opacity-60"
              title="Send"
            >
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <section className="border-b border-line-light px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-dark">Available Agents</p>
          </div>
          <span className="rounded border border-line-light bg-line-light/40 px-2 py-1 text-[10px] text-text-med">
            {detail?.process.status ?? selectedSummary?.status ?? "idle"}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedStageIndex(null)}
            className={cn(
              "text-sm transition-colors",
              selectedStageIndex == null ? "underline underline-offset-4 text-text-norm" : "text-text-med hover:underline"
            )}
          >
            All
          </button>
          {PROCESS_STEPS.map((step, idx) => (
            <div key={step} className="inline-flex items-center gap-2">
              <span className="text-text-dark/70">›</span>
              <StageLink
                label={step}
                state={stageStates[idx]}
                selected={selectedStageIndex === idx}
                onClick={() => setSelectedStageIndex(idx)}
              />
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="border-b border-line-light px-4 py-2 text-xs text-accent-red">{error}</div>
      )}

      <section className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <div className="mb-2 text-[10px] text-text-dark">
          <p className="truncate" title={explorerPath || explorerRootPath || "(no process directory)"}>
            {explorerPath
              ? explorerPath === explorerRootPath
                ? "."
                : `./${explorerPath.slice(explorerRootPath.length + 1)}`
              : explorerRootPath || "(no process directory)"}
          </p>
        </div>

        {explorerError ? (
          <div className="rounded border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">{explorerError}</div>
        ) : explorerLoading ? (
          <div className="flex h-40 items-center justify-center rounded border border-dashed border-line-med bg-line-light/20">
            <Loader2 size={16} className="animate-spin text-text-dark" />
          </div>
        ) : explorerEntries.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded border border-dashed border-line-med bg-line-light/20">
            <p className="text-xs text-text-dark">No files in this directory.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-line-light">
            <div className="grid grid-cols-[1fr_100px_72px] gap-2 border-b border-line-light bg-line-light/30 px-2 py-1 text-[10px] uppercase tracking-wider text-text-dark">
              <span>Name</span>
              <span className="text-right">Size</span>
              <span className="text-right">Type</span>
            </div>
            {explorerEntries.map((entry) => (
              <ArtifactTile
                key={entry.path}
                entry={entry}
                onOpen={() => {
                  if (entry.is_dir) {
                    void loadExplorer(entry.path);
                    return;
                  }
                  void openFileEditor(entry.path);
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-line-light px-4 py-2">
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap text-xs">{terminalOutput || "No terminal output yet."}</pre>
        <input
          value={terminalCommand}
          onChange={(e) => setTerminalCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !terminalRunning) {
              e.preventDefault();
              void runTerminalCommand();
            }
          }}
          placeholder="Type command and press Enter"
          className="mt-2 w-full text-xs"
        />
      </section>

      {openFilePath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line-med bg-bg-norm shadow-2xl">
            <div className="flex items-center justify-between border-b border-line-light px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs text-text-norm" title={openFilePath}>{fileName(openFilePath)}</p>
                <p className="truncate text-[10px] text-text-dark" title={openFilePath}>{openFilePath}</p>
              </div>
              <button
                onClick={() => setOpenFilePath(null)}
                className="rounded p-1 text-text-med hover:bg-line-light hover:text-text-norm"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-hidden p-3">
              {loadingFile ? (
                <div className="flex h-full items-center justify-center text-text-dark">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : (
                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="h-full w-full resize-none rounded border border-line-light bg-bg-dark p-3 font-mono text-[12px] leading-5 text-text-med outline-none focus:border-accent-primary/50"
                />
              )}
            </div>

            {editorError && (
              <div className="border-t border-line-light px-4 py-2 text-xs text-accent-red">{editorError}</div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-line-light px-4 py-2.5">
              <button
                onClick={() => setOpenFilePath(null)}
                className="rounded border border-line-med px-3 py-1.5 text-[11px] text-text-med hover:bg-line-light"
              >
                Close
              </button>
              <button
                onClick={() => void saveFileEditor()}
                disabled={loadingFile || savingFile}
                className="inline-flex items-center gap-1 rounded bg-accent-primary/20 px-3 py-1.5 text-[11px] text-accent-primary hover:bg-accent-primary/30 disabled:opacity-60"
              >
                {savingFile ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const jsonData = useMemo(
    () => ({
      selected_process_id: selectedProcessId,
      selected_summary: selectedSummary,
      process: detail?.process ?? null,
      stage_states: stageStates,
      artifact_count: filteredArtifacts.length,
      explorer_path: explorerPath,
      explorer_root_path: explorerRootPath,
      explorer_file_count: explorerEntries.length,
      recent_events: visibleEvents.slice(-20),
    }),
    [explorerEntries.length, explorerPath, explorerRootPath, filteredArtifacts.length, detail?.process, selectedProcessId, selectedSummary, stageStates, visibleEvents]
  );

  return (
    <PanelWrapper
      title={
        <span className="inline-flex items-center gap-2">
          <span>Project</span>
          <span className="rounded bg-line-med px-1.5 py-0.5 text-[10px] text-text-dark">{processes.length}</span>
        </span>
      }
      icon={<Users size={16} className="text-accent-primary" />}
      actions={
        <button
          onClick={() => void seedDemo()}
          disabled={seeding || loading}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors",
            seeding || loading
              ? "bg-line-light text-text-dark"
              : "bg-line-med text-text-med hover:bg-line-dark hover:text-text-norm"
          )}
        >
          {seeding ? <Loader2 size={12} className="animate-spin" /> : <Network size={12} />}
          {seeding ? "Seeding..." : "New Process"}
        </button>
      }
      fill
    >
      {showDevBanner && (
        <div className="flex items-center justify-between gap-2 border border-amber-400 bg-black/80 px-3 py-1 text-[11px] text-amber-300">
          <span>Project is under development.</span>
          <button
            onClick={() => setShowDevBanner(false)}
            className="rounded p-0.5 text-amber-300/90 hover:bg-amber-400/20 hover:text-amber-200"
            title="Dismiss"
            aria-label="Dismiss under development notice"
          >
            <X size={11} />
          </button>
        </div>
      )}
      <SplitPaneLayout
        sidebar={sidebar}
        content={content}
        jsonData={jsonData}
        jsonLabel="Agent Process"
        showJson={false}
        storageKey="arx-agents-process-sidebar-width"
      />
    </PanelWrapper>
  );
}
