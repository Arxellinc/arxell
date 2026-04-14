import type { WorkspaceToolRecord } from "../contracts";
import type { WorkspaceTab } from "../layout";

const PROTECTED_TOOL_IDS = new Set([
  "terminal",
  "files",
  "webSearch",
  "flow",
  "tasks",
  "createTool",
  "memory",
  "skills"
]);

function isSystemTool(toolId: string): boolean {
  return PROTECTED_TOOL_IDS.has(toolId);
}

interface WorkspaceToolManagerState {
  workspaceTools: WorkspaceToolRecord[];
  workspaceTab: WorkspaceTab;
}

interface WorkspaceToolManagerActionsDeps {
  state: WorkspaceToolManagerState;
  nextCorrelationId: () => string;
  toolInvokeOrThrow: (
    toolId: string,
    action: string,
    payload: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  deleteWorkspacePath: (path: string, recursive?: boolean) => Promise<void>;
  refreshTools: () => Promise<void>;
  pushConsoleEntry: (
    level: "log" | "info" | "warn" | "error" | "debug",
    source: "browser" | "app",
    message: string
  ) => void;
}

async function resolveWorkspaceRootPath(
  toolInvokeOrThrow: WorkspaceToolManagerActionsDeps["toolInvokeOrThrow"],
  nextCorrelationId: WorkspaceToolManagerActionsDeps["nextCorrelationId"]
): Promise<string> {
  const correlationId = nextCorrelationId();
  const data = await toolInvokeOrThrow("files", "list-directory", {
    correlationId
  });
  const rootPath = String(data.rootPath ?? "").trim();
  if (!rootPath) {
    throw new Error("Unable to resolve workspace root.");
  }
  return rootPath;
}

export function createWorkspaceToolManagerActions(deps: WorkspaceToolManagerActionsDeps): {
  exportSingleTool: (toolId: string) => Promise<void>;
  deleteSingleTool: (toolId: string) => Promise<void>;
} {
  const exportSingleTool = async (toolId: string): Promise<void> => {
    if (isSystemTool(toolId)) return;
    const root = await resolveWorkspaceRootPath(deps.toolInvokeOrThrow, deps.nextCorrelationId);
    const row = deps.state.workspaceTools.find((item) => item.toolId === toolId) || null;
    const entryPath = String(row?.entry ?? "").replace(/\\/g, "/");
    const pluginDirFromEntry = entryPath.includes("/dist/")
      ? entryPath.slice(0, entryPath.indexOf("/dist/"))
      : "";
    const toolDir =
      row?.source === "custom"
        ? pluginDirFromEntry || `${root}/plugins/${toolId}`
        : `${root}/frontend/src/tools/${toolId}`;

    const collectFiles = async (
      path: string
    ): Promise<Array<{ fullPath: string; relativePath: string }>> => {
      const correlationId = deps.nextCorrelationId();
      const listing = await deps.toolInvokeOrThrow("files", "list-directory", {
        correlationId,
        path
      });
      const entries =
        (listing.entries as Array<{ isDir?: boolean; path?: string }>) || [];
      const out: Array<{ fullPath: string; relativePath: string }> = [];
      for (const entry of entries) {
        const fullPath = String(entry.path ?? "");
        if (!fullPath) continue;
        if (entry.isDir) {
          const nested = await collectFiles(fullPath);
          out.push(...nested);
          continue;
        }
        const relativePath = fullPath.startsWith(`${toolDir}/`)
          ? fullPath.slice(toolDir.length + 1)
          : fullPath;
        out.push({ fullPath, relativePath });
      }
      return out;
    };

    const fileEntries = await collectFiles(toolDir);
    const files: Record<string, string> = {};
    for (const entry of fileEntries) {
      const correlationId = deps.nextCorrelationId();
      const data = await deps.toolInvokeOrThrow("files", "read-file", {
        correlationId,
        path: entry.fullPath
      });
      files[entry.relativePath] = String(data.content ?? "");
    }

    const payload = {
      toolId,
      source: row?.source || "unknown",
      exportedAt: new Date().toISOString(),
      files
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${toolId}-tool-export.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    deps.pushConsoleEntry("info", "browser", `Exported tool bundle for ${toolId}.`);
  };

  const deleteSingleTool = async (toolId: string): Promise<void> => {
    if (isSystemTool(toolId)) {
      deps.pushConsoleEntry("warn", "browser", `System tool '${toolId}' cannot be deleted.`);
      return;
    }
    const confirmed = window.confirm(
      `Delete tool '${toolId}'?\n\nThis will remove its files and generated wiring.\nConsider exporting first to keep a backup.`
    );
    if (!confirmed) return;

    const root = await resolveWorkspaceRootPath(deps.toolInvokeOrThrow, deps.nextCorrelationId);
    const pluginDir = `${root}/plugins/${toolId}`;
    const legacyToolDir = `${root}/frontend/src/tools/${toolId}`;

    await deps.deleteWorkspacePath(pluginDir, true).catch(() => undefined);
    await deps.deleteWorkspacePath(legacyToolDir, true).catch(() => undefined);
    deps.state.workspaceTools = deps.state.workspaceTools.filter((tool) => tool.toolId !== toolId);
    if (deps.state.workspaceTab === (`${toolId}-tool` as WorkspaceTab)) {
      deps.state.workspaceTab = "manager-tool";
    }
    deps.pushConsoleEntry(
      "info",
      "browser",
      `Removed tool '${toolId}' without modifying core host source files.`
    );
    await deps.refreshTools();
  };

  return {
    exportSingleTool,
    deleteSingleTool
  };
}
