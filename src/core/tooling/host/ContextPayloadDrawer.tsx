import { useEffect, useMemo, useState } from "react";
import { Braces, ChevronDown, ChevronUp } from "lucide-react";
import { useTaskStore } from "../../../store/taskStore";
import { useNotesStore } from "../../../store/notesStore";
import { useMcpStore } from "../../../store/mcpStore";
import { useChatStore } from "../../../store/chatStore";
import { useServeStore } from "../../../store/serveStore";
import { useWebPanelStore } from "../../../store/webPanelStore";
import type { ToolPanelId } from "../types";
import { memoryList, type MemoryEntry } from "../../../lib/tauri";
import {
  buildAgentMemoryPayload,
  buildMcpContextPayload,
  buildNotesContextPayload,
  buildRuntimeContextPayload,
  buildTaskContextPayload,
} from "../../../lib/contextPayloads";

interface ContextPayloadDrawerProps {
  panelId: ToolPanelId;
}

export function ContextPayloadDrawer({ panelId }: ContextPayloadDrawerProps) {
  const [open, setOpen] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<{
    user: MemoryEntry[];
    episodic: MemoryEntry[];
    project: MemoryEntry[];
  }>({ user: [], episodic: [], project: [] });

  const tasks = useTaskStore((s) => s.tasks);
  const notes = useNotesStore((s) => s.notes);
  const servers = useMcpStore((s) => s.servers);
  const activeProjectId = useChatStore((s) => s.activeProjectId);
  const projects = useChatStore((s) => s.projects);
  const activeMode = useChatStore((s) => s.activeMode);
  const activeSkillIds = useChatStore((s) => s.activeSkillIds);
  const webContextPayload = useWebPanelStore((s) => s.contextPayload);
  const modelInfo = useServeStore((s) => s.modelInfo);
  const systemResources = useServeStore((s) => s.systemResources);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [user, episodic, project] = await Promise.all([
          memoryList("user").catch((): MemoryEntry[] => []),
          memoryList("episodic").catch((): MemoryEntry[] => []),
          activeProjectId
            ? memoryList(`project_${activeProjectId}`).catch((): MemoryEntry[] => [])
            : Promise.resolve([] as MemoryEntry[]),
        ]);
        if (!cancelled) {
          setMemoryEntries({ user, episodic, project });
        }
      } catch {
        if (!cancelled) {
          setMemoryEntries({ user: [], episodic: [], project: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const runtimePayload = useMemo(() => {
    const cpu = systemResources?.cpu
      ? `${systemResources.cpu.name} (${systemResources.cpu.physicalCores}C/${systemResources.cpu.logicalCores}T)`
      : "Unknown";
    const memory = systemResources?.memory
      ? `${systemResources.memory.availableMb.toLocaleString()}MB free / ${systemResources.memory.totalMb.toLocaleString()}MB total`
      : "Unknown";
    const gpu = systemResources?.gpus?.[0]
      ? `${systemResources.gpus[0].name} (${systemResources.gpus[0].gpuType})`
      : "None";

    return buildRuntimeContextPayload({
      modelName: modelInfo?.name,
      contextLength: modelInfo?.contextLength,
      cpuLabel: cpu,
      memoryLabel: memory,
      gpuLabel: gpu,
    });
  }, [modelInfo, systemResources]);

  const taskPayload = useMemo(() => buildTaskContextPayload(tasks), [tasks]);
  const notesPayload = useMemo(() => buildNotesContextPayload(notes), [notes]);
  const mcpPayload = useMemo(() => buildMcpContextPayload(servers), [servers]);
  const memoryPayload = useMemo(
    () =>
      buildAgentMemoryPayload({
        userMemory: memoryEntries.user,
        episodicMemory: memoryEntries.episodic,
        projectMemory: memoryEntries.project,
      }),
    [memoryEntries]
  );

  const workspacePath = useMemo(() => {
    const activeProject = projects.find((project) => project.id === activeProjectId);
    return activeProject?.workspace_path ?? "";
  }, [activeProjectId, projects]);

  const payload = useMemo(() => {
    const common = {
      panel_id: panelId,
      active_mode: activeMode,
      active_skill_ids: activeSkillIds,
      workspace_path: workspacePath || null,
      runtime: runtimePayload,
    };

    if (panelId === "tasks") return { ...common, tasks: taskPayload };
    if (panelId === "notes") return { ...common, notes: notesPayload };
    if (panelId === "project") return { ...common, memory: memoryPayload };
    if (panelId === "settings") return { ...common, memory: memoryPayload };
    if (panelId === "tools" || panelId === "extensions") return { ...common, mcp: mcpPayload };
    if (panelId === "web") return { ...common, web: webContextPayload };

    return {
      ...common,
      memory: memoryPayload,
      tasks: taskPayload,
      notes: notesPayload,
      mcp: mcpPayload,
      web: webContextPayload,
    };
  }, [
    activeMode,
    activeSkillIds,
    mcpPayload,
    memoryPayload,
    notesPayload,
    panelId,
    runtimePayload,
    taskPayload,
    webContextPayload,
    workspacePath,
  ]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">
      <div className="w-full border-t border-line-med bg-bg-dark/95 backdrop-blur-sm pointer-events-auto">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full h-7 px-2 flex items-center justify-between text-[11px] text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
          title="Context payload used for agent visibility"
        >
          <span className="inline-flex items-center gap-1.5">
            <Braces size={12} />
            Context Payload
          </span>
          {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>

        {open && (
          <div className="max-h-52 overflow-auto border-t border-line-light p-2">
            <pre className="text-[10px] leading-4 text-text-dark whitespace-pre-wrap break-words">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
