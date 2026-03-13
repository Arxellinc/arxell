import { DiffEditor } from "@monaco-editor/react";
import { Check, X } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";

export function DiffViewer() {
  const { diffState, setDiff } = useWorkspaceStore();

  if (!diffState) return null;

  const handleAccept = async () => {
    // Accept the modified content
    setDiff(null);
  };

  const handleReject = () => {
    setDiff(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-line-med bg-bg-norm flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-med">Diff:</span>
          <span className="text-xs text-text-norm font-mono">{diffState.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReject}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-accent-red hover:bg-accent-red/10 transition-colors"
          >
            <X size={12} /> Reject
          </button>
          <button
            onClick={handleAccept}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-accent-green hover:bg-accent-green/10 transition-colors"
          >
            <Check size={12} /> Accept
          </button>
        </div>
      </div>
      <div className="flex-1">
        <DiffEditor
          height="100%"
          original={diffState.original}
          modified={diffState.modified}
          language={diffState.language}
          theme="vs-dark"
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            readOnly: false,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12 },
          }}
        />
      </div>
    </div>
  );
}
