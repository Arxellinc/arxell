import { useEffect, useRef, useState } from "react";
import {
  Code2,
  Eye,
  FolderOpen,
  GitMerge,
  Redo2,
  Trash2,
  Undo2,
  X,
  Plus,
  Save,
  SquareArrowRight,
  WrapText,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useChatStore } from "../../store/chatStore";
import { useToolPanelStore } from "../../store/toolPanelStore";
import { useWorkspace } from "../../hooks/useWorkspace";
import { FileTree } from "./FileTree";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { DiffViewer } from "./DiffViewer";
import { MarkdownPreview } from "./MarkdownPreview";
import { Terminal } from "./Terminal";
import { ToolBar } from "./ToolBar";
import { cn } from "../../lib/utils";
import type { FileEntry } from "../../types";
import { ToolHost } from "../../core/tooling/host/ToolHost";
import { getHostedPanel } from "../../core/tooling/registry";

const TERMINAL_MIN = 28;
const TERMINAL_MAX = 400;
const TERMINAL_DEFAULT = 150;

export function WorkspacePanel() {
  const {
    tabs,
    activeTabPath,
    view,
    diffState,
    sidebarPath,
    setActiveTab,
    closeTab,
  } = useWorkspaceStore();
  const { activeProjectId, projects } = useChatStore();
  const { openFile, saveFile, createNewFile, saveFileAs, deleteFile } = useWorkspace();
  const {
    activePanel,
    consoleVisible,
    agentActivationToken,
    agentActivationPanel,
    toolbarPosition,
  } = useToolPanelStore();
  const [showAgentActivationFlash, setShowAgentActivationFlash] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [fileTreeRefreshNonce, setFileTreeRefreshNonce] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(TERMINAL_DEFAULT);
  const terminalResizeRef = useRef<{ lastY: number; active: boolean }>({ lastY: 0, active: false });
  const codeEditorRef = useRef<CodeEditorHandle | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const workspacePath = activeProject?.workspace_path ?? "";
  const fileTreeRoot = sidebarPath?.trim() || workspacePath;
  const activeTab = tabs.find((t) => t.path === activeTabPath);
  const isHorizontalToolbar = toolbarPosition === "top";

  const handleFileOpen = async (entry: FileEntry) => {
    if (!entry.is_dir) await openFile(entry.path);
  };

  const handleOpenDialog = async () => {
    try {
      const selected = await openDialog({ multiple: false, directory: false });
      if (selected && typeof selected === "string") {
        await openFile(selected);
      }
    } catch (e) {
      console.error("Open dialog error:", e);
    }
  };

  const handleSave = () => {
    if (activeTab) saveFile(activeTab.path, activeTab.content);
  };

  const handleSaveAs = async () => {
    if (!activeTab) return;
    try {
      const newPath = await saveFileAs(activeTab.path, activeTab.content);
      if (newPath) {
        await openFile(newPath);
      }
    } catch (e) {
      console.error("Failed to save as:", e);
    }
  };

  const handleNewFile = async () => {
    try {
      await createNewFile();
    } catch (e) {
      console.error("Failed to create new file:", e);
    }
  };

  // Path breadcrumb: show last 2 segments
  const pathCrumb = (() => {
    if (!activeTab) return null;
    const parts = activeTab.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length <= 1) return parts[0] ?? "";
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  })();

  const renderEditor = () => {
    if (view === "diff" && diffState) return <DiffViewer />;
    if (!activeTab) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
          <Code2 size={28} className="text-text-dark" />
          <p className="text-sm text-text-dark">No file open</p>
          <p className="text-xs text-text-dark">
            Open a file from the tree, or ask the AI to create one
          </p>
        </div>
      );
    }
    // For markdown, show preview only when showPreview is true, otherwise show code editor
    if (activeTab.language === "markdown" && showPreview) {
      return <MarkdownPreview path={activeTab.path} content={activeTab.content} />;
    }
    return (
      <CodeEditor
        ref={codeEditorRef}
        key={activeTab.path}
        path={activeTab.path}
        content={activeTab.content}
        language={activeTab.language}
        wordWrap={wordWrap}
      />
    );
  };

  // Render the main content area based on active panel
  const renderMainContent = () => {
    // For files/code panels, show the traditional file tree + editor layout
    if (activePanel === "files" || activePanel === "code" || activePanel === "none") {
      return (
        <div className="flex h-full min-w-0 min-h-0 overflow-hidden">
          {/* File tree panel - only show for files panel */}
          {activePanel === "files" && (
            <div className="w-52 border-r border-line-light flex flex-col overflow-hidden flex-shrink-0">
              <FileTree
                rootPath={fileTreeRoot}
                onFileOpen={handleFileOpen}
                refreshNonce={fileTreeRefreshNonce}
              />
            </div>
          )}

          {/* Editor area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Editor toolbar */}
            <div className="h-12 flex items-center gap-1 px-3 border-b border-line-light bg-bg-light flex-shrink-0">
              {/* New */}
              <button
                onClick={handleNewFile}
                title="Create new file"
                className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
              >
                <Plus size={18} />
              </button>

              {/* Open */}
              <button
                onClick={handleOpenDialog}
                title="Open file"
                className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
              >
                <FolderOpen size={18} />
              </button>

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={!activeTab || (!activeTab.modified && view !== "diff")}
                title="Save file (Ctrl+S)"
                className={cn(
                  "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                  activeTab?.modified
                    ? "text-accent-primary hover:text-accent-primary hover:bg-accent-primary/10"
                    : "text-text-dark opacity-50 cursor-not-allowed"
                )}
              >
                <Save size={18} />
              </button>

              {/* Save As */}
              <button
                onClick={handleSaveAs}
                disabled={!activeTab}
                title="Save file as..."
                className={cn(
                  "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                  activeTab
                    ? "text-text-med hover:text-text-norm hover:bg-line-light"
                    : "text-text-dark opacity-50 cursor-not-allowed"
                )}
              >
                <SquareArrowRight size={18} />
              </button>

              {/* Close */}
              <button
                onClick={() => {
                  if (!activeTab) return;
                  closeTab(activeTab.path);
                }}
                disabled={!activeTab}
                title="Close file"
                className={cn(
                  "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                  activeTab
                    ? "text-text-med hover:text-text-norm hover:bg-line-light"
                    : "text-text-dark opacity-50 cursor-not-allowed"
                )}
              >
                <X size={18} />
              </button>

              {/* Delete */}
              <button
                onClick={async () => {
                  if (!activeTab) return;
                  const ok = confirm(`Delete file?\n${activeTab.path}`);
                  if (!ok) return;
                  try {
                    await deleteFile(activeTab.path);
                    closeTab(activeTab.path);
                    setFileTreeRefreshNonce((v) => v + 1);
                  } catch (e) {
                    console.error("Failed to delete file:", e);
                  }
                }}
                disabled={!activeTab}
                title="Delete file"
                className={cn(
                  "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                  activeTab
                    ? "text-accent-red hover:text-accent-red hover:bg-accent-red/10"
                    : "text-text-dark opacity-50 cursor-not-allowed"
                )}
              >
                <Trash2 size={18} />
              </button>

              {/* Separator */}
              <div className="w-px h-3.5 bg-line-light mx-0.5" />

              {/* Word wrap */}
              <button
                onClick={() => setWordWrap((w) => !w)}
                title="Toggle word wrap"
                className={cn(
                  "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                  wordWrap
                    ? "text-accent-primary bg-accent-primary/10"
                    : "text-text-med hover:text-text-norm hover:bg-line-light"
                )}
              >
                <WrapText size={18} />
              </button>

              {/* Undo */}
              <button
                onClick={() => codeEditorRef.current?.undo()}
                disabled={!activeTab || showPreview || view === "diff"}
                title="Undo"
                className={cn(
                  "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                  activeTab && !showPreview && view !== "diff"
                    ? "text-text-med hover:text-text-norm hover:bg-line-light"
                    : "text-text-dark opacity-50 cursor-not-allowed"
                )}
              >
                <Undo2 size={18} />
              </button>

              {/* Redo */}
              <button
                onClick={() => codeEditorRef.current?.redo()}
                disabled={!activeTab || showPreview || view === "diff"}
                title="Redo"
                className={cn(
                  "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                  activeTab && !showPreview && view !== "diff"
                    ? "text-text-med hover:text-text-norm hover:bg-line-light"
                    : "text-text-dark opacity-50 cursor-not-allowed"
                )}
              >
                <Redo2 size={18} />
              </button>

              {/* Preview toggle - only for markdown files */}
              {activeTab?.language === "markdown" && (
                <button
                  onClick={() => setShowPreview((p) => !p)}
                  title="Toggle preview"
                  className={cn(
                    "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                    showPreview
                      ? "text-accent-primary bg-accent-primary/10"
                      : "text-text-med hover:text-text-norm hover:bg-line-light"
                  )}
                >
                  <Eye size={18} />
                </button>
              )}

              {/* Diff button */}
              {diffState && (
                <button
                  onClick={() => useWorkspaceStore.getState().setView("diff")}
                  className={cn(
                    "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                    view === "diff"
                      ? "text-accent-gold bg-accent-gold/10"
                      : "text-text-med hover:text-text-norm hover:bg-line-light"
                  )}
                  title="View diff"
                >
                  <GitMerge size={18} />
                </button>
              )}

              {/* Breadcrumb — push to right */}
              {pathCrumb && (
                <span
                  className="ml-auto text-[10px] text-text-dark truncate max-w-[200px] font-mono pr-1"
                  title={activeTab?.path}
                >
                  {pathCrumb}
                </span>
              )}
            </div>

            {/* Open file tabs */}
            {tabs.length > 0 && (
              <div className="h-8 flex items-center gap-1 px-2 border-b border-line-light bg-bg-light overflow-x-auto scrollbar-none">
                {tabs.map((tab) => {
                  const isActive = tab.path === activeTabPath;
                  return (
                    <button
                      key={tab.path}
                      onClick={() => setActiveTab(tab.path)}
                      className={cn(
                        "group inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11px] border transition-colors max-w-[220px] flex-shrink-0",
                        isActive
                          ? "bg-line-light text-text-norm border-line-med"
                          : "bg-transparent text-text-med border-transparent hover:bg-line-light/70 hover:text-text-norm"
                      )}
                      title={tab.path}
                    >
                      <span className="truncate">{tab.name}</span>
                      {tab.modified && <span className="text-[10px] text-accent-gold">•</span>}
                      <span
                        role="button"
                        aria-label={`Close ${tab.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeTab(tab.path);
                        }}
                        className="inline-flex items-center justify-center rounded p-0.5 text-text-dark hover:text-text-norm hover:bg-line-med"
                      >
                        <X size={11} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Editor / Preview / Diff */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {renderEditor()}
            </div>
          </div>
        </div>
      );
    }

    // For other panels, render hosted tool panel when available
    if (getHostedPanel(activePanel)) {
      return <ToolHost panelId={activePanel} />;
    }

    // Fallback - empty state
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
        <Code2 size={28} className="text-text-dark" />
        <p className="text-sm text-text-dark">Select a panel from the toolbar</p>
      </div>
    );
  };

  useEffect(() => {
    if (agentActivationToken <= 0) return;
    if (!agentActivationPanel || agentActivationPanel !== activePanel) return;
    setShowAgentActivationFlash(true);
    const timer = setTimeout(() => setShowAgentActivationFlash(false), 520);
    return () => clearTimeout(timer);
  }, [agentActivationPanel, agentActivationToken, activePanel]);

  return (
    <div
      id="arx-workspace-panel"
      className={cn(
        isHorizontalToolbar ? "flex-col border-l-0" : "flex-row border-l border-line-light",
        "flex h-full bg-bg-dark overflow-hidden"
      )}
    >
      <ToolBar />

      {/* Content column (main view + bottom console) */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        {/* Main content area */}
        <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
          {renderMainContent()}
          {showAgentActivationFlash && (
            <div className="pointer-events-none absolute inset-0 z-20 bg-blue-400/12 animate-pulse" />
          )}
        </div>

        {/* Console resize handle - only visible when console is visible */}
        {consoleVisible && (
          <div
            className="h-[3px] flex-shrink-0 cursor-row-resize group z-10 bg-line-light hover:bg-accent-primary/50 active:bg-accent-primary/80 transition-colors"
            onPointerDown={(e) => {
              terminalResizeRef.current.active = true;
              terminalResizeRef.current.lastY = e.clientY;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!terminalResizeRef.current.active) return;
              const delta = terminalResizeRef.current.lastY - e.clientY;
              setTerminalHeight((h) => Math.max(TERMINAL_MIN, Math.min(TERMINAL_MAX, h + delta)));
              terminalResizeRef.current.lastY = e.clientY;
            }}
            onPointerUp={(e) => {
              terminalResizeRef.current.active = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          />
        )}

        {/* Console panel - aligned to content column, right of toolbar */}
        {consoleVisible && (
          <Terminal
            height={terminalHeight}
            onHeightChange={setTerminalHeight}
          />
        )}
      </div>
    </div>
  );
}
