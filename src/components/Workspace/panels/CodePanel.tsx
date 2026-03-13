import { Code2, Settings } from "lucide-react";
import { PanelWrapper } from "./shared";

export function CodePanel() {
  return (
    <PanelWrapper
      title="Code"
      icon={<Code2 size={16} className="text-accent-primary" />}
      actions={
        <button
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
        >
          <Settings size={12} />
          Settings
        </button>
      }
    >
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Code2 size={32} className="text-text-dark mb-3" />
        <p className="text-sm text-text-dark mb-1">Code Workspace</p>
        <p className="text-xs text-text-dark">
          Select the "Code" tab to view the code editor with your workspace files.
        </p>
      </div>
    </PanelWrapper>
  );
}
