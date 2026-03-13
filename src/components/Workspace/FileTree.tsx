import { useState, useEffect } from "react";
import {
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { FileEntry } from "../../types";
import { codeListDir } from "../../core/tooling/client";
import type { ToolMode } from "../../core/tooling/types";
import { useChatStore } from "../../store/chatStore";
import { skillsDir } from "../../lib/tauri";

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  onFileClick: (entry: FileEntry) => void;
  rootGuard: string | null;
  mode: ToolMode;
  defaultExpanded?: boolean;
}

function TreeNode({ entry, depth, onFileClick, rootGuard, mode, defaultExpanded = false }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadChildren = async () => {
    if (!entry.is_dir || loading) return;
    setLoading(true);
    try {
      const items = await codeListDir(entry.path, rootGuard, mode);
      setChildren(items);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const toggle = async () => {
    if (!entry.is_dir) {
      onFileClick(entry);
      return;
    }
    if (!expanded && children.length === 0) {
      await loadChildren();
    }
    setExpanded((v) => !v);
  };

  useEffect(() => {
    if (defaultExpanded) {
      void loadChildren();
    }
  }, [defaultExpanded, entry.path, rootGuard, mode]);

  const fileIcon = () => {
    const ext = entry.name.split(".").pop()?.toLowerCase();
    const colors: Record<string, string> = {
      ts: "text-blue-400",
      tsx: "text-blue-400",
      js: "text-yellow-400",
      jsx: "text-yellow-400",
      rs: "text-orange-400",
      py: "text-accent-green",
      md: "text-purple-400",
      json: "text-yellow-300",
      css: "text-pink-400",
      html: "text-orange-300",
    };
    return colors[ext ?? ""] ?? "text-text-dark";
  };

  return (
    <div>
      <div
        className="group flex items-center gap-1 py-0.5 cursor-pointer hover:bg-line-light rounded transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={toggle}
      >
        {entry.is_dir ? (
          <>
            {loading ? (
              <RefreshCw size={10} className="text-text-dark animate-spin flex-shrink-0" />
            ) : expanded ? (
              <ChevronDown size={10} className="text-text-dark flex-shrink-0" />
            ) : (
              <ChevronRight size={10} className="text-text-dark flex-shrink-0" />
            )}
            {expanded ? (
              <FolderOpen size={13} className="text-accent-primary/70 flex-shrink-0" />
            ) : (
              <Folder size={13} className="text-accent-primary/50 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 flex-shrink-0" />
            <File size={12} className={cn("flex-shrink-0", fileIcon())} />
          </>
        )}
        <span className="text-xs text-text-med truncate group-hover:text-text-norm transition-colors">
          {entry.name}
        </span>
      </div>
      {expanded &&
        children.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            onFileClick={onFileClick}
            rootGuard={rootGuard}
            mode={mode}
          />
        ))}
    </div>
  );
}

interface FileTreeProps {
  rootPath: string;
  onFileOpen: (entry: FileEntry) => void;
  refreshNonce?: number;
}

function deriveArxellDocumentsRoot(paths: string[]): string {
  const normalized = paths
    .map((p) => p.trim().replace(/\\/g, "/"))
    .filter((p) => p.length > 0);
  for (const path of normalized) {
    const m = path.match(/^(.*\/Documents\/Arxell)(?:\/.*)?$/i);
    if (m?.[1]) return m[1];
  }
  for (const path of normalized) {
    const idx = path.toLowerCase().indexOf("/projects/");
    if (idx > 0) return path.slice(0, idx);
  }
  return normalized[0] ?? "";
}

export function FileTree({ rootPath, onFileOpen, refreshNonce = 0 }: FileTreeProps) {
  const projects = useChatStore((s) => s.projects);
  const projectOptions = projects
    .filter((project) => project.workspace_path?.trim().length > 0)
    .map((project) => ({
      id: project.id,
      name: project.name || project.id,
      path: project.workspace_path.trim(),
    }));
  const arxellDocumentsRoot = deriveArxellDocumentsRoot([
    rootPath,
    ...projectOptions.map((option) => option.path),
  ]);
  const [scope, setScope] = useState<string>(arxellDocumentsRoot ? "arxell" : "current");
  const [skillsRoot, setSkillsRoot] = useState<string>("");
  const [appDataRoot, setAppDataRoot] = useState<string>("");
  const [toolsRoot, setToolsRoot] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const selectedProject = scope.startsWith("project:")
    ? projectOptions.find((option) => option.id === scope.slice("project:".length))
    : null;
  const effectiveRootPath =
    scope === "root"
      ? "/"
      : scope === "arxell"
      ? arxellDocumentsRoot
      : scope === "skills"
      ? skillsRoot
      : scope === "tools"
      ? toolsRoot
      : scope === "appdata"
      ? appDataRoot
      : selectedProject?.path ?? rootPath;
  const effectiveMode: ToolMode = scope === "root" ? "root" : "sandbox";
  const effectiveRootGuard = scope === "root" ? null : effectiveRootPath || null;
  const rootName =
    effectiveRootPath.replace(/\/+$/, "").split(/[\\/]/).filter(Boolean).pop() || effectiveRootPath;

  useEffect(() => {
    if (arxellDocumentsRoot && scope === "current") {
      setScope("arxell");
    }
  }, [arxellDocumentsRoot, scope]);

  useEffect(() => {
    let cancelled = false;
    const loadSystemRoots = async () => {
      try {
        const skillsPathRaw = (await skillsDir()).trim();
        if (!skillsPathRaw) return;
        const normalized = skillsPathRaw.replace(/\\/g, "/");
        const appData = normalized.replace(/\/skills\/?$/i, "");
        const tools = `${appData}/coder`;
        if (!cancelled) {
          setSkillsRoot(skillsPathRaw);
          setAppDataRoot(appData);
          setToolsRoot(tools);
        }
      } catch {
        if (!cancelled) {
          setSkillsRoot("");
          setAppDataRoot("");
          setToolsRoot("");
        }
      }
    };
    void loadSystemRoots();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = async () => {
    if (!effectiveRootPath) return;
    setLoading(true);
    setError(null);
    try {
      await codeListDir(effectiveRootPath, effectiveRootGuard, effectiveMode);
      setRefreshToken((v) => v + 1);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [effectiveMode, effectiveRootGuard, effectiveRootPath, refreshNonce]);

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 flex items-center px-3 border-b border-line-light bg-bg-light">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="h-7 w-full max-w-[170px] rounded border border-line-light bg-transparent px-2 text-[11px] text-text-med outline-none"
          title={effectiveRootPath || "No root path"}
        >
          {skillsRoot && (
            <option value="skills" className="bg-bg-dark text-text-med">
              Skills: {skillsRoot}
            </option>
          )}
          {toolsRoot && (
            <option value="tools" className="bg-bg-dark text-text-med">
              Tools: {toolsRoot}
            </option>
          )}
          {appDataRoot && (
            <option value="appdata" className="bg-bg-dark text-text-med">
              App Data: {appDataRoot}
            </option>
          )}
          {arxellDocumentsRoot && (
            <option value="arxell" className="bg-bg-dark text-text-med">
              Arxell: {arxellDocumentsRoot}
            </option>
          )}
          <option value="current" className="bg-bg-dark text-text-med">
            Current: {rootName || "(none)"}
          </option>
          <option value="root" className="bg-bg-dark text-text-med">
            Root: /
          </option>
          {projectOptions.map((project) => (
            <option
              key={project.id}
              value={`project:${project.id}`}
              className="bg-bg-dark text-text-med"
            >
              Project: {project.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {!effectiveRootPath && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-text-dark">No current root path set</p>
            <p className="text-[10px] text-text-dark mt-1">Use Root mode to browse system files</p>
          </div>
        )}
        {error && (
          <p className="px-3 py-2 text-xs text-accent-red/70">{error}</p>
        )}
        {!error && effectiveRootPath && (
          <TreeNode
            key={`${scope}:${effectiveRootPath}:${refreshToken}:${refreshNonce}`}
            entry={{ name: rootName, path: effectiveRootPath, is_dir: true, size: 0 }}
            depth={0}
            onFileClick={onFileOpen}
            rootGuard={effectiveRootGuard}
            mode={effectiveMode}
            defaultExpanded
          />
        )}
      </div>
    </div>
  );
}
