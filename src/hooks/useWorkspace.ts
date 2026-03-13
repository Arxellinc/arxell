import { useWorkspaceStore } from "../store/workspaceStore";
import { useChatStore } from "../store/chatStore";
import { getLanguageFromPath } from "../lib/utils";
import {
  codeCreateFile,
  codeDeletePath,
  codeListDir,
  codeReadFile,
  codeWriteFile,
} from "../core/tooling/client";
import type { ToolMode } from "../core/tooling/types";

export function useWorkspace() {
  const { openTab, updateTabContent, markTabModified, setDiff } =
    useWorkspaceStore();
  const { activeProjectId, projects } = useChatStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const workspacePath = activeProject?.workspace_path?.trim() ?? "";
  const mode: ToolMode = "sandbox";
  const rootGuard = workspacePath || null;

  const normalize = (value: string) => value.replace(/\\/g, "/");
  const parentDir = (value: string): string | null => {
    const normalized = normalize(value).trim();
    if (!normalized) return null;
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return null;
    return normalized.slice(0, idx);
  };
  const resolveFileAccess = (path: string): { rootGuard: string | null; mode: ToolMode } => {
    const normalizedPath = normalize(path);
    const normalizedWorkspace = normalize(workspacePath);
    if (
      normalizedWorkspace &&
      (normalizedPath === normalizedWorkspace || normalizedPath.startsWith(`${normalizedWorkspace}/`))
    ) {
      return { rootGuard: normalizedWorkspace, mode: "sandbox" };
    }
    // For non-workspace absolute files (e.g. skills), sandbox them to their parent directory.
    const guard = parentDir(normalizedPath);
    return { rootGuard: guard, mode: guard ? "sandbox" : "shell" };
  };

  const requireWorkspaceRoot = () => {
    if (!workspacePath) {
      throw new Error("No active project workspace. Assign chat to a project first.");
    }
  };

  const openFile = async (path: string) => {
    const name = path.split("/").pop() ?? path;
    const language = getLanguageFromPath(path);
    try {
      const access = resolveFileAccess(path);
      const content = await codeReadFile(path, access.rootGuard, access.mode);
      openTab({ path, name, content, language, modified: false });
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  const saveFile = async (path: string, content: string) => {
    const access = resolveFileAccess(path);
    await codeWriteFile(path, content, access.rootGuard, access.mode);
    markTabModified(path, false);
  };

  const listDir = (path: string) => {
    requireWorkspaceRoot();
    return codeListDir(path, rootGuard, mode);
  };

  const showDiff = (
    path: string,
    original: string,
    modified: string
  ) => {
    const language = getLanguageFromPath(path);
    const title = path.split("/").pop() ?? path;
    setDiff({ original, modified, language, title });
  };

  const createNewFile = async (fileName?: string) => {
    requireWorkspaceRoot();
    // Generate a default file name if not provided
    const name = fileName ?? `untitled-${Date.now()}.txt`;
    const fullPath = `${workspacePath}/${name}`;
    
    try {
      // Create empty file on disk
      await codeCreateFile(fullPath, rootGuard, mode);
      // Open it in the editor
      const language = getLanguageFromPath(fullPath);
      openTab({ path: fullPath, name, content: "", language, modified: false });
      return fullPath;
    } catch (e) {
      console.error("Failed to create file:", e);
      throw e;
    }
  };

  const saveFileAs = async (oldPath: string, content: string) => {
    requireWorkspaceRoot();
    // Prompt for new file name using the old name as default
    const oldName = oldPath.split("/").pop() ?? "file.txt";
    const newName = prompt("Save as:", oldName);
    if (!newName) return null;
    
    const newPath = `${workspacePath}/${newName}`;
    
    try {
      await codeWriteFile(newPath, content, rootGuard, mode);
      return newPath;
    } catch (e) {
      console.error("Failed to save as:", e);
      throw e;
    }
  };

  const deleteFile = async (path: string) => {
    const access = resolveFileAccess(path);
    await codeDeletePath(path, access.rootGuard, access.mode);
  };

  return { openFile, saveFile, listDir, showDiff, createNewFile, saveFileAs, deleteFile };
}
