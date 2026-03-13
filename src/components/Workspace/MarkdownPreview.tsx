import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Eye, Edit3 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useWorkspace } from "../../hooks/useWorkspace";

interface MarkdownPreviewProps {
  path: string;
  content: string;
}

export function MarkdownPreview({ path, content }: MarkdownPreviewProps) {
  const [mode, setMode] = useState<"preview" | "split">("split");
  const { updateTabContent } = useWorkspaceStore();
  const { saveFile } = useWorkspace();

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-line-med bg-bg-norm flex-shrink-0">
        <button
          onClick={() => setMode("split")}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
            mode === "split"
              ? "bg-line-dark text-text-norm"
              : "text-text-dark hover:text-text-med"
          )}
        >
          <Edit3 size={11} /> Edit
        </button>
        <button
          onClick={() => setMode("preview")}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
            mode === "preview"
              ? "bg-line-dark text-text-norm"
              : "text-text-dark hover:text-text-med"
          )}
        >
          <Eye size={11} /> Preview
        </button>
      </div>

      <div className={cn("flex-1 overflow-hidden flex", mode === "split" ? "divide-x divide-line-med" : "")}>
        {/* Editor pane */}
        {mode === "split" && (
          <textarea
            value={content}
            onChange={(e) => updateTabContent(path, e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                saveFile(path, content);
              }
            }}
            className="flex-1 bg-transparent text-sm text-text-med font-mono p-4 resize-none outline-none leading-relaxed"
            spellCheck={false}
          />
        )}

        {/* Preview pane */}
        <div className="flex-1 overflow-y-auto p-6 prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
